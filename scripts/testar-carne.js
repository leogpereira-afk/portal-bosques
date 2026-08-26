/* Testes do motor do carnê. Roda sem node:
   ./scripts/testar.sh  (concatena carne.js + este arquivo no jsc do macOS) */

let falhas = 0;
function eq(rotulo, a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { print('  ✓ ' + rotulo); }
  else { falhas++; print('  ✗ ' + rotulo + '\n    esperado ' + jb + '\n    veio     ' + ja); }
}
const HOJE = '2026-08-21';
const REAJ = { pct: 6, aCada: 12 };

/* ── geração ── */
print('gerarParcelas:');
{
  const v = { entrada: 1000, dataEntrada: '2026-03-23', qtdeParcelas: 3, valorParcela: 100, tipoParcela: 'Fixa' };
  const ls = CARNE.gerarParcelas(v, REAJ);
  eq('entrada + 3 parcelas', ls.length, 4);
  eq('entrada vence no dia', ls[0].venc, '2026-03-23');
  eq('1ª parcela 1 mês depois', ls[1].venc, '2026-04-23');
  eq('3ª parcela', ls[3].venc, '2026-06-23');
  eq('valor fixo', ls.slice(1).map((l) => l.valor), [100, 100, 100]);
}
{
  // dia 31: fevereiro não tem — cai no último dia do mês
  const v = { entrada: 500, dataEntrada: '2026-12-31', qtdeParcelas: 2, valorParcela: 100 };
  const ls = CARNE.gerarParcelas(v, REAJ);
  eq('jan mantém o 31', ls[1].venc, '2027-01-31');
  eq('fev cai para 28', ls[2].venc, '2027-02-28');
}
{
  // reajustada: +6% nas parcelas 13-24, +6%² nas 25-36
  const v = { entrada: 0, dataEntrada: '2026-01-10', qtdeParcelas: 26, valorParcela: 100, tipoParcela: 'Reajustada' };
  const ls = CARNE.gerarParcelas(v, REAJ);
  eq('parcela 12 sem reajuste', ls.find((l) => l.n === 12).valor, 100);
  eq('parcela 13 com +6%', ls.find((l) => l.n === 13).valor, 106);
  eq('parcela 25 com +6% duas vezes', ls.find((l) => l.n === 25).valor, 112.36);
}
{
  // à vista: só a entrada
  const v = { entrada: 30000, dataEntrada: '2026-03-30', qtdeParcelas: 0, valorParcela: 0 };
  eq('à vista = 1 linha', CARNE.gerarParcelas(v, REAJ).length, 1);
}
{
  // inicioParcelas explícito manda no venc da 1ª
  const v = { entrada: 1000, dataEntrada: '2026-03-23', qtdeParcelas: 2, valorParcela: 100, inicioParcelas: '2026-05-05' };
  const ls = CARNE.gerarParcelas(v, REAJ);
  eq('1ª parcela na data dita', ls[1].venc, '2026-05-05');
  eq('2ª um mês depois', ls[2].venc, '2026-06-05');
}

/* ── aplicação ── */
print('aplicar:');
const vBase = { entrada: 1000, dataEntrada: '2026-03-23', qtdeParcelas: 3, valorParcela: 100, tipoParcela: 'Fixa' };
const linhas = () => CARNE.gerarParcelas(vBase, REAJ);
{
  // entrada cravada, parcelas em atraso detectadas
  const r = CARNE.aplicar(linhas(), [{ id: 'r1', tipo: 'entrada', valor: 1000, data: '2026-03-23' }], HOJE);
  eq('entrada paga', r.linhas[0].situacao, 'paga');
  eq('parcelas 1-3 atrasadas (venc < hoje)', r.linhas.slice(1).map((l) => l.situacao), ['atrasada', 'atrasada', 'atrasada']);
}
{
  // FIFO: R$150 soltos quitam a 1ª e metade da 2ª (entrada já paga)
  const r = CARNE.aplicar(linhas(), [
    { id: 'r1', tipo: 'entrada', valor: 1000, data: '2026-03-23' },
    { id: 'r2', tipo: 'parcela', valor: 150, data: '2026-04-23' },
  ], HOJE);
  eq('1ª quitada', r.linhas[1].situacao, 'paga');
  eq('2ª parcial-atrasada com 50', [r.linhas[2].pago, r.linhas[2].situacao], [50, 'atrasada']);
}
{
  // parcelaN cravada pula a fila
  const r = CARNE.aplicar(linhas(), [{ id: 'r1', tipo: 'parcela', parcelaN: 3, valor: 100, data: '2026-06-23' }], HOJE);
  eq('3ª paga direto', r.linhas[3].situacao, 'paga');
  eq('1ª segue devendo', r.linhas[1].pago, 0);
}
{
  // pagamento a maior: o troco rola; o que passa do carnê vira sobra
  const r = CARNE.aplicar(linhas(), [{ id: 'r1', tipo: 'parcela', valor: 1400, data: '2026-03-23' }], HOJE);
  eq('tudo quitado', r.linhas.map((l) => l.situacao), ['paga', 'paga', 'paga', 'paga']);
  eq('sobra de 100', r.sobra, 100);
}
{
  // acerto de distrato NÃO quita parcela
  const r = CARNE.aplicar(linhas(), [{ id: 'r1', tipo: 'acerto', valor: 500, data: '2026-05-01' }], HOJE);
  eq('nada pago com acerto', r.linhas.every((l) => l.pago === 0), true);
}
{
  // recebimento estornado (apagadoEm) não conta
  const r = CARNE.aplicar(linhas(), [{ id: 'r1', tipo: 'entrada', valor: 1000, data: '2026-03-23', apagadoEm: '2026-04-01' }], HOJE);
  eq('estornado fora da conta', r.linhas[0].pago, 0);
}
{
  // vence hoje
  const v = { entrada: 0, dataEntrada: '2026-07-21', qtdeParcelas: 1, valorParcela: 100 };
  const r = CARNE.aplicar(CARNE.gerarParcelas(v, REAJ), [], HOJE);
  eq('parcela de hoje marcada', r.linhas.find((l) => l.n === 1).situacao, 'hoje');
}

/* ── resumo ── */
print('resumo:');
{
  const recs = [
    { id: 'r1', tipo: 'entrada', valor: 1000, data: '2026-03-23' },
    { id: 'r2', tipo: 'parcela', valor: 100, data: '2026-04-23' },
  ];
  const r = CARNE.resumo(vBase, REAJ, recs, HOJE);
  eq('total do contrato', r.total, 1300);
  eq('pago', r.pago, 1100);
  eq('saldo', r.saldo, 200);
  eq('2 em atraso', r.qtdAtraso, 2);
  eq('não quitada', r.quitada, false);
}
{
  const recs = [{ id: 'r1', tipo: 'entrada', valor: 30000, data: '2026-03-30' }];
  const r = CARNE.resumo({ entrada: 30000, dataEntrada: '2026-03-30', qtdeParcelas: 0 }, REAJ, recs, HOJE);
  eq('à vista quitada', r.quitada, true);
}

print(falhas ? ('\nFALHOU: ' + falhas + ' teste(s)') : '\nTODOS OS TESTES PASSARAM');
if (falhas) throw new Error('testes falharam');
