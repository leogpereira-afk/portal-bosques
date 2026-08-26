/* CARNÊ — o motor de recebimentos. Funções PURAS: nada aqui grava nem lê rede.
 *
 * A regra de ouro: O CARNÊ É DERIVADO, NUNCA GRAVADO. O que fica guardado são
 * dois fatos — o PLANO da venda (entrada, nº de parcelas, valor, tipo) e cada
 * RECEBIMENTO (registro próprio, com autor e data). A tela recalcula o carnê a
 * partir dos dois a cada abertura. Não existe "parcela.paga = true" gravada
 * para dessincronizar do dinheiro que de fato entrou.
 *
 * Vem da planilha (conferido nas fórmulas em 21/08/2026):
 *   • parcela "Fixa" = mesmo valor do início ao fim;
 *   • parcela "Reajustada" = começa menor e sobe com o reajuste
 *     (cfg.reajuste = { pct: 6, aCada: 12 } — +6% a cada 12 parcelas,
 *     aniversário do contrato. REGRA ASSUMIDA, confirmar com a direção);
 *   • 1ª parcela = 1 mês depois da entrada, no MESMO dia do mês.
 *
 * Como um recebimento encontra a sua parcela:
 *   • tipo 'entrada'                 → linha 0 (a entrada);
 *   • tipo 'parcela' com parcelaN    → aquela parcela, cravada;
 *   • os demais (sem parcelaN)       → FIFO: quita da mais antiga em aberto
 *     para frente, e o troco rola para a seguinte (pagamento parcial e
 *     pagamento a maior ficam certos sem conta manual).
 */

const CARNE = (() => {

  // Vencimento m meses após a base, no mesmo dia (ou o último dia do mês,
  // quando o mês não tem o dia — venda no dia 31 vence 28/29 em fevereiro).
  function venc(baseISO, m) {
    const base = new Date(String(baseISO).slice(0, 10) + 'T12:00:00');
    if (isNaN(base)) return '';
    const dia = base.getDate();
    const mo = base.getMonth() + m;
    const y = base.getFullYear() + Math.floor(mo / 12);
    const mm = ((mo % 12) + 12) % 12;
    const ultimo = new Date(y, mm + 1, 0).getDate();
    const d = new Date(y, mm, Math.min(dia, ultimo));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const cent = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Valor da parcela n (1-based) segundo o plano da venda.
  function valorParcelaN(venda, n, cfgReajuste) {
    const base = Number(venda.valorParcela) || 0;
    if ((venda.tipoParcela || 'Fixa') !== 'Reajustada') return cent(base);
    const pct = Number((cfgReajuste || {}).pct);
    const aCada = Math.max(1, Number((cfgReajuste || {}).aCada) || 12);
    if (!pct) return cent(base);
    const degraus = Math.floor((n - 1) / aCada);
    return cent(base * Math.pow(1 + pct / 100, degraus));
  }

  // O carnê cru: linha 0 é a entrada; 1..N são as parcelas.
  function gerarParcelas(venda, cfgReajuste) {
    const linhas = [];
    const dataEntrada = venda.dataEntrada || venda.dataVenda || venda.criadoEm || '';
    if (Number(venda.entrada) > 0 || !(Number(venda.qtdeParcelas) > 0)) {
      linhas.push({ n: 0, rotulo: 'Entrada', venc: String(dataEntrada).slice(0, 10), valor: cent(venda.entrada) });
    }
    const qtde = Math.max(0, Math.round(Number(venda.qtdeParcelas) || 0));
    // A 1ª parcela é 1 mês após a entrada (fórmula da planilha), a não ser que
    // a venda diga outra data de início.
    const base = venda.inicioParcelas
      ? venc(venda.inicioParcelas, -1)   // inicioParcelas JÁ é o venc da 1ª
      : String(dataEntrada).slice(0, 10);
    for (let n = 1; n <= qtde; n++) {
      linhas.push({ n, rotulo: 'Parcela ' + n + '/' + qtde, venc: venc(base, n), valor: valorParcelaN(venda, n, cfgReajuste) });
    }
    return linhas;
  }

  // Casa os recebimentos com as linhas do carnê. Devolve as linhas com
  // { pago, recs: [ids], situacao } e a sobra que não coube em lugar nenhum.
  function aplicar(linhas, recebimentos, hojeStr) {
    const hoje = hojeStr || hojeISO();
    const out = linhas.map((l) => ({ ...l, pago: 0, recs: [] }));
    const vivos = (recebimentos || [])
      .filter((r) => r && !r.apagadoEm)
      .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));

    let sobra = 0;
    const sobraRecs = [];

    // 1º passe: o que tem endereço certo (entrada e parcela cravada).
    const soltos = [];
    for (const r of vivos) {
      const v = cent(r.valor);
      if (r.tipo === 'entrada') {
        const l = out.find((x) => x.n === 0);
        if (l) { l.pago = cent(l.pago + v); l.recs.push(r.id); continue; }
      }
      if (r.tipo === 'parcela' && r.parcelaN != null && r.parcelaN !== '') {
        const l = out.find((x) => x.n === Number(r.parcelaN));
        if (l) { l.pago = cent(l.pago + v); l.recs.push(r.id); continue; }
      }
      if (r.tipo === 'acerto') continue; // acerto de distrato não quita parcela
      soltos.push(r);
    }

    // 2º passe: FIFO — quita da mais antiga em aberto para frente.
    let i = 0;
    for (const r of soltos) {
      let resto = cent(r.valor);
      while (resto > 0.004 && i < out.length) {
        const l = out[i];
        const falta = cent(l.valor - l.pago);
        if (falta <= 0.004) { i++; continue; }
        const usa = Math.min(falta, resto);
        l.pago = cent(l.pago + usa);
        if (!l.recs.includes(r.id)) l.recs.push(r.id);
        resto = cent(resto - usa);
        if (cent(l.valor - l.pago) <= 0.004) i++;
      }
      if (resto > 0.004) { sobra = cent(sobra + resto); sobraRecs.push(r.id); }
    }

    for (const l of out) {
      const falta = cent(l.valor - l.pago);
      if (falta <= 0.004) l.situacao = 'paga';
      else if (l.pago > 0.004) l.situacao = l.venc && l.venc < hoje ? 'atrasada' : 'parcial';
      else if (l.venc && l.venc < hoje) l.situacao = 'atrasada';
      else if (l.venc === hoje) l.situacao = 'hoje';
      else l.situacao = 'aberta';
    }
    return { linhas: out, sobra, sobraRecs };
  }

  // O retrato da venda numa olhada: total, pago, saldo, atraso.
  function resumo(venda, cfgReajuste, recebimentos, hojeStr) {
    const linhas = gerarParcelas(venda, cfgReajuste);
    const { linhas: carne, sobra } = aplicar(linhas, recebimentos, hojeStr);
    const total = cent(carne.reduce((s, l) => s + l.valor, 0));
    const pago = cent(carne.reduce((s, l) => s + Math.min(l.pago, l.valor), 0) + 0); // sobra fica fora
    const atrasadas = carne.filter((l) => l.situacao === 'atrasada');
    const emAtraso = cent(atrasadas.reduce((s, l) => s + (l.valor - l.pago), 0));
    const proxima = carne.find((l) => ['aberta', 'hoje', 'parcial'].includes(l.situacao)) || null;
    return {
      carne, total, pago, sobra,
      saldo: cent(total - pago),
      qtdAtraso: atrasadas.length, emAtraso,
      proxima,
      quitada: total > 0 && cent(total - pago) <= 0.004,
    };
  }

  return { gerarParcelas, aplicar, resumo, venc, valorParcelaN };
})();
