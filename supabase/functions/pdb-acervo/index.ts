// ============================================================================
// Edge Function "pdb-acervo" — arquivos grandes (contrato assinado, distrato,
// comprovante de pagamento, PDF de proposta).
//
// Mesmo protocolo em partes da Domo (iniciar → parte → finalizar →
// baixarParte), provado no 4G. As partes viram objetos no bucket
// "pdb-arquivos" do Storage:
//   <id>/meta   → metadados (coleção interna "_arqmeta")
//   <id>/p0, p1 → os pedaços
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { identificar, perfilDe, podeFazer } from "../_shared/acesso.ts";
import { NOMES_COLECOES } from "../_shared/colecoes.ts";
import { arquivosDoRegistro } from "../_shared/arquivos.ts";
import {
  agora, idNovo, lerUm, gravarUm, lerCfgBruta, lerTudo,
  subirParte, baixarParte, apagarArquivo, apagarDeVez, lerColecaoBruta,
} from "../_shared/dados.ts";

const META = "_arqmeta";

// A senha aberta demais vira chave-mestra do acervo: a régua de LEITURA vale
// por arquivo. Direção e escritório leem tudo (contratos são o trabalho
// deles); o corretor só baixa o que é de proposta DELE.
async function podeBaixar(eu: any, arquivoId: string): Promise<boolean> {
  const perfil = perfilDe(eu);
  if (perfil === "direcao" || perfil === "escritorio") return true;
  const registros = await lerTudo(null, NOMES_COLECOES);
  for (const o of registros) {
    if (!arquivosDoRegistro(o).includes(arquivoId)) continue;
    if (o._col === "foto") return true;               // apresentação: material de venda
    return o._col === "prop" && o.dono === eu.id;
  }
  // Arquivo órfão: ninguém abre por aqui (direção/escritório já saíram acima).
  return false;
}

const b64ParaBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesParaB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const TOKEN = Deno.env.get("PDB_TOKEN");
  if (!TOKEN || (h["x-token"] || body.token) !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const cfg = await lerCfgBruta();
  const eu = await identificar(cfg, h["x-senha"] || body.senha || "");
  if (!eu) return json({ error: "Senha inválida", semSenha: true }, 403);

  // 'apagar' e 'uso' seguem a mesma régua do nucleo.
  const ACAO_EQUIVALENTE: Record<string, string> = { apagar: "apagar", uso: "log" };
  const equivalente = ACAO_EQUIVALENTE[body.action];
  if (equivalente && !podeFazer(eu, equivalente)) {
    return json({ error: "Seu acesso não permite isso. Fale com a direção.", semPermissao: true }, 403);
  }

  const quem = (eu.proprio && eu.nome) ||
    String(h["x-quem"] ? decodeURIComponent(h["x-quem"]) : (body.por || "—")).slice(0, 60);

  try {
    switch (body.action) {

      case "iniciar": {
        const id = idNovo() + Math.random().toString(36).slice(2, 6);
        const meta = {
          id,
          nome: String(body.nome || "arquivo").slice(0, 200),
          // O cliente manda o tipo no campo 'mime' (lição paga no porte da
          // Domo: ler outro nome de campo gravava tudo como octet-stream).
          mime: String(body.mime ?? body.tipo ?? "application/octet-stream").slice(0, 100),
          tamanho: Number(body.tamanho) || 0,
          partes: Math.max(1, Number(body.partes) || 1),
          recebidas: 0,
          criadoEm: agora(),
          criadoPor: quem,
          pronto: false,
        };
        await gravarUm(META, id, meta);
        return json({ ok: true, id, meta });
      }

      case "parte": {
        const { id, dados } = body;
        const idx = Number(body.i ?? body.n);
        if (!Number.isInteger(idx) || idx < 0) return json({ ok: false, error: "Índice de parte inválido" }, 400);
        const meta = await lerUm(META, id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        // Arquivo finalizado não aceita pedaço novo (sobrescrever contrato
        // aprovado com lixo, em silêncio, não).
        if (meta.pronto) return json({ ok: false, error: "Arquivo já finalizado" }, 409);
        if (perfilDe(eu) !== "direcao" && meta.criadoPor && meta.criadoPor !== quem) {
          return json({ ok: false, error: "Este envio é de outra pessoa", semPermissao: true }, 403);
        }
        if (typeof dados !== "string") return json({ ok: false, error: "Parte vazia" }, 400);
        await subirParte(id + "/p" + idx, b64ParaBytes(dados));
        meta.recebidas = Math.max(Number(meta.recebidas) || 0, idx + 1);
        await gravarUm(META, id, meta);
        return json({ ok: true, recebidas: meta.recebidas, partes: meta.partes });
      }

      case "finalizar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        // Confere pedaço por pedaço no Storage: contador certo com parte que
        // não subiu deixaria o arquivo "pronto" e corrompido.
        for (let i = 0; i < (meta.partes || 1); i++) {
          const p = await baixarParte(body.id + "/p" + i);
          if (!p) return json({ ok: false, error: "Falta a parte " + i + " de " + meta.partes }, 400);
        }
        meta.pronto = true;
        meta.concluidoEm = agora();
        await gravarUm(META, body.id, meta);
        return json({ ok: true, meta });
      }

      case "meta": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (!await podeBaixar(eu, body.id)) {
          return json({ error: "Seu acesso não permite este arquivo.", semPermissao: true }, 403);
        }
        return json({ ok: true, meta });
      }

      case "baixarParte": {
        const idx = Number(body.i ?? body.n);
        if (!Number.isInteger(idx) || idx < 0) return json({ ok: false, error: "Índice de parte inválido" }, 400);
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: false, error: "Arquivo não encontrado" }, 404);
        if (!await podeBaixar(eu, body.id)) {
          return json({ error: "Seu acesso não permite este arquivo.", semPermissao: true }, 403);
        }
        const bytes = await baixarParte(body.id + "/p" + idx);
        if (!bytes) return json({ ok: false, error: "Parte não encontrada" }, 404);
        return json({ ok: true, dados: bytesParaB64(bytes), partes: meta.partes, meta });
      }

      case "apagar": {
        const meta = await lerUm(META, body.id);
        if (!meta) return json({ ok: true });
        const chaves: string[] = [];
        for (let i = 0; i < (meta.partes || 1); i++) chaves.push(body.id + "/p" + i);
        await apagarArquivo(chaves);
        await apagarDeVez(META, body.id);
        return json({ ok: true });
      }

      case "uso": {
        const linhas = await lerColecaoBruta(META, "registro");
        let bytes = 0, arquivos = 0;
        for (const l of linhas) {
          const m = l.registro as any;
          if (!m || !m.pronto) continue;
          bytes += Number(m.tamanho) || 0;
          arquivos++;
        }
        return json({ ok: true, arquivos, bytes });
      }

      default:
        return json({ error: "Ação desconhecida: " + body.action }, 400);
    }
  } catch (e) {
    console.error("[pdb-acervo] erro:", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
