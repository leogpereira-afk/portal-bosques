/* CONTRATOS — o termo de reserva preenchido pela venda, sem retrabalho.
 *
 * Dois modelos oficiais (Fixa e Reajustada 6%) que são O MESMO texto, exceto a
 * frase do reajuste no fim da alínea "a" da cláusula do preço — então aqui é UM
 * template com a frase condicional, escolhida pelo tipo de parcela da venda.
 * O quadro do título usa a COTA da tabela oficial: quadra×1000 + lote.
 * Valores saem cheios E com o desconto de pontualidade de 20%, por extenso,
 * como nos modelos assinados. */

/* ── número por extenso (reais) ───────────────────────────────────────────── */
const EXT_U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const EXT_D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const EXT_C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function extenso999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), d = n % 100;
  const dez = d < 20 ? EXT_U[d] : EXT_D[Math.floor(d / 10)] + (d % 10 ? ' e ' + EXT_U[d % 10] : '');
  return (c ? EXT_C[c] + (d ? ' e ' : '') : '') + dez;
}

// 43.560 → "quarenta e três mil quinhentos e sessenta". Vale até a casa dos milhões.
function extensoNum(n) {
  n = Math.round(n);
  if (n === 0) return 'zero';
  const mi = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  const partes = [];
  if (mi) partes.push(mi === 1 ? 'um milhão' : extenso999(mi) + ' milhões');
  if (mil) partes.push(mil === 1 ? 'mil' : extenso999(mil) + ' mil');
  if (resto) partes.push((partes.length && (resto < 100 || resto % 100 === 0) ? 'e ' : '') + extenso999(resto));
  return partes.join(' ');
}

// 436.25 → "quatrocentos e trinta e seis reais e vinte e cinco centavos"
function extensoBRL(v) {
  const cent = Math.round((Number(v) || 0) * 100);
  const reais = Math.floor(cent / 100), c = cent % 100;
  const pR = reais ? extensoNum(reais) + (reais === 1 ? ' real' : ' reais') : '';
  const pC = c ? extensoNum(c) + (c === 1 ? ' centavo' : ' centavos') : '';
  return pR && pC ? pR + ' e ' + pC : (pR || pC || 'zero reais');
}

const MESES_EXT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/* ── a logomarca entra no cabeçalho de toda página do contrato ────────────── */
let LOGO_CONTRATO = null;
try {
  fetch('icons/logo-pdf.png').then((r) => r.blob()).then((bl) => {
    const fr = new FileReader();
    fr.onload = () => { LOGO_CONTRATO = fr.result; };
    fr.readAsDataURL(bl);
  }).catch(() => {});
} catch (e) { /* offline no primeiro uso: cabeçalho sai sem logo */ }

/* ── o PDF do contrato ────────────────────────────────────────────────────── */
function gerarContratoPdf(v, cliente, l, cfg, plano) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  // O PLANO vem corrigido do modal (a venda é o prefill; o que o dono digitar
  // ali é o que vale no papel).
  plano = plano || {};
  const reajustada = (plano.tipoParcela || v.tipoParcela) === 'Reajustada';
  const nParc = plano.qtdeParcelas != null ? plano.qtdeParcelas : (Number(v.qtdeParcelas) || 0);
  const parcDesc = plano.valorParcela != null ? plano.valorParcela : (Number(v.valorParcela) || 0);
  const parcCheia = plano.parcCheia != null ? plano.parcCheia : Math.round(parcDesc / 0.8 * 100) / 100;
  const entradaV = plano.entrada != null ? plano.entrada : (Number(v.entrada) || 0);
  const restante = Math.round(parcCheia * nParc * 100) / 100;
  const importancia = Math.round((entradaV + restante) * 100) / 100;
  const cota = (Number(v.quadra) || 0) * 1000 + (Number(v.lote) || 0);
  const area = (l && l.areaM2) ? Number(l.areaM2) : null;
  const ini = String(plano.inicioParcelas != null ? plano.inicioParcelas : (v.inicioParcelas || ''));
  const diaVenc = plano.diaVenc || (ini ? Number(ini.slice(8, 10)) : null);
  const mesIni = ini ? MESES_EXT[Number(ini.slice(5, 7)) - 1] : 'XX';
  const anoIni = ini ? ini.slice(0, 4) : '20XX';
  const hoje = new Date();

  const brl = (x) => 'R$ ' + Number(x || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dinheiroExt = (x) => brl(x) + ' (' + extensoBRL(x) + ')';

  const enderecoCli = [cliente.endereco, cliente.bairro && 'Bairro ' + cliente.bairro,
    cliente.cep && 'CEP ' + cliente.cep].filter(Boolean).join(', ');
  const cidadeCli = (cliente.cidade || 'Montes Claros') + '/' + (cliente.uf || 'MG');

  const qualifComprador = (cliente.nome || '—').toUpperCase() + ', ' +
    (cliente.nacionalidade || 'brasileiro(a)') + ', ' + (cliente.profissao || '(profissão)') +
    ', inscrito(a) no CPF sob nº ' + (cliente.cpf || '—') +
    (cliente.rg ? ' e RG nº ' + cliente.rg : '') +
    ', residente e domiciliado(a) na ' + (enderecoCli || '—') + ', na cidade de ' + cidadeCli +
    (cliente.email ? ', com endereço eletrônico sendo ' + cliente.email : '') + '.';

  const pagamento = nParc > 0
    ? 'a) Uma entrada no valor de ' + dinheiroExt(entradaV) + ' que será paga ' +
      (plano.entradaDetalhe ? '(' + plano.entradaDetalhe + ') '
        : v.entradaDetalhe ? '(' + v.entradaDetalhe + ') ' : (v.formaEntrada ? 'via ' + v.formaEntrada + ' ' : '')) +
      'para a conta da PROMITENTE VENDEDORA. O valor restante de ' + dinheiroExt(restante) +
      ' será parcelado em boletos bancários, emitidos pela promitente vendedora ou empresa de cobrança ' +
      'indicada pela mesma. Serão ' + nParc + ' (' + extensoNum(nParc) + ') parcelas com vencimento mensal ' +
      'consecutivos, sendo todo dia ' + (diaVenc || 'XX') + ' (' + (diaVenc ? extensoNum(diaVenc) : 'XX') + ') de cada mês, ' +
      'vencendo a primeira no mês de ' + mesIni + ' de ' + anoIni + ', sendo cada parcela no valor de ' +
      dinheiroExt(parcCheia) + ', com desconto de 20% (vinte por cento) sobre valor total da parcela ' +
      'ficando assim no valor de ' + dinheiroExt(parcDesc) + ', para pagamento antes do vencimento.' +
      (reajustada ? ' As parcelas terão reajuste anual no índice de 6% (seis por cento) sobre o valor total da parcela atual.' : '')
    : 'a) Pagamento à vista no valor de ' + dinheiroExt(entradaV || importancia) +
      (v.formaEntrada ? ', via ' + v.formaEntrada + ',' : '') + ' para a conta da PROMITENTE VENDEDORA.';

  const blocos = [
    ['T', 'TERMO DE RESERVA E GARANTIA PARA SUBSCRIÇÃO DE TÍTULO PATRIMONIAL DE ASSOCIADO PROPRIETÁRIO DO CLUBE PORTAL DOS BOSQUES'],
    ['P', 'Pelo presente instrumento particular de compromisso de compra e venda que entre si celebram, de um lado, como PROMITENTE VENDEDORA; H.C.S CONSTRUÇÕES SERVIÇOS LTDA, inscrita no CNPJ de Nº 54.214.683/0001-09, tendo seu escritório sediado na Rua Santa Luzia, 298, Bairro Todos os Santos, Montes Claros, MG, neste ato representada pelo seu sócio THIAGO HOLLANDA CAVALCANTI SOARES, brasileiro, empresário, inscrito no CPF/MF sob nº 054.615.906-08; e do outro lado, como PROMITENTE COMPRADOR; ' + qualifComprador +
     ' As partes acima qualificadas têm entre si, por justo e contratado o que se segue, que se obrigam a cumprir por si, seus herdeiros e sucessores.'],
    ['C', 'CLÁUSULA PRIMEIRA – DO OBJETO'],
    ['P', 'O PROMITENTE VENDEDOR, na qualidade de senhor e legítimo possuidor de "IMÓVEL RURAL", denominado e registrado "FAZENDA ALMAS", situado no município de Bocaiuva/MG, com área total de 96,9949 ha (noventa e seis hectares, noventa e nove ares e quarenta e nove centiares), registrado no Cartório de Registro de Imóveis de Bocaiuva sob a matrícula de número 24757 - 20/08/2025, registrada no INCRA sob o nº 0000354057107, onde se estabeleceu o empreendimento denominado "CLUBE PORTAL DOS BOSQUES", o qual encontra-se em fase de constituição, construção e implantação conforme projeto;'],
    ['P', 'Pelo presente instrumento particular e na melhor forma de direito as partes acima qualificadas, em conformidade com seus atos constitutivos, têm entre si, ajustadas e contratadas as cláusulas e condições que mutuamente aceitam e outorgam, a saber:'],
    ['P', 'O objeto desse termo é a venda, reserva e garantia para subscrição do título patrimonial de associado do Clube Portal Dos Bosques, conforme descrito na tabela abaixo e demais condições aqui estabelecidas. O objeto realiza a transferência pelo VENDEDOR ao COMPRADOR do Título patrimonial descrito no quadro seguinte, do Clube Portal Dos Bosques, correspondente à cota de número ' + cota + ' com área de uso privativo vinculada ao título patrimonial conforme descrita abaixo e identificada na Planta Geral do Clube Portal Dos Bosques.'],
    ['Q', ['QUADRA', 'NÚMERO DA ÁREA PRIVATIVA VINCULADA', 'DIMENSÃO DA ÁREA PRIVATIVA'],
          [String(v.quadra), String(v.lote), area ? area.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' m²' : '—']],
    ['C', 'CLÁUSULA SEGUNDA – DO PREÇO'],
    ['P', 'Pela venda ora prometida, as PROMITENTES COMPRADORAS pagarão, ao PROMITENTE VENDEDOR, a importância de ' + dinheiroExt(importancia) + ' que será paga da seguinte forma:'],
    ['P', pagamento],
    ['QP', null],
    ['C', 'CLÁUSULA TERCEIRA – DAS PENALIDADES'],
    ['P', 'A mora ou inadimplência de qualquer das parcelas referidas no Parágrafo Primeiro da Cláusula Segunda sujeitará as PROMITENTES COMPRADORAS ao pagamento de multa de 10% (dez por cento ao mês) do valor da parcela, acrescida de juros de 2% (dois por cento ao mês) e correção monetária a ser calculada pelos índices da Corregedoria de Justiça do TJMG.'],
    ['P', 'PARÁGRAFO PRIMEIRO – Além dos encargos previstos nesta cláusula, o PROMITENTE COMPRADOR arcará com o pagamento de honorários dos advogados eventualmente contratados para cobrança das obrigações ora contratadas, honorários estes desde já fixados em 20% (vinte por cento) sobre o valor da cobrança; serviços esses serão contratados após 30 dias de vencimento da parcela.'],
    ['P', 'PARÁGRAFO SEGUNDO – O descumprimento de qualquer das cláusulas deste contrato sujeitará a parte infratora a pagar à parte inocente multa contratual estipulada em 10% (dez por cento) sobre o valor deste contrato.'],
    ['C', 'CLÁUSULA QUARTA – DA RESCISÃO CONTRATUAL'],
    ['P', 'A inadimplência de 03 (três) das parcelas referidas na alínea "a" da Cláusula Segunda (consecutivas ou não) implicará na rescisão do presente contrato, perdendo o PROMISSÁRIO COMPRADOR todos os direitos adquiridos em virtude do mesmo, revertendo a posse do imóvel objeto do presente contrato em favor das PROMITENTES VENDEDORAS.'],
    ['P', 'PARÁGRAFO PRIMEIRO – Ocorrendo a inadimplência de 03 (três) parcelas, o PROMISSÁRIO COMPRADOR não terá direito a reaver os valores da entrada e das prestações já pagas, esclarecendo que, nesta hipótese, as demais parcelas vencerão antecipadamente.'],
    ['P', 'PARÁGRAFO SEGUNDO – Em caso de rescisão contratual, o promissário comprador não terá direito à retenção do imóvel por qualquer espécie de benfeitoria, seja ela necessária, útil ou voluptuária; a renúncia a tal direito não dispensa o promissário comprador de obter prévia anuência do promissário vendedor e dos órgãos públicos acerca da realização de qualquer obra e benfeitoria em seu imóvel.'],
    ['P', 'PARÁGRAFO TERCEIRO – Em caso de rescisão contratual por culpa do promissário comprador, ou seja, nos casos em que este descumprir qualquer obrigação estipulada nesse contrato, como por exemplo inadimplência ou descumprimento de qualquer obrigação acessória prevista na cláusula segunda, o promissário comprador perderá qualquer direito às construções já efetuadas na unidade; em nenhum caso o promissário comprador terá direito a indenização pelas benfeitorias úteis, necessárias, voluptuárias, pertenças ou quaisquer espécies de obras ou construções efetivadas em sua unidade habitacional. No prazo de 10 (dez) dias deverá retirar também eventuais animais que deixe no imóvel, sob pena de o promissário vendedor adquirir a propriedade dos mesmos, podendo, nesse caso, dar-lhes quaisquer destinações.'],
    ['P', 'PARÁGRAFO QUARTO – Na hipótese de rescisão do presente contrato por mera desistência do PROMISSÁRIO COMPRADOR, não decorrente de inadimplemento ou descumprimento contratual imputável à PROMITENTE VENDEDORA, serão deduzidas dos valores efetivamente pagos pelo PROMISSÁRIO COMPRADOR as despesas comprovadamente suportadas pela PROMITENTE VENDEDORA em razão da contratação, bem como o percentual de 5% (cinco por cento) sobre o valor total efetivamente pago até a data da rescisão, a título de compensação pelos custos decorrentes da rescisão antecipada. Após as referidas deduções, eventual saldo remanescente será restituído ao PROMISSÁRIO COMPRADOR no prazo de até 10 (dez) dias úteis, contados da formalização da rescisão e da apuração dos valores devidos.'],
    ['C', 'CLÁUSULA QUINTA – DAS OBRIGAÇÕES DO PROMISSÁRIO COMPRADOR'],
    ['P', 'Constituem obrigações das PROMISSÁRIAS COMPRADORAS:'],
    ['P', 'A) Não ceder ou transferir a terceiros os direitos e obrigações decorrentes deste contrato, sem prévia e expressa anuência do PROMITENTE VENDEDOR;'],
    ['P', 'B) Não utilizar o imóvel objeto deste contrato para fins que atentem contra os bons costumes e a moral pública;'],
    ['P', 'C) Não erigir na área ora prometida barracos de lona, cobertura com telhas de amianto, muros de alvenaria, construção sem reboco (ainda que provisório) e nem chiqueiros;'],
    ['P', 'D) Não criar porcos no local, animais com mau cheiro ou quaisquer animais considerados de risco; o promissário comprador se compromete a manter limpa sua unidade habitacional, seja com relação aos animais ou capina regular, evitando mau cheiro, cheiro forte ou proliferação de insetos. É permitida a criação de outros animais somente dentro dos limites de sua propriedade exclusiva;'],
    ['P', 'E) Arcar com os pagamentos de todos os tributos, impostos, contribuições, tarifas, preços públicos e taxas que incidirem sobre a área objeto deste contrato, a partir da data da assinatura do mesmo;'],
    ['P', 'F) Ocorrendo, eventualmente, necessidade de promover novas benfeitorias no empreendimento, além das obrigações do promitente vendedor, tais como meio-fio, rede de água ou luz, abertura de poço artesiano, as despesas decorrentes das mesmas serão rateadas proporcionalmente entre os proprietários, responsabilizando-se as PROMISSÁRIAS COMPRADORAS a arcar com o valor da fração que lhes couber;'],
    ['P', 'G) Não promover desmatamento ou derrubada de árvores sem prévia licença dos órgãos ambientais, esclarecendo que as penalidades impostas pelo descumprimento desta alínea serão de inteira responsabilidade das PROMISSÁRIAS COMPRADORAS;'],
    ['P', 'H) É de inteira responsabilidade dos COMPRADORES os atos dos mesmos, de seus animais e de seus visitantes dentro deste clube condomínio, evitando assim, de todas as formas possíveis, incomodar os outros proprietários;'],
    ['P', 'I) É proibida a caça de animais silvestres dentro do clube condomínio;'],
    ['P', 'J) É permitida a criação de cães de qualquer tamanho, raça ou porte dentro da unidade das PROMISSÁRIAS COMPRADORAS. Nas áreas comuns os cães de grande porte deverão circular com guia curta (1,5 m);'],
    ['P', 'K) É proibida a abertura da cerca que limita o empreendimento com demais propriedades. Não é permitida a colocação de porteiras, a abertura de vias, a retirada da cerca para unificação com propriedades vizinhas externas ao clube condomínio;'],
    ['P', 'L) Não é permitida a movimentação ou retirada, para qualquer fim, da cerca que delimita o empreendimento;'],
    ['P', 'M) As edificações na unidade das PROMISSÁRIAS COMPRADORAS devem seguir o seguinte: distância da cerca de divisa lateral e nos fundos de no mínimo 2 metros; edificação de no máximo dois pavimentos;'],
    ['P', 'N) Não é permitida a abertura de comércio, venda, bar, padaria ou qualquer tipo de negócio/comércio dentro do condomínio.'],
    ['C', 'CLÁUSULA SEXTA – DAS OBRIGAÇÕES DO PROMITENTE VENDEDOR'],
    ['P', 'Constituem obrigações do PROMITENTE VENDEDOR:'],
    ['P', 'a) A perfuração de um único poço artesiano para todo o empreendimento, e construção de rede de distribuição de água até a divisa da unidade autônoma com a respectiva "rua" de cada uma das áreas individuais, inclusive a rede até a unidade das PROMISSÁRIAS COMPRADORAS, esclarecendo que a manutenção do poço será dividida proporcionalmente entre cada um dos associados. Além disso, só será liberada a água para o uso individual após o pagamento de uma taxa única, taxa de instalação, no valor de R$ 630,00 (seiscentos e trinta reais), e a adesão à associação estabelecida para regulamentar as normas do empreendimento, a fim de obter água para uso individual. O pagamento será através de boleto bancário, referente à mão de obra e materiais necessários para instalar o cavalete e hidrômetro individual;'],
    ['P', 'b) Prazo para construção de benfeitorias para uso dos associados: Portaria – até 30/09/2027; Rede de água – até 30/09/2027; Cascalhamento das ruas – até 30/09/2027. As benfeitorias serão realizadas conforme padrão e projeto realizado entre o promissário vendedor e o arquiteto/engenheiro responsável; as obras poderão ter seu prazo alterado devido a intempéries naturais, alteração do projeto etc., respeitando um limite de 06 meses após o prazo acordado;'],
    ['P', 'c) A instalação da rede de energia elétrica será rateada por unidade privada pelo PROMISSÁRIO PRIMEIRO VENDEDOR e entre os PROMISSÁRIOS COMPRADORES. Sendo assim, o promissário comprador é responsável por arcar com um valor de R$ 2.200,00 (dois mil e duzentos reais), que poderá ser parcelado, tendo a obrigação de efetuar o pagamento total no prazo máximo de 12 meses a partir da data de assinatura deste presente contrato. Posterior e eventual custeio e manutenção da rede será rateado entre os proprietários.'],
    ['C', 'CLÁUSULA SÉTIMA – DOS ÔNUS'],
    ['P', 'Todos os tributos, impostos, contribuições, taxas, tarifas e preços públicos que incidem sobre o imóvel até a data da celebração deste contrato são de inteira responsabilidade do PROMITENTE VENDEDOR, passando, a partir de então, a serem de responsabilidade exclusiva das PROMISSÁRIAS COMPRADORAS.'],
    ['C', 'CLÁUSULA OITAVA – DA IMISSÃO NA POSSE'],
    ['P', 'O PROMITENTE VENDEDOR, neste ato, entrega às PROMISSÁRIAS COMPRADORAS a posse da unidade do imóvel objeto do presente contrato, imitindo-as, desde já, na posse do mesmo.'],
    ['C', 'CLÁUSULA NONA – DA TRANSFERÊNCIA DA PROPRIEDADE'],
    ['P', 'A partir da quitação integral do valor convencionado, o promitente comprador se torna proprietário de sua unidade autônoma.'],
    ['C', 'CLÁUSULA DÉCIMA'],
    ['P', 'Este contrato é celebrado sob condição expressa de sua irrevogabilidade e irretratabilidade, renunciando os contratantes, expressamente, à faculdade de arrependimento concedida pelo Código Civil ou quaisquer outras do Código Comercial, ressalvando, entretanto, as disposições constantes da Cláusula Quarta deste instrumento.'],
    ['C', 'CLÁUSULA DÉCIMA PRIMEIRA'],
    ['P', 'Os casos omissos serão resolvidos pelas leis vigentes na época e costumes geralmente observados.'],
    ['C', 'CLÁUSULA DÉCIMA SEGUNDA'],
    ['P', 'Concomitantemente à assinatura do presente contrato de aquisição do Título Patrimonial, o ADQUIRENTE deverá assinar também o Termo de Associação ao Clube Portal Dos Bosques, concordando e aceitando as condições gerais dispostas no Termo de Associação, Estatuto, Regimento Interno e demais Atos que regem o Clube Portal Dos Bosques.'],
    ['C', 'CLÁUSULA DÉCIMA TERCEIRA'],
    ['P', 'Para dirimir quaisquer questões que direta ou indiretamente decorrerem deste contrato, as partes elegem o foro da Comarca de Montes Claros, Minas Gerais, com renúncia expressa de qualquer outro, por mais especial e privilegiado que seja, mesmo em razão de seus domicílios.'],
    ['P', 'Para todos os fins e efeitos de direito, os contratados mandaram elaborar este instrumento, que assinam em 02 (duas) vias de igual teor e forma, para só efeito jurídico, o que fazem na presença das testemunhas abaixo assinadas.'],
    ['P', 'Montes Claros, ' + hoje.getDate() + ' de ' + MESES_EXT[hoje.getMonth()] + ' de ' + hoje.getFullYear() + '.'],
  ];

  // ── diagramação: o layout da casa em toda página ─────────────────────────
  const VERDE = [14, 83, 43], VERDE_CLARO = [139, 195, 74], CINZA = [95, 122, 102];
  let pagina = 0;
  const cabecalhoCasa = () => {
    pagina += 1;
    doc.setFillColor(...VERDE); doc.rect(0, 0, 210, 30, 'F');
    doc.setFillColor(...VERDE_CLARO); doc.rect(0, 30, 210, 1.6, 'F');
    if (LOGO_CONTRATO) { try { doc.addImage(LOGO_CONTRATO, 'PNG', 9, 2, 49.5, 26); } catch (e) {} }
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('CONTRATO ' + (v.codigo || ''), 196, 14, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(197, 225, 165);
    doc.text('Clube Portal dos Bosques · Montes Claros/MG', 196, 20, { align: 'right' });
    doc.setFontSize(8); doc.setTextColor(...CINZA);
    doc.text('Termo de reserva · ' + (v.codigo || '') + ' · página ' + pagina, 105, 288, { align: 'center' });
    doc.setFontSize(7);
    doc.text('developed by Léo Gonçalves', 105, 292.5, { align: 'center' });
    doc.setTextColor(30, 43, 33);
  };
  cabecalhoCasa();
  let y = 40;
  const garante = (mm) => { if (y + mm > 280) { doc.addPage(); cabecalhoCasa(); y = 40; } };
  for (const bloco of blocos) {
    const [tipo] = bloco;
    if (tipo === 'T') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      const ls = doc.splitTextToSize(bloco[1], 170);
      garante(ls.length * 5 + 4);
      doc.text(ls, 105, y, { align: 'center' });
      y += ls.length * 5 + 4;
    } else if (tipo === 'C') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      garante(10);
      y += 2; doc.text(bloco[1], 14, y); y += 6;
    } else if (tipo === 'QP') {
      // O QUADRO DO PLANO DE PAGAMENTO, linha a linha — pedido do dono:
      // as faixas de parcela com o valor do boleto e o valor pagando em dia.
      if (nParc > 0) {
        const reajCfg = (cfg && cfg.reajuste) || { pct: 6, aCada: 12 };
        // vencimento da parcela N: mesmo dia, N-1 meses após a primeira
        const vencDe = (nPar) => {
          if (!ini) return '';
          const d0 = new Date(ini + 'T12:00:00');
          const dt = new Date(d0.getFullYear(), d0.getMonth() + (nPar - 1), 1);
          const dia0 = Math.min(d0.getDate(), new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate());
          return String(dia0).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
        };
        const linhasQP = [['Entrada', '', '', brl(entradaV)]];
        let totCheio = entradaV, totDia = entradaV;
        const degraus = reajustada ? Math.ceil(nParc / (reajCfg.aCada || 12)) : 1;
        for (let dg = 0; dg < degraus; dg++) {
          const ini2 = dg * (reajustada ? (reajCfg.aCada || 12) : nParc) + 1;
          const fim2 = reajustada ? Math.min(nParc, (dg + 1) * (reajCfg.aCada || 12)) : nParc;
          const emDia = Math.round(parcDesc * Math.pow(1 + (reajCfg.pct || 6) / 100, dg) * 100) / 100;
          const cheia = Math.round(emDia / 0.8 * 100) / 100;
          totDia += emDia * (fim2 - ini2 + 1);
          totCheio += cheia * (fim2 - ini2 + 1);
          linhasQP.push(['Parcelas ' + ini2 + ' a ' + fim2,
            ini ? vencDe(ini2) + ' a ' + vencDe(fim2) : '', brl(cheia), brl(emDia)]);
        }
        if (ini) linhasQP.push(['Última parcela: ' + nParc + 'ª', vencDe(nParc), '', '']);
        linhasQP.push(['TOTAL (entrada + parcelas)', '', brl(Math.round(totCheio * 100) / 100), brl(Math.round(totDia * 100) / 100)]);
        garante(12);
        doc.setFillColor(240, 246, 240);
        doc.rect(14, y - 4, 182, 6.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text('PLANO DE PAGAMENTO', 16, y);
        doc.text('VENCIMENTOS', 96, y);
        doc.text('BOLETO', 152, y, { align: 'right' });
        doc.text('EM DIA (-20%)', 194, y, { align: 'right' });
        y += 6.5;
        doc.setFontSize(9);
        for (const [rot2, venc2, cheia2, dia2] of linhasQP) {
          garante(6);
          const totalLinha = rot2.indexOf('TOTAL') === 0 || rot2.indexOf('Última') === 0;
          doc.setFont('helvetica', totalLinha ? 'bold' : 'normal');
          doc.text(rot2, 16, y);
          if (venc2) { doc.setFontSize(8); doc.text(String(venc2), 96, y); doc.setFontSize(9); }
          if (cheia2) doc.text(String(cheia2), 152, y, { align: 'right' });
          doc.setFont('helvetica', 'bold');
          if (dia2) doc.text(String(dia2), 194, y, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          doc.setDrawColor(225, 234, 226);
          doc.line(14, y + 1.6, 196, y + 1.6);
          y += 5.6;
        }
        doc.setFontSize(7.5); doc.setTextColor(95, 122, 102);
        doc.text('O desconto de 20% vale para pagamento até o vencimento do boleto.' + (reajustada ? ' Valores com o reajuste anual de 6% aplicado por faixa.' : ''), 16, y);
        doc.setTextColor(30, 43, 33);
        y += 5;
      }
    } else if (tipo === 'Q') {
      const [, cab, val] = bloco;
      garante(18);
      doc.setFillColor(240, 246, 240);
      doc.rect(14, y - 4, 182, 7, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text(cab[0], 24, y); doc.text(cab[1], 68, y); doc.text(cab[2], 145, y);
      y += 7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      doc.text(val[0], 28, y); doc.text(val[1], 90, y); doc.text(val[2], 152, y);
      y += 7;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const ls = doc.splitTextToSize(bloco[1], 182);
      // parágrafo grande quebra entre páginas sem drama
      for (const linha of ls) { garante(6); doc.text(linha, 14, y); y += 4.9; }
      y += 2.2;
    }
  }
  // assinaturas
  garante(60);
  y += 14;
  doc.setFontSize(10);
  doc.text('PROMITENTE VENDEDOR: ________________________________________________', 14, y);
  y += 5; doc.text('H.C.S CONSTRUÇÕES SERVIÇOS LTDA', 60, y);
  y += 14;
  doc.text('PROMITENTE COMPRADOR: ______________________________________________', 14, y);
  y += 5; doc.text((cliente.nome || '').toUpperCase(), 63, y);
  y += 14;
  doc.text('TESTEMUNHAS:  1ª) ________________________________', 14, y);
  y += 10;
  doc.text('2ª) ________________________________', 45, y);
  return doc.output('blob');
}

/* ── Tela: Contratos ──────────────────────────────────────────────────────── */
TELAS.contratos = function () {
  const app = document.getElementById('app');
  const f = TELAS._fContr || { q: '' };
  TELAS._fContr = f;
  const vivas = lista('venda').filter((v) => ['ativa', 'conferir', 'quitada'].includes(v.situacao || 'ativa'));
  const filtradas = f.q
    ? vivas.filter((v) => ((v.clienteNome || '') + ' Q' + v.quadra + '-L' + v.lote + ' ' + (v.codigo || ''))
        .toLowerCase().includes(f.q.toLowerCase()))
    : vivas;

  app.innerHTML =
    '<div class="cartao"><h2>📜 Contratos <span class="nota">— o termo de reserva preenchido pela venda, no modelo oficial</span></h2>' +
    '<p class="nota">Escolha a venda: o contrato sai no modelo certo pelo tipo de parcela ' +
    '(Fixa ou Reajustada 6%), com o quadro do título (cota = quadra×1000 + lote), os valores por extenso ' +
    'e o desconto de pontualidade de 20% — igual aos modelos assinados. O PDF baixa e fica anexado à venda.</p>' +
    '<div class="filtros"><input type="search" id="ct-q" placeholder="cliente, lote, código…" value="' + esc(f.q) + '"></div>' +
    (filtradas.slice(0, 40).map((v) =>
      '<div class="lin ct-lin" data-id="' + esc(v.id) + '">' +
      '<div class="cresce"><b>' + esc(v.codigo || '') + ' · Q' + v.quadra + '-L' + v.lote + ' · ' + esc(v.clienteNome || '—') + '</b>' +
      '<span class="sub">' + esc(v.tipoParcela || '') + (v.qtdeParcelas ? ' · ' + v.qtdeParcelas + '× de ' + fmt.brl(v.valorParcela) : '') +
      ' · modelo ' + (v.tipoParcela === 'Reajustada' ? 'REAJUSTE 6%' : 'FIXO') + '</span></div>' +
      '<span class="etiqueta et-hoje">gerar →</span></div>').join('') ||
      '<p class="nota">Nenhuma venda nesse recorte.</p>') +
    '</div>';

  document.getElementById('ct-q').oninput = (e) => { f.q = e.target.value; TELAS.contratos(); };
  app.querySelectorAll('.ct-lin').forEach((el) => { el.onclick = () => abrirGerarContrato(el.dataset.id); });
};

function abrirGerarContrato(vendaId) {
  const v = achar('venda', vendaId);
  if (!v) return;
  const cli = achar('cliente', v.clienteId) || {};
  const iniPrefill = v.inicioParcelas ||
    (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 10).toISOString().slice(0, 10); })();
  const corpo =
    '<p class="nota">Complete o que faltar do comprador — fica salvo no cadastro dele. ' +
    'Os VALORES e as DATAS do plano podem ser corrigidos aqui: o que você acertar vale no contrato e volta para a venda.</p>' +
    '<div class="colunas-3">' +
      campo('Nome completo', entrada('nome', cli.nome || v.clienteNome || '')) +
      campo('CPF', entrada('cpf', cli.cpf || '')) +
      campo('RG', entrada('rg', cli.rg || '')) +
    '</div><div class="colunas-3">' +
      campo('Profissão', entrada('profissao', cli.profissao || '')) +
      campo('Nacionalidade', entrada('nacionalidade', cli.nacionalidade || 'brasileiro(a)')) +
      campo('E-mail', entrada('email', cli.email || '')) +
    '</div>' +
      campo('Endereço (rua e número)', entrada('endereco', cli.endereco || '')) +
    '<div class="colunas-3">' +
      campo('Bairro', entrada('bairro', cli.bairro || '')) +
      campo('Cidade', entrada('cidade', cli.cidade || 'Montes Claros')) +
      campo('CEP', entrada('cep', cli.cep || '')) +
    '</div>' +
    '<h3 style="margin:10px 0 4px">Plano de pagamento <span class="nota">— corrija aqui, se precisar</span></h3>' +
    '<div class="colunas-3">' +
      campo('Entrada (R$)', entrada('entrada', v.entrada != null ? v.entrada : '', { inputmode: 'decimal' })) +
      campo('Nº de parcelas', entrada('qtdeParcelas', v.qtdeParcelas != null ? v.qtdeParcelas : 150, { inputmode: 'numeric' })) +
      '<div class="campo"><label>Tipo de parcela</label><select data-campo="tipoParcela">' +
        ['Fixa', 'Reajustada'].map((t) => '<option' + ((v.tipoParcela || 'Fixa') === t ? ' selected' : '') + '>' + t + '</option>').join('') +
      '</select><div class="dica">decide o modelo: FIXO ou REAJUSTE 6%</div></div>' +
    '</div><div class="colunas-3">' +
      campo('Parcela pagando em dia (R$)', entrada('valorParcela', v.valorParcela != null ? v.valorParcela : '', { inputmode: 'decimal' }),
        'a cheia calcula sozinha (÷0,8)') +
      campo('Parcela cheia do boleto (R$)', entrada('parcCheia',
        v.valorParcela ? (Math.round(Number(v.valorParcela) / 0.8 * 100) / 100).toFixed(2) : '', { inputmode: 'decimal' }),
        'mexeu aqui, vale o que digitar') +
      campo('1ª parcela vence em', entrada('inicioParcelas', iniPrefill, { tipo: 'date' }),
        'o dia desta data vale para todo mês') +
    '</div>' +
      campo('Condição da entrada (sai no contrato)', entrada('entradaDetalhe', v.entradaDetalhe || '',
        { placeholder: 'ex.: via PIX em 26/08/2026 · ou: cartão 4x de R$ 1.650,00' })) +
    '<p class="nota" id="ct-detalhe" style="font-weight:600"></p>';

  abrirModal({
    titulo: '📜 Contrato — ' + (v.codigo || ''),
    corpo,
    acoes: [
      { texto: 'Voltar', aoClicar: () => fecharModal() },
      { texto: 'Gerar contrato (PDF)', classe: 'primario', aoClicar: async (fundo) => {
        const c = lerCampos(fundo);
        if (!c.nome || !c.cpf) { toast('Nome e CPF são obrigatórios no contrato', 'ruim'); return; }
        const plano = {
          entrada: numeroBR(c.entrada),
          qtdeParcelas: Math.max(0, Math.round(numeroBR(c.qtdeParcelas))),
          valorParcela: numeroBR(c.valorParcela),
          parcCheia: c.parcCheia !== '' ? numeroBR(c.parcCheia) : Math.round(numeroBR(c.valorParcela) / 0.8 * 100) / 100,
          tipoParcela: c.tipoParcela,
          inicioParcelas: c.inicioParcelas || '',
          diaVenc: c.inicioParcelas ? Number(c.inicioParcelas.slice(8, 10)) : null,
          entradaDetalhe: String(c.entradaDetalhe || '').slice(0, 160),
        };
        // a correção VOLTA para a venda — contrato e sistema contam a mesma história
        salvar('venda', { id: v.id, entrada: plano.entrada, qtdeParcelas: plano.qtdeParcelas,
          valorParcela: plano.valorParcela, tipoParcela: plano.tipoParcela,
          inicioParcelas: plano.inicioParcelas, entradaDetalhe: plano.entradaDetalhe,
          historico: [{ em: new Date().toISOString(), por: S.quem || '—', acao: 'plano corrigido ao gerar o contrato' }] });
        if (cli.id) {
          salvar('cliente', { id: cli.id, nome: c.nome, cpf: c.cpf, rg: c.rg, profissao: c.profissao,
            nacionalidade: c.nacionalidade, email: c.email, endereco: c.endereco,
            bairro: c.bairro, cidade: c.cidade, cep: c.cep });
        }
        const l = achar('lote', v.loteId);
        const blob = gerarContratoPdf({ ...v, codigo: v.codigo }, c, l, S.cfg || {}, plano);
        const nomeArq = 'Contrato-Bosques-' + (v.codigo || 'Q' + v.quadra + 'L' + v.lote) + '-' +
          (c.nome || '').split(' ')[0] + '.pdf';
        salvarNoAparelho(blob, nomeArq);
        fecharSilencioso(fundo);
        toast('Contrato gerado — baixando e anexando à venda…');
        try {
          const meta = await enviarArquivo(new File([blob], nomeArq, { type: 'application/pdf' }));
          salvar('venda', { id: v.id, anexos: [{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            arquivoId: meta.id, nome: nomeArq, rotulo: 'contrato gerado', em: new Date().toISOString(), por: S.quem || '—' }] });
          toast('Contrato anexado à venda ✓');
        } catch (e) { toast('PDF baixado; não anexou à venda agora (' + (e.message || 'sem internet') + ')', 'ruim'); }
      } },
    ],
  });

  // ── o DETALHE VIVO das datas e valores: recalcula a cada tecla ────────────
  const fundo = document.querySelector('[data-campo="entrada"]').closest('.modal, body');
  const pega = (nome) => document.querySelector('[data-campo="' + nome + '"]');
  const detalhe = () => {
    const el = document.getElementById('ct-detalhe');
    if (!el) return;
    const n = Math.max(0, Math.round(numeroBR(pega('qtdeParcelas').value)));
    const emDia = numeroBR(pega('valorParcela').value);
    const cheiaCampo = pega('parcCheia');
    if (!cheiaCampo.dataset.mexido && emDia > 0) cheiaCampo.value = (Math.round(emDia / 0.8 * 100) / 100).toFixed(2);
    const cheia = numeroBR(cheiaCampo.value);
    const ini = pega('inicioParcelas').value;
    const ent = numeroBR(pega('entrada').value);
    let datas = '';
    if (ini && n > 0) {
      const d0 = new Date(ini + 'T12:00:00');
      const dFim = new Date(d0.getFullYear(), d0.getMonth() + (n - 1), Math.min(d0.getDate(), 28));
      datas = '1ª: ' + fmt.data(ini) + ' · última (' + n + 'ª): ' +
        String(d0.getDate()).padStart(2, '0') + '/' + String(dFim.getMonth() + 1).padStart(2, '0') + '/' + dFim.getFullYear() +
        ' · todo dia ' + d0.getDate();
    }
    el.textContent = (datas ? '📅 ' + datas + '  ·  ' : '') +
      (cheia > 0 ? '💵 boleto ' + fmt.brl(cheia) + ' / em dia ' + fmt.brl(emDia) : '') +
      (n > 0 && cheia > 0 ? '  ·  total do contrato ' + fmt.brl(Math.round((ent + cheia * n) * 100) / 100) : '');
  };
  ['entrada', 'qtdeParcelas', 'valorParcela', 'parcCheia', 'inicioParcelas'].forEach((nome) => {
    const el = pega(nome);
    if (el) el.addEventListener('input', detalhe);
  });
  const cc = pega('parcCheia');
  if (cc) cc.addEventListener('keydown', () => { cc.dataset.mexido = '1'; });
  detalhe();
}
