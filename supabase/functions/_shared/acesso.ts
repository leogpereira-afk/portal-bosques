// Quem é quem, e o que cada um pode fazer. ÚNICO lugar onde isso é decidido.
// A porta é o servidor: esconder botão no app não protege nada.

// ── Hash ────────────────────────────────────────────────────────────────────
// O cliente manda sha256(senha); guardamos sha256(sha256(senha)). Assim um
// vazamento do banco não entrega direto o que abre a porta.
export async function sha256(txt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(txt)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Quem {
  id: string;
  nome: string;
  cargo: string;
  perfil: "direcao" | "escritorio" | "corretor";
  proprio: boolean;
}

// ── Perfis ──────────────────────────────────────────────────────────────────
// direcao    — tudo, inclusive configuração, acessos, lixeira e backup.
// escritorio — opera o dia a dia: vendas, baixas, caixa, cadastros, contratos.
// corretor   — vê o espelho (lote) e manda proposta; NUNCA vê o dinheiro da
//              casa (venda, recebimento, caixa, contrato) nem o cadastro de
//              clientes (a proposta carrega o interessado dentro dela).
export const PERFIS: Record<string, {
  txt: string; tudo?: boolean; escreve?: string[]; le?: string[];
}> = {
  direcao: { txt: "Direção", tudo: true },
  escritorio: { txt: "Escritório", tudo: false },
  corretor: {
    txt: "Corretor",
    tudo: false,
    escreve: ["prop"],
    le: ["lote", "prop", "corretor", "foto"],
  },
};

export const ACOES_DIRECAO = ["salvarCfg", "trocarSenha", "esvaziarLixeira", "reiniciarNumeracao",
  "restaurar", "restaurarItem", "salvarUsuario", "apagarUsuario", "log", "backup", "importar", "saude"];

// Apagar mexe em dinheiro (estorno de recebimento, venda). Corretor não apaga
// nada; escritório apaga (vai para a lixeira, com log — a direção restaura).
export const ACOES_NEGADAS_CORRETOR = ["apagar"];

export async function hashGuardado(cfg: any): Promise<string | null> {
  if (cfg && cfg.senhaHash) return cfg.senhaHash;
  const env = Deno.env.get("PDB_PAINEL_SENHA");
  if (!env) return null;
  return await sha256(await sha256(env));
}

// A senha da equipe (PAINEL_SENHA / cfg.senhaHash) vale como Direção — ninguém
// fica trancado do lado de fora ao ligar os acessos individuais.
export async function identificar(cfg: any, senhaCliente: string): Promise<Quem | null> {
  if (!senhaCliente) return null;
  const h = await sha256(senhaCliente);
  const u = ((cfg && cfg.usuarios) || []).find((x: any) => x && x.ativo !== false && x.hash && x.hash === h);
  if (u) {
    return {
      id: u.id, nome: u.nome, cargo: u.cargo || "",
      perfil: PERFIS[u.perfil] ? u.perfil : "corretor", proprio: true,
    };
  }
  const mestre = await hashGuardado(cfg);
  if (mestre && h === mestre) return { id: "equipe", nome: "", cargo: "", perfil: "direcao", proprio: false };
  return null;
}

// Tira todo hash antes de qualquer resposta sair do servidor.
export function cfgSemSegredo(cfg: any) {
  const c = { ...(cfg || {}) };
  delete c.senhaHash;
  c.usuarios = ((cfg && cfg.usuarios) || []).map((u: any) => {
    const x = { ...u };
    delete x.hash;
    return x;
  });
  return c;
}

export const perfilDe = (quem: Quem | null) => (quem && PERFIS[quem.perfil]) ? quem.perfil : "corretor";

// Devolve '' quando pode gravar, ou o motivo da recusa.
export function motivoRecusa(quem: Quem | null, colecao: string, registro: any, atual: any): string {
  const perfil = perfilDe(quem);
  if (perfil !== "corretor") return "";
  const escreve = PERFIS.corretor.escreve!;
  if (!escreve.includes(colecao)) return "corretor não grava " + colecao;
  // Proposta: só a própria (o dono é carimbado pelo servidor na gravação).
  if (colecao === "prop" && atual && atual.dono && atual.dono !== quem!.id) {
    return "esta proposta é de outro corretor";
  }
  return "";
}

export function podeFazer(quem: Quem | null, action: string): boolean {
  if (!quem) return false;
  const perfil = perfilDe(quem);
  if (perfil === "direcao") return true;
  if (ACOES_DIRECAO.includes(action)) return false;
  if (perfil === "corretor" && ACOES_NEGADAS_CORRETOR.includes(action)) return false;
  return true;
}

/* ── Leitura ─────────────────────────────────────────────────────────────────
   O corretor recebe só as coleções da lista dele — e das propostas, só as
   SUAS (o filtro por dono é aplicado no snapshot, não aqui). Do cadastro de
   corretores ele recebe um roster mínimo (id + nome), montado no snapshot. */
export function filtrarLeitura(quem: Quem | null, registros: any[]): any[] {
  const p = PERFIS[perfilDe(quem)];
  if (!p || p.tudo || !p.le) return registros;
  return registros.filter((r) => p.le!.includes(r._col));
}
