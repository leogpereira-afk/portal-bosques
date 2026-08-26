// omie.js — a ponte da tela com o ERP Omie (o trabalho pesado é da função
// pdb-omie, no servidor; aqui é só disparar, mostrar e vincular).
//
// O que vem de lá: baixa de boleto vira recebimento, conta paga vira despesa
// com categoria, cadastro do Omie completa o do cliente, e a linha digitável
// do boleto aparece na cobrança. O que NUNCA entra sozinho: lançamento
// duvidoso — vira pendência listada nas Configurações.

const K_OMIE_VISTO = 'pdb_omie_visto';

const apiOmie = (action, dados = {}, opts = {}) =>
  api(action, dados, Object.assign({ url: API_OMIE, prazoMs: 280000 }, opts));

// Sincroniza em rodadas (o servidor pagina para caber no tempo dele).
// Devolve a última resposta, com as contagens somadas de todas as rodadas.
async function sincronizarOmie(aoVivo) {
  let pagina = null, parcial = null, resp = null;
  for (let volta = 0; volta < 25; volta++) {
    resp = await apiOmie('sincronizar', pagina ? { pagina, parcial } : {});
    if (!resp.ok) throw new Error(resp.error || 'o Omie não respondeu');
    parcial = resp.contagens || parcial;
    if (!resp.continua) break;
    pagina = resp.continua;
    if (aoVivo) toast('Omie: sincronizando… (parte ' + Math.ceil(pagina / 15) + ')');
  }
  localStorage.setItem(K_OMIE_VISTO, String(Date.now()));
  registrarSyncOmie(true, resumoOmie(resp && resp.contagens));
  puxar();                                   // traz para a tela o que a função gravou
  return resp;
}

// O registro que a tela de Início mostra: quando foi, deu certo, o que trouxe.
const K_OMIE_ULTIMA = 'pdb_omie_ultima';
function registrarSyncOmie(ok, detalhe) {
  try {
    localStorage.setItem(K_OMIE_ULTIMA, JSON.stringify({ em: new Date().toISOString(), ok, detalhe: String(detalhe || '') }));
  } catch (e) { /* sem espaço: o indicador cai no servidor */ }
}

// Linha de status para a tela de Início — lê o registro local na hora e
// confirma com o servidor em segundo plano (quem responde a verdade é ele).
function statusOmieHome(el) {
  const pinta = (ok, txt) => { if (el && document.body.contains(el)) el.innerHTML = (ok ? '🟢' : '🔴') + ' ' + txt; };
  let local = null;
  try { local = JSON.parse(localStorage.getItem(K_OMIE_ULTIMA) || 'null'); } catch (e) { local = null; }
  if (local) pinta(local.ok, 'Omie: ' + (local.ok ? 'sincronizado' : 'FALHOU') + ' ' + fmt.quando(local.em) +
    (local.detalhe ? ' — ' + esc(local.detalhe) : ''));
  apiOmie('saude').then((r) => {
    if (!r.sync || !r.sync.quando) { pinta(false, 'Omie: nunca sincronizou — abra Configurações e rode o ↻'); return; }
    const horas = (Date.now() - new Date(r.sync.quando).getTime()) / 3600e3;
    pinta(horas < 26, 'Omie: última sincronização ' + fmt.quando(r.sync.quando) +
      (horas < 26 ? ' ✓' : ' — ATRASADA (mais de ' + Math.round(horas) + 'h)') +
      ' — ' + resumoOmie(r.sync.contagens));
  }).catch((e) => { if (!local) pinta(false, 'Omie: sem resposta agora (' + esc(e.message || 'rede') + ')'); });
}

// Texto curto e humano do que a rodada fez.
function resumoOmie(c) {
  if (!c) return 'nada novo';
  const p = [];
  if (c.recNovos) p.push(c.recNovos + ' recebimento(s) baixado(s)');
  if (c.recParaConferir) p.push(c.recParaConferir + ' recebimento(s) para conferir');
  if (c.recEstornados) p.push(c.recEstornados + ' estorno(s)');
  if (c.cxNovos) p.push(c.cxNovos + ' despesa(s) nova(s)');
  if (c.cxDuvidosos) p.push(c.cxDuvidosos + ' pendência(s) para conferir');
  if (c.clientesCompletados) p.push(c.clientesCompletados + ' cadastro(s) completado(s)');
  return p.length ? p.join(', ') : 'nada novo';
}

// Ninguém precisa lembrar de sincronizar: quem entra (direção/escritório)
// dispara sozinho quando a última rodada tem mais de 20 horas.
async function talvezSincronizarOmie() {
  if (!['direcao', 'escritorio'].includes(S.perfil)) return;
  const visto = Number(localStorage.getItem(K_OMIE_VISTO) || 0);
  if (Date.now() - visto < 6 * 3600e3) return;     // conferido há pouco
  try {
    const r = await apiOmie('saude');
    const quando = r.sync && r.sync.quando ? new Date(r.sync.quando).getTime() : 0;
    if (Date.now() - quando < 20 * 3600e3) {
      localStorage.setItem(K_OMIE_VISTO, String(Date.now()));
      return;
    }
    const fim = await sincronizarOmie(false);
    const resumo = resumoOmie(fim && fim.contagens);
    if (resumo !== 'nada novo') toast('Omie sincronizado: ' + resumo);
  } catch (e) { registrarSyncOmie(false, e.message || 'sem resposta'); }
}

/* ── boletos do cliente, consultados na hora ───────────────────────────────── */
async function abrirBoletosVenda(v) {
  toast('Consultando os boletos no Omie…');
  let r;
  try { r = await apiOmie('boleto', { cpf: v.clienteId }); }
  catch (e) { toast(e.message || 'O Omie não respondeu', 'ruim'); return; }
  const ts = (r && r.titulos) || [];
  if (!ts.length) { toast((r && r.aviso) || 'Nenhum boleto em aberto no Omie para este cliente'); return; }
  const tel = typeof telDaVenda === 'function' ? telDaVenda(v) : '';
  const corpo =
    '<p class="nota">O que está em aberto no Omie para ' + esc(v.clienteNome || 'o cliente') +
      '. A linha digitável paga em qualquer banco.</p>' +
    ts.map((t, i) =>
      '<div class="lin" style="cursor:default"><div class="cresce"><b>vence ' + fmt.data(t.venc) + ' · ' + fmt.brl(t.aberto || t.valor) + '</b>' +
      '<span class="sub">' + esc(t.status || '') + (t.parcela ? ' · parcela ' + esc(t.parcela) : '') +
        (t.boleto ? ' · boleto ' + esc(t.boleto) : '') + '</span>' +
      (t.linhaDigitavel ? '<span class="sub" style="user-select:all;word-break:break-all">' + esc(t.linhaDigitavel) + '</span>' : '') +
      '</div>' +
      (t.linhaDigitavel ? '<button class="btn mini bo-copiar" data-i="' + i + '">copiar</button>' : '') +
      (tel && t.linhaDigitavel
        ? '<a class="btn mini whats" target="_blank" rel="noopener" href="' +
          esc(linkWhats(tel, 'Olá, ' + ((v.clienteNome || '').split(' ')[0] || '') +
            '! Segue a linha digitável do boleto que vence em ' + fmt.data(t.venc) + ' (' + fmt.brl(t.aberto || t.valor) + '):\n' +
            t.linhaDigitavel + '\nQualquer dúvida é só chamar. — Portal dos Bosques')) + '">📱</a>'
        : '') +
      '</div>').join('');
  abrirModal({
    titulo: '📄 Boletos em aberto — ' + (v.codigo || ''),
    corpo,
    acoes: [{ texto: 'Fechar', aoClicar: () => fecharModal() }],
  });
  document.querySelectorAll('.bo-copiar').forEach((b) => {
    b.onclick = () => {
      const t = ts[Number(b.dataset.i)];
      navigator.clipboard.writeText(t.linhaDigitavel).then(
        () => toast('Linha digitável copiada'),
        () => toast('Não deu para copiar — selecione o número e copie', 'ruim'));
    };
  });
}

/* ── recebimentos que chegaram sem venda: o vínculo é um clique ────────────── */
function vincularRecsOmie(aoTerminar) {
  const soltos = lista('rec').filter((r) => !r.vendaId);
  if (!soltos.length) { toast('Nenhum recebimento para vincular'); if (aoTerminar) aoTerminar(); return; }
  const vendas = lista('venda').filter((v) => v.situacao !== 'distratada');
  const rotulo = (v) => (v.codigo || '') + ' Q' + v.quadra + '-L' + v.lote + ' · ' + (v.clienteNome || '');
  const corpo =
    '<p class="nota">Dinheiro que entrou por boleto mas cujo CPF não bate com nenhuma venda — ou bate ' +
      'com mais de uma. Escolha a venda certa; o carnê aplica na parcela mais antiga em aberto. ' +
      'CPF sem venda nenhuma pode ser <b>venda que falta cadastrar</b>.</p>' +
    soltos.map((r) => {
      const cpf = (r.omie && r.omie.cpf) || '';
      const doCpf = cpf ? vendas.filter((v) => String(v.clienteId || '').replace(/\D/g, '') === cpf) : [];
      const opcoes = (doCpf.length ? doCpf : vendas).map((v) =>
        '<option value="' + esc(v.id) + '">' + esc(rotulo(v)) + '</option>').join('');
      return '<div class="lin" style="cursor:default;flex-wrap:wrap"><div class="cresce"><b>' +
        fmt.brl(r.valor) + ' · ' + fmt.data(r.data) + '</b>' +
        '<span class="sub">' + esc(r.obs || '') + (cpf ? ' · CPF ' + esc(cpf) : '') +
          (doCpf.length ? ' · ' + doCpf.length + ' venda(s) desse CPF' : ' · CPF sem venda no sistema') + '</span></div>' +
        '<select class="vr-venda" data-id="' + esc(r.id) + '"><option value="">— escolher a venda —</option>' + opcoes + '</select>' +
        '<button class="btn mini vr-ok" data-id="' + esc(r.id) + '">vincular</button></div>';
    }).join('');
  abrirModal({
    titulo: '🔗 Recebimentos do Omie sem venda (' + soltos.length + ')',
    corpo,
    acoes: [{ texto: 'Fechar', aoClicar: (fundo) => { fecharSilencioso ? fecharSilencioso(fundo) : fecharModal(); if (aoTerminar) aoTerminar(); } }],
  });
  document.querySelectorAll('.vr-ok').forEach((b) => {
    b.onclick = () => {
      const sel = document.querySelector('.vr-venda[data-id="' + b.dataset.id + '"]');
      if (!sel || !sel.value) { toast('Escolha a venda primeiro', 'ruim'); return; }
      const r = achar('rec', b.dataset.id);
      if (!r) return;
      salvar('rec', Object.assign({}, r, { vendaId: sel.value, conferir: false }));
      b.textContent = '✓'; b.disabled = true; sel.disabled = true;
      toast('Vinculado — o carnê aplica sozinho');
    };
  });
}

/* ── saldo das contas, segundo o Omie ──────────────────────────────────────── */
const K_OMIE_SALDOS = 'pdb_omie_saldos';

// Cache local de 30 min: o painel do Caixa aparece na hora e atualiza quando
// a resposta fresca chega. Devolve { quando, contas, bancario } ou null.
async function saldoBancosOmie() {
  try {
    const guardado = JSON.parse(localStorage.getItem(K_OMIE_SALDOS) || 'null');
    if (guardado && Date.now() - new Date(guardado.quando).getTime() < 30 * 60e3) return guardado;
    const r = await apiOmie('saldos');
    if (!r.ok) throw new Error(r.error || '');
    const novo = { quando: r.quando, contas: r.contas || [], bancario: r.bancario };
    localStorage.setItem(K_OMIE_SALDOS, JSON.stringify(novo));
    return novo;
  } catch (e) {
    // Sem rede, o último visto ainda serve — velho e dito é melhor que nada.
    try { return JSON.parse(localStorage.getItem(K_OMIE_SALDOS) || 'null'); } catch { return null; }
  }
}

function abrirSaldosOmie(dados, caixaSistema) {
  const linhas = (dados.contas || []).map((c) =>
    '<div class="lin" style="cursor:default"><div class="cresce"><b>' + esc(c.nome) + '</b>' +
    '<span class="sub">' + (c.tipo === 'CX' ? 'caixinha (dinheiro em espécie)' : 'conta bancária') + '</span></div>' +
    '<span class="dinheiro" style="font-weight:700;color:' + ((c.saldo || 0) >= 0 ? 'var(--verde)' : 'var(--ruim)') + '">' +
      (c.saldo == null ? '—' : fmt.brl(c.saldo)) + '</span></div>').join('');
  abrirModal({
    titulo: '🏦 Saldos no Omie',
    corpo: linhas +
      '<p class="nota" style="margin-top:8px">Conferido ' + fmt.quando(dados.quando) + ', direto do extrato do Omie. ' +
      'O <b>Caixa do empreendimento</b> (' + fmt.brl(caixaSistema) + ') soma a vida inteira registrada no sistema — ' +
      'os dois não têm obrigação de bater no centavo (dinheiro que não passou pelo banco, história anterior ao Omie), ' +
      'mas diferença grande merece investigação.</p>',
    acoes: [{ texto: 'Fechar', aoClicar: () => fecharModal() }],
  });
}
