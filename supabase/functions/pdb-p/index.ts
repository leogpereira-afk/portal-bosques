// ============================================================================
// Edge Function "pdb-p" — a página que o CLIENTE abre pelo link do WhatsApp.
//
//   GET  /pdb-p/<idProposta>/<token>          → landing (teaser + botões)
//   GET  /pdb-p/<idProposta>/<token>?pdf=1    → o PDF da proposta
//   POST /pdb-p/<idProposta>/<token>          → registra "tenho interesse"/"dúvida"
//
// Sem senha: quem tem o link vê SÓ esta proposta (token sorteado por envio).
// Cada abertura e cada clique ficam gravados NA PROPOSTA — é assim que o
// sistema responde "quem mandou, quando, e o cliente viu?".
// ============================================================================
import { lerUm, gravarUm, baixarParte, agora, idNovo } from "../_shared/dados.ts";

const esc = (s: unknown) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
// escape p/ contexto <script> inline: neutraliza </script> e <!--
const js = (v: unknown) => JSON.stringify(String(v == null ? "" : v)).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
const telWa = (t: unknown) => { const d = String(t || "").replace(/\D/g, ""); return d.length >= 12 ? d : d.length >= 10 ? "55" + d : d; };
const fmtBRL = (v: unknown) => { const n = Number(v) || 0; return n ? "R$ " + n.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : ""; };
const ehBot = (ua: unknown) => /bot\b|facebookexternalhit|crawler|spider|slurp|bingpreview|telegrambot|googlebot|bingbot|yandex|applebot|twitterbot|discordbot|slackbot|linkpreview|embedly|preview/i.test(String(ua || ""));
const MAX_EVENTOS = 50;

const html = (code: number, body: string) => new Response(body, {
  status: code,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
const json = (code: number, obj: unknown) => new Response(JSON.stringify(obj), {
  status: code,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const aviso = (code: number, msg: string) => html(code, `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Portal dos Bosques</title><body style="margin:0;font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0f2417;color:#eef5ef;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px"><div><div style="color:#8bc34a;font-weight:800;font-size:22px;letter-spacing:.06em">PORTAL DOS BOSQUES</div><p style="margin-top:14px;color:#a9c0ad">${esc(msg)}</p></div></body>`);

function landing(prop: any, selfUrl: string, waEmpresa: string) {
  const num = telWa(prop.corretorTel) || telWa(waEmpresa);
  const cli = esc((prop.cliente && prop.cliente.nome) || "você");
  const loteTxt = prop.quadra ? `Quadra ${esc(prop.quadra)} · Lote ${esc(prop.lote)}` : esc(prop.loteId || "");
  const cor = esc(prop.donoNome || prop.corretorNome || "o corretor");
  const valorTxt = fmtBRL(prop.valor);
  const areaTxt = prop.areaM2 ? (Number(prop.areaM2).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " m²") : "";
  const planoTxt = prop.qtdeParcelas
    ? `${fmtBRL(prop.entrada)} + ${prop.qtdeParcelas}× ${fmtBRL(prop.valorParcela)}` : "";
  const emDate = prop.enviadaEm ? new Date(prop.enviadaEm) : null;
  const dias = emDate && !isNaN(+emDate) ? Math.floor((Date.now() - emDate.getTime()) / 86400000) : null;
  const geradaEm = emDate && !isNaN(+emDate) ? emDate.toLocaleDateString("pt-BR") : "";
  const validade = Number(prop.validadeDias) || 7;
  const vencida = dias != null && dias > validade;
  return html(200, `<!doctype html><html lang=pt-BR><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Sua proposta · Portal dos Bosques</title>
<meta property="og:title" content="Sua proposta · Portal dos Bosques">
<meta property="og:description" content="${esc((valorTxt ? valorTxt + " · " : "") + loteTxt + ". Toque para ver os detalhes.")}">
<meta property="og:type" content="website"><style>
*{box-sizing:border-box;margin:0}body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0f2417;color:#eef5ef;min-height:100vh;padding:30px 20px;display:flex;justify-content:center}
.wrap{max-width:440px;width:100%}.logo{color:#8bc34a;font-weight:800;font-size:22px;letter-spacing:.05em;text-align:center}.sub{color:#8fa894;text-align:center;font-size:13px;margin-top:4px}
.card{background:#14301f;border:1px solid #235233;border-radius:16px;padding:24px;margin-top:24px}.oi{font-size:20px;font-weight:700}.oi span{color:#aed581}
.un{color:#c9d9cc;margin-top:10px;font-size:15px}.btn{display:block;width:100%;text-align:center;text-decoration:none;padding:16px;border-radius:12px;font-weight:700;font-size:16px;border:0;cursor:pointer;font-family:inherit}
.btn-pdf{background:#8bc34a;color:#0c2012;margin-top:18px}.q{color:#8fa894;font-size:14px;margin:24px 0 10px;text-align:center}.acoes{display:flex;gap:10px}
.btn-sim{background:#1d3d17;color:#c5e1a5;border:1px solid #38652c}.btn-duv{background:#122a1a;color:#eef5ef;border:1px solid #2b5a3a}
.ok{text-align:center;color:#c5e1a5;font-weight:700;margin-top:20px;display:none;line-height:1.5}.foot{color:#5f7a66;font-size:12px;text-align:center;margin-top:26px}
.teaser{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}.t-item{flex:1;min-width:96px;background:#0e2718;border:1px solid #235233;border-radius:12px;padding:12px 14px}
.t-lab{color:#7d9a84;font-size:11px;text-transform:uppercase;letter-spacing:.05em}.t-val{font-weight:700;font-size:15px;margin-top:3px}.t-val.big{color:#aed581;font-size:20px}
.validade{color:#7d9a84;font-size:12px;text-align:center;margin-top:14px}.validade.venc{color:#e7c64b;background:#24200b;border:1px solid #3d3512;border-radius:10px;padding:10px 12px;line-height:1.5}</style></head>
<body><div class=wrap>
<div class=logo>PORTAL DOS BOSQUES</div><div class=sub>Associação Campestre · Montes Claros/MG</div>
<div class=card>
<div class=oi>Olá, <span>${cli}</span>! 👋</div>
<div class=un>Sua proposta do lote <b>${loteTxt}</b> está pronta:</div>
${(valorTxt || areaTxt || planoTxt) ? `<div class=teaser>
${valorTxt ? `<div class=t-item><div class=t-lab>Valor</div><div class="t-val big">${esc(valorTxt)}</div></div>` : ""}
${areaTxt ? `<div class=t-item><div class=t-lab>Área</div><div class=t-val>${esc(areaTxt)}</div></div>` : ""}
${planoTxt ? `<div class=t-item style="min-width:100%"><div class=t-lab>Plano</div><div class=t-val>${esc(planoTxt)}</div></div>` : ""}
</div>` : ""}
${prop.arquivoId ? `<a class="btn btn-pdf" href="${esc(selfUrl)}?pdf=1" target="_blank" rel="noopener">📄 Ver proposta completa (PDF)</a>` : ""}
${geradaEm ? `<div class="validade${vencida ? " venc" : ""}">${vencida
  ? "⚠ Proposta gerada em " + geradaEm + " (há " + dias + " dias). Os valores podem ter mudado — confirme com " + cor + " antes de decidir."
  : "Gerada em " + geradaEm + " · válida por " + validade + " dias."}</div>` : ""}
<div class=q>O que você achou? Responda ao corretor:</div>
<div class=acoes id=acoes>
<button class="btn btn-sim" onclick="acao('interesse')">✅ Tenho interesse</button>
<button class="btn btn-duv" onclick="acao('duvida')">💬 Tirar dúvida</button>
</div>
<div class=ok id=ok>Perfeito! ${cor} foi avisado e já vai te chamar aqui no WhatsApp. 🎉</div>
</div>
<div class=foot>${prop.codigo ? esc(prop.codigo) + " · " : ""}enviada por ${cor}</div>
</div><script>
var NUM=${js(num)},LOTE=${js(loteTxt)},SELF=${js(selfUrl)};
function reg(t){var b=JSON.stringify({acao:t});try{if(!navigator.sendBeacon(SELF,new Blob([b],{type:'application/json'})))throw 0;}catch(e){fetch(SELF,{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true})}}
function acao(t){reg(t);document.getElementById('acoes').style.display='none';document.querySelector('.q').style.display='none';document.getElementById('ok').style.display='block';
if(NUM){var m=t==='duvida'?('Olá! Tenho uma dúvida sobre a proposta do '+LOTE+' no Portal dos Bosques.'):('Olá! Tenho interesse no '+LOTE+' do Portal dos Bosques. Podemos conversar?');setTimeout(function(){location.href='https://wa.me/'+NUM+'?text='+encodeURIComponent(m)},700)}}
</script></body></html>`);
}

// Evento gravado NA PROPOSTA (aberturas, cliques) — com teto, porque esta é
// uma rota pública e um laço de bot não pode inflar o registro sem fim.
async function anotarEvento(prop: any, tipo: string) {
  const eventos = Array.isArray(prop.eventos) ? prop.eventos : [];
  if (eventos.length >= MAX_EVENTOS) return;
  eventos.push({ id: idNovo(), tipo, em: agora() });
  prop.eventos = eventos;
  prop.atualizadoEm = agora();
  await gravarUm("prop", prop.id, prop);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 204 });
  const url = new URL(req.url);
  // caminho: /pdb-p/<id>/<token>
  const partes = url.pathname.split("/").filter(Boolean);
  const iFn = partes.indexOf("pdb-p");
  const id = (iFn >= 0 ? partes[iFn + 1] : "") || url.searchParams.get("id") || "";
  const t = (iFn >= 0 ? partes[iFn + 2] : "") || url.searchParams.get("t") || "";
  if (!id || !t) return aviso(400, "Link inválido.");

  const prop = await lerUm("prop", id);
  if (!prop || prop.apagadoEm) return aviso(404, "Proposta não encontrada — o link pode ter sido removido.");
  if (!prop.tokenPublico || prop.tokenPublico !== t) return aviso(403, "Link inválido.");

  const ua = req.headers.get("user-agent");
  const preview = url.searchParams.has("preview");

  // POST → o cliente clicou "interesse"/"dúvida"
  if (req.method === "POST") {
    let acao = "";
    try { acao = ((await req.json()).acao || "").slice(0, 20); } catch { /* corpo vazio */ }
    if (!/^[a-z_]+$/.test(acao)) return json(400, { erro: "ação inválida" });
    try { await anotarEvento(prop, acao); } catch { /* best-effort */ }
    return json(200, { ok: true });
  }

  // GET ?pdf=1 → junta as partes do Storage e devolve o PDF
  if (url.searchParams.has("pdf")) {
    if (!prop.arquivoId) return aviso(404, "Esta proposta não tem PDF anexado.");
    const meta = await lerUm("_arqmeta", prop.arquivoId);
    if (!meta || !meta.pronto) return aviso(404, "Proposta não encontrada.");
    const pedacos: Uint8Array[] = [];
    for (let i = 0; i < (meta.partes || 1); i++) {
      const p = await baixarParte(prop.arquivoId + "/p" + i);
      if (!p) return aviso(500, "Erro ao abrir a proposta.");
      pedacos.push(p);
    }
    const total = pedacos.reduce((s, p) => s + p.length, 0);
    const corpo = new Uint8Array(total);
    let pos = 0;
    for (const p of pedacos) { corpo.set(p, pos); pos += p.length; }
    if (!ehBot(ua) && !preview) { try { await anotarEvento(prop, "abriu_pdf"); } catch { /* segue */ } }
    const nome = "Proposta-Bosques" + (prop.quadra ? "-Q" + prop.quadra + "L" + prop.lote : "") + ".pdf";
    return new Response(corpo, {
      status: 200,
      headers: {
        "content-type": meta.mime || "application/pdf",
        "content-disposition": 'inline; filename="' + nome + '"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  // GET → landing (conta a abertura, menos bots e menos o ?preview do painel)
  if (!ehBot(ua) && !preview) {
    try {
      prop.views = (prop.views || 0) + 1;
      prop.lastView = agora();
      if (!prop.firstView) prop.firstView = prop.lastView;
      await gravarUm("prop", prop.id, prop);
    } catch { /* segue */ }
  }
  let waEmpresa = "";
  try {
    const { lerCfgBruta } = await import("../_shared/dados.ts");
    const cfg = await lerCfgBruta();
    waEmpresa = (cfg.empresa && cfg.empresa.telefone) || "";
  } catch { /* sem fallback */ }
  const selfUrl = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/pdb-p/" + id + "/" + t;
  return landing(prop, selfUrl, waEmpresa);
});
