// ============================================================================
// Edge Function "pdb-nucleo" — backend do Portal dos Bosques (loteadora).
// Mesma fundação da Domo Construtora, com as regras do negócio de loteamento:
//
//   • UM LOTE, UMA VENDA VIVA — a trava é aqui, no único lugar que enxerga o
//     estado real (a planilha tinha 3 lotes vendidos duas vezes sem aviso).
//   • O STATUS DO LOTE É DECIDIDO PELO SERVIDOR a partir da venda, nunca
//     aceito do navegador (venda ativa/quitada = Vendido; distrato liberta).
//   • RECEBIMENTO É FATO: cada baixa é um registro próprio (RB-0001), com
//     autor carimbado pelo servidor. O carnê é derivado, nunca gravado.
//
// Duas camadas de autenticação (iguais às da Domo):
//   1. TOKEN (header x-token) — barra robô/curioso. Viaja no navegador, é leve.
//   2. SENHA (header x-senha = sha256 da senha digitada) — conferida aqui.
//
// verify_jwt = false no config.toml: o preflight CORS chega sem token e o
// gateway barraria antes de o código rodar. A autorização é feita AQUI.
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { COLECOES } from "../_shared/colecoes.ts";
import {
  PERFIS, identificar, cfgSemSegredo, podeFazer, motivoRecusa,
  filtrarLeitura, hashGuardado, perfilDe, sha256, type Quem,
} from "../_shared/acesso.ts";
import { arquivosDoRegistro } from "../_shared/arquivos.ts";
import {
  db, agora, idNovo, tokenCurto, lerUm, gravarUm, lerTudo, apagarDeVez,
  lerCfgBruta, gravarCfg, proximoNumero, guardarIndiceNumero, lerNumeracao,
  definirNumeracao, registrarLog, lerLog, apagarArquivo, marcarMudanca,
  lerColecaoBruta, gravarVarios,
} from "../_shared/dados.ts";

const NOMES_COLECOES = Object.keys(COLECOES);

// ── Configuração padrão ─────────────────────────────────────────────────────
const CFG_PADRAO = {
  empresa: {
    nome: "ASSOCIAÇÃO CAMPESTRE PORTAL DOS BOSQUES",
    nomeCurto: "Portal dos Bosques",
    cnpj: "", endereco: "", cidade: "Montes Claros", uf: "MG", telefone: "", email: "",
  },
  // Reajuste da parcela "Reajustada": +pct% a cada `aCada` parcelas
  // (aniversário do contrato). REGRA ASSUMIDA — confirmar com a direção.
  reajuste: { pct: 6, aCada: 12 },
  formasPg: ["PIX", "Dinheiro", "Transferência", "Boleto", "Cartão de Débito", "Cartão de Crédito", "Cheque", "Permuta"],
  categoriasDespesa: ["Obra / infraestrutura", "Funcionários", "Comissão", "Marketing",
    "Administrativo", "Impostos e taxas", "Contabilidade", "Telefone / internet",
    "Tarifas bancárias", "Distrato / devolução", "Outros"],
  categoriasReceita: ["Aluguel", "Antecipação", "Sócios", "Outros"],
  // Dias de validade padrão de uma proposta enviada.
  validadeProposta: 7,
  // A entrada com que o simulador abre (a "fixa de 3 mil" da casa).
  entradaPadrao: 3000,
  senhaHash: null,
  usuarios: [] as any[],
  atualizadoEm: null,
};

async function lerCfg(): Promise<any> {
  const salvo = await lerCfgBruta();
  return { ...CFG_PADRAO, ...(salvo || {}) };
}

/* ── União de listas de dois donos ─────────────────────────────────────────── */
// Listas em que os dois lados TÊM RAZÃO ao mesmo tempo: em vez de o último a
// gravar apagar o do outro, o servidor junta item a item pelo id.
const CAMPOS_UNIAO = ["historico", "anexos", "versoes", "documentos", "cobrancas"];

function unirPorId(antigo: any, novo: any): any[] {
  const a = Array.isArray(antigo) ? antigo : [];
  const b = Array.isArray(novo) ? novo : [];
  const vistos = new Map<string, any>();
  for (const it of a.concat(b)) {
    if (!it) continue;
    const k = it.id || (it.em || "") + "|" + (it.o_que || it.texto || "");
    vistos.set(k, { ...(vistos.get(k) || {}), ...it });
  }
  return Array.from(vistos.values());
}

const txt = (v: unknown, max?: number) => String(v == null ? "" : v).slice(0, max || 200).trim();
const num = (v: unknown) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };

/* ── O status do lote é conta do servidor ──────────────────────────────────── */
// Chamado depois de gravar/apagar/restaurar uma venda. A venda viva manda:
// ativa/conferir/quitada → Vendido; distratada ou apagada → Disponível.
async function recalcularLote(loteId: string) {
  if (!loteId) return;
  const lote = await lerUm("lote", loteId);
  if (!lote) return;
  // Vendas deste lote: o vínculo forte é lote.vendaId + a conferência da venda.
  let vendaViva: any = null;
  if (lote.vendaId) {
    const v = await lerUm("venda", lote.vendaId);
    if (v && !v.apagadoEm && ["ativa", "conferir", "quitada"].includes(v.situacao || "ativa")) vendaViva = v;
  }
  const statusNovo = vendaViva ? "Vendido" : (lote.reservadoPor ? "Reservado" : "Disponível");
  const vendaIdNovo = vendaViva ? vendaViva.id : null;
  if (lote.status === statusNovo && (lote.vendaId || null) === vendaIdNovo) return;
  lote.status = statusNovo;
  lote.vendaId = vendaIdNovo;
  lote.atualizadoEm = agora();
  await gravarUm("lote", lote.id, lote);
  await marcarMudanca("lote");
}

/* ── Gravação: onde mora a inteligência ─────────────────────────────────────── */
async function gravar(col: string, registro: any, por: string): Promise<any> {
  if (!COLECOES[col]) throw new Error("Coleção desconhecida: " + col);
  const id = registro.id || idNovo();
  const antigo = await lerUm(col, id);
  const novo: any = { ...(antigo || {}), ...registro, id };

  for (const campo of CAMPOS_UNIAO) {
    if (antigo && (antigo[campo] || registro[campo])) novo[campo] = unirPorId(antigo[campo], registro[campo]);
  }

  // Venda distratada não "desdistrata" por um aparelho com cache velho: o
  // caminho de volta é explícito (a direção reabre pela ficha, com histórico).
  if (col === "venda" && antigo && antigo.situacao === "distratada" &&
      (!registro.situacao || registro.situacao !== antigo.situacao) && !registro._reabrir) {
    novo.situacao = "distratada";
  }
  delete novo._reabrir;

  // O status do lote NUNCA vem do navegador (só reservadoPor é aceito).
  if (col === "lote") {
    if (antigo) { novo.status = antigo.status; novo.vendaId = antigo.vendaId; }
    else { novo.status = "Disponível"; novo.vendaId = null; }
    // Sem venda viva, o status segue a RESERVA: reservou → Reservado;
    // liberou (reservadoPor: null explícito) → Disponível. Campo ausente
    // preserva a reserva que estava (upsert não pode soltar reserva alheia).
    if (!novo.vendaId) novo.status = novo.reservadoPor ? "Reservado" : "Disponível";
  }

  if (!novo.criadoEm) { novo.criadoEm = agora(); novo.criadoPor = por || registro.criadoPor || "—"; }
  novo.atualizadoEm = agora();
  novo.atualizadoPor = por || novo.atualizadoPor || "—";

  const pre = COLECOES[col].pre;
  if (pre && !novo.numero) {
    novo.numero = await proximoNumero(col);
    novo.codigo = pre + "-" + String(novo.numero).padStart(4, "0");
    try { await guardarIndiceNumero(col, novo.numero, id); } catch { /* índice é atalho */ }
  }
  if (pre && !novo.codigo && novo.numero) novo.codigo = pre + "-" + String(novo.numero).padStart(4, "0");

  // Proposta ganha o link público (WhatsApp) na primeira gravação.
  if (col === "prop" && !novo.tokenPublico) novo.tokenPublico = tokenCurto();

  await gravarUm(col, id, novo);
  await marcarMudanca(col);

  // A venda mexeu? O lote acompanha (vendido, libertado pelo distrato…).
  if (col === "venda") {
    // O lote apontado pela venda ganha o vínculo antes do recálculo.
    if (novo.loteId && ["ativa", "conferir", "quitada"].includes(novo.situacao || "ativa")) {
      const lote = await lerUm("lote", novo.loteId);
      if (lote && lote.vendaId !== id) {
        lote.vendaId = id;
        await gravarUm("lote", lote.id, lote);
      }
    }
    await recalcularLote(novo.loteId);
    // Trocou de lote? O antigo também é recalculado (senão fica preso em Vendido).
    if (antigo && antigo.loteId && antigo.loteId !== novo.loteId) await recalcularLote(antigo.loteId);
  }

  novo._col = col;
  return novo;
}

/* ── Regras por coleção na entrada do salvarLote ───────────────────────────── */
// Devolve { erro } para recusar, ou { registro } saneado para gravar.
async function prepararItem(quem: Quem, col: string, registro: any, atual: any): Promise<{ erro?: string; registro?: any }> {
  // VENDA: um lote, uma venda viva.
  if (col === "venda") {
    const situacao = registro.situacao || (atual && atual.situacao) || "ativa";
    const loteId = txt(registro.loteId || (atual && atual.loteId), 40);
    if (!loteId) return { erro: "venda sem lote" };
    if (["ativa", "conferir"].includes(situacao)) {
      const lote = await lerUm("lote", loteId);
      if (!lote || lote.apagadoEm) return { erro: "lote " + loteId + " não existe" };
      if (lote.vendaId && lote.vendaId !== (registro.id || "")) {
        const outra = await lerUm("venda", lote.vendaId);
        if (outra && !outra.apagadoEm && ["ativa", "conferir", "quitada"].includes(outra.situacao || "ativa")) {
          return { erro: "o lote " + (lote.quadra ? "Q" + lote.quadra + "-L" + lote.lote : loteId) +
            " já tem venda viva (" + (outra.codigo || "") + " — " + (outra.clienteNome || "?") + ")" };
        }
      }
    }
    return { registro };
  }

  // RECEBIMENTO: fato contábil — nasce completo e com autor do servidor.
  if (col === "rec") {
    if (atual) {
      // Editar recebimento é permitido (corrigir forma/obs/data), mas o
      // VALOR e a venda de destino não mudam por edição — estorna (lixeira,
      // com log) e lança de novo. Corrigir apagando é auditável; editar não.
      const r = { ...registro, valor: atual.valor, vendaId: atual.vendaId };
      // Exceção única: recebimento que chegou SEM venda (baixa do Omie cujo
      // CPF não casou sozinho) pode GANHAR a venda agora — definir não é trocar.
      if (!atual.vendaId && txt(registro.vendaId, 40)) {
        const vId = txt(registro.vendaId, 40);
        const venda = await lerUm("venda", vId);
        if (!venda || venda.apagadoEm) return { erro: "venda não encontrada" };
        if (venda.situacao === "distratada") return { erro: "a venda " + (venda.codigo || "") + " está distratada" };
        r.vendaId = vId;
        r.conferir = false;
      }
      return { registro: r };
    }
    const vendaId = txt(registro.vendaId, 40);
    const valor = num(registro.valor);
    if (!vendaId) return { erro: "recebimento sem venda" };
    if (!(valor > 0)) return { erro: "recebimento sem valor" };
    const venda = await lerUm("venda", vendaId);
    if (!venda || venda.apagadoEm) return { erro: "venda não encontrada" };
    if (venda.situacao === "distratada" && registro.tipo !== "acerto") {
      return { erro: "a venda " + (venda.codigo || "") + " está distratada — use um lançamento de acerto" };
    }
    const tipo = ["entrada", "parcela", "antecipacao", "acerto", "outro"].includes(registro.tipo)
      ? registro.tipo : "parcela";
    return { registro: { ...registro, vendaId, valor, tipo,
      data: txt(registro.data, 10) || agora().slice(0, 10),
      parcelaN: registro.parcelaN != null ? Math.max(0, Math.round(num(registro.parcelaN))) : null } };
  }

  // CAIXA avulso: tipo e valor saneados.
  if (col === "cx") {
    if (atual) return { registro };
    const valor = num(registro.valor);
    if (!(valor > 0)) return { erro: "lançamento sem valor" };
    const tipo = registro.tipo === "entrada" ? "entrada" : "saida";
    return { registro: { ...registro, valor, tipo, data: txt(registro.data, 10) || agora().slice(0, 10) } };
  }

  // PROPOSTA: o dono é carimbado aqui (corretor não assina pelo colega).
  if (col === "prop") {
    const limpo: any = { ...registro };
    delete limpo.dono; delete limpo.donoNome;
    if (atual) {
      limpo.dono = atual.dono; limpo.donoNome = atual.donoNome;
    } else {
      limpo.dono = quem.id;
      limpo.donoNome = quem.proprio ? quem.nome : (txt(registro.corretorNome, 60) || "Direção");
    }
    return { registro: limpo };
  }

  return { registro };
}

/* ══════════════════════════════════════════════════════════════════════════ */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const token = h["x-token"] || body.token;

  // A porta do backup central (hub Impresilk): as ações list/getCfg abrem
  // SOMENTE com o token de rotina — um segredo forte que nunca viaja no
  // navegador. O token público (do bundle) não serve aqui: ele barra robô,
  // não guarda dado.
  if (body.action === "list" || body.action === "getCfg") {
    const ROTINA = Deno.env.get("PDB_ROTINA_TOKEN");
    if (!ROTINA || token !== ROTINA) return json({ error: "Não autorizado" }, 401);
    if (body.action === "getCfg") {
      return json({ cfg: cfgSemSegredo(await lerCfgBruta()) });
    }
    // Tudo, paginado — lixeira inclusive: backup é retrato, não vitrine.
    const de = Number(body.after) || 0;
    const POR_PAGINA = 200;
    const { data, error } = await db.from("pdb_registros")
      .select("colecao, id, registro, apagado")
      .order("colecao").order("id")
      .range(de, de + POR_PAGINA - 1);
    if (error) return json({ error: error.message }, 500);
    const registros = (data || []).map((l: any) =>
      ({ _col: l.colecao, ...(l.apagado ? { _apagado: true } : {}), ...l.registro }));
    return json({
      registros,
      nextAfter: (data || []).length < POR_PAGINA ? null : de + POR_PAGINA,
    });
  }

  const TOKEN = Deno.env.get("PDB_TOKEN");
  if (!TOKEN || token !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const { action } = body;
  const cfg = await lerCfg();

  const senhaCliente = h["x-senha"] || body.senha || "";
  const quem: Quem | null = await identificar(cfg, senhaCliente);
  const autenticado = !!quem;
  // Nome que assina o histórico: se o acesso é próprio, o cadastro manda.
  const por = (quem && quem.proprio && quem.nome) ||
    txt(h["x-quem"] ? decodeURIComponent(h["x-quem"]) : (body.por || ""), 60) || "—";

  const PUBLICAS = ["ping", "entrar"];
  if (!PUBLICAS.includes(action) && !autenticado) return json({ error: "Senha inválida", semSenha: true }, 403);
  if (!PUBLICAS.includes(action) && !podeFazer(quem, action)) {
    await registrarLog({ acao: "bloqueado: " + action, por, perfil: quem!.perfil });
    return json({ error: "Seu acesso não permite isso. Fale com a direção.", semPermissao: true }, 403);
  }

  try {
    switch (action) {

      // Não diz se a senha bate (isso seria um oráculo). Quem confere usa 'entrar'.
      case "ping":
        return json({ ok: true, runtime: "bosques-supabase" });

      case "entrar": {
        const esperado = await hashGuardado(cfg);
        if (!esperado) return json({ ok: false, error: "Sistema ainda não configurado: falta o segredo PDB_PAINEL_SENHA." }, 503);
        if (!autenticado) {
          await registrarLog({ acao: "login negado", por });
          return json({ ok: false, error: "Senha incorreta" }, 403);
        }
        if (quem!.proprio) {
          const usuarios = (cfg.usuarios || []).map((u: any) =>
            u.id === quem!.id ? { ...u, ultimoAcesso: agora() } : u);
          await gravarCfg({ ...cfg, usuarios });
        }
        await registrarLog({ acao: "entrou", por, perfil: quem!.perfil });
        return json({
          ok: true,
          senhaPadrao: !quem!.proprio && !cfg.senhaHash,
          proprio: quem!.proprio,
          nome: quem!.nome, cargo: quem!.cargo, perfil: quem!.perfil, usuarioId: quem!.id,
        });
      }

      // Tudo que o app precisa numa requisição só.
      case "snapshot": {
        const todos = await lerTudo(body.colecoes || null, NOMES_COLECOES);
        let registros = filtrarLeitura(quem, todos);
        if (perfilDe(quem) !== "direcao" && perfilDe(quem) !== "escritorio") {
          // Corretor: das propostas, SÓ as dele. Dos corretores, roster mínimo.
          registros = registros.filter((r: any) => r._col !== "prop" || r.dono === quem!.id);
          registros = registros.map((r: any) => r._col === "corretor"
            ? { id: r.id, nome: r.nome, _col: "corretor" } : r);
        }
        const cfgSaida = cfgSemSegredo(cfg);
        if (perfilDe(quem) === "corretor") cfgSaida.usuarios = [];
        return json({
          ok: true, cfg: cfgSaida, registros, em: agora(),
          eu: { id: quem!.id, nome: quem!.nome, perfil: quem!.perfil, proprio: quem!.proprio },
        });
      }

      // Recusa ITEM A ITEM, nunca o pacote (uma linha proibida não pode
      // derrubar a baixa de parcela que veio no mesmo lote).
      case "salvarLote": {
        const itens = Array.isArray(body.itens) ? body.itens : [];
        if (!itens.length) return json({ ok: true, salvos: [] });
        const salvos: any[] = [];
        const recusados: any[] = [];
        for (const it of itens) {
          if (!it || !it.colecao || !it.registro) continue;
          const atual = it.registro.id ? await lerUm(it.colecao, it.registro.id) : null;
          const perfilRecusa = motivoRecusa(quem, it.colecao, it.registro, atual);
          if (perfilRecusa) { recusados.push({ colecao: it.colecao, id: it.registro.id, motivo: perfilRecusa }); continue; }
          const pronto = await prepararItem(quem!, it.colecao, it.registro, atual);
          if (pronto.erro) { recusados.push({ colecao: it.colecao, id: it.registro.id, motivo: pronto.erro }); continue; }
          salvos.push(await gravar(it.colecao, pronto.registro, por));
        }
        if (recusados.length) {
          await registrarLog({
            acao: "recusou gravação", por, perfil: perfilDe(quem),
            detalhe: recusados.map((r) => r.colecao + ":" + r.motivo).join(" | "),
          });
        }
        await registrarLog({ acao: "salvou", por, qtd: itens.length, cols: itens.map((i: any) => i.colecao).join(",") });
        return json({ ok: true, salvos, recusados });
      }

      // Lixeira: marca apagadoEm em vez de sumir. Estorno de recebimento passa
      // por aqui — e fica no log com o valor.
      case "apagar": {
        const { colecao, id } = body;
        const r = await lerUm(colecao, id);
        if (!r) return json({ ok: true });
        r.apagadoEm = agora();
        r.apagadoPor = por;
        await gravarUm(colecao, id, r);
        await marcarMudanca(colecao);
        if (colecao === "venda" && r.loteId) await recalcularLote(r.loteId);
        await registrarLog({
          acao: colecao === "rec" ? "estornou recebimento" : "apagou", por, colecao, id,
          codigo: r.codigo || r.nome || "", ...(colecao === "rec" ? { valor: r.valor, vendaId: r.vendaId } : {}),
        });
        return json({ ok: true });
      }

      case "restaurarItem": {
        const { colecao, id } = body;
        const r = await lerUm(colecao, id);
        if (!r) return json({ ok: false, error: "Não encontrado" }, 404);
        delete r.apagadoEm; delete r.apagadoPor;
        r.atualizadoEm = agora(); r.atualizadoPor = por;
        await gravarUm(colecao, id, r);
        await marcarMudanca(colecao);
        if (colecao === "venda" && r.loteId) await recalcularLote(r.loteId);
        return json({ ok: true, registro: r });
      }

      case "esvaziarLixeira": {
        const { data } = await db.from("pdb_registros").select("colecao, id, registro").eq("apagado", true);
        let apagados = 0, arquivos = 0;
        for (const linha of (data || [])) {
          const o = linha.registro as any;
          for (const idArq of arquivosDoRegistro(o)) {
            const meta = await lerUm("_arqmeta", idArq);
            const partes = (meta && meta.partes) || 1;
            const chaves = [idArq + "/meta"];
            for (let i = 0; i < partes; i++) chaves.push(idArq + "/p" + i);
            await apagarArquivo(chaves);
            await apagarDeVez("_arqmeta", idArq);
            arquivos++;
          }
          await apagarDeVez(linha.colecao, linha.id);
          apagados++;
        }
        await registrarLog({ acao: "esvaziou a lixeira", por, qtd: apagados, arquivos });
        return json({ ok: true, apagados, arquivos });
      }

      case "reiniciarNumeracao": {
        const col = body.colecao;
        if (!COLECOES[col] || !COLECOES[col].pre) return json({ ok: false, error: "Coleção sem numeração" }, 400);
        const proximo = Math.max(1, parseInt(body.proximo, 10) || 1);
        const { data } = await db.from("pdb_seq_idx").delete().eq("colecao", col).gte("numero", proximo).select("numero");
        await definirNumeracao(col, proximo - 1);
        await registrarLog({ acao: "reiniciou a numeração", por, colecao: col, proximo });
        return json({ ok: true, proximo, soltas: (data || []).length });
      }

      // ── Configurações ──────────────────────────────────────────────────────
      case "salvarCfg": {
        const novo = { ...cfg, ...(body.cfg || {}) };
        novo.senhaHash = cfg.senhaHash;      // senha só muda pela ação própria
        novo.usuarios = cfg.usuarios || [];  // idem os acessos
        novo.atualizadoEm = agora();
        novo.atualizadoPor = por;
        await gravarCfg(novo);
        await registrarLog({ acao: "mudou configuração", por });
        return json({ ok: true, cfg: cfgSemSegredo(novo) });
      }

      /* ── Acessos da equipe: um por pessoa ──────────────────────────────────── */
      case "salvarUsuario": {
        const u = body.usuario || {};
        const nome = txt(u.nome, 60);
        if (!nome) return json({ ok: false, error: "Informe o nome" }, 400);
        const perfil = PERFIS[u.perfil] ? u.perfil : "corretor";
        const lista = cfg.usuarios || [];
        const existente = u.id ? lista.find((x: any) => x.id === u.id) : null;
        if (u.id && !existente) return json({ ok: false, error: "Acesso não encontrado" }, 404);

        let hash = existente ? existente.hash : null;
        if (u.novaHash) {
          const nh = txt(u.novaHash, 128);
          if (nh.length < 32) return json({ ok: false, error: "Senha inválida" }, 400);
          hash = await sha256(nh);
        }
        if (!hash) return json({ ok: false, error: "Defina uma senha para esta pessoa" }, 400);
        // O login identifica pelo hash: duas pessoas com a mesma senha se
        // confundem. Barrar na criação.
        if (hash === (await hashGuardado(cfg)) ||
            lista.some((x: any) => x.hash === hash && x.id !== (u.id || ""))) {
          return json({ ok: false, error: "Essa senha já está em uso por outro acesso. Escolha outra." }, 400);
        }

        const registro = {
          ...(existente || {}),
          id: u.id || idNovo(),
          nome, cargo: txt(u.cargo, 60), telefone: txt(u.telefone, 30),
          // O acesso de corretor pode apontar para o cadastro dele (comissões).
          corretorId: txt(u.corretorId, 40),
          perfil, hash, ativo: u.ativo !== false,
          criadoEm: (existente && existente.criadoEm) || agora(),
          atualizadoEm: agora(), atualizadoPor: por,
        };
        const usuarios = existente
          ? lista.map((x: any) => x.id === registro.id ? registro : x)
          : [...lista, registro];
        await gravarCfg({ ...cfg, usuarios, atualizadoEm: agora() });
        await registrarLog({ acao: (existente ? "alterou o acesso de " : "criou acesso para ") + nome, por, perfil });
        return json({ ok: true, cfg: cfgSemSegredo({ ...cfg, usuarios }) });
      }

      case "apagarUsuario": {
        const id = txt(body.id, 40);
        const lista = cfg.usuarios || [];
        const alvo = lista.find((x: any) => x.id === id);
        if (!alvo) return json({ ok: true });
        const usuarios = lista.filter((x: any) => x.id !== id);
        await gravarCfg({ ...cfg, usuarios, atualizadoEm: agora() });
        await registrarLog({ acao: "removeu o acesso de " + alvo.nome, por });
        return json({ ok: true, cfg: cfgSemSegredo({ ...cfg, usuarios }) });
      }

      case "minhaSenha": {
        if (!quem!.proprio) return json({ ok: false, error: "Você entrou com a senha da equipe. Troque em Configurações." }, 400);
        const nh = txt(body.novaHash, 128);
        if (!nh || nh.length < 32) return json({ ok: false, error: "Senha inválida" }, 400);
        const novoHash = await sha256(nh);
        if (novoHash === (await hashGuardado(cfg)) ||
            (cfg.usuarios || []).some((x: any) => x.hash === novoHash && x.id !== quem!.id)) {
          return json({ ok: false, error: "Essa senha já está em uso. Escolha outra." }, 400);
        }
        const usuarios = (cfg.usuarios || []).map((x: any) =>
          x.id === quem!.id ? { ...x, hash: novoHash, atualizadoEm: agora() } : x);
        await gravarCfg({ ...cfg, usuarios, atualizadoEm: agora() });
        await registrarLog({ acao: "trocou a própria senha", por });
        return json({ ok: true });
      }

      case "trocarSenha": {
        const nova = txt(body.novaHash, 128);
        if (!nova || nova.length < 32) return json({ ok: false, error: "Senha inválida" }, 400);
        await gravarCfg({ ...cfg, senhaHash: await sha256(nova), atualizadoEm: agora() });
        await registrarLog({ acao: "trocou a senha da equipe", por });
        return json({ ok: true });
      }

      // A saúde da rotina diária: quando rodou, o que fez, e os últimos dias
      // que EXISTEM na tabela de backup — a prova é a tabela, não o job.
      case "saude": {
        const { data: st } = await db.from("pdb_meta").select("valor, atualizado_em")
          .eq("chave", "manutencao_status").maybeSingle();
        const { data: dias } = await db.from("pdb_backup").select("dia, em")
          .order("dia", { ascending: false }).limit(5);
        return json({ ok: true, rotina: (st && st.valor) || null, backups: dias || [] });
      }

      // ── Log e backup ───────────────────────────────────────────────────────
      case "log":
        return json({ ok: true, linhas: await lerLog(body.limite || 200) });

      case "backup": {
        const registros = await lerTudo(null, NOMES_COLECOES);
        const limpo = cfgSemSegredo(cfg);
        const seq = await lerNumeracao();
        return json({ ok: true, em: agora(), cfg: limpo, registros, seq });
      }

      // ── MODO HÍBRIDO: a planilha continua sendo digitada e é reimportada
      // quantas vezes quiser (scripts/atualizar-da-planilha.sh). Regras:
      //   • id determinístico: a mesma linha da planilha ATUALIZA, não duplica;
      //   • o que o SISTEMA fez sobrevive: anexos e histórico são unidos, e a
      //     situação de venda que JÁ EXISTE é a do sistema (distrato/quitação/
      //     conferência feitos no app não voltam atrás por reimportação);
      //   • registro de origem 'planilha' que sumiu do payload vai para a
      //     LIXEIRA (nunca apagado de vez — reimportação errada se desfaz);
      //   • registro nascido no app (sem origem 'planilha') não é tocado;
      //   • no fim, o status de TODO lote é recalculado das vendas vivas.
      case "importar": {
        const vindos = Array.isArray(body.registros) ? body.registros : [];
        const porCol = new Map<string, any[]>();
        for (const r of vindos) {
          if (!COLECOES[r._col] || !r.id) continue;
          if (!porCol.has(r._col)) porCol.set(r._col, []);
          porCol.get(r._col)!.push(r);
        }
        let gravados = 0, paraLixeira = 0, ressuscitados = 0;
        const maiorNumero: Record<string, number> = {};
        const MARCA_PRUNE = "importação (saiu da planilha)";

        // Tudo em LOTE: um gravarUm por registro eram 861 idas ao banco e a
        // função caía no meio, deixando gravação parcial.
        for (const [col, itens] of porCol) {
          const idsNovos = new Set(itens.map((x: any) => String(x.id)));
          const paraGravar: { colecao: string; id: string; registro: any }[] = [];
          // 1. o que era da planilha e saiu dela → lixeira
          const existentes = await lerColecaoBruta(col, "id, registro");
          const antigosPorId = new Map(existentes.map((l: any) => [String(l.id), l.registro]));
          for (const l of existentes) {
            const r: any = l.registro;
            if (r.origem === "planilha" && !idsNovos.has(String(l.id)) && !r.apagadoEm) {
              r.apagadoEm = agora();
              r.apagadoPor = MARCA_PRUNE;
              paraGravar.push({ colecao: col, id: String(l.id), registro: r });
              paraLixeira++;
            }
          }
          // 2. grava o payload, preservando o que o sistema mandou
          for (const it of itens) {
            const novo: any = { ...it };
            delete novo._col;
            const antigo: any = antigosPorId.get(String(it.id));
            if (antigo) {
              for (const campo of CAMPOS_UNIAO) {
                if (antigo[campo]) novo[campo] = unirPorId(antigo[campo], novo[campo]);
              }
              // A situação de venda existente é do SISTEMA (distrato, quitação
              // e conferência feitos no app valem mais que a planilha).
              if (col === "venda") {
                if (antigo.situacao) novo.situacao = antigo.situacao;
                if (antigo.distrato) novo.distrato = antigo.distrato;
              }
              // Lançamento de caixa: o que foi ORGANIZADO no app sobrevive à
              // reimportação — o vínculo com a etapa do cronograma, a categoria
              // reclassificada e a data posta num sem-data. Sem isto, rodar a
              // planilha de novo desfazia horas de classificação em silêncio.
              if (col === "cx") {
                if (antigo.etapaId) novo.etapaId = antigo.etapaId;
                if (antigo.categoria) novo.categoria = antigo.categoria;
                if (!novo.data && antigo.data) novo.data = antigo.data;
                // associação de comissão feita no app (um corretor ou rateio
                // entre vários) também sobrevive à reimportação
                if (antigo.corretorId && !novo.corretorId) novo.corretorId = antigo.corretorId;
                if (antigo.rateio && antigo.rateio.length) novo.rateio = antigo.rateio;
              }
              if (antigo.apagadoEm) {
                if (antigo.apagadoPor === MARCA_PRUNE) { ressuscitados++; } // voltou à planilha
                else { novo.apagadoEm = antigo.apagadoEm; novo.apagadoPor = antigo.apagadoPor; } // apagado no app segue apagado
              }
              if (antigo.criadoEm) { novo.criadoEm = antigo.criadoEm; novo.criadoPor = antigo.criadoPor; }
            }
            novo.atualizadoEm = agora();
            novo.atualizadoPor = "importação";
            paraGravar.push({ colecao: col, id: String(it.id), registro: novo });
            gravados++;
            if (novo.numero) maiorNumero[col] = Math.max(maiorNumero[col] || 0, Number(novo.numero) || 0);
          }
          await gravarVarios(paraGravar);
        }
        // 3. numeração acompanha o maior número importado
        const atualSeq = await lerNumeracao();
        for (const [col, maior] of Object.entries(maiorNumero)) {
          const ja = atualSeq["ultimo_" + col];
          if (!ja || (ja.n || 0) < maior) await definirNumeracao(col, maior);
        }
        // 4. o status de todo lote é recalculado das vendas vivas (inclusive
        //    as que nasceram no app e a planilha não conhece)
        const vendasTodas = await lerColecaoBruta("venda", "id, registro");
        const vivaPorLote: Record<string, string> = {};
        for (const l of vendasTodas) {
          const r: any = l.registro;
          if (!r.apagadoEm && r.loteId && ["ativa", "conferir", "quitada"].includes(r.situacao || "ativa")) {
            vivaPorLote[r.loteId] = String(l.id);
          }
        }
        let lotesAjustados = 0;
        const lotesParaGravar: { colecao: string; id: string; registro: any }[] = [];
        const lotesTodos = await lerColecaoBruta("lote", "id, registro");
        for (const l of lotesTodos) {
          const r: any = l.registro;
          const statusNovo = vivaPorLote[String(l.id)] ? "Vendido" : (r.reservadoPor ? "Reservado" : "Disponível");
          const vendaIdNovo = vivaPorLote[String(l.id)] || null;
          if (r.status !== statusNovo || (r.vendaId || null) !== vendaIdNovo) {
            r.status = statusNovo;
            r.vendaId = vendaIdNovo;
            r.atualizadoEm = agora();
            lotesParaGravar.push({ colecao: "lote", id: String(l.id), registro: r });
            lotesAjustados++;
          }
        }
        await gravarVarios(lotesParaGravar);
        await marcarMudanca([...porCol.keys()]);
        await registrarLog({ acao: "importou da planilha", por, gravados, paraLixeira, ressuscitados, lotesAjustados });
        return json({ ok: true, gravados, paraLixeira, ressuscitados, lotesAjustados });
      }

      case "restaurar": {
        const registros = Array.isArray(body.registros) ? body.registros : [];
        let n = 0;
        const maiorNumero: Record<string, number> = {};
        for (const r of registros) {
          const col = r._col;
          if (!COLECOES[col] || !r.id) continue;
          const copia = { ...r };
          delete copia._col;
          await gravarUm(col, r.id, copia);
          if (r.numero) maiorNumero[col] = Math.max(maiorNumero[col] || 0, Number(r.numero) || 0);
          n++;
        }
        const atual = await lerNumeracao();
        for (const [col, maior] of Object.entries(maiorNumero)) {
          const ja = atual["ultimo_" + col];
          if (!ja || (ja.n || 0) < maior) await definirNumeracao(col, maior);
        }
        await marcarMudanca(Object.keys(maiorNumero));
        await registrarLog({ acao: "restaurou backup", por, qtd: n });
        return json({ ok: true, restaurados: n });
      }

      default:
        return json({ error: "Ação desconhecida: " + action }, 400);
    }
  } catch (e) {
    console.error("[pdb-nucleo] erro:", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
