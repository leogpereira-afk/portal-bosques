/* CAIXA — o Totalizador da planilha, vivo. Entradas (recebimentos das vendas
 * + receitas avulsas), saídas (despesas + comissões + devoluções), resultado
 * mês a mês.
 *
 * A lição da planilha (paga lá, não aqui): o MESMO dinheiro morava em três
 * abas — a entrada da venda em "Vendas" E em "Outras Receitas", a comissão em
 * "Vendas" E em "Despesas". Aqui cada real tem UM lançamento: recebimento de
 * venda vive em 'rec'; todo o resto vive em 'cx'. Não existe coluna de
 * anotação — anotação é obs.
 */

const mesDe = (iso) => String(iso || '').slice(0, 7);
const nomeMes = (m) => {
  const [a, mm] = String(m).split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return (nomes[Number(mm) - 1] || mm) + '/' + a;
};
const cxVivos = () => lista('cx').filter((c) => !c.anotacao);

// Todos os movimentos de um mês, já com sinal e origem.
/* ── A régua de inconsistência: o que faz um lançamento ficar ASSINALADO ────
   Regra pedida pelo dono (27/08): linha com problema carrega ⚠ com o motivo,
   em toda tela. A mesma régua alimenta o cartão de vínculos do Caixa. */
function problemasDoLancamento(x) {
  const probs = [];
  if (!x.data) probs.push('sem data');
  if (x.col === 'cx' && !x.entrada) {
    if (!x.categoria || x.categoria === 'Outros') probs.push('sem categoria (Outros)');
    if (x.categoria === 'Comissão' && !x.corretorId && !x.temRateio) probs.push('comissão sem corretor');
    if (x.categoria === 'Obra / infraestrutura' && !x.etapaId) probs.push('obra sem etapa');
    // só cobra centro de custo depois que a casa os cadastrou
    if (!x.centroCusto && ((S.cfg && S.cfg.centrosCusto) || []).length) probs.push('sem centro de custo');
  }
  if (x.col === 'rec' && !x.vendaId) probs.push('recebimento sem venda');
  return probs;
}

function movimentosDoMes(mes) {
  const movs = [];
  for (const r of lista('rec')) {
    if (mesDe(r.data) !== mes) continue;
    const v = achar('venda', r.vendaId);
    movs.push({
      id: r.id, col: 'rec', data: r.data, valor: Number(r.valor) || 0, entrada: true,
      descricao: (v ? 'Q' + v.quadra + '-L' + v.lote + ' · ' + (v.clienteNome || '') : 'Venda') +
        (r.tipo === 'entrada' ? ' (entrada)' : r.parcelaN ? ' (parc. ' + r.parcelaN + ')' : ''),
      categoria: 'Recebimento de venda', forma: r.forma || '', vendaId: r.vendaId, codigo: r.codigo || '',
    });
  }
  for (const c of cxVivos()) {
    if (mesDe(c.data) !== mes) continue;
    movs.push({
      id: c.id, col: 'cx', data: c.data, valor: Number(c.valor) || 0, entrada: c.tipo === 'entrada',
      descricao: c.descricao || '—', categoria: c.categoria || (c.tipo === 'entrada' ? 'Outros' : 'Despesa'),
      forma: c.forma || '', vendaId: c.vendaId || '', corretorId: c.corretorId || '',
    });
  }
  return movs.sort((a, b) => String(b.data).localeCompare(a.data));
}

function totaisDoMes(mes) {
  let entradas = 0, saidas = 0;
  for (const m of movimentosDoMes(mes)) {
    if (m.entrada) entradas += m.valor; else saidas += m.valor;
  }
  return { entradas, saidas, resultado: entradas - saidas };
}

// Acumulado do empreendimento desde o início (inclui o que está sem data —
// dinheiro sem data existe do mesmo jeito; o aviso da tela cobra a data).
function totaisAcumulados() {
  let entradas = 0, saidas = 0;
  for (const r of lista('rec')) entradas += Number(r.valor) || 0;
  for (const c of cxVivos()) {
    if (c.tipo === 'entrada') entradas += Number(c.valor) || 0;
    else saidas += Number(c.valor) || 0;
  }
  return { entradas, saidas, resultado: entradas - saidas };
}

/* ── DRE do empreendimento ──────────────────────────────────────────────────
   Três colunas: o mês escolhido, o ano dele e desde o início. As despesas
   abertas POR CATEGORIA — é a resposta de "para onde o dinheiro está indo".
   Sem data entra só no "desde o início". */
function dreDados(mesSel) {
  const ano = mesSel.slice(0, 4);
  const balde = () => ({ recVendas: 0, outras: {}, desp: {} });
  const b = { mes: balde(), ano: balde(), total: balde() };
  const baldesDe = (data) => {
    const out = [b.total];
    if (data) {
      if (mesDe(data) === mesSel) out.push(b.mes);
      if (String(data).startsWith(ano)) out.push(b.ano);
    }
    return out;
  };
  for (const r of lista('rec')) {
    for (const alvo of baldesDe(r.data)) alvo.recVendas += Number(r.valor) || 0;
  }
  for (const c of cxVivos()) {
    const cat = c.categoria || 'Outros';
    for (const alvo of baldesDe(c.data)) {
      const caixa2 = c.tipo === 'entrada' ? alvo.outras : alvo.desp;
      caixa2[cat] = (caixa2[cat] || 0) + (Number(c.valor) || 0);
    }
  }
  for (const k of ['mes', 'ano', 'total']) {
    const x = b[k];
    x.somaOutras = Object.values(x.outras).reduce((s, v) => s + v, 0);
    x.receita = x.recVendas + x.somaOutras;
    x.somaDesp = Object.values(x.desp).reduce((s, v) => s + v, 0);
    x.resultado = x.receita - x.somaDesp;
  }
  // Rubricas na ordem do que mais pesa no acumulado.
  b.catsDesp = Object.keys(b.total.desp).sort((a, c) => b.total.desp[c] - b.total.desp[a]);
  b.catsOutras = Object.keys(b.total.outras).sort((a, c) => b.total.outras[c] - b.total.outras[a]);
  b.mesSel = mesSel;
  b.anoRotulo = ano;   // NÃO sobrescrever b.ano — é o balde do ano!
  return b;
}

// Meses com movimento (para os chips e a tabela anual).
function mesesComMovimento() {
  const set = new Set();
  for (const r of lista('rec')) if (r.data) set.add(mesDe(r.data));
  for (const c of cxVivos()) if (c.data) set.add(mesDe(c.data));
  set.add(mesDe(hojeISO()));
  return [...set].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
}

/* ── Tela: caixa ───────────────────────────────────────────────────────────── */
TELAS.caixa = function () {
  const app = document.getElementById('app');
  const meses = mesesComMovimento();
  const mes = TELAS._mesCaixa || mesDe(hojeISO());
  TELAS._mesCaixa = mes;
  const t = totaisDoMes(mes);
  const ac = totaisAcumulados();

  // O que os carnês previam trazer neste mês (referência do painel).
  let projecao = 0;
  for (const v of vendasVivas()) {
    for (const l of CARNE.gerarParcelas(v, cfgReajuste())) {
      if (mesDe(l.venc) === mes) projecao += l.valor;
    }
  }

  // ── Vínculos pendentes: o sistema APONTA o que falta amarrar ──────────────
  // (categoria genérica, comissão sem dono, gasto de obra sem etapa). Cada
  // linha leva direto ao lugar de resolver.
  const vivos = cxVivos();
  const semCategoria = vivos.filter((c) => c.tipo === 'saida' && (!c.categoria || c.categoria === 'Outros')).length;
  const comSemCor = vivos.filter((c) => c.tipo === 'saida' && c.categoria === 'Comissão' &&
    !c.corretorId && !(c.rateio && c.rateio.length)).length;
  const obraSemEtapa = vivos.filter((c) => c.tipo === 'saida' && c.categoria === 'Obra / infraestrutura' && !c.etapaId).length;
  const pendencias = [];
  if (semCategoria) pendencias.push({ n: semCategoria, txt: 'saída(s) na categoria "Outros" — classifique para o DRE dizer a verdade', acao: 'outros' });
  if (comSemCor) pendencias.push({ n: comSemCor, txt: 'comissão(ões) paga(s) sem corretor — associe em Corretores', acao: 'corretores' });
  if (obraSemEtapa) pendencias.push({ n: obraSemEtapa, txt: 'gasto(s) de obra sem etapa do cronograma', acao: 'cronograma' });
  const recsSoltos = lista('rec').filter((r) => !r.vendaId).length;
  if (recsSoltos) pendencias.push({ n: recsSoltos, txt: 'recebimento(s) do Omie sem venda — o caixa conta, o carnê não', acao: 'rec-omie' });
  const blocoVinculos = pendencias.length
    ? '<div class="cartao" style="border-color:#f0ddb5"><h2>🔗 Vínculos pendentes <span class="nota">— amarre e os números contam a história certa</span></h2>' +
      pendencias.map((x) => '<div class="lin vinc-lin" data-acao="' + x.acao + '">' +
        '<span class="etiqueta et-hoje" style="min-width:34px;text-align:center">' + x.n + '</span>' +
        '<div class="cresce"><b>' + x.txt + '</b></div><span class="nota">resolver →</span></div>').join('') + '</div>'
    : '';

  // ── Sem data: fora de todos os meses até alguém datar ─────────────────────
  const semData = vivos.filter((c) => !c.data);
  const avisoSemData = semData.length
    ? '<div class="cartao" style="border-color:#f0ddb5"><h2>⚠ ' + semData.length + ' lançamento(s) sem data</h2>' +
      semData.map((c) => '<div class="lin" style="cursor:default"><div class="cresce"><b>' + esc(c.descricao || '—') + '</b>' +
        '<span class="sub">' + (c.tipo === 'entrada' ? 'entrada' : 'saída') + ' · ' + esc(c.categoria || '') + '</span></div>' +
        '<span class="dinheiro">' + fmt.brl(c.valor) + '</span>' +
        '<button class="btn mini cx-datar" data-id="' + esc(c.id) + '">datar</button></div>').join('') + '</div>'
    : '';

  // ── Ano mês a mês ──────────────────────────────────────────────────────────
  const ano = mes.slice(0, 4);
  const tabelaAno = meses.filter((m) => m.startsWith(ano)).map((m) => {
    const tm = totaisDoMes(m);
    return '<tr' + (m === mes ? ' style="font-weight:700"' : '') + '>' +
      '<td><a href="#" class="mes-link" data-m="' + m + '">' + nomeMes(m) + '</a></td>' +
      '<td class="num">' + fmt.brl(tm.entradas) + '</td>' +
      '<td class="num">' + fmt.brl(tm.saidas) + '</td>' +
      '<td class="num" style="color:' + (tm.resultado >= 0 ? 'var(--verde)' : 'var(--ruim)') + '">' + fmt.brl(tm.resultado) + '</td></tr>';
  }).join('');
  const tAno = meses.filter((m) => m.startsWith(ano)).reduce((s, m) => {
    const tm = totaisDoMes(m);
    return { e: s.e + tm.entradas, s2: s.s2 + tm.saidas };
  }, { e: 0, s2: 0 });

  // ── Previsão em UMA linha (o detalhe mora nos Relatórios) ─────────────────
  const arCaixa = aReceberPorMes();
  const doze = Object.keys(arCaixa.porMes).sort().filter((m) => m >= mes).slice(0, 12)
    .reduce((s, m) => s + arCaixa.porMes[m], 0);
  const anoC = String(new Date().getFullYear());
  const aReceberAnoCorrente = Object.entries(arCaixa.porMes)
    .filter(([m2]) => m2.slice(0, 4) === anoC).reduce((s2, [, v2]) => s2 + v2, 0);

  // ── DRE com as barras embutidas (um cartão só responde "para onde foi") ──
  const dre = dreDados(mes);
  const maiorDesp = Math.max(1, ...dre.catsDesp.map((c) => dre.total.desp[c]));
  const linhaDre = (rotulo, vMes, vAno, vTot, opts = {}) =>
    '<tr' + (opts.forte ? ' style="font-weight:800;border-top:2px solid var(--borda)"' : '') + '>' +
    '<td' + (opts.recuo ? ' style="padding-left:22px;color:var(--tinta-fraca)"' : '') + '>' + rotulo +
    (opts.barra != null ? '<span style="display:block;max-width:180px;background:var(--verde-palido);border-radius:5px;height:7px;overflow:hidden;margin-top:3px">' +
      '<span style="display:block;width:' + opts.barra + '%;height:100%;background:var(--verde)"></span></span>' : '') + '</td>' +
    [vMes, vAno, vTot].map((v) => '<td class="num"' +
      (opts.cor ? ' style="color:' + (v >= 0 ? 'var(--verde)' : 'var(--ruim)') + '"' : '') + '>' +
      (v === 0 && opts.recuo ? '—' : fmt.brl(v)) + '</td>').join('') + '</tr>';
  const blocoDre =
    '<div class="cartao"><h2>DRE — para onde o dinheiro está indo <span class="nota">— regime de caixa · clique num lançamento para reclassificar</span>' +
      ' <button class="btn mini" id="dre-pdf" style="float:right">📄 PDF</button></h2>' +
    '<div class="rolagem"><table class="tabela"><thead><tr><th></th>' +
      '<th class="num">' + nomeMes(mes) + '</th><th class="num">' + dre.anoRotulo + '</th><th class="num">Desde o início</th></tr></thead><tbody>' +
    linhaDre('Recebimentos de vendas (entradas e parcelas)', dre.mes.recVendas, dre.ano.recVendas, dre.total.recVendas) +
    dre.catsOutras.map((c) => linhaDre(esc(c), dre.mes.outras[c] || 0, dre.ano.outras[c] || 0, dre.total.outras[c], { recuo: true })).join('') +
    linhaDre('(=) Receita', dre.mes.receita, dre.ano.receita, dre.total.receita, { forte: true }) +
    dre.catsDesp.map((c) => linhaDre(esc(c), dre.mes.desp[c] || 0, dre.ano.desp[c] || 0, dre.total.desp[c],
      { recuo: true, barra: Math.round(dre.total.desp[c] / maiorDesp * 100) })).join('') +
    linhaDre('(-) Despesas', dre.mes.somaDesp, dre.ano.somaDesp, dre.total.somaDesp, { forte: true }) +
    linhaDre('(=) Resultado', dre.mes.resultado, dre.ano.resultado, dre.total.resultado, { forte: true, cor: true }) +
    '</tbody></table></div></div>';

  app.innerHTML =
    '<div class="filtros"><div class="chips">' +
      meses.map((m) => '<button class="chip' + (m === mes ? ' on' : '') + '" data-m="' + m + '">' + nomeMes(m) + '</button>').join('') +
    '</div>' +
      '<button class="btn primario" id="cx-desp">− Despesa</button>' +
      '<button class="btn" id="cx-rece">+ Receita</button>' +
    '</div>' +
    avisoSemData + blocoVinculos +
    '<div class="paineis">' +
      '<div class="painel clicavel" data-lanc="entrada"><div class="rot">Entradas · ' + nomeMes(mes) + '</div><div class="num pos">' + fmt.brl(t.entradas) + '</div>' +
        '<div class="sub">carnês previam ' + fmt.brl(projecao) + '</div></div>' +
      '<div class="painel clicavel" data-lanc="saida"><div class="rot">Saídas · ' + nomeMes(mes) + '</div><div class="num neg">' + fmt.brl(t.saidas) + '</div></div>' +
      '<div class="painel clicavel" data-lanc=""><div class="rot">Resultado do mês</div><div class="num ' + (t.resultado >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(t.resultado) + '</div></div>' +
      '<div class="painel clicavel" id="pn-acum"><div class="rot">Caixa do empreendimento</div>' +
        '<div class="num ' + (ac.resultado >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(ac.resultado) + '</div>' +
        '<div class="sub">' + fmt.brl(ac.entradas) + ' entraram · ' + fmt.brl(ac.saidas) + ' saíram</div></div>' +
      '<div class="painel clicavel" id="pn-banco" style="display:none"><div class="rot">🏦 No banco (Omie)</div>' +
        '<div class="num" id="pn-banco-num">…</div><div class="sub" id="pn-banco-sub"></div></div>' +
    '</div>' +
    '<div class="cartao"><h2>' + ano + ' mês a mês</h2><div class="rolagem"><table class="tabela">' +
      '<thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th></tr></thead>' +
      '<tbody>' + tabelaAno + '<tr style="border-top:2px solid var(--borda);font-weight:800"><td>TOTAL</td>' +
      '<td class="num">' + fmt.brl(tAno.e) + '</td><td class="num">' + fmt.brl(tAno.s2) + '</td>' +
      '<td class="num">' + fmt.brl(tAno.e - tAno.s2) + '</td></tr></tbody></table></div></div>' +
    '<div class="cartao clicavel" id="pn-prev" style="cursor:pointer"><h2 style="margin:0">🔭 Previsibilidade ' +
      '<span class="nota">— a receber em ' + String(new Date().getFullYear()) + ': <b>' + fmt.brl(aReceberAnoCorrente) + '</b>' +
      ' · próximos 12 meses: <b>' + fmt.brl(doze) + '</b> · vencido a cobrar <b style="color:var(--ruim)">' +
      fmt.brl(arCaixa.vencido) + '</b> · o detalhe está nos Relatórios →</span></h2></div>' +
    blocoDre +
    '<div class="cartao clicavel" id="ver-lanc" style="cursor:pointer"><h2 style="margin:0">🧾 Lançamentos de ' + nomeMes(mes) +
      ' <span class="nota">— ' + movimentosDoMes(mes).length + ' movimento(s) · ver, editar e reclassificar →</span></h2></div>';

  /* ── handlers ── */
  app.querySelectorAll('.chip[data-m], .mes-link').forEach((el) => {
    el.onclick = (e) => { e.preventDefault(); TELAS._mesCaixa = el.dataset.m; TELAS.caixa(); };
  });
  document.getElementById('cx-desp').onclick = () => abrirLancamento('saida');
  document.getElementById('cx-rece').onclick = () => abrirLancamento('entrada');
  app.querySelectorAll('.painel[data-lanc]').forEach((el) => {
    el.onclick = () => {
      TELAS._fLanc = { q: '', tipo: el.dataset.lanc, cat: '', mes };
      location.hash = '#/lancamentos';
    };
  });
  const pAc = document.getElementById('pn-acum');
  if (pAc) pAc.onclick = () => { location.hash = '#/relatorios'; };
  // O saldo real do banco chega do Omie sem segurar a tela: o painel aparece
  // quando a resposta vem (cache de 30 min faz isso ser quase sempre imediato).
  (async () => {
    const dados = await saldoBancosOmie();
    const pn = document.getElementById('pn-banco');
    if (!dados || !pn || !document.body.contains(pn)) return;
    document.getElementById('pn-banco-num').textContent = fmt.brl(dados.bancario || 0);
    document.getElementById('pn-banco-num').className = 'num ' + ((dados.bancario || 0) >= 0 ? 'pos' : 'neg');
    const bancarias = (dados.contas || []).filter((c) => c.tipo === 'CC' && !/inativ/i.test(c.nome) && c.saldo != null);
    document.getElementById('pn-banco-sub').textContent =
      bancarias.map((c) => c.nome).join(' + ') + ' · conferido ' + fmt.quando(dados.quando);
    pn.style.display = '';
    pn.onclick = () => abrirSaldosOmie(dados, ac.resultado);
  })();
  const pPrev = document.getElementById('pn-prev');
  if (pPrev) pPrev.onclick = () => { location.hash = '#/relatorios'; };
  const vLanc = document.getElementById('ver-lanc');
  if (vLanc) vLanc.onclick = () => { TELAS._fLanc = { q: '', tipo: '', cat: '', mes }; location.hash = '#/lancamentos'; };
  app.querySelectorAll('.vinc-lin').forEach((el) => {
    el.onclick = () => {
      const acao = el.dataset.acao;
      if (acao === 'outros') { TELAS._fLanc = { q: '', tipo: 'saida', cat: 'Outros', mes: 'todos' }; location.hash = '#/lancamentos'; }
      else if (acao === 'corretores') location.hash = '#/corretores';
      else if (acao === 'cronograma') location.hash = '#/cronograma';
      else if (acao === 'rec-omie') vincularRecsOmie(TELAS.caixa);
    };
  });
  app.querySelectorAll('.cx-datar').forEach((b) => {
    b.onclick = async () => {
      const c = achar('cx', b.dataset.id);
      if (!c) return;
      const d = await perguntarData('Quando foi "' + (c.descricao || '') + '" (' + fmt.brl(c.valor) + ')?');
      if (d) { salvar('cx', { id: c.id, data: d }); TELAS.caixa(); }
    };
  });
  const bDre = document.getElementById('dre-pdf');
  if (bDre) bDre.onclick = () => { PDF.dre(dre, S.cfg || {}); toast('DRE em PDF gerado'); };
};

/* ── Editar/reclassificar um lançamento avulso ─────────────────────────────
   É aqui que "MENSALIDADE VITOR · Outros" vira "Funcionários": a importação
   classificou por palavra-chave e quem conhece o dinheiro corrige a categoria.
   Recebimento de venda NÃO passa por aqui (estorna na ficha da venda). */
function abrirEdicaoLancamento(id, aoTerminar) {
  const c = achar('cx', id);
  if (!c) return;
  const depois = aoTerminar || TELAS.caixa;
  const cats = c.tipo === 'saida'
    ? ((S.cfg && S.cfg.categoriasDespesa) || ['Outros'])
    : ((S.cfg && S.cfg.categoriasReceita) || ['Outros']);
  const listaCats = cats.includes(c.categoria) || !c.categoria ? cats : [c.categoria].concat(cats);
  // O fio do lançamento: quem criou e cada edição, com o que mudou. Dinheiro
  // editado sem trilha vira discussão sem resposta.
  const trilha =
    '<div class="campo"><label>Histórico</label>' +
    '<div class="nota">• criado ' + fmt.dataHora(c.criadoEm) + ' por ' + esc(c.criadoPor || '—') + '</div>' +
    (c.historico || []).map((h) => '<div class="nota">• ' + fmt.dataHora(h.em) + ' por ' + esc(h.por || '—') + ' — ' + esc(h.o_que || '') + '</div>').join('') +
    '</div>';
  const corpo =
    campo('Descrição', entrada('descricao', c.descricao || '')) +
    '<div class="colunas-3">' +
      campo('Valor (R$)', entrada('valor', c.valor, { inputmode: 'decimal' })) +
      campo('Data', entrada('data', c.data || '', { tipo: 'date' })) +
      campo('Forma', seletor('forma', c.forma || 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX'])) +
    '</div>' +
    campo('Categoria', seletor('categoria', c.categoria || 'Outros', listaCats), 'é o que separa o DRE — estrutura, funcionário, comissão…') +
    (c.tipo === 'saida'
      ? '<div id="le-cor" style="display:' + ((c.categoria || '') === 'Comissão' ? 'block' : 'none') + '">' +
        campo('Corretor da comissão', seletor('corretorId', c.corretorId || '',
          lista('corretor').map((c2) => ({ v: c2.id, t: c2.nome })), '— escolher —'),
          (c.rateio && c.rateio.length ? 'este pagamento está DIVIDIDO (rateio) — mexa em Corretores' : 'vincula direto na conta dele')) + '</div>' +
        campo('Etapa do cronograma', seletor('etapaId', c.etapaId || '',
          lista('etapa').map((e2) => ({ v: e2.id, t: e2.nome })), 'nenhuma'), 'soma no "pago" da etapa')
      : '') +
    (((S.cfg && S.cfg.centrosCusto) || []).length && c.tipo === 'saida'
      ? campo('Centro de custo', seletor('centroCusto', c.centroCusto || '', (S.cfg.centrosCusto || []), '— nenhum —'), 'onde esse dinheiro trabalhou')
      : '') +
    campo('Observação', entrada('obs', c.obs || '')) + trilha;
  const fundoEd = abrirModal({
    titulo: (c.tipo === 'saida' ? 'Saída' : 'Receita') + ' — editar',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Apagar', classe: 'perigo', aoClicar: async (fundo) => {
        if (await confirmar('Apagar "' + (c.descricao || '') + '" de ' + fmt.brl(c.valor) + '? (vai para a lixeira, com registro)', { perigo: true, ok: 'Apagar' })) {
          try {
            await api('apagar', { colecao: 'cx', id: c.id });
            const arr = S.reg.cx || [];
            const i = arr.findIndex((x) => x.id === c.id);
            if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
            gravarCache();
            fecharSilencioso(fundo);
            depois();
          } catch (err) { toast(err.message || 'Não consegui apagar agora', 'ruim'); }
        }
      } },
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        const valor = numeroBR(v.valor);
        if (!(valor > 0)) { toast('Valor inválido', 'ruim'); return; }
        const desc = String(v.descricao || '').trim().slice(0, 200);
        // o QUE mudou fica escrito — é a trilha que responde "quem mexeu nisso"
        const mud = [];
        if (Math.abs(valor - (Number(c.valor) || 0)) > 0.004) mud.push('valor ' + fmt.brl(c.valor) + ' → ' + fmt.brl(valor));
        if ((v.data || '') !== (c.data || '')) mud.push('data ' + (c.data || '—') + ' → ' + (v.data || '—'));
        if ((v.categoria || '') !== (c.categoria || '')) mud.push('categoria ' + (c.categoria || '—') + ' → ' + v.categoria);
        if ((v.forma || '') !== (c.forma || '')) mud.push('forma ' + (c.forma || '—') + ' → ' + v.forma);
        if (desc !== (c.descricao || '')) mud.push('descrição alterada');
        if ((String(v.obs || '')) !== (c.obs || '')) mud.push('observação alterada');
        const etapaNova = v.etapaId != null ? v.etapaId : (c.etapaId || '');
        if (etapaNova !== (c.etapaId || '')) {
          const nomeEt = (achar('etapa', etapaNova) || {}).nome || 'nenhuma';
          mud.push('etapa → ' + nomeEt);
        }
        const corNovo = (c.rateio && c.rateio.length) ? (c.corretorId || '')
          : (v.categoria === 'Comissão' ? (v.corretorId != null ? v.corretorId : (c.corretorId || '')) : '');
        if (corNovo !== (c.corretorId || '')) {
          mud.push('corretor → ' + ((lista('corretor').find((x2) => x2.id === corNovo) || {}).nome || 'nenhum'));
        }
        if (!mud.length) { fecharSilencioso(fundo); return; }
        salvar('cx', {
          id: c.id, valor, data: v.data, forma: v.forma, categoria: v.categoria,
          etapaId: etapaNova, corretorId: corNovo,
          centroCusto: v.centroCusto != null ? v.centroCusto : (c.centroCusto || ''),
          descricao: desc, obs: String(v.obs || '').slice(0, 300),
          historico: historiar(c, 'Editou: ' + mud.join('; ')),
        });
        fecharSilencioso(fundo);
        toast('Lançamento atualizado');
        depois();
      } },
    ],
  });
  const selCatEd = fundoEd.querySelector('[data-campo="categoria"]');
  const divCorEd = fundoEd.querySelector('#le-cor');
  if (selCatEd && divCorEd) selCatEd.addEventListener('input', () => {
    divCorEd.style.display = selCatEd.value === 'Comissão' ? 'block' : 'none';
  });
}

function abrirLancamento(tipo, aoTerminar, etapaPre) {
  const depois = aoTerminar || TELAS.caixa;
  const etapasVivas = tipo === 'saida' ? lista('etapa').filter((e) => e.situacao !== 'concluida') : [];
  const cats = tipo === 'saida'
    ? ((S.cfg && S.cfg.categoriasDespesa) || ['Outros'])
    : ((S.cfg && S.cfg.categoriasReceita) || ['Outros']);
  const corpo =
    campo('Descrição', entrada('descricao', '', { placeholder: tipo === 'saida' ? 'ex.: patrola, contabilidade…' : 'ex.: aluguel da antena…' })) +
    '<div class="colunas-3">' +
      campo('Valor (R$)', entrada('valor', '', { inputmode: 'decimal' })) +
      campo('Data', entrada('data', hojeISO(), { tipo: 'date' })) +
      campo('Forma', seletor('forma', 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX'])) +
    '</div>' +
    campo('Categoria', seletor('categoria', cats[0], cats)) +
    (tipo === 'saida'
      ? '<div id="lc-cor" style="display:' + (cats[0] === 'Comissão' ? 'block' : 'none') + '">' +
        campo('Corretor da comissão', seletor('corretorId', '', lista('corretor').map((c2) => ({ v: c2.id, t: c2.nome })), '— escolher —'),
          'vincula direto na conta dele') + '</div>'
      : '') +
    (etapasVivas.length
      ? campo('Etapa do cronograma', seletor('etapaId', etapaPre || '', etapasVivas.map((e) => ({ v: e.id, t: e.nome })), 'nenhuma'), 'soma no "pago" da etapa')
      : '') +
    (tipo === 'saida' && ((S.cfg && S.cfg.centrosCusto) || []).length
      ? campo('Centro de custo', seletor('centroCusto', '', (S.cfg.centrosCusto || []), '— nenhum —'), 'onde esse dinheiro trabalhou')
      : '') +
    campo('Observação', entrada('obs', ''));
  const fundoNv = abrirModal({
    titulo: tipo === 'saida' ? 'Nova despesa' : 'Outra receita',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Lançar', classe: 'primario', aoClicar: (fundo) => {
        const c = lerCampos(fundo);
        const valor = numeroBR(c.valor);
        if (!c.descricao || !c.descricao.trim()) { toast('Descreva o lançamento', 'ruim'); return; }
        if (!(valor > 0)) { toast('Diga o valor', 'ruim'); return; }
        salvar('cx', {
          tipo, valor, data: c.data, forma: c.forma, categoria: c.categoria,
          etapaId: c.etapaId || '',
          centroCusto: c.centroCusto || '',
          corretorId: c.categoria === 'Comissão' ? (c.corretorId || '') : '',
          descricao: c.descricao.trim().slice(0, 200), obs: String(c.obs || '').slice(0, 300),
        });
        fecharSilencioso(fundo);
        toast('Lançado');
        depois();
      } },
    ],
  });
  // categoria Comissão → mostra o corretor (vínculo na origem, não depois)
  const selCatNv = fundoNv.querySelector('[data-campo="categoria"]');
  const divCorNv = fundoNv.querySelector('#lc-cor');
  if (selCatNv && divCorNv) selCatNv.addEventListener('input', () => {
    divCorNv.style.display = selCatNv.value === 'Comissão' ? 'block' : 'none';
  });
}

/* ── Tela: lançamentos (ao lado do Caixa) ───────────────────────────────────
   A lista COMPLETA e detalhada: todo dinheiro que entrou e saiu, com filtros,
   edição (só os avulsos — recebimento de venda se mexe na ficha da venda) e a
   trilha de quem fez. */
TELAS.lancamentos = function () {
  const app = document.getElementById('app');
  const meses = mesesComMovimento();
  const f = TELAS._fLanc || { q: '', tipo: '', cat: '', mes: mesDe(hojeISO()) };
  TELAS._fLanc = f;
  // Outras telas mandam mes 'AAAA-MM' ou 'todos' — vira ano + chip de mês.
  if (f.mes && /^\d{4}-\d{2}$/.test(f.mes)) { f.ano = f.mes.slice(0, 4); f.mes = f.mes.slice(5, 7); }
  else if (f.mes === 'todos') { f.mes = ''; if (f.ano == null) f.ano = ''; }
  if (f.ano == null) f.ano = String(new Date().getFullYear());

  // combina recebimentos de venda + lançamentos avulsos
  const tudo = [];
  for (const r of lista('rec')) {
    const v = achar('venda', r.vendaId);
    tudo.push({
      col: 'rec', id: r.id, data: r.data || '', entrada: true,
      valor: Number(r.valor) || 0, forma: r.forma || '',
      categoria: 'Recebimento de venda',
      descricao: (v ? 'Q' + v.quadra + '-L' + v.lote + ' · ' + (v.clienteNome || '') : 'Venda') +
        (r.tipo === 'entrada' ? ' (entrada)' : r.parcelaN ? ' (parc. ' + r.parcelaN + ')' : ''),
      codigo: r.codigo || '', criadoPor: r.criadoPor || '—', criadoEm: r.criadoEm,
      atualizadoPor: r.atualizadoPor, vendaId: r.vendaId, obs: r.obs || '',
      origem: r.origem || '', nHist: 0,
    });
  }
  for (const c of cxVivos()) {
    tudo.push({
      col: 'cx', id: c.id, data: c.data || '', entrada: c.tipo === 'entrada',
      valor: Number(c.valor) || 0, forma: c.forma || '',
      categoria: c.categoria || 'Outros', descricao: c.descricao || '—',
      codigo: '', criadoPor: c.criadoPor || '—', criadoEm: c.criadoEm,
      atualizadoPor: c.atualizadoPor, obs: c.obs || '',
      origem: c.origem || '', nHist: (c.historico || []).length,
      corretorId: c.corretorId || '', temRateio: !!(c.rateio && c.rateio.length),
      etapaId: c.etapaId || '', centroCusto: c.centroCusto || '',
    });
  }

  const cats = [...new Set(tudo.map((x) => x.categoria))].sort();
  const filtrados = tudo.filter((x) => {
    if (f.mes === 'sem-data') { if (x.data) return false; }
    else {
      if (f.ano && mesDe(x.data).slice(0, 4) !== f.ano) return false;
      if (f.mes && mesDe(x.data).slice(5, 7) !== f.mes) return false;
    }
    if (f.tipo === 'entrada' && !x.entrada) return false;
    if (f.tipo === 'saida' && x.entrada) return false;
    if (f.cat && x.categoria !== f.cat) return false;
    if (f.cc) {
      if (x.entrada) return false;                    // centro de custo é coisa de despesa
      if (f.cc === '__sem__' ? x.centroCusto : x.centroCusto !== f.cc) return false;
    }
    if (f.q && !((x.descricao + ' ' + x.obs + ' ' + x.forma + ' ' + x.criadoPor + ' ' + x.codigo).toLowerCase().includes(f.q.toLowerCase()))) return false;
    return true;
  }).sort((a, b) => String(b.data).localeCompare(a.data));

  const somaE = filtrados.filter((x) => x.entrada).reduce((s, x) => s + x.valor, 0);
  const somaS = filtrados.filter((x) => !x.entrada).reduce((s, x) => s + x.valor, 0);

  // Extrato em DUAS COLUNAS, estilo banco: entradas à esquerda, saídas à
  // direita, linha fina como planilha. Filtrou por um tipo só, a coluna
  // ocupa a tela inteira. No celular as colunas empilham (CSS).
  const entradas2 = filtrados.filter((x) => x.entrada);
  const saidas2 = filtrados.filter((x) => !x.entrada);

  const linhaExtrato = (x) =>
    '<tr class="ln-row" data-col="' + x.col + '" data-id="' + esc(x.id) + '"' +
      (x.col === 'rec' ? ' data-venda="' + esc(x.vendaId) + '"' : '') + ' style="cursor:pointer">' +
    '<td style="white-space:nowrap;color:var(--tinta-fraca)">' + (x.data ? fmt.data(x.data).slice(0, 5) : '⚠ s/data') +
      (problemasDoLancamento(x).length ? ' <span title="' + esc(problemasDoLancamento(x).join(' · ')) + '" style="cursor:help">⚠</span>' : '') + '</td>' +
    '<td><b>' + esc(x.descricao) + '</b>' + (x.codigo ? ' <span class="nota">' + esc(x.codigo) + '</span>' : '') +
      '<br><span class="nota">' + esc(x.categoria) +
      (x.origem === 'omie' && x.criadoPor !== 'omie' ? ' · <b>omie</b>' : x.origem === 'planilha' ? ' · 📄 planilha' : '') +
      (x.forma ? ' · ' + esc(x.forma) : '') +
      ' · ' + esc(x.criadoPor) + (x.nHist ? ' · ✏️' + x.nHist : '') +
      (x.obs ? ' · ' + esc(x.obs) : '') + '</span></td>' +
    '<td class="num" style="font-weight:700;color:' + (x.entrada ? 'var(--verde)' : 'var(--ruim)') + '">' +
      (x.entrada ? '+' : '−') + fmt.brl(x.valor) + '</td></tr>';

  const coluna = (titulo, icone, itens, soma, corTot) =>
    '<div class="cartao" style="margin:0"><h2>' + icone + ' ' + titulo +
      ' <span class="nota">— ' + itens.length + ' lançamento(s)</span>' +
      '<span style="float:right;font-weight:800;color:' + corTot + '">' + fmt.brl(soma) + '</span></h2>' +
    (itens.length
      ? '<div class="rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>' +
        itens.map(linhaExtrato).join('') + '</tbody></table></div>'
      : '<p class="nota">Nada nesse recorte.</p>') + '</div>';

  const grade =
    f.tipo === 'entrada' ? coluna('Entradas', '↑', entradas2, somaE, 'var(--verde)')
    : f.tipo === 'saida' ? coluna('Saídas', '↓', saidas2, somaS, 'var(--ruim)')
    : '<div class="colunas-lanc">' +
        coluna('Entradas', '↑', entradas2, somaE, 'var(--verde)') +
        coluna('Saídas', '↓', saidas2, somaS, 'var(--ruim)') +
      '</div>';

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel clicavel" data-pl=""><div class="rot">Lançamentos no recorte</div><div class="num">' + filtrados.length + '</div></div>' +
      '<div class="painel clicavel" data-pl="entrada"><div class="rot">Entradas</div><div class="num pos">' + fmt.brl(somaE) + '</div></div>' +
      '<div class="painel clicavel" data-pl="saida"><div class="rot">Saídas</div><div class="num neg">' + fmt.brl(somaS) + '</div></div>' +
      '<div class="painel clicavel" data-pl=""><div class="rot">Diferença</div><div class="num ' + (somaE - somaS >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(somaE - somaS) + '</div></div>' +
    '</div>' +
    '<div class="filtros">' +
      '<input type="search" id="ln-q" placeholder="descrição, quem fez, forma…" value="' + esc(f.q) + '">' +
      '<select id="ln-ano"><option value=""' + (f.ano === '' ? ' selected' : '') + '>Todos os anos</option>' +
        [...new Set(meses.map((m) => m.slice(0, 4)))].sort().reverse().map((a2) =>
          '<option value="' + a2 + '"' + (f.ano === a2 ? ' selected' : '') + '>' + a2 + '</option>').join('') + '</select>' +
      '<select id="ln-tipo"><option value="">Entradas e saídas</option>' +
        '<option value="entrada"' + (f.tipo === 'entrada' ? ' selected' : '') + '>Só entradas</option>' +
        '<option value="saida"' + (f.tipo === 'saida' ? ' selected' : '') + '>Só saídas</option></select>' +
      '<select id="ln-cat"><option value="">Todas as categorias</option>' +
        cats.map((c) => '<option' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      '<select id="ln-cc"><option value="">Todos os centros</option>' +
        ((S.cfg && S.cfg.centrosCusto) || []).map((c) => '<option value="' + esc(c) + '"' + (f.cc === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
        '<option value="__sem__"' + (f.cc === '__sem__' ? ' selected' : '') + '>— sem centro</option></select>' +
      '<button class="btn mini" id="ln-pdf" title="baixa em PDF exatamente o recorte da tela">📄 PDF</button>' +
      '<button class="btn primario" id="ln-desp">− Despesa</button>' +
      '<button class="btn" id="ln-rece">+ Receita</button>' +
    '</div>' +
    '<div class="filtros"><div class="chips">' +
      '<button class="chip' + (!f.mes ? ' on' : '') + '" data-lm="">Todos</button>' +
      ['01','02','03','04','05','06','07','08','09','10','11','12'].map((m2, i2) =>
        '<button class="chip' + (f.mes === m2 ? ' on' : '') + '" data-lm="' + m2 + '">' +
        ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][i2] + '</button>').join('') +
      '<button class="chip' + (f.mes === 'sem-data' ? ' on' : '') + '" data-lm="sem-data">s/ data</button>' +
    '</div></div>' + grade;

  app.querySelectorAll('.painel[data-pl]').forEach((el) => {
    el.onclick = () => { f.tipo = el.dataset.pl; TELAS.lancamentos(); };
  });
  document.getElementById('ln-q').oninput = (e) => { f.q = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-ano').onchange = (e) => { f.ano = e.target.value; TELAS.lancamentos(); };
  app.querySelectorAll('.chip[data-lm]').forEach((c) => {
    c.onclick = () => { f.mes = f.mes === c.dataset.lm ? '' : c.dataset.lm; TELAS.lancamentos(); };
  });
  document.getElementById('ln-pdf').onclick = () => {
    const rotulo = [
      f.mes === 'sem-data' ? 'sem data' : f.mes ? ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(f.mes) - 1] : 'todos os meses',
      f.ano || 'todos os anos',
      f.tipo === 'entrada' ? 'só entradas' : f.tipo === 'saida' ? 'só saídas' : '',
      f.cat, f.cc === '__sem__' ? 'sem centro' : f.cc, f.q,
    ].filter(Boolean).join(' · ');
    const blob = PDF.lancamentos(rotulo, filtrados, S.cfg || {});
    salvarNoAparelho(blob, 'Lancamentos-Bosques-' + hojeISO() + '.pdf');
    toast('PDF do recorte baixado');
  };
  document.getElementById('ln-tipo').onchange = (e) => { f.tipo = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-cat').onchange = (e) => { f.cat = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-cc').onchange = (e) => { f.cc = e.target.value; TELAS.lancamentos(); };
  document.getElementById('ln-desp').onclick = () => abrirLancamento('saida', TELAS.lancamentos);
  document.getElementById('ln-rece').onclick = () => abrirLancamento('entrada', TELAS.lancamentos);
  app.querySelectorAll('.ln-row').forEach((el) => {
    el.onclick = () => {
      if (el.dataset.col === 'cx') abrirEdicaoLancamento(el.dataset.id, TELAS.lancamentos);
      else if (el.dataset.venda) location.hash = '#/venda/' + el.dataset.venda;
      else vincularRecsOmie(TELAS.lancamentos);   // recebimento do Omie ainda solto
    };
  });
};

/* ── Tela: relatórios ───────────────────────────────────────────────────────
   O retrato do negócio num horizonte que VOCÊ escolhe: este mês, este ano ou
   até o último carnê acabar. Vendido, recebido, a receber, gasto — e os
   GASTOS FUTUROS PREVISTOS, que se cadastram aqui (única vez ou mensal). */

// Parcelas em aberto dos contratos vivos, por mês de vencimento.
// Vencida NÃO entra no mês: vira um número próprio ("cobrar"), senão o
// passado se disfarça de futuro.
function aReceberPorMes() {
  const hoje = hojeISO();
  const porMes = {};
  let vencido = 0, total = 0, parcelas = 0;
  for (const v of vendasVivas()) {
    const r = resumoVenda(v);
    for (const l of r.carne) {
      // Parcela PAGA está encerrada — quitar com o desconto de pontualidade
      // não deixa "falta"; contar a diferença criava vencido fantasma.
      if (l.situacao === 'paga') continue;
      const falta = Math.round((l.valor - Math.min(l.pago, l.valor)) * 100) / 100;
      if (falta <= 0.004) continue;
      total += falta; parcelas++;
      if (l.venc && l.venc < hoje) {
        // VENCIDO é só o que a régua marca 'atrasada' (parcela do espelho do
        // Omie sem pagamento). Parcela derivada do plano com data passada em
        // venda SEM boletos não é dívida provada — fica fora da conta toda.
        if (l.situacao === 'atrasada') { vencido += falta; }
        else { total -= falta; parcelas--; }
        continue;
      }
      const m = mesDe(l.venc);
      if (/^\d{4}-\d{2}$/.test(m)) porMes[m] = (porMes[m] || 0) + falta;
    }
  }
  return { porMes, vencido, total, parcelas };
}

// Quanto está PREVISTO de gasto num mês: os cadastrados à mão ('prev') MAIS
// o que falta das etapas do cronograma (o restante de cada etapa não
// concluída, diluído nos meses que sobram do período dela).
function previstoNoMes(m) {
  let soma = 0;
  for (const g of lista('prev')) {
    if (g.recorrencia === 'mensal') {
      if ((!g.inicio || g.inicio <= m) && (!g.fim || m <= g.fim)) soma += Number(g.valor) || 0;
    } else if ((g.data || '').slice(0, 7) === m) {
      soma += Number(g.valor) || 0;
    }
  }
  return soma + previstoEtapasNoMes(m);
}

// Idade do vencido: quem está devendo há mais tempo é quem se cobra primeiro.
function agingInadimplencia() {
  const hoje = new Date(hojeISO() + 'T00:00:00');
  const faixas = [
    { rotulo: '1 a 30 dias', ate: 30, rs: 0, parcelas: 0, contratos: new Set() },
    { rotulo: '31 a 60 dias', ate: 60, rs: 0, parcelas: 0, contratos: new Set() },
    { rotulo: '61 a 90 dias', ate: 90, rs: 0, parcelas: 0, contratos: new Set() },
    { rotulo: 'mais de 90 dias', ate: 1e9, rs: 0, parcelas: 0, contratos: new Set() },
  ];
  for (const v of vendasVivas()) {
    const r = resumoVenda(v);
    for (const l of r.carne) {
      if (l.situacao !== 'atrasada') continue;
      const falta = Math.round((l.valor - Math.min(l.pago, l.valor)) * 100) / 100;
      if (falta <= 0.004) continue;
      const dias = Math.floor((hoje - new Date(l.venc + 'T00:00:00')) / 86400000);
      const f = faixas.find((x) => dias <= x.ate);
      f.rs += falta; f.parcelas++; f.contratos.add(v.id);
    }
  }
  return faixas;
}

TELAS.relatorios = function () {
  const app = document.getElementById('app');
  const hz = TELAS._hz || 'ano';
  TELAS._hz = hz;
  const mesAtual = mesDe(hojeISO());
  const anoAtual = mesAtual.slice(0, 4);

  // vendido / recebido / gasto (sempre desde o início — é o retrato do negócio)
  const vendasDePe = lista('venda').filter((v) => v.situacao !== 'distratada');
  const vgv = vendasDePe.reduce((s, v) => s + totalPlanoVenda(v), 0);
  const ac = totaisAcumulados();

  // a receber e previstos DENTRO do horizonte
  const ar = aReceberPorMes();
  const mesesFuturos = Object.keys(ar.porMes).sort().filter((m) => m >= mesAtual);
  const doHorizonte = mesesFuturos.filter((m) =>
    hz === 'mes' ? m === mesAtual : hz === 'ano' ? m.startsWith(anoAtual) : true);
  const aReceberHz = doHorizonte.reduce((s, m) => s + ar.porMes[m], 0);
  const previstoHz = doHorizonte.reduce((s, m) => s + previstoNoMes(m), 0);
  // Etapa com valor e SEM prazo não cai em mês nenhum — mostrar, senão some.
  const pagoEtapas = pagoPorEtapa();   // devolve o MAPA inteiro {etapaId: pago}
  const previstoSemData = lista('etapa').filter((e) => !e.inicio && !e.fim)
    .reduce((s2, e) => s2 + Math.max(0, (Number(e.valorPrevisto) || 0) - (pagoEtapas[e.id] || 0)), 0);

  const rotuloHz = { mes: 'em ' + nomeMes(mesAtual), ano: 'em ' + anoAtual, total: 'até acabar' }[hz];
  // o recorte do horizonte para valores JÁ acontecidos (formas, centros)
  const dentroHz = (d) => {
    const m = mesDe(d || '');
    if (!/^\d{4}-\d{2}$/.test(m)) return hz === 'total';
    return hz === 'mes' ? m === mesAtual : hz === 'ano' ? m.startsWith(anoAtual) : true;
  };

  // tabela do horizonte: por mês (mês/ano) ou por ANO (até acabar — 150
  // parcelas vão até 2038; 13 linhas de ano leem melhor que 150 de mês)
  let grupos;
  if (hz === 'total') {
    const porAno = {};
    for (const m of mesesFuturos) {
      const a = m.slice(0, 4);
      const g = porAno[a] = porAno[a] || { rec: 0, prev: 0 };
      g.rec += ar.porMes[m]; g.prev += previstoNoMes(m);
    }
    grupos = Object.keys(porAno).sort().map((a) => ({ rotulo: a, ...porAno[a] }));
  } else {
    grupos = doHorizonte.map((m) => ({ rotulo: nomeMes(m), rec: ar.porMes[m], prev: previstoNoMes(m) }));
  }

  const previstos = lista('prev').sort((a, b) => String(a.data || a.inicio || '').localeCompare(b.data || b.inicio || ''));

  const aging = agingInadimplencia();
  const maiorFaixa = Math.max(1, ...aging.map((f) => f.rs));
  const blocoAging = ar.vencido > 0.01
    ? '<div class="cartao"><h2>Inadimplência por idade <span class="nota">— quem está vencido há mais tempo cobra-se primeiro</span></h2>' +
      '<div class="rolagem"><table class="tabela"><thead><tr><th>Vencido há</th><th></th>' +
      '<th class="num">Valor</th><th class="num">Parcelas</th><th class="num">Contratos</th></tr></thead><tbody>' +
      aging.map((f) => '<tr><td>' + f.rotulo + '</td>' +
        '<td style="width:34%"><div style="background:var(--verde-palido);border-radius:6px;height:12px;overflow:hidden">' +
          '<div style="width:' + Math.round(f.rs / maiorFaixa * 100) + '%;height:100%;background:var(--ruim)"></div></div></td>' +
        '<td class="num">' + (f.rs ? fmt.brl(f.rs) : '—') + '</td>' +
        '<td class="num">' + (f.parcelas || '—') + '</td><td class="num">' + (f.contratos.size || '—') + '</td></tr>').join('') +
      '<tr style="font-weight:800"><td>TOTAL</td><td></td><td class="num">' + fmt.brl(ar.vencido) + '</td>' +
      '<td class="num">' + aging.reduce((s, f) => s + f.parcelas, 0) + '</td>' +
      '<td class="num">' + new Set(aging.flatMap((f) => [...f.contratos])).size + '</td></tr>' +
      '</tbody></table></div>' +
      '<button class="btn mini" id="rel-cobrar" style="margin-top:8px">📣 Ir cobrar (Vendas → só atraso)</button></div>'
    : '';

  app.innerHTML =
    '<div class="filtros"><div class="chips">' +
      [['mes', 'Este mês'], ['ano', 'Este ano'], ['total', 'Até acabar']].map(([v, t2]) =>
        '<button class="chip' + (hz === v ? ' on' : '') + '" data-hz="' + v + '">' + t2 + '</button>').join('') +
    '</div><button class="btn mini" id="rel-pdf">📄 PDF do relatório</button></div>' +
    '<div class="paineis">' +
      '<div class="painel clicavel" data-acao="' + (vendasDePe.length !== new Set(vendasDePe.map((v) => v.loteId)).size ? 'duplicados' : 'vendas') + '"><div class="rot">Lotes vendidos</div><div class="num">' + new Set(vendasDePe.map((v) => v.loteId)).size + '</div>' +
        (vendasDePe.length !== new Set(vendasDePe.map((v) => v.loteId)).size ? '<div class="sub">⚠ ' + vendasDePe.length + ' contratos — clique e veja os lotes com 2 vendas</div>' : '') + '</div>' +
      '<div class="painel clicavel" data-acao="vendas"><div class="rot">Valor total vendido (VGV)</div><div class="num pos">' + fmt.brl(vgv) + '</div></div>' +
      '<div class="painel clicavel" data-acao="recebido"><div class="rot">Já recebido</div><div class="num pos">' + fmt.brl(ac.entradas) + '</div>' +
        '<div class="sub">clique e veja por forma abaixo</div></div>' +
      '<div class="painel clicavel" data-acao="gasto"><div class="rot">Já gasto</div><div class="num neg">' + fmt.brl(ac.saidas) + '</div></div>' +
    '</div>' +
    '<div class="paineis">' +
      '<div class="painel clicavel" data-acao="caixa"><div class="rot">A receber ' + rotuloHz + '</div><div class="num pos">' + fmt.brl(aReceberHz) + '</div>' +
        '<div class="sub">' + (hz === 'total' ? ar.parcelas + ' parcela(s) em aberto' : 'parcelas a vencer no período') + '</div></div>' +
      '<div class="painel clicavel" data-acao="vencido"><div class="rot">Vencido a cobrar</div><div class="num' + (ar.vencido ? ' neg' : '') + '">' + fmt.brl(ar.vencido) + '</div>' +
        '<div class="sub">clique para ir cobrar</div></div>' +
      '<div class="painel clicavel" data-acao="previstos"><div class="rot">Gastos previstos ' + rotuloHz + '</div><div class="num">' + fmt.brl(previstoHz) + '</div>' +
        (previstoSemData > 0 ? '<div class="sub">⚠ + ' + fmt.brl(previstoSemData) + ' de etapas SEM PRAZO — defina no Cronograma</div>' : '') + '</div>' +
      '<div class="painel clicavel" data-acao="tabela"><div class="rot">Saldo projetado ' + rotuloHz + '</div>' +
        '<div class="num ' + (aReceberHz - previstoHz >= 0 ? 'pos' : 'neg') + '">' + fmt.brl(aReceberHz - previstoHz) + '</div>' +
        '<div class="sub">a receber − previstos (sem o vencido)</div></div>' +
    '</div>' + blocoAging +
    '<div class="cartao" id="rel-tabela"><h2>' + (hz === 'total' ? 'Ano a ano até o fim dos carnês <span class="nota">— clique no ano para abrir os meses</span>' : 'Mês a mês do período') + '</h2>' +
      (grupos.length
        ? '<div class="rolagem"><table class="tabela"><thead><tr><th>' + (hz === 'total' ? 'Ano' : 'Mês') + '</th>' +
          '<th class="num">A receber</th><th class="num">Gastos previstos</th><th class="num">Saldo projetado</th></tr></thead><tbody>' +
          grupos.map((g) => {
            const aberto = hz === 'total' && TELAS._anoAbertoRel === g.rotulo;
            let sub = '';
            if (aberto) {
              sub = mesesFuturos.filter((m) => m.startsWith(g.rotulo)).map((m) => {
                const rec2 = ar.porMes[m], pv = previstoNoMes(m);
                return '<tr style="background:#f7faf7"><td style="padding-left:26px;color:var(--tinta-fraca)">' + nomeMes(m) + '</td>' +
                  '<td class="num">' + fmt.brl(rec2) + '</td><td class="num">' + (pv ? fmt.brl(pv) : '—') + '</td>' +
                  '<td class="num">' + fmt.brl(rec2 - pv) + '</td></tr>';
              }).join('');
            }
            return '<tr' + (hz === 'total' ? ' class="rel-ano" data-ano="' + g.rotulo + '" style="cursor:pointer"' : '') + '>' +
              '<td>' + (hz === 'total' ? (aberto ? '▼ ' : '▶ ') : '') + g.rotulo + '</td><td class="num">' + fmt.brl(g.rec) + '</td>' +
              '<td class="num">' + (g.prev ? fmt.brl(g.prev) : '—') + '</td>' +
              '<td class="num" style="color:' + (g.rec - g.prev >= 0 ? 'var(--verde)' : 'var(--ruim)') + '">' + fmt.brl(g.rec - g.prev) + '</td></tr>' + sub;
          }).join('') +
          '<tr style="font-weight:800"><td>TOTAL</td><td class="num">' + fmt.brl(aReceberHz) + '</td>' +
          '<td class="num">' + fmt.brl(previstoHz) + '</td><td class="num">' + fmt.brl(aReceberHz - previstoHz) + '</td></tr>' +
          '</tbody></table></div>' +
          '<p class="nota" style="margin-top:8px">O "a receber" supõe as parcelas pagas em dia; o vencido acumulado (' + fmt.brl(ar.vencido) + ') fica fora destas linhas de propósito.</p>'
        : '<p class="nota">Nada a vencer nesse período.</p>') + '</div>' +
    (() => {
      const cap = comissoesAPagar();
      if (!cap.length) return '';
      const totalCap = cap.reduce((s, x) => s + x.saldo, 0);
      return '<div class="cartao"><h2>Contas a pagar — comissões <span class="nota">— saldo devido por corretor</span>' +
        '<span style="float:right;font-weight:800;color:var(--ruim)">' + fmt.brl(totalCap) + '</span></h2>' +
        cap.map((x) => '<div class="lin" style="cursor:default">' +
          '<div class="cresce"><b>' + esc(x.cor.nome) + '</b>' +
          '<span class="sub">combinado ' + fmt.brl(x.devido) + ' · pago ' + fmt.brl(x.pago) +
            (x.cor.chavePix ? ' · PIX ' + esc(x.cor.chavePix) : '') + '</span></div>' +
          '<span class="dinheiro" style="color:var(--ruim)">' + fmt.brl(x.saldo) + '</span>' +
          '<button class="btn mini cap-pagar" data-id="' + esc(x.cor.id) + '" data-nome="' + esc(x.cor.nome) + '" data-saldo="' + x.saldo.toFixed(2) + '">💸 pagar</button>' +
          '</div>').join('') +
        '<p class="nota" style="margin-top:6px">Este valor NÃO está dentro dos "gastos previstos" acima — comissão devida não tem mês marcado; paga quando você decidir.</p></div>';
    })() +
    '<div class="cartao" id="rel-formas"><h2>💳 Recebido por forma <span class="nota">— ' + rotuloHz + '</span></h2>' +
      (function () {
        const somaF = {};
        for (const r2 of lista('rec')) {
          if (!dentroHz(r2.data)) continue;
          const f2 = r2.forma || '—';
          somaF[f2] = (somaF[f2] || 0) + (Number(r2.valor) || 0);
        }
        for (const c2 of cxVivos()) {
          if (c2.tipo !== 'entrada' || !dentroHz(c2.data)) continue;
          const f2 = c2.forma || '—';
          somaF[f2] = (somaF[f2] || 0) + (Number(c2.valor) || 0);
        }
        const ordem = ['PIX', 'Dinheiro', 'Boleto', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Cheque', 'Permuta'];
        const chaves = [...new Set([...ordem.filter((k2) => somaF[k2]), ...Object.keys(somaF)])];
        const total2 = Object.values(somaF).reduce((s2, v2) => s2 + v2, 0);
        if (!total2) return '<p class="nota">Nada recebido nesse recorte.</p>';
        return '<div class="rolagem"><table class="tabela"><thead><tr><th>Forma</th><th class="num">Valor</th><th class="num">%</th></tr></thead><tbody>' +
          chaves.map((k2) => '<tr class="rf-lin" data-forma="' + esc(k2) + '" style="cursor:pointer"><td><b>' + esc(k2) + '</b></td>' +
            '<td class="num">' + fmt.brl(somaF[k2]) + '</td>' +
            '<td class="num">' + Math.round(somaF[k2] / total2 * 100) + '%</td></tr>').join('') +
          '<tr style="border-top:2px solid var(--borda);font-weight:800"><td>TOTAL</td><td class="num">' + fmt.brl(total2) + '</td><td class="num">100%</td></tr>' +
          '</tbody></table></div>';
      })() + '</div>' +

      '<div class="cartao" id="rel-centros"><h2>🏗️ Gasto por centro de custo <span class="nota">— ' + rotuloHz + ' · cadastre os centros em Configurações</span></h2>' +
      (function () {
        const somaC = {}; let semC = 0;
        for (const c2 of cxVivos()) {
          if (c2.tipo !== 'saida' || !dentroHz(c2.data)) continue;
          if (c2.centroCusto) somaC[c2.centroCusto] = (somaC[c2.centroCusto] || 0) + (Number(c2.valor) || 0);
          else semC += Number(c2.valor) || 0;
        }
        const chaves = Object.keys(somaC).sort((x2, y2) => somaC[y2] - somaC[x2]);
        const total2 = chaves.reduce((s2, k2) => s2 + somaC[k2], 0) + semC;
        if (!total2) return '<p class="nota">Nenhuma despesa nesse recorte.</p>';
        return '<div class="rolagem"><table class="tabela"><thead><tr><th>Centro de custo</th><th class="num">Valor</th><th class="num">%</th></tr></thead><tbody>' +
          chaves.map((k2) => '<tr class="rc-lin" data-cc="' + esc(k2) + '" style="cursor:pointer"><td><b>' + esc(k2) + '</b></td>' +
            '<td class="num">' + fmt.brl(somaC[k2]) + '</td><td class="num">' + Math.round(somaC[k2] / total2 * 100) + '%</td></tr>').join('') +
          (semC ? '<tr class="rc-lin" data-cc="__sem__" style="cursor:pointer"><td>— sem centro de custo</td><td class="num">' + fmt.brl(semC) + '</td><td class="num">' + Math.round(semC / total2 * 100) + '%</td></tr>' : '') +
          '<tr style="border-top:2px solid var(--borda);font-weight:800"><td>TOTAL</td><td class="num">' + fmt.brl(total2) + '</td><td class="num">100%</td></tr>' +
          '</tbody></table></div>';
      })() + '</div>' +

      '<div class="cartao" id="rel-previstos"><h2>Gastos futuros previsíveis <span class="nota">— o que você já sabe que vem</span></h2>' +
      (previstos.map((g) =>
        '<div class="lin prev-lin" data-id="' + esc(g.id) + '">' +
        '<div class="cresce"><b>' + esc(g.descricao || '—') + '</b>' +
        '<span class="sub">' + (g.recorrencia === 'mensal'
          ? 'mensal · de ' + nomeMes(g.inicio || mesAtual) + (g.fim ? ' até ' + nomeMes(g.fim) : ' em diante')
          : 'única · ' + nomeMes((g.data || '').slice(0, 7) || mesAtual)) +
          ' · ' + esc(g.categoria || 'Outros') + (g.obs ? ' · ' + esc(g.obs) : '') + '</span></div>' +
        '<span class="dinheiro">' + fmt.brl(g.valor) + (g.recorrencia === 'mensal' ? '<span class="nota">/mês</span>' : '') + '</span>' +
        '</div>').join('') || '<p class="nota">Nenhum previsto ainda — cadastre o que você já sabe que vai pagar (obra, mensalidades…).</p>') +
      '<p class="nota" style="margin-top:8px">O que FALTA das etapas do Cronograma entra sozinho nesta conta — não cadastre de novo aqui, senão dobra.</p>' +
      '<button class="btn primario" id="prev-novo" style="margin-top:8px">+ Gasto previsto</button></div>';

  app.querySelectorAll('.chip[data-hz]').forEach((c) => {
    c.onclick = () => { TELAS._hz = c.dataset.hz; TELAS.relatorios(); };
  });
  // Card clicável leva ao DETALHE do número — número em que não dá para
  // clicar é beco sem saída.
  app.querySelectorAll('.painel[data-acao]').forEach((el) => {
    el.onclick = () => {
      const acao = el.dataset.acao;
      if (acao === 'vendas') location.hash = '#/vendas';
      else if (acao === 'duplicados') abrirLotesDuplicados();
      else if (acao === 'recebido') { TELAS._fLanc = { q: '', tipo: 'entrada', cat: '', mes: 'todos' }; location.hash = '#/lancamentos'; }
      else if (acao === 'gasto') { TELAS._fLanc = { q: '', tipo: 'saida', cat: '', mes: 'todos' }; location.hash = '#/lancamentos'; }
      else if (acao === 'caixa') { const c2 = document.getElementById('rel-tabela'); if (c2) c2.scrollIntoView({ behavior: 'smooth', block: 'start' }); else location.hash = '#/caixa'; }
      else if (acao === 'vencido') { TELAS._fVendas = { q: '', sit: '', so: 'atraso' }; location.hash = '#/vendas'; }
      else if (acao === 'previstos') { const c2 = document.getElementById('rel-previstos'); if (c2) c2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (acao === 'tabela') { const c2 = document.getElementById('rel-tabela'); if (c2) c2.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
  });
  app.querySelectorAll('.cap-pagar').forEach((b) => {
    b.onclick = () => abrirPagarComissao(b.dataset.id, b.dataset.nome, Number(b.dataset.saldo));
  });
  app.querySelectorAll('.rc-lin').forEach((el) => {
    el.onclick = () => { TELAS._fLanc = { q: '', tipo: 'saida', cat: '', mes: 'todos', cc: el.dataset.cc }; location.hash = '#/lancamentos'; };
  });
  app.querySelectorAll('.rf-lin').forEach((el) => {
    el.onclick = () => { TELAS._fLanc = { q: el.dataset.forma, tipo: '', cat: '', mes: 'todos' }; location.hash = '#/lancamentos'; };
  });
  const bCobrar = document.getElementById('rel-cobrar');
  if (bCobrar) bCobrar.onclick = () => { TELAS._fVendas = { q: '', sit: '', so: 'atraso' }; location.hash = '#/vendas'; };
  app.querySelectorAll('.rel-ano').forEach((tr) => {
    tr.onclick = () => {
      TELAS._anoAbertoRel = TELAS._anoAbertoRel === tr.dataset.ano ? null : tr.dataset.ano;
      TELAS.relatorios();
    };
  });
  document.getElementById('prev-novo').onclick = () => abrirGastoPrevisto(null);
  app.querySelectorAll('.prev-lin').forEach((el) => {
    el.onclick = () => abrirGastoPrevisto(el.dataset.id);
  });
  document.getElementById('rel-pdf').onclick = () => {
    PDF.relatorio({
      rotuloHz, hz, vendidos: new Set(vendasDePe.map((v) => v.loteId)).size, vgv,
      recebido: ac.entradas, gasto: ac.saidas,
      aReceber: aReceberHz, vencido: ar.vencido, previsto: previstoHz, grupos,
      aging: aging.map((f) => ({ rotulo: f.rotulo, rs: f.rs, parcelas: f.parcelas, contratos: f.contratos.size })),
      comissoesAPagar: comissoesAPagar().reduce((s, x) => s + x.saldo, 0),
    }, S.cfg || {});
    toast('Relatório em PDF gerado');
  };
};

function abrirGastoPrevisto(id) {
  const g = id ? (achar('prev', id) || {}) : {};
  const cats = (S.cfg && S.cfg.categoriasDespesa) || ['Outros'];
  const mesAtual = mesDe(hojeISO());
  const corpo =
    campo('Descrição', entrada('descricao', g.descricao || '', { placeholder: 'ex.: patrola da estrada, energia da sede…' })) +
    '<div class="colunas-3">' +
      campo('Valor (R$)', entrada('valor', g.valor != null ? g.valor : '', { inputmode: 'decimal' })) +
      campo('Categoria', seletor('categoria', g.categoria || cats[0], cats)) +
      campo('Repete?', seletor('recorrencia', g.recorrencia || 'unica', [{ v: 'unica', t: 'Uma vez só' }, { v: 'mensal', t: 'Todo mês' }])) +
    '</div>' +
    '<div class="colunas-3">' +
      campo('Mês (se única)', entrada('data', (g.data || '').slice(0, 7) || mesAtual, { tipo: 'month' })) +
      campo('De (se mensal)', entrada('inicio', g.inicio || mesAtual, { tipo: 'month' })) +
      campo('Até (se mensal)', entrada('fim', g.fim || '', { tipo: 'month' }), 'vazio = sem fim') +
    '</div>' +
    campo('Observação', entrada('obs', g.obs || ''));
  abrirModal({
    titulo: id ? 'Gasto previsto — editar' : 'Novo gasto previsto',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      ...(id ? [{ texto: 'Apagar', classe: 'perigo', aoClicar: async (fundo) => {
        if (await confirmar('Apagar este gasto previsto?', { perigo: true, ok: 'Apagar' })) {
          try {
            await api('apagar', { colecao: 'prev', id });
            const arr = S.reg.prev || [];
            const i = arr.findIndex((x) => x.id === id);
            if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
            gravarCache();
            fecharSilencioso(fundo);
            TELAS.relatorios();
          } catch (e) { toast(e.message || 'Não consegui agora', 'ruim'); }
        }
      } }] : []),
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        const valor = numeroBR(v.valor);
        if (!v.descricao || !v.descricao.trim()) { toast('Descreva o gasto', 'ruim'); return; }
        if (!(valor > 0)) { toast('Diga o valor', 'ruim'); return; }
        salvar('prev', {
          id: id || undefined,
          descricao: v.descricao.trim().slice(0, 200), valor,
          categoria: v.categoria, recorrencia: v.recorrencia === 'mensal' ? 'mensal' : 'unica',
          data: String(v.data || '').slice(0, 7), inicio: String(v.inicio || '').slice(0, 7),
          fim: String(v.fim || '').slice(0, 7), obs: String(v.obs || '').slice(0, 300),
        });
        fecharSilencioso(fundo);
        toast('Gasto previsto salvo');
        TELAS.relatorios();
      } },
    ],
  });
}
