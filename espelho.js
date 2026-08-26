/* ESPELHO — o mapa de vendas do loteamento: cada quadra, cada lote, quem está
   disponível, vendido ou reservado. Daqui saem o SIMULADOR e a PROPOSTA.

   Preço e parcela vêm do CADASTRO DO LOTE (4 preços por lote, herdados da
   planilha): parcela fixa / reajustada 6%, cada uma com e sem o desconto de
   20%. A venda escolhe o tipo; o valor pode ser ajustado na mão. */

const lotes = () => lista('lote').sort((a, b) => (a.quadra - b.quadra) || (a.lote - b.lote));
const nomeLote = (l) => l ? ('Q' + l.quadra + ' · L' + l.lote) : '—';
const recsDaVenda = (vid) => lista('rec').filter((r) => r.vendaId === vid);
const cfgReajuste = () => (S.cfg && S.cfg.reajuste) || { pct: 6, aCada: 12 };
const ehCorretorPerfil = () => S.perfil === 'corretor';

/* ── O MOTOR DO CARNÊ (ordem do dono, 26/08): a verdade das parcelas é o
   ESPELHO DO OMIE, armazenado em v.parcelas pela sincronização e EDITÁVEL na
   ficha. O carnê derivado do plano (carne.js) só vale para simulação de
   proposta e para venda que ainda não tem espelho. A inadimplência daqui
   bate com o banco por construção: parcela vencida sem pagamento = título
   vencido em aberto no Omie. */
function resumoVenda(v) {
  const ps = Array.isArray(v.parcelas) ? v.parcelas.filter(Boolean) : [];
  if (!ps.length) {
    // Sem boletos no Omie o atraso NÃO se afirma: o carnê derivado vira só o
    // PLANO (régua do banco é a única que conta dívida). A ficha avisa.
    const r = CARNE.resumo(v, cfgReajuste(), recsDaVenda(v.id));
    for (const l of r.carne) if (l.situacao === 'atrasada') l.situacao = 'aberta';
    r.qtdAtraso = 0; r.emAtraso = 0; r.semEspelho = true;
    return r;
  }
  const hoje = hojeISO();
  const cent = (x) => Math.round(x * 100) / 100;
  const carne = ps.map((pp, i) => {
    const situacao = pp.pago ? 'paga' : (pp.venc < hoje ? 'atrasada' : pp.venc === hoje ? 'hoje' : 'aberta');
    return {
      n: i + 1, venc: pp.venc || '', valor: Number(pp.valor) || 0,
      valorDia: pp.valorDia != null ? Number(pp.valorDia) : null,
      pago: pp.pago ? (Number(pp.pagoValor) || Number(pp.valor) || 0) : 0,
      pagoEm: pp.pago || null, situacao, tid: pp.tid || null,
      trava: !!pp.trava, conferir: !!pp.conferir, obs: pp.obs || '',
      rotulo: (i + 1) + 'ª' + (pp.tid ? '' : ' ✍️'),
    };
  });
  const total = cent(carne.reduce((s2, l) => s2 + l.valor, 0));
  const pago = cent(carne.reduce((s2, l) => s2 + l.pago, 0));
  const atrasadas = carne.filter((l) => l.situacao === 'atrasada');
  const emAtraso = cent(atrasadas.reduce((s2, l) => s2 + l.valor, 0));
  const proxima = carne.find((l) => ['aberta', 'hoje'].includes(l.situacao)) || null;
  const abertas = carne.filter((l) => !l.pagoEm);
  return {
    carne, total, pago, sobra: 0,
    saldo: cent(abertas.reduce((s2, l) => s2 + l.valor, 0)),
    qtdAtraso: atrasadas.length, emAtraso, proxima,
    quitada: carne.length > 0 && abertas.length === 0,
    espelhoOmie: true,
  };
}

// O valor do plano (VGV): pagando sempre em dia — entrada + parcelas com desconto.
function totalPlanoVenda(v) {
  const ps = Array.isArray(v.parcelas) ? v.parcelas.filter(Boolean) : [];
  if (!ps.length) return CARNE.resumo(v, cfgReajuste(), []).total;
  const soma = ps.reduce((s2, pp) => s2 + (pp.valorDia != null ? Number(pp.valorDia) : Number(pp.valor) || 0), 0);
  return Math.round(((Number(v.entrada) || 0) + soma) * 100) / 100;
}

// Vendas em atraso por lote (para o "!" no espelho) — só direção/escritório.
function lotesComAtraso() {
  const marca = new Set();
  if (ehCorretorPerfil()) return marca;
  for (const v of lista('venda')) {
    if (v.situacao && v.situacao !== 'ativa' && v.situacao !== 'conferir') continue;
    const r = resumoVenda(v);
    if (r.qtdAtraso > 0) marca.add(v.loteId);
  }
  return marca;
}

/* ── Tela: espelho ─────────────────────────────────────────────────────────── */
TELAS.espelho = function () {
  const app = document.getElementById('app');
  const ls = lotes();
  if (!ls.length) { app.innerHTML = vazio('🗺️', 'Nenhum lote cadastrado', 'Os lotes entram pela importação da planilha ou por Configurações.'); return; }

  const quadras = [...new Set(ls.map((l) => l.quadra))].sort((a, b) => a - b);
  const filtro = TELAS._fEspelho || { q: '', quadra: '', status: '', atraso: false };
  TELAS._fEspelho = filtro;

  const disponiveis = ls.filter((l) => l.status === 'Disponível');
  const disp = disponiveis.length;
  const estoqueRS = disponiveis.reduce((s, l) => s + (Number(l.preco) || 0), 0);
  const vend = ls.filter((l) => l.status === 'Vendido').length;
  // MESMA régua da tela Vendas (contratos de pé) — duas telas com números
  // diferentes para "vendido" é briga em reunião.
  const vgvVendido = lista('venda').filter((v) => v.situacao !== 'distratada')
    .reduce((s, v) => s + totalPlanoVenda(v), 0);
  const atrasos = lotesComAtraso();

  const filtrados = ls.filter((l) =>
    (!filtro.quadra || String(l.quadra) === filtro.quadra) &&
    (!filtro.status || l.status === filtro.status) &&
    (!filtro.atraso || atrasos.has(l.id)) &&
    (!filtro.q || (l.lote + '').includes(filtro.q) || nomeLote(l).toLowerCase().includes(filtro.q.toLowerCase())));

  // Cada quadra é uma gaveta: recolhe o que não interessa hoje. Nascem
  // abertas; o que você fechar fica lembrado enquanto a tela vive.
  TELAS._quadrasFechadas = TELAS._quadrasFechadas || new Set();
  const blocos = quadras
    .filter((q) => filtrados.some((l) => l.quadra === q))
    .map((q) => {
      const doQ = filtrados.filter((l) => l.quadra === q);
      return '<details class="quadra-bloco" data-quadra="' + q + '"' +
        (TELAS._quadrasFechadas.has(String(q)) ? '' : ' open') + '>' +
        '<summary style="cursor:pointer"><h3 style="display:inline-block;margin:0 0 8px">Quadra ' + q + ' <span class="nota">· ' +
        doQ.filter((l) => l.status === 'Disponível').length + ' disponíveis de ' + doQ.length + '</span></h3></summary>' +
        '<div class="grade-lotes">' + doQ.map((l) => {
          const cls = l.status === 'Vendido' ? 'vendido' : l.status === 'Reservado' ? 'reservado' : 'disp';
          const res2 = l.reservadoPor;
          return '<div class="lote-q ' + cls + (atrasos.has(l.id) ? ' atraso' : '') + '" data-id="' + esc(l.id) + '"' +
            (res2 ? ' title="Reservado para ' + esc(res2.nome || '?') + ' até ' + fmt.data(res2.ate) + '"' : '') + '>' +
            (l.status === 'Disponível' && !ehCorretorPerfil()
              ? '<span class="lq-res" data-id="' + esc(l.id) + '" title="Reservar este lote">🔒</span>' : '') +
            '<b>' + l.lote + '</b>' +
            '<span class="m2">' + fmt.numero(l.areaM2, 0) + ' m²</span>' +
            (l.status === 'Disponível'
              ? '<span class="preco">' + fmt.brl(l.preco).replace(',00', '') + '</span>'
              : l.status === 'Reservado' && res2
                ? '<span class="m2">🔒 ' + esc((res2.nome || '').split(' ')[0]) + '</span>'
                : '<span class="m2">' + esc(l.status) + '</span>') +
            '</div>';
        }).join('') + '</div></details>';
    }).join('');

  app.innerHTML =
    '<div class="cartao" style="background:var(--verde-escuro);border-color:var(--verde-escuro);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px">' +
      '<img src="icons/logo-full.png" alt="Portal dos Bosques" style="height:58px;max-width:52%;object-fit:contain">' +
      '<div style="display:flex;gap:8px">' +
        (ehCorretorPerfil() ? '' : '<button class="btn mini" id="esp-novo-lote" style="background:rgba(255,255,255,.14);border-color:transparent;color:#eaf3ec">+ Lote</button>') +
        '<button class="btn mini" id="esp-pdf" style="background:var(--verde-claro);border-color:var(--verde-claro);color:#123018">📄 PDF do espelho</button>' +
      '</div>' +
    '</div>' +
    '<div class="paineis">' +
      '<div class="painel clicavel" data-card="todos"><div class="rot">Lotes</div><div class="num">' + ls.length + '</div>' +
        '<div class="sub">ver todos</div></div>' +
      '<div class="painel clicavel" data-card="Disponível"><div class="rot">Disponíveis</div><div class="num pos">' + disp + '</div>' +
        '<div class="sub">' + fmt.brl(estoqueRS) + ' em tabela para vender</div></div>' +
      '<div class="painel clicavel" data-card="Vendido"><div class="rot">Vendidos</div><div class="num">' + vend + '</div>' +
        '<div class="sub">' + Math.round(vend / ls.length * 100) + '% · VGV ' + fmt.brl(vgvVendido) + '</div></div>' +
      (ehCorretorPerfil() ? '' :
      '<div class="painel clicavel" data-card="atraso"><div class="rot">Com atraso</div><div class="num' + (atrasos.size ? ' neg' : '') + '">' + atrasos.size + '</div></div>') +
    '</div>' +
    '<div class="filtros">' +
      '<input type="search" id="esp-q" placeholder="nº do lote…" value="' + esc(filtro.q) + '">' +
      '<select id="esp-quadra"><option value="">Todas as quadras</option>' +
        quadras.map((q) => '<option value="' + q + '"' + (filtro.quadra === String(q) ? ' selected' : '') + '>Quadra ' + q + '</option>').join('') + '</select>' +
    '</div>' +
    '<div class="filtros"><div class="chips">' +
      [['Disponível', disp, '#e1f2e2;border-color:#a8d5a0'],
       ['Vendido', vend, '#f0f0ef'],
       ['Reservado', ls.filter((l) => l.status === 'Reservado').length, '#fff8ec;border-color:#f0ddb5']]
        .map(([s, n2, cor]) => '<button class="chip esp-chip' + (filtro.status === s ? ' on' : '') + '" data-st="' + s + '">' +
          '<i style="display:inline-block;width:11px;height:11px;border-radius:4px;border:1px solid var(--borda);background:' + cor + ';margin-right:6px;vertical-align:-1px"></i>' +
          s + ' (' + n2 + ')</button>').join('') +
      (ehCorretorPerfil() ? '' :
        '<button class="chip esp-chip-atraso' + (filtro.atraso ? ' on' : '') + '">🔴 Com atraso (' + atrasos.size + ')</button>') +
    '</div>' +
    (ehCorretorPerfil() ? '' : '<span class="nota">🔒 no canto do lote verde = reservar na hora</span>') +
    '</div>' +
    (blocos || vazio('🔍', 'Nada com esse filtro'));

  document.getElementById('esp-pdf').onclick = () => {
    // O papel sai IGUAL à tela: filtrou, o PDF leva só o filtrado — e com o
    // recorte escrito, senão o pedaço vira "o total" na mão de alguém.
    const pedacos = [];
    if (filtro.status) pedacos.push('só ' + filtro.status.toLowerCase() + 's');
    if (filtro.atraso) pedacos.push('só com atraso');
    if (filtro.quadra) pedacos.push('quadra ' + filtro.quadra);
    if (filtro.q) pedacos.push('busca "' + filtro.q + '"');
    PDF.espelho(filtrados, atrasos, S.cfg || {}, pedacos.join(' · '));
    toast('Espelho em PDF gerado — ' + filtrados.length + ' lote(s)' + (pedacos.length ? ' (recorte)' : ''));
  };
  const bNovo = document.getElementById('esp-novo-lote');
  if (bNovo) bNovo.onclick = () => abrirCadastroLote(null);
  document.getElementById('esp-q').oninput = (e) => { filtro.q = e.target.value; TELAS.espelho(); };
  document.getElementById('esp-quadra').onchange = (e) => { filtro.quadra = e.target.value; TELAS.espelho(); };
  document.querySelectorAll('.painel[data-card]').forEach((cd) => {
    cd.onclick = () => {
      const alvo = cd.dataset.card;
      if (alvo === 'todos') { filtro.status = ''; filtro.atraso = false; }
      else if (alvo === 'atraso') { filtro.atraso = !filtro.atraso; filtro.status = ''; }
      else { filtro.status = filtro.status === alvo ? '' : alvo; filtro.atraso = false; }
      TELAS.espelho();
    };
  });
  document.querySelectorAll('.esp-chip').forEach((c) => {
    c.onclick = () => {
      filtro.status = filtro.status === c.dataset.st ? '' : c.dataset.st;   // clicou de novo, desliga
      TELAS.espelho();
    };
  });
  const chAtr = document.querySelector('.esp-chip-atraso');
  if (chAtr) chAtr.onclick = () => { filtro.atraso = !filtro.atraso; TELAS.espelho(); };
  document.querySelectorAll('.lote-q').forEach((el) => {
    el.onclick = () => { location.hash = '#/lote/' + el.dataset.id; };
  });
  document.querySelectorAll('.lq-res').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const l = achar('lote', el.dataset.id);
      if (l) abrirReservaLote(l);
    });
  });
  document.querySelectorAll('details[data-quadra]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) TELAS._quadrasFechadas.delete(d.dataset.quadra);
      else TELAS._quadrasFechadas.add(d.dataset.quadra);
    });
  });
};

/* ── Tela: ficha do lote (com simulador) ───────────────────────────────────── */
TELAS.lote = function (id) {
  const app = document.getElementById('app');
  const l = achar('lote', id);
  if (!l) { app.innerHTML = vazio('🗺️', 'Lote não encontrado', 'Ele pode ter sido removido.') + '<a href="#/espelho">← voltar ao espelho</a>'; return; }
  const venda = l.vendaId ? achar('venda', l.vendaId) : null;
  const reaj = cfgReajuste();

  const entradaPadrao = Number(S.cfg && S.cfg.entradaPadrao) || 3000;
  const sim = TELAS._sim && TELAS._sim.loteId === id ? TELAS._sim : {
    loteId: id, tipo: 'Fixa', entrada: entradaPadrao, qtde: 150, entradaModo: 'avista',
  };
  TELAS._sim = sim;
  const parcelaDoTipo = () => sim.tipo === 'Reajustada' ? (l.parcReajDesc || l.parcReaj) : (l.parcFixaDesc || l.parcFixa);
  if (sim.valorParcela == null) sim.valorParcela = parcelaDoTipo();

  const cabec =
    '<div class="cartao"><h2>' + nomeLote(l) + ' ' + etiqueta(l.status) +
      (venda ? ' <a class="btn mini" href="#/venda/' + esc(venda.id) + '">abrir a venda ' + esc(venda.codigo || '') + '</a>' : '') + '</h2>' +
      '<div class="paineis" style="margin:0">' +
        '<div class="painel clicavel lt-editar"><div class="rot">Área</div><div class="num">' + fmt.numero(l.areaM2, 2) + '</div><div class="sub">m²</div></div>' +
        '<div class="painel clicavel lt-editar"><div class="rot">Preço de tabela</div><div class="num pos">' + fmt.brl(l.preco) + '</div></div>' +
        '<div class="painel clicavel lt-editar"><div class="rot">Parcela fixa</div><div class="num">' + fmt.brl(l.parcFixaDesc) + '</div><div class="sub">com desconto · ' + fmt.brl(l.parcFixa) + ' sem</div></div>' +
        '<div class="painel clicavel lt-editar"><div class="rot">Parcela reajustada</div><div class="num">' + fmt.brl(l.parcReajDesc) + '</div><div class="sub">+' + reaj.pct + '% a cada ' + reaj.aCada + ' · ' + fmt.brl(l.parcReaj) + ' sem desc.</div></div>' +
      '</div></div>';

  let simulador = '';
  if (l.status === 'Disponível' || l.status === 'Reservado') {
    const avista = sim.tipo === 'Avista';
    const total = totalDoPlano(sim, reaj);
    const corretores = lista('corretor').filter((c) => c.ativo !== false);
    simulador =
      '<div class="cartao"><h2>Simulador <span class="nota">— monte o plano, baixe o PDF ou mande o link</span></h2>' +
      '<div class="colunas-3">' +
        campo('Como vai pagar', seletor('tipo', sim.tipo, [{ v: 'Fixa', t: 'Parcelas fixas' }, { v: 'Reajustada', t: 'Reajustadas +' + reaj.pct + '%/' + reaj.aCada + 'p' }, { v: 'Avista', t: 'À vista' }])) +
        campo(avista ? 'Valor à vista (R$)' : 'Entrada (R$)', entrada('entrada', sim.entrada, { inputmode: 'decimal' })) +
        campo('Pagamento por', seletor('formaPg', sim.formaPg || 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX', 'Boleto', 'Cartão de Crédito'])) +
      '</div>' +
      (avista ? '' :
      '<div class="colunas-3">' +
        campo('Nº de parcelas', entrada('qtde', sim.qtde, { inputmode: 'numeric' })) +
        campo('Valor da parcela (R$)', entrada('valorParcela', sim.valorParcela, { inputmode: 'decimal' }), 'sugerido pela tabela do lote') +
        '<div class="campo"><label>Total do plano</label><div style="font-size:21px;font-weight:800;padding:7px 0" id="sim-total">' + fmt.brl(total) + '</div>' +
          (sim.tipo === 'Reajustada' ? '<div class="dica">já somando os degraus de +' + reaj.pct + '%</div>' : '') + '</div>' +
      '</div>') +
      (avista ? '<div class="campo"><label>Total do plano</label><div style="font-size:21px;font-weight:800;padding:0 0 7px" id="sim-total">' + fmt.brl(total) + '</div></div>' : '') +
      (avista ? '' :
      '<div class="colunas">' +
        campo('Como paga a entrada', seletor('entradaModo', sim.entradaModo || 'avista', [
          { v: 'avista', t: 'De uma vez (PIX/dinheiro)' },
          { v: '2', t: 'Parcelada em 2x (sem juros)' },
          { v: '3', t: 'Parcelada em 3x (sem juros)' },
          { v: '4', t: 'Parcelada em 4x (sem juros)' },
          { v: 'cartao', t: 'No cartão, com juros' },
        ]), detalheEntrada(sim)) +
        (sim.entradaModo === 'cartao'
          ? '<div class="colunas">' +
            campo('Vezes no cartão', entrada('entradaVezes', sim.entradaVezes || 4, { inputmode: 'numeric' })) +
            campo('Juros total (%)', entrada('entradaJurosPct', sim.entradaJurosPct != null ? sim.entradaJurosPct : 10, { inputmode: 'decimal' }), 'repassado ao cliente') +
            '</div>'
          : '<div></div>') +
      '</div>') +
      '<div class="colunas' + (ehCorretorPerfil() ? '' : '-3') + '">' +
        (ehCorretorPerfil()
          ? campo('Nome do cliente', entrada('nome', sim.nome || '', { placeholder: 'quem vai receber a proposta' }))
          : '<div class="campo ac-wrap"><label>Cliente</label>' +
            '<input data-campo="nome" id="cli-busca" value="' + esc(sim.nome || '') + '" placeholder="digite 2 letras — busca no cadastro" autocomplete="off">' +
            '<div class="ac-lista" id="cli-sugestoes"></div>' +
            '<div class="dica" id="cli-vinculo">' + (sim.clienteId ? '✓ do cadastro' : '') + '</div></div>') +
        campo('WhatsApp dele', entrada('telefone', sim.telefone || '', { inputmode: 'tel', placeholder: '(38) 9…' })) +
        (ehCorretorPerfil() ? '' :
          campo('Corretor', seletor('corretorId', sim.corretorId || '', corretores.map((c) => ({ v: c.id, t: c.nome })), 'sem corretor (a casa)'))) +
      '</div>' +
      (ehCorretorPerfil() ? '' :
        '<div class="colunas">' +
        campo('Comissão do corretor (R$)', entrada('comissao', sim.comissao != null ? sim.comissao : '', { inputmode: 'decimal' }),
          'INTERNO — não sai no PDF do cliente; já vai preenchida para a venda') +
        (sim.temCor2
          ? '<div class="campo"><label>2º corretor <a href="#" id="bt-tira-cor2" style="float:right;font-weight:400">✕ tirar</a></label>' +
            seletor('cor2Id', sim.cor2Id || '', corretores.map((c) => ({ v: c.id, t: c.nome })), '— escolher —') + '</div>'
          : '<div class="campo"><label>&nbsp;</label><button type="button" class="btn mini" id="bt-cor2">👥 São dois corretores? dividir comissão</button></div>') +
        '</div>' +
        (sim.temCor2
          ? '<div class="colunas"><div></div>' +
            campo('Comissão do 2º corretor (R$)', entrada('comissao2', sim.comissao2 != null ? sim.comissao2 : '', { inputmode: 'decimal' }),
              'cada um recebe a sua — as duas entram nas contas a pagar') + '</div>'
          : '')) +
      '<div class="acoes-linha">' +
        '<button class="btn primario" id="bt-pdf-prop">📄 Baixar PDF da proposta</button>' +
        '<button class="btn" id="bt-proposta">📱 Enviar por link (WhatsApp)</button>' +
        (ehCorretorPerfil() ? '' : '<button class="btn" id="bt-venda">✅ Registrar venda</button>') +
      '</div></div>';
  }

  // ── CRM do lote: toda proposta que já saiu daqui, com quem e como foi ──
  const propsDoLote = lista('prop').filter((x) => x.loteId === id)
    .sort((a, b) => String(b.enviadaEm || b.criadoEm || '').localeCompare(a.enviadaEm || a.criadoEm || ''));
  const crm = propsDoLote.length
    ? '<div class="cartao"><h2>CRM do lote <span class="nota">— ' + propsDoLote.length + ' proposta(s) já saíram daqui</span></h2>' +
      propsDoLote.map((x) => {
        const interesse = (x.eventos || []).some((e) => e.tipo === 'interesse');
        return '<div class="lin prop-crm" data-id="' + esc(x.id) + '">' +
          '<div class="cresce"><b>' + esc((x.cliente && x.cliente.nome) || '?') + '</b>' +
          '<span class="sub">' + esc(x.codigo || '') + ' · ' + fmt.brl(x.valor) + ' · por ' + esc(x.donoNome || '—') +
            ' · ' + fmt.quando(x.enviadaEm || x.criadoEm) + ' · 👁 ' + (x.views || 0) +
            (interesse ? ' · ✅ interesse' : '') + '</span></div>' +
          etiqueta(x.situacao || 'enviada') + '</div>';
      }).join('') + '</div>'
    : '';

  // Reserva: aviso vivo na ficha (com o vencimento), e vencida ela GRITA.
  const res = l.reservadoPor;
  const resVencida = res && res.ate && res.ate < hojeISO();
  const blocoReserva = res
    ? '<div class="cartao" style="border-color:' + (resVencida ? '#f2c4c4' : '#f0ddb5') + ';padding:10px 16px">' +
      (resVencida ? '🔴 <b>Reserva VENCIDA</b>' : '🔒 <b>Reservado</b>') +
      ' para <b>' + esc(res.nome || '?') + '</b>' + (res.tel ? ' (' + fmt.telefone(res.tel) + ')' : '') +
      ' até ' + fmt.data(res.ate) + ' · por ' + esc(res.por || '—') +
      (res.obs ? ' · ' + esc(res.obs) : '') + '</div>'
    : '';

  const admLote = ehCorretorPerfil() ? '' :
    '<div class="acoes-linha" style="margin-bottom:14px">' +
      '<button class="btn mini" id="bt-editar-lote">✏️ Editar lote</button>' +
      (l.status === 'Disponível' ? '<button class="btn mini" id="bt-reservar">🔒 Reservar</button>' : '') +
      (res ? '<button class="btn mini" id="bt-liberar">Liberar reserva</button>' : '') +
      (l.status === 'Disponível' ? '<button class="btn mini perigo" id="bt-apagar-lote">Excluir lote</button>' : '') +
    '</div>';

  app.innerHTML = '<a class="nota" href="#/espelho">← espelho</a>' + cabec + blocoReserva + admLote + simulador + crm;

  const bEd = document.getElementById('bt-editar-lote');
  if (bEd) bEd.onclick = () => abrirCadastroLote(id);
  // os cartões de tabela do lote abrem a edição (só quem pode editar)
  if (!ehCorretorPerfil()) app.querySelectorAll('.lt-editar').forEach((el) => {
    el.onclick = () => abrirCadastroLote(id);
  });
  const bRes = document.getElementById('bt-reservar');
  if (bRes) bRes.onclick = () => abrirReservaLote(l);
  const bLib = document.getElementById('bt-liberar');
  if (bLib) bLib.onclick = async () => {
    if (await confirmar('Liberar a reserva de ' + esc((l.reservadoPor || {}).nome || '?') + '? O lote volta a Disponível.')) {
      salvar('lote', { id: l.id, reservadoPor: null });
      toast('Reserva liberada');
      TELAS.lote(id);
    }
  };
  const bAp = document.getElementById('bt-apagar-lote');
  if (bAp) bAp.onclick = async () => {
    if (await confirmar('Excluir o lote ' + nomeLote(l) + '? Ele vai para a lixeira (a direção restaura se precisar).', { perigo: true, ok: 'Excluir' })) {
      try {
        await api('apagar', { colecao: 'lote', id: l.id });
        const arr = S.reg.lote || [];
        const i = arr.findIndex((x) => x.id === l.id);
        if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
        gravarCache();
        toast('Lote excluído');
        location.hash = '#/espelho';
      } catch (e) { toast(e.message || 'Não consegui excluir agora', 'ruim'); }
    }
  };

  app.querySelectorAll('.prop-crm').forEach((el) => {
    el.onclick = () => abrirFichaProposta(el.dataset.id);
  });

  if (l.status !== 'Disponível' && l.status !== 'Reservado') return;
  const raiz = app;
  raiz.querySelectorAll('[data-campo]').forEach((el) => {
    el.addEventListener('input', () => {
      const v = lerCampos(raiz);
      const tipoAntes = sim.tipo;
      Object.assign(sim, {
        tipo: v.tipo, entrada: numeroBR(v.entrada),
        qtde: v.qtde != null ? Math.round(numeroBR(v.qtde)) : sim.qtde,
        valorParcela: v.valorParcela != null ? numeroBR(v.valorParcela) : sim.valorParcela,
        nome: String(v.nome || ''), telefone: String(v.telefone || ''),
        corretorId: v.corretorId != null ? v.corretorId : sim.corretorId,
        formaPg: v.formaPg || sim.formaPg,
        comissao: v.comissao != null ? numeroBR(v.comissao) : sim.comissao,
        cor2Id: v.cor2Id != null ? v.cor2Id : sim.cor2Id,
        comissao2: v.comissao2 != null ? numeroBR(v.comissao2) : sim.comissao2,
        entradaModo: v.entradaModo || sim.entradaModo || 'avista',
        entradaVezes: v.entradaVezes != null ? Math.max(2, Math.round(numeroBR(v.entradaVezes)) || 4) : sim.entradaVezes,
        entradaJurosPct: v.entradaJurosPct != null ? numeroBR(v.entradaJurosPct) : sim.entradaJurosPct,
      });
      // nome que bate com o cadastro → vincula o cliente e puxa o WhatsApp
      if (!ehCorretorPerfil()) {
        const nomeNorm = String(sim.nome || '').trim().toUpperCase();
        const cli = nomeNorm ? lista('cliente').find((c2) => (c2.nome || '').trim().toUpperCase() === nomeNorm) : null;
        sim.clienteId = cli ? cli.id : '';
        if (cli && !sim.telefone && (cli.whatsapp || cli.celular)) {
          sim.telefone = cli.whatsapp || cli.celular;
          const elTel = raiz.querySelector('[data-campo="telefone"]');
          if (elTel) elTel.value = sim.telefone;
        }
      }
      const modoAntes = el.dataset.campo === 'entradaModo';
      if (modoAntes) {
        // o que o campo MOSTRA como padrão precisa existir no dado — senão a
        // proposta sai com juros 0% enquanto a tela mostrava 10%
        if (sim.entradaModo === 'cartao') {
          if (sim.entradaVezes == null) sim.entradaVezes = 4;
          if (sim.entradaJurosPct == null) sim.entradaJurosPct = 10;
        }
        TELAS.lote(id); return;   // muda os campos do cartão
      }
      if (v.tipo !== tipoAntes) {
        if (v.tipo === 'Avista') sim.entrada = l.preco;          // à vista: começa no preço de tabela
        else { sim.valorParcela = parcelaDoTipo(); if (!(sim.qtde > 0)) sim.qtde = 150; if (tipoAntes === 'Avista') sim.entrada = Number(S.cfg && S.cfg.entradaPadrao) || 3000; }
        TELAS.lote(id); return;
      }
      document.getElementById('sim-total').textContent = fmt.brl(totalDoPlano(sim, reaj));
    });
  });
  // ── autocomplete do cliente: organizado, sem despejar o banco inteiro ──
  const caixaSug = document.getElementById('cli-sugestoes');
  const inpCli = document.getElementById('cli-busca');
  if (caixaSug && inpCli) {
    const norm = (s2) => String(s2 || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const pintaVinculo = () => {
      const el2 = document.getElementById('cli-vinculo');
      if (el2) el2.textContent = sim.clienteId ? '✓ ' + (achar('cliente', sim.clienteId) || {}).nome + ' — do cadastro' : '';
    };
    const abreSugestoes = () => {
      const q2 = norm(inpCli.value);
      if (q2.length < 2) { caixaSug.style.display = 'none'; return; }
      const achados = lista('cliente')
        .filter((c2) => norm(c2.nome).includes(q2) || (c2.cpf || '').includes(q2))
        .slice(0, 6);
      const exato = achados.some((c2) => norm(c2.nome) === q2);
      caixaSug.innerHTML =
        achados.map((c2) => '<div class="ac-item" data-id="' + esc(c2.id) + '"><b>' + esc(c2.nome) + '</b>' +
          '<span class="sub">' + (c2.cpf ? fmt.doc(c2.cpf) + ' · ' : '') + (fmt.telefone(c2.whatsapp || c2.celular) || 'sem telefone') + '</span></div>').join('') +
        (!exato ? '<div class="ac-item novo">➕ Cadastrar novo cliente' + (inpCli.value.trim() ? ': "' + esc(inpCli.value.trim()) + '"' : '') + '</div>' : '');
      caixaSug.style.display = 'block';
      // mousedown (não click): dispara antes do blur fechar a lista
      caixaSug.querySelectorAll('.ac-item[data-id]').forEach((it) => {
        it.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          const c2 = achar('cliente', it.dataset.id);
          sim.nome = c2.nome; sim.clienteId = c2.id;
          inpCli.value = c2.nome;
          if (!sim.telefone && (c2.whatsapp || c2.celular)) {
            sim.telefone = c2.whatsapp || c2.celular;
            const elTel = raiz.querySelector('[data-campo="telefone"]');
            if (elTel) elTel.value = sim.telefone;
          }
          caixaSug.style.display = 'none';
          pintaVinculo();
        });
      });
      const itNovo = caixaSug.querySelector('.ac-item.novo');
      if (itNovo) itNovo.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        caixaSug.style.display = 'none';
        abrirFichaPessoa('cliente', null, {
          prefill: { nome: inpCli.value.trim(), whatsapp: sim.telefone || '' },
          aoSalvar: (c2) => {
            sim.nome = c2.nome; sim.clienteId = c2.id;
            if (!sim.telefone) sim.telefone = c2.whatsapp || c2.celular || '';
            TELAS.lote(id);
          },
        });
      });
    };
    inpCli.addEventListener('input', abreSugestoes);
    inpCli.addEventListener('focus', abreSugestoes);
    inpCli.addEventListener('blur', () => { setTimeout(() => { caixaSug.style.display = 'none'; pintaVinculo(); }, 150); });
  }

  const btCor2 = document.getElementById('bt-cor2');
  if (btCor2) btCor2.onclick = () => { sim.temCor2 = true; TELAS.lote(id); };
  const btTiraCor2 = document.getElementById('bt-tira-cor2');
  if (btTiraCor2) btTiraCor2.onclick = (e) => { e.preventDefault(); sim.temCor2 = false; sim.cor2Id = ''; sim.comissao2 = null; TELAS.lote(id); };

  const btPdf = document.getElementById('bt-pdf-prop');
  if (btPdf) btPdf.onclick = () => baixarPdfProposta(l, sim);
  const btP = document.getElementById('bt-proposta');
  if (btP) btP.onclick = () => enviarLinkProposta(l, sim, btP);
  const btV = document.getElementById('bt-venda');
  if (btV) btV.onclick = () => abrirNovaVenda(l, { ...sim });
};

// A frase da entrada — a mesma na dica do simulador, na proposta e na venda.
function detalheEntrada(sim) {
  const e = Number(sim.entrada) || 0;
  const modo = sim.entradaModo || 'avista';
  if (modo === 'avista' || !e) return '';
  if (modo === 'cartao') {
    const vezes = Math.max(2, Math.round(Number(sim.entradaVezes)) || 4);
    const pct = Number(sim.entradaJurosPct) || 0;
    const total = Math.round(e * (1 + pct / 100) * 100) / 100;
    return 'cartão: ' + vezes + 'x de ' + fmt.brl(total / vezes) + ' — total ' + fmt.brl(total) + ' com juros de ' + pct + '%';
  }
  const n = Number(modo);
  return n + 'x de ' + fmt.brl(e / n) + ' sem juros';
}

// Total honesto: a parcela Reajustada sobe em degraus — multiplicar reto
// subestimaria o plano (e o PDF sairia prometendo menos do que o carnê cobra).
function totalDoPlano(sim, reaj) {
  const qtde = sim.tipo === 'Avista' ? 0 : Math.max(0, Math.round(Number(sim.qtde) || 0));
  let soma = Number(sim.entrada) || 0;
  for (let n = 1; n <= qtde; n++) {
    soma += CARNE.valorParcelaN({ valorParcela: sim.valorParcela, tipoParcela: sim.tipo }, n, reaj);
  }
  return Math.round(soma * 100) / 100;
}

/* ── Cadastro do lote (incluir / editar) ───────────────────────────────────── */
// A régua da tabela veio da planilha e é LINEAR no preço (conferida lote a
// lote): parcela = preço × fator. Digitou o preço, as 4 parcelas se sugerem —
// e continuam editáveis, porque tabela é política, não lei.
// As razões EXATAS da tabela oficial (Simulador de Parcelas de Lotes.xlsx):
// valor do lote = m² × R$ 40; parcela = valor × razão; desconto = ×0,8.
const PRECO_POR_M2 = 40;
const RAZAO_PARC = { parcFixa: 0.01090625, parcFixaDesc: 0.008725, parcReaj: 0.00840625, parcReajDesc: 0.006725 };

function abrirCadastroLote(id) {
  const l = id ? (achar('lote', id) || {}) : {};
  const corpo =
    '<div class="colunas-3">' +
      campo('Quadra', entrada('quadra', l.quadra != null ? l.quadra : '', { inputmode: 'numeric' })) +
      campo('Nº do lote', entrada('lote', l.lote != null ? l.lote : '', { inputmode: 'numeric' })) +
      campo('Área (m²)', entrada('areaM2', l.areaM2 != null ? l.areaM2 : '', { inputmode: 'decimal' })) +
    '</div>' +
    campo('Preço de tabela (R$)', entrada('preco', l.preco != null ? l.preco : '', { inputmode: 'decimal' }), 'ao digitar, as 4 parcelas se sugerem pela régua da tabela') +
    '<div class="colunas">' +
      campo('Parcela fixa (R$)', entrada('parcFixa', l.parcFixa != null ? l.parcFixa : '', { inputmode: 'decimal' })) +
      campo('Fixa com desconto (R$)', entrada('parcFixaDesc', l.parcFixaDesc != null ? l.parcFixaDesc : '', { inputmode: 'decimal' })) +
    '</div><div class="colunas">' +
      campo('Parcela reajustada (R$)', entrada('parcReaj', l.parcReaj != null ? l.parcReaj : '', { inputmode: 'decimal' })) +
      campo('Reajustada com desconto (R$)', entrada('parcReajDesc', l.parcReajDesc != null ? l.parcReajDesc : '', { inputmode: 'decimal' })) +
    '</div>' +
    campo('Rua / observação', entrada('rua', l.rua || ''));

  const fundo = abrirModal({
    titulo: id ? 'Editar ' + nomeLote(l) : 'Novo lote',
    corpo, largo: true,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Salvar', classe: 'primario', aoClicar: (f2) => {
        const v = lerCampos(f2);
        const quadra = Math.round(numeroBR(v.quadra));
        const nLote = Math.round(numeroBR(v.lote));
        const preco = numeroBR(v.preco);
        if (!(quadra > 0) || !(nLote > 0)) { toast('Diga quadra e número do lote', 'ruim'); return; }
        if (!(preco > 0)) { toast('Diga o preço', 'ruim'); return; }
        const idNovoLote = 'q' + quadra + '-l' + nLote;
        if (!id && achar('lote', idNovoLote)) { toast('O lote Q' + quadra + '-L' + nLote + ' já existe', 'ruim'); return; }
        if (id && idNovoLote !== id && achar('lote', idNovoLote)) { toast('Já existe outro lote Q' + quadra + '-L' + nLote, 'ruim'); return; }
        salvar('lote', {
          // mudar quadra/nº de um lote existente NÃO troca o id (as vendas
          // apontam para ele); só o rótulo muda.
          id: id || idNovoLote,
          cod: l.cod || (Math.max(0, ...lotes().map((x) => Number(x.cod) || 0)) + 1),
          quadra, lote: nLote,
          areaM2: numeroBR(v.areaM2), preco,
          parcFixa: numeroBR(v.parcFixa), parcFixaDesc: numeroBR(v.parcFixaDesc),
          parcReaj: numeroBR(v.parcReaj), parcReajDesc: numeroBR(v.parcReajDesc),
          rua: String(v.rua || '').slice(0, 120),
        });
        fecharSilencioso(f2);
        toast(id ? 'Lote atualizado' : 'Lote Q' + quadra + '-L' + nLote + ' criado');
        location.hash = '#/lote/' + (id || idNovoLote);
        TELAS.espelho._forcar = true;
      } },
    ],
  });
  // preço digitado → sugere as 4 parcelas (só preenche campo que está vazio
  // ou que ainda segue a régua — o que foi mexido à mão fica quieto)
  const campoPreco = fundo.querySelector('[data-campo="preco"]');
  // área digitada → sugere o preço pela régua oficial (m² × R$ 40); o preço
  // digitado à mão fica quieto (dataset.mexido).
  const campoArea = fundo.querySelector('[data-campo="areaM2"]');
  if (campoArea) campoArea.addEventListener('input', () => {
    const m2 = numeroBR(campoArea.value);
    if (!(m2 > 0) || campoPreco.dataset.mexido) return;
    campoPreco.value = (m2 * PRECO_POR_M2).toFixed(2);
    campoPreco.dispatchEvent(new Event('input'));
  });
  campoPreco.addEventListener('keydown', () => { campoPreco.dataset.mexido = '1'; });
  campoPreco.addEventListener('input', () => {
    const preco = numeroBR(campoPreco.value);
    if (!(preco > 0)) return;
    for (const [nome, razao] of Object.entries(RAZAO_PARC)) {
      const el = fundo.querySelector('[data-campo="' + nome + '"]');
      if (el && !el.dataset.mexido) el.value = (preco * razao).toFixed(2);
    }
  });
  for (const nome of Object.keys(RAZAO_PARC)) {
    const el = fundo.querySelector('[data-campo="' + nome + '"]');
    if (el) el.addEventListener('keydown', () => { el.dataset.mexido = '1'; });
  }
}

/* ── Reservar lote ──────────────────────────────────────────────────────────
   Reserva é AVISO com prazo, não trava: a venda pode ser registrada por cima
   (é a reserva virando negócio). O status Reservado é decidido no servidor. */
function abrirReservaLote(l) {
  const corpo =
    '<div class="colunas">' +
      campo('Reservado para', entrada('nome', '', { placeholder: 'nome do interessado' })) +
      campo('WhatsApp dele', entrada('tel', '', { inputmode: 'tel' })) +
    '</div>' +
    campo('Validade (dias)', entrada('dias', 3, { inputmode: 'numeric' }), 'vencida, a ficha avisa em vermelho') +
    campo('Observação', entrada('obs', '', { placeholder: 'aguardando sinal, vem sábado…' }));
  abrirModal({
    titulo: '🔒 Reservar ' + nomeLote(l),
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Reservar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        if (!v.nome || !v.nome.trim()) { toast('Diga para quem é a reserva', 'ruim'); return; }
        const dias = Math.max(1, Math.round(numeroBR(v.dias)) || 3);
        const ate = new Date(Date.now() + dias * 86400000);
        salvar('lote', { id: l.id, reservadoPor: {
          nome: v.nome.trim().slice(0, 80), tel: String(v.tel || '').slice(0, 30),
          por: S.quem || '—', em: hojeISO(),
          ate: ate.getFullYear() + '-' + String(ate.getMonth() + 1).padStart(2, '0') + '-' + String(ate.getDate()).padStart(2, '0'),
          obs: String(v.obs || '').slice(0, 200),
        } });
        fecharSilencioso(fundo);
        toast('Lote reservado por ' + dias + ' dia(s)');
        TELAS.lote(l.id);
      } },
    ],
  });
}

/* ── Proposta: duas saídas, um CRM ──────────────────────────────────────────
   BAIXAR PDF — sai na hora, offline se preciso, para imprimir ou mandar você
   mesmo. ENVIAR POR LINK — grava no servidor e entrega o link do WhatsApp que
   registra abertura e interesse. As DUAS ficam no CRM do lote: proposta que
   só vive no papel não responde "quantas saíram e o que deu". */

function montarPropDoSim(l, sim) {
  if (!sim.nome || !sim.nome.trim()) { toast('Diga o nome do cliente', 'ruim'); return null; }
  const reaj = cfgReajuste();
  const souCorretor = ehCorretorPerfil();
  const cor = souCorretor ? null : lista('corretor').find((c) => c.id === sim.corretorId);
  // O interessado ENTRA NO BANCO de clientes (direção/escritório): existente é
  // reaproveitado pelo nome; novo é cadastrado na hora — a proposta nunca cria
  // um cliente-fantasma que só vive dentro dela. (Corretor não grava cliente:
  // o dele segue embutido na proposta, e vira cadastro na venda.)
  let clienteId = '';
  if (!souCorretor) {
    const nomeNorm = sim.nome.trim().toUpperCase();
    let cli = (sim.clienteId && achar('cliente', sim.clienteId)) ||
      lista('cliente').find((c2) => (c2.nome || '').trim().toUpperCase() === nomeNorm);
    if (!cli) {
      cli = salvar('cliente', { nome: sim.nome.trim().slice(0, 90), whatsapp: String(sim.telefone || '').slice(0, 30) });
      toast('Cliente "' + cli.nome + '" cadastrado — complete a ficha depois');
    } else if (sim.telefone && !cli.whatsapp && !cli.celular) {
      salvar('cliente', { id: cli.id, whatsapp: String(sim.telefone || '').slice(0, 30) });
    }
    clienteId = cli.id;
    sim.clienteId = cli.id;
  }
  return {
    clienteId,
    loteId: l.id, quadra: l.quadra, lote: l.lote, areaM2: l.areaM2,
    valor: totalDoPlano(sim, reaj),
    entrada: Number(sim.entrada) || 0,
    qtdeParcelas: sim.tipo === 'Avista' ? 0 : Math.max(0, Math.round(Number(sim.qtde) || 0)),
    valorParcela: sim.tipo === 'Avista' ? 0 : (Number(sim.valorParcela) || 0),
    tipoParcela: sim.tipo === 'Avista' ? 'À vista' : (sim.tipo === 'Reajustada' ? 'Reajustada' : 'Fixa'),
    formaPg: sim.formaPg || 'PIX',
    entradaModo: sim.entradaModo || 'avista',
    entradaDetalhe: detalheEntrada(sim),
    comissao: Number(sim.comissao) || 0,   // interno: NUNCA impresso no PDF do cliente
    cliente: { nome: sim.nome.trim().slice(0, 80), telefone: String(sim.telefone || '').slice(0, 30) },
    corretorNome: souCorretor ? (S.quem || '') : (cor ? cor.nome : ''),
    corretorId: souCorretor ? '' : (cor ? cor.id : ''),
    corretorTel: cor ? (cor.whatsapp || cor.celular || '') : '',
    corretor2Id: (!souCorretor && sim.temCor2 && sim.cor2Id) || '',
    corretor2Nome: (!souCorretor && sim.temCor2 && sim.cor2Id && (lista('corretor').find((c2) => c2.id === sim.cor2Id) || {}).nome) || '',
    comissao2: (!souCorretor && sim.temCor2 && Number(sim.comissao2)) || 0,
    validadeDias: (S.cfg && S.cfg.validadeProposta) || 7,
    enviadaEm: new Date().toISOString(),
    situacao: 'enviada',
  };
}

async function baixarPdfProposta(l, sim) {
  const prop = montarPropDoSim(l, sim);
  if (!prop) return;
  const salva = salvar('prop', { ...prop, canal: 'pdf' });   // entra no CRM
  // A proposta sai NUMERADA: espera o servidor carimbar o PR-XXXX. Só sem
  // internet ela sai sem número (e ganha o dela ao sincronizar).
  try { await subirFila(); } catch (e) { /* offline: segue */ }
  const atual = achar('prop', salva.id) || salva;
  if (!atual.codigo) toast('Sem internet agora: saiu SEM número — ela ganha o PR ao sincronizar', 'ruim');
  // A proposta leva os dados COMPLETOS do proponente: o cadastro entra por
  // baixo, o que foi digitado agora fica por cima.
  const cadastro = (atual.clienteId && achar('cliente', atual.clienteId)) || {};
  const blob = PDF.proposta({ ...atual, cliente: { ...cadastro, ...atual.cliente } }, l, S.cfg || {});
  salvarNoAparelho(blob, 'Proposta-Bosques-' + (atual.codigo || 'Q' + l.quadra + 'L' + l.lote) + '-' +
    prop.cliente.nome.split(' ')[0] + '.pdf');
  toast('PDF ' + (atual.codigo || '') + ' baixado e no CRM do lote');
  TELAS.lote(l.id);
}

async function enviarLinkProposta(l, sim, btn) {
  const prop = montarPropDoSim(l, sim);
  if (!prop) return;
  if (btn) { btn.disabled = true; btn.textContent = 'gerando…'; }
  try {
    // 1. grava (o servidor numera e sorteia o token do link)
    const salva = salvar('prop', { ...prop, canal: 'link' });
    await subirFila();
    const doServidor = achar('prop', salva.id);
    if (!doServidor || !doServidor.tokenPublico) throw new Error('sem internet agora — o link precisa do servidor (o PDF avulso funciona offline)');
    // 2. PDF com o número carimbado, anexado ao link
    const cadastro2 = (doServidor.clienteId && achar('cliente', doServidor.clienteId)) || {};
    const pdfBlob = PDF.proposta({ ...doServidor, cliente: { ...cadastro2, ...doServidor.cliente } }, l, S.cfg || {});
    const arq = await enviarArquivo(new File([pdfBlob], 'proposta.pdf', { type: 'application/pdf' }));
    salvar('prop', { id: salva.id, arquivoId: arq.id });
    await subirFila();
    mostrarLinkProposta(achar('prop', salva.id));
    TELAS.lote(l.id);
  } catch (e) {
    toast(e.message || 'Não consegui gerar o link', 'ruim');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📱 Enviar por link (WhatsApp)'; }
  }
}

function mostrarLinkProposta(p) {
  if (!p) return;
  const link = P_URL + '/' + p.id + '/' + p.tokenPublico;
  const msg = 'Olá' + (p.cliente && p.cliente.nome ? ', ' + p.cliente.nome.split(' ')[0] : '') +
    '! Segue sua proposta do lote Q' + p.quadra + '-L' + p.lote + ' no Portal dos Bosques: ' + link;
  abrirModal({
    titulo: 'Proposta ' + (p.codigo || '') + ' pronta',
    corpo:
      '<p>O link abre uma página com o resumo e o PDF. Cada abertura fica registrada aqui no sistema.</p>' +
      '<div class="campo" style="margin-top:10px"><label>Link</label><input type="text" readonly value="' + esc(link) + '" onclick="this.select()"></div>',
    acoes: [
      { texto: 'Copiar link', aoClicar: () => { navigator.clipboard && navigator.clipboard.writeText(link); toast('Link copiado'); } },
      { texto: 'Mandar no WhatsApp', classe: 'primario', aoClicar: () => {
        window.open(linkWhats((p.cliente && p.cliente.telefone) || '', msg), '_blank');
      } },
    ],
  });
}

/* ── Nova venda (direção/escritório) ───────────────────────────────────────── */
function abrirNovaVenda(l, sim) {
  const clientes = lista('cliente').sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const corretores = lista('corretor').filter((c) => c.ativo !== false);
  const hoje = hojeISO();
  const corpo =
    campo('Cliente já cadastrado', seletor('clienteId', sim.clienteId || '', clientes.map((c) => ({ v: c.id, t: c.nome + (c.cpf ? ' · ' + fmt.doc(c.cpf) : '') })), '— cadastrar novo abaixo —')) +
    '<div class="colunas">' +
      campo('ou nome do cliente novo', entrada('nomeNovo', '')) +
      campo('CPF dele', entrada('cpfNovo', '', { inputmode: 'numeric' })) +
    '</div>' +
    '<div class="colunas">' +
      campo('WhatsApp', entrada('telNovo', '', { inputmode: 'tel' })) +
      campo('Data da venda', entrada('dataVenda', hoje, { tipo: 'date' })) +
    '</div><hr style="border:0;border-top:1px solid var(--borda);margin:6px 0 12px">' +
    '<div class="colunas">' +
      campo('Corretor', seletor('corretorId', sim.corretorId || '', corretores.map((c) => ({ v: c.id, t: c.nome })), 'sem corretor')) +
      campo('Comissão combinada (R$)', entrada('comissao', sim.comissao != null && sim.comissao !== 0 ? sim.comissao : '', { inputmode: 'decimal' })) +
    '</div>' +
    '<div class="colunas">' +
      campo('2º corretor (se dupla)', seletor('cor2Id', sim.cor2Id || '', corretores.map((c) => ({ v: c.id, t: c.nome })), 'não tem')) +
      campo('Comissão do 2º (R$)', entrada('comissao2', sim.comissao2 != null && sim.comissao2 !== 0 ? sim.comissao2 : '', { inputmode: 'decimal' })) +
    '</div>' +
    '<div class="colunas-3">' +
      campo('Entrada (R$)', entrada('entrada', sim.entrada, { inputmode: 'decimal' })) +
      campo('Forma da entrada', seletor('formaEntrada', sim.formaPg || 'PIX', (S.cfg && S.cfg.formasPg) || ['PIX', 'Dinheiro'])) +
      campo('Recebida em', entrada('dataEntrada', hoje, { tipo: 'date' }), 'deixe vazio se ainda não recebeu') +
    '</div>' +
    '<div class="colunas-3">' +
      campo('Nº de parcelas', entrada('qtde', sim.tipo === 'Avista' ? 0 : sim.qtde, { inputmode: 'numeric' }), 'à vista = 0') +
      campo('Valor da parcela', entrada('valorParcela', sim.tipo === 'Avista' ? 0 : sim.valorParcela, { inputmode: 'decimal' })) +
      campo('Tipo', seletor('tipoParcela', sim.tipo === 'Avista' ? 'Fixa' : sim.tipo, ['Fixa', 'Reajustada'])) +
    '</div>' +
    campo('Observações', areaTexto('obs', ''));

  abrirModal({
    titulo: 'Registrar venda — ' + nomeLote(l),
    corpo, largo: true,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Registrar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        let clienteId = v.clienteId, clienteNome = '';
        if (clienteId) {
          const c = achar('cliente', clienteId);
          clienteNome = c ? c.nome : '';
        } else {
          if (!v.nomeNovo || !v.nomeNovo.trim()) { toast('Escolha um cliente ou cadastre o novo', 'ruim'); return; }
          const cpf = String(v.cpfNovo || '').replace(/\D/g, '');
          const novo = salvar('cliente', {
            id: cpf || undefined, cpf, nome: v.nomeNovo.trim().slice(0, 90),
            whatsapp: String(v.telNovo || '').slice(0, 30),
          });
          clienteId = novo.id; clienteNome = novo.nome;
        }
        const cor = corretores.find((c) => c.id === v.corretorId);
        const entradaRS = numeroBR(v.entrada);
        const dataEntrada = v.dataEntrada || '';
        const venda = salvar('venda', {
          loteId: l.id, quadra: l.quadra, lote: l.lote,
          clienteId, clienteNome,
          corretorId: cor ? cor.id : '', corretorNome: cor ? cor.nome : '',
          comissao: numeroBR(v.comissao),
          corretor2Id: v.cor2Id || '',
          corretor2Nome: (v.cor2Id && (corretores.find((c2) => c2.id === v.cor2Id) || {}).nome) || '',
          comissao2: numeroBR(v.comissao2),
          dataVenda: v.dataVenda || hoje,
          entrada: entradaRS, formaEntrada: v.formaEntrada, dataEntrada,
          entradaDetalhe: detalheEntrada(sim),
          qtdeParcelas: Math.round(numeroBR(v.qtde)), valorParcela: numeroBR(v.valorParcela),
          tipoParcela: v.tipoParcela === 'Reajustada' ? 'Reajustada' : 'Fixa',
          situacao: 'ativa', obs: String(v.obs || '').slice(0, 800),
          historico: [{ id: Date.now().toString(36), em: new Date().toISOString(), por: S.quem || '—', o_que: 'Venda registrada' }],
        });
        // Entrada já recebida vira RECEBIMENTO na hora — o caixa nasce certo.
        if (entradaRS > 0 && dataEntrada) {
          salvar('rec', { vendaId: venda.id, tipo: 'entrada', valor: entradaRS, data: dataEntrada, forma: v.formaEntrada });
        }
        fecharSilencioso(fundo);
        toast('Venda registrada');
        location.hash = '#/venda/' + venda.id;
      } },
    ],
  });
}


/* ── Tela: Simulador (aba livre) ────────────────────────────────────────────
   A inteligência da tabela oficial, solta: escolhe um lote (ou digita a
   metragem) e vê as 4 parcelas — Fixa e Reajustada 6%, cheias e com o
   desconto de pontualidade. NÃO grava nada: nem orçamento, nem reserva. */
TELAS.simulador = function () {
  const app = document.getElementById('app');
  const f = TELAS._fSimLivre || { loteId: '', m2: '', preco: '' };
  TELAS._fSimLivre = f;
  const disponiveis = lista('lote').filter((x) => x.status === 'Disponível')
    .sort((a, b) => (a.quadra - b.quadra) || (a.lote - b.lote));

  const l = f.loteId ? achar('lote', f.loteId) : null;
  const m2 = l ? Number(l.areaM2) || 0 : numeroBR(f.m2);
  const preco = f.preco !== '' && !l ? numeroBR(f.preco)
    : (l && l.preco ? Number(l.preco) : m2 * PRECO_POR_M2);
  const entradaP = (S.cfg && S.cfg.entradaPadrao) || 3000;
  const parc = (razao) => Math.round(preco * razao * 100) / 100;
  const nParc = 150;
  const linha = (rot, cheia, desc) =>
    '<tr><td><b>' + rot + '</b></td>' +
    '<td class="num">' + fmt.brl(cheia) + '</td>' +
    '<td class="num" style="font-weight:700;color:var(--verde)">' + fmt.brl(desc) + '</td>' +
    '<td class="num">' + fmt.brl(entradaP + desc * nParc) + '</td></tr>';

  app.innerHTML =
    '<div class="cartao"><h2>🏷️ Simulador <span class="nota">— a tabela oficial na mão; nada é gravado</span></h2>' +
    '<div class="colunas-3">' +
      '<div class="campo"><label>Lote do espelho</label><select id="sl-lote"><option value="">— digitar metragem —</option>' +
        disponiveis.map((x) => '<option value="' + esc(x.id) + '"' + (f.loteId === x.id ? ' selected' : '') + '>Q' +
          x.quadra + '-L' + x.lote + ' · ' + (Number(x.areaM2) || 0).toLocaleString('pt-BR') + ' m²</option>').join('') +
      '</select><div class="dica">' + disponiveis.length + ' disponíveis</div></div>' +
      campo('Metragem (m²)', entrada('m2', l ? (l.areaM2 || '') : f.m2, { inputmode: 'decimal', somenteLeitura: !!l }),
        'régua oficial: R$ ' + PRECO_POR_M2 + '/m²') +
      campo('Valor do lote (R$)', entrada('preco', preco ? preco.toFixed(2) : '', { inputmode: 'decimal' }),
        'sugerido pela régua — pode ajustar') +
    '</div></div>' +
    (preco > 0
      ? '<div class="paineis">' +
          '<div class="painel clicavel sl-foca" data-campo-alvo="preco"><div class="rot">Valor do lote</div><div class="num">' + fmt.brl(preco) + '</div>' +
            (m2 ? '<div class="sub">' + m2.toLocaleString('pt-BR') + ' m² × R$ ' + PRECO_POR_M2 + '</div>' : '') + '</div>' +
          '<div class="painel clicavel sl-foca" data-campo-alvo="m2"><div class="rot">Entrada</div><div class="num">' + fmt.brl(entradaP) + '</div>' +
            '<div class="sub">padrão da casa · ' + nParc + ' parcelas</div></div>' +
        '</div>' +
        '<div class="cartao"><h2>O plano, nas duas réguas</h2>' +
        '<div class="rolagem"><table class="tabela">' +
        '<thead><tr><th>Tipo</th><th class="num">Boleto (cheio)</th><th class="num">Pagando em dia (−20%)</th><th class="num">Total do plano em dia</th></tr></thead><tbody>' +
        linha('Fixa', parc(RAZAO_PARC.parcFixa), parc(RAZAO_PARC.parcFixaDesc)) +
        linha('Reajustada 6%', parc(RAZAO_PARC.parcReaj), parc(RAZAO_PARC.parcReajDesc)) +
        '</tbody></table></div>' +
        '<p class="nota">Reajustada: +6% a cada 12 parcelas sobre o valor da parcela — começa menor e sobe com o tempo. ' +
        'Simulação de tabela: não cria orçamento, não reserva e não fica registrada. ' +
        'Para propor de verdade, use o simulador de venda dentro do lote, no Espelho.</p></div>'
      : '<div class="cartao"><p class="nota">Escolha um lote ou digite a metragem para ver as parcelas.</p></div>');

  app.querySelectorAll('.sl-foca').forEach((el) => {
    el.onclick = () => { const c = app.querySelector('[data-campo="' + el.dataset.campoAlvo + '"]'); if (c) { c.focus(); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  });
  document.getElementById('sl-lote').onchange = (e) => {
    f.loteId = e.target.value; f.m2 = ''; f.preco = ''; TELAS.simulador();
  };
  const cm2 = app.querySelector('[data-campo="m2"]');
  if (cm2) cm2.oninput = (e) => { f.m2 = e.target.value; f.loteId = ''; f.preco = ''; TELAS.simulador(); };
  const cpr = app.querySelector('[data-campo="preco"]');
  if (cpr) cpr.onchange = (e) => { f.preco = e.target.value; TELAS.simulador(); };
};
