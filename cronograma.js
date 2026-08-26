/* CRONOGRAMA — o que falta fazer na obra, com dinheiro amarrado.
 *
 * Cada etapa tem VALOR PREVISTO e período (início → término). As despesas
 * PAGAS se vinculam à etapa (cx.etapaId) — aí a barra mostra previsto × pago
 * × falta, sem conta de cabeça. E o que FALTA de cada etapa não concluída
 * entra sozinho na previsão de gastos dos Relatórios (previstoNoMes soma as
 * etapas): o previsto e o pago vivem juntos, como o Léo pediu.
 *
 * Situação 'atrasada' é DERIVADA (término passou e não concluiu) — ninguém
 * grava atraso à mão, então ele nunca fica esquecido para trás. */

const etapas = () => lista('etapa').sort((a, b) =>
  String(a.inicio || '9999').localeCompare(b.inicio || '9999') || String(a.criadoEm || '').localeCompare(b.criadoEm || ''));

// Quanto já foi PAGO de cada etapa (saídas vivas vinculadas a ela).
function pagoPorEtapa() {
  const mapa = {};
  for (const c of cxVivos()) {
    if (c.tipo !== 'saida' || !c.etapaId) continue;
    mapa[c.etapaId] = (mapa[c.etapaId] || 0) + (Number(c.valor) || 0);
  }
  return mapa;
}

// O que FALTA das etapas não concluídas, diluído nos meses que restam do
// período de cada uma (período já passado e não concluído → cai no mês atual).
function previstoEtapasNoMes(m) {
  const mesAtual = mesDe(hojeISO());
  const pago = pagoPorEtapa();
  let soma = 0;
  for (const e of lista('etapa')) {
    if (e.situacao === 'concluida') continue;
    const restante = Math.max(0, (Number(e.valorPrevisto) || 0) - (pago[e.id] || 0));
    if (restante <= 0.004) continue;
    let ini = mesDe(e.inicio) || mesAtual;
    if (ini < mesAtual) ini = mesAtual;
    let fim = mesDe(e.fim) || ini;
    if (fim < ini) fim = ini;
    if (m < ini || m > fim) continue;
    const [ia, im] = ini.split('-').map(Number);
    const [fa, fm2] = fim.split('-').map(Number);
    const n = (fa - ia) * 12 + (fm2 - im) + 1;
    soma += restante / n;
  }
  return soma;
}

const situacaoEtapa = (e, pago) => {
  if (e.situacao === 'concluida') return 'concluida';
  if (e.fim && e.fim < hojeISO()) return 'atrasada';
  if ((e.inicio && e.inicio <= hojeISO()) || (pago || 0) > 0) return 'andamento';
  return 'prevista';
};

/* ── Tela ──────────────────────────────────────────────────────────────────── */
TELAS.cronograma = function () {
  const app = document.getElementById('app');
  const ets = etapas();
  const pago = pagoPorEtapa();
  TELAS._etAbertas = TELAS._etAbertas || new Set();

  const previstoTotal = ets.reduce((s, e) => s + (Number(e.valorPrevisto) || 0), 0);
  const pagoTotal = ets.reduce((s, e) => s + (pago[e.id] || 0), 0);
  const concluidas = ets.filter((e) => e.situacao === 'concluida').length;
  const pctFin = previstoTotal > 0 ? Math.min(100, Math.round(pagoTotal / previstoTotal * 100)) : 0;

  const saidasSoltas = cxVivos().filter((c) => c.tipo === 'saida' && !c.etapaId).length;

  app.innerHTML =
    '<div class="paineis">' +
      '<div class="painel clicavel" data-pe="lista"><div class="rot">Etapas</div><div class="num">' + ets.length + '</div>' +
        '<div class="sub">' + concluidas + ' concluída(s)</div></div>' +
      '<div class="painel clicavel" data-pe="lista"><div class="rot">Previsto da obra</div><div class="num">' + fmt.brl(previstoTotal) + '</div></div>' +
      '<div class="painel clicavel" data-pe="pagos"><div class="rot">Já pago</div><div class="num pos">' + fmt.brl(pagoTotal) + '</div>' +
        '<div class="sub">' + pctFin + '% do previsto</div></div>' +
      '<div class="painel clicavel" data-pe="lista"><div class="rot">Falta pagar</div><div class="num' + (previstoTotal - pagoTotal > 0.01 ? ' neg' : '') + '">' +
        fmt.brl(Math.max(0, previstoTotal - pagoTotal)) + '</div>' +
        '<div class="sub">entra sozinho nos Relatórios</div></div>' +
    '</div>' +
    '<div class="filtros">' +
      '<button class="btn primario" id="et-nova">+ Etapa</button>' +
      '<button class="btn mini" id="et-pdf">📄 PDF do cronograma</button>' +
      (saidasSoltas ? '<span class="nota">' + saidasSoltas + ' despesa(s) ainda sem etapa — vincule dentro de cada etapa</span>' : '') +
    '</div>' +
    (ets.map((e) => {
      const sit = situacaoEtapa(e, pago[e.id]);
      const prev = Number(e.valorPrevisto) || 0;
      const pg = pago[e.id] || 0;
      const falta = Math.max(0, prev - pg);
      const pct = prev > 0 ? Math.min(100, Math.round(pg / prev * 100)) : 0;
      const vinculadas = cxVivos().filter((c) => c.etapaId === e.id && c.tipo === 'saida')
        .sort((a, b) => String(b.data || '').localeCompare(a.data || ''));
      return '<details class="cartao" style="padding:12px 16px" data-et="' + esc(e.id) + '"' +
        (TELAS._etAbertas.has(e.id) ? ' open' : '') + '>' +
        '<summary style="cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span style="flex:1;min-width:180px"><b>' + esc(e.nome || '—') + '</b>' +
          '<span class="sub" style="display:block;font-size:12.5px;color:var(--tinta-fraca)">' +
            (e.inicio || e.fim ? fmt.data(e.inicio) + ' → ' + fmt.data(e.fim) + ' · ' : '') +
            (prev > 0
              ? 'previsto ' + fmt.brl(prev) + ' · pago ' + fmt.brl(pg) + ' (' + pct + '%)' +
                (falta > 0.01 ? ' · falta ' + fmt.brl(falta) : '')
              : 'gasto até aqui: ' + fmt.brl(pg) + ' (sem meta de custo — defina o previsto quando quiser)') + '</span>' +
          (prev > 0
            ? '<span style="display:block;background:var(--verde-palido);border-radius:6px;height:10px;overflow:hidden;margin-top:5px;max-width:420px">' +
              '<span style="display:block;width:' + pct + '%;height:100%;background:' + (sit === 'atrasada' ? 'var(--ruim)' : 'var(--verde)') + '"></span></span>'
            : '') +
          '</span>' +
          etiqueta(sit) +
        '</summary>' +
        '<div style="margin-top:10px">' +
          (e.obs ? '<p class="nota" style="margin-bottom:8px">📝 ' + esc(e.obs) + '</p>' : '') +
          '<div class="acoes-linha" style="margin:0 0 10px">' +
            '<button class="btn mini et-editar" data-id="' + esc(e.id) + '">✏️ Editar</button>' +
            (e.situacao !== 'concluida'
              ? '<button class="btn mini et-concluir" data-id="' + esc(e.id) + '">✅ Concluir</button>' +
                '<button class="btn mini et-vincular" data-id="' + esc(e.id) + '">🔗 Vincular despesas pagas</button>' +
                '<button class="btn mini et-despesa" data-id="' + esc(e.id) + '">− Despesa desta etapa</button>'
              : '<button class="btn mini et-reabrir" data-id="' + esc(e.id) + '">Reabrir</button>') +
          '</div>' +
          '<h2 style="font-size:13.5px;margin:0 0 4px">Despesas pagas desta etapa <span class="nota">— ' + vinculadas.length + '</span></h2>' +
          (vinculadas.map((c) => '<div class="lin et-cx" data-id="' + esc(c.id) + '" style="padding:8px 10px">' +
            '<div class="cresce"><b>' + esc(c.descricao || '—') + '</b>' +
            '<span class="sub">' + fmt.data(c.data) + ' · ' + esc(c.categoria || '') + ' · por ' + esc(c.criadoPor || '—') + '</span></div>' +
            '<span class="dinheiro" style="color:var(--ruim)">−' + fmt.brl(c.valor) + '</span></div>').join('') ||
            '<p class="nota">Nenhuma ainda — vincule as pagas ou lance uma nova aqui de dentro.</p>') +
        '</div></details>';
    }).join('') || vazio('🏗️', 'Nenhuma etapa ainda', 'Comece pelo que falta fazer: patrola, meio-fio, rede de energia…'));

  app.querySelectorAll('.painel[data-pe]').forEach((el) => {
    el.onclick = () => {
      if (el.dataset.pe === 'pagos') { TELAS._fLanc = { q: '', tipo: 'saida', cat: 'Obra / infraestrutura', mes: 'todos' }; location.hash = '#/lancamentos'; }
      else { const h = [...app.querySelectorAll('h2')].find((x) => x.textContent.length); if (h) h.scrollIntoView({ behavior: 'smooth' }); }
    };
  });
  document.getElementById('et-nova').onclick = () => abrirEtapa(null);
  document.getElementById('et-pdf').onclick = () => {
    PDF.cronograma(ets.map((e) => ({ e, sit: situacaoEtapa(e, pago[e.id]), pago: pago[e.id] || 0 })),
      { previstoTotal, pagoTotal }, S.cfg || {});
    toast('Cronograma em PDF gerado');
  };
  app.querySelectorAll('details[data-et]').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) TELAS._etAbertas.add(d.dataset.et);
      else TELAS._etAbertas.delete(d.dataset.et);
    });
  });
  app.querySelectorAll('.et-editar').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); abrirEtapa(b.dataset.id); }; });
  app.querySelectorAll('.et-concluir').forEach((b) => {
    b.onclick = async (ev) => {
      ev.stopPropagation();
      const e = achar('etapa', b.dataset.id);
      const pg = pagoPorEtapa()[e.id] || 0;
      const prev = Number(e.valorPrevisto) || 0;
      const aviso = pg < prev - 0.01 ? ' Atenção: pago ' + fmt.brl(pg) + ' de ' + fmt.brl(prev) + ' previstos.' : '';
      if (await confirmar('Concluir a etapa "' + e.nome + '"?' + aviso + ' Ela sai da previsão de gastos.')) {
        salvar('etapa', { id: e.id, situacao: 'concluida', concluidaEm: hojeISO() });
        TELAS.cronograma();
      }
    };
  });
  app.querySelectorAll('.et-reabrir').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); salvar('etapa', { id: b.dataset.id, situacao: 'andamento' }); TELAS.cronograma(); };
  });
  app.querySelectorAll('.et-vincular').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); abrirVincularDespesas(b.dataset.id); }; });
  app.querySelectorAll('.et-despesa').forEach((b) => {
    b.onclick = (ev) => { ev.stopPropagation(); abrirLancamento('saida', TELAS.cronograma, b.dataset.id); };
  });
  app.querySelectorAll('.et-cx').forEach((el) => {
    el.onclick = () => abrirEdicaoLancamento(el.dataset.id, TELAS.cronograma);
  });
};

/* ── Etapa: criar / editar ─────────────────────────────────────────────────── */
function abrirEtapa(id) {
  const e = id ? (achar('etapa', id) || {}) : {};
  const corpo =
    campo('Nome da etapa', entrada('nome', e.nome || '', { placeholder: 'ex.: rede de energia da quadra 3' })) +
    '<div class="colunas-3">' +
      campo('Valor previsto (R$)', entrada('valorPrevisto', e.valorPrevisto ? e.valorPrevisto : '', { inputmode: 'decimal' }), 'opcional — vazio = só somar o gasto') +
      campo('Início', entrada('inicio', e.inicio || '', { tipo: 'date' })) +
      campo('Término', entrada('fim', e.fim || '', { tipo: 'date' })) +
    '</div>' +
    campo('Observação', areaTexto('obs', e.obs || ''));
  abrirModal({
    titulo: id ? 'Editar etapa' : 'Nova etapa',
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      ...(id ? [{ texto: 'Apagar', classe: 'perigo', aoClicar: async (fundo) => {
        if (await confirmar('Apagar esta etapa? As despesas vinculadas continuam no caixa (só perdem o vínculo à vista).', { perigo: true, ok: 'Apagar' })) {
          try {
            await api('apagar', { colecao: 'etapa', id });
            const arr = S.reg.etapa || [];
            const i = arr.findIndex((x) => x.id === id);
            if (i >= 0) arr[i] = { ...arr[i], apagadoEm: new Date().toISOString() };
            gravarCache();
            fecharSilencioso(fundo);
            TELAS.cronograma();
          } catch (err) { toast(err.message || 'Não consegui agora', 'ruim'); }
        }
      } }] : []),
      { texto: 'Salvar', classe: 'primario', aoClicar: (fundo) => {
        const v = lerCampos(fundo);
        const valor = numeroBR(v.valorPrevisto);
        if (!v.nome || !v.nome.trim()) { toast('Dê um nome à etapa', 'ruim'); return; }
        if (v.inicio && v.fim && v.fim < v.inicio) { toast('O término vem antes do início', 'ruim'); return; }
        salvar('etapa', {
          id: id || undefined,
          nome: v.nome.trim().slice(0, 160), valorPrevisto: valor,
          inicio: v.inicio || '', fim: v.fim || '',
          situacao: e.situacao || 'prevista',
          obs: String(v.obs || '').slice(0, 500),
        });
        fecharSilencioso(fundo);
        toast('Etapa salva');
        TELAS.cronograma();
      } },
    ],
  });
}

/* ── Vincular despesas já pagas à etapa ────────────────────────────────────── */
function abrirVincularDespesas(etapaId) {
  const e = achar('etapa', etapaId);
  if (!e) return;
  const soltas = cxVivos().filter((c) => c.tipo === 'saida' && !c.etapaId)
    .sort((a, b) => String(b.data || '').localeCompare(a.data || ''));
  if (!soltas.length) { toast('Não há despesa paga sem etapa'); return; }
  const corpo =
    '<p class="nota">Marque as despesas que são desta etapa — elas somam no "pago" dela.</p>' +
    '<input type="search" id="vc-busca" placeholder="filtrar por descrição, categoria…" style="width:100%;border:1px solid var(--borda);border-radius:9px;padding:8px 11px;margin-bottom:8px">' +
    '<div style="max-height:46vh;overflow-y:auto">' +
    soltas.map((c) => '<label class="lin vc-lin" data-txt="' + esc(((c.descricao || '') + ' ' + (c.categoria || '') + ' ' + (c.obs || '')).toLowerCase()) + '" style="cursor:pointer;padding:8px 10px">' +
      '<input type="checkbox" class="vc-check" data-id="' + esc(c.id) + '" style="width:18px;height:18px;flex-shrink:0">' +
      '<div class="cresce"><b>' + esc(c.descricao || '—') + '</b>' +
      '<span class="sub">' + fmt.data(c.data) + ' · ' + esc(c.categoria || '') + '</span></div>' +
      '<span class="dinheiro">' + fmt.brl(c.valor) + '</span></label>').join('') + '</div>';
  const fundoV = abrirModal({
    titulo: '🔗 Vincular a "' + e.nome + '"',
    corpo, largo: true,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Vincular marcadas', classe: 'primario', aoClicar: (fundo) => {
        const ids = [...fundo.querySelectorAll('.vc-check:checked')].map((cb) => cb.dataset.id);
        if (!ids.length) { toast('Marque pelo menos uma', 'ruim'); return; }
        for (const cid of ids) {
          const c = achar('cx', cid);
          salvar('cx', { id: cid, etapaId, historico: historiar(c, 'Vinculou à etapa "' + e.nome + '"') });
        }
        fecharSilencioso(fundo);
        toast(ids.length + ' despesa(s) vinculada(s)');
        TELAS.cronograma();
      } },
    ],
  });
  const busca = fundoV.querySelector('#vc-busca');
  busca.addEventListener('input', () => {
    const q = busca.value.toLowerCase();
    fundoV.querySelectorAll('.vc-lin').forEach((l2) => {
      l2.style.display = !q || l2.dataset.txt.includes(q) ? '' : 'none';
    });
  });
}
