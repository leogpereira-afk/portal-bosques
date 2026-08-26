// Lista ÚNICA das coleções do sistema, compartilhada pelas Edge Functions.
// Ao criar uma coleção nova, mexa AQUI e no COLECOES_APP do store.js — só
// nesses dois lugares (a lista já morou em três arquivos noutro sistema e o
// backup ficou cego para coleções novas sem ninguém notar).
//
// `pre` é o prefixo do número do documento (VD-0001). Vazio = sem numeração.
export const COLECOES: Record<string, { pre: string; nome: string }> = {
  lote:     { pre: "",   nome: "Lote" },
  cliente:  { pre: "",   nome: "Cliente" },
  corretor: { pre: "",   nome: "Corretor" },
  venda:    { pre: "VD", nome: "Venda" },
  // Proposta enviada pelo sistema: registra QUEM mandou, quando e para quem —
  // e carrega o interessado dentro dela (nome/telefone), sem depender do
  // cadastro de clientes.
  prop:     { pre: "PR", nome: "Proposta" },
  // Recebimento: cada dinheiro que entra de uma venda (entrada, parcela,
  // antecipação, acerto de distrato). É FATO contábil — o carnê é derivado.
  rec:      { pre: "RB", nome: "Recebimento" },
  // Lançamento avulso do caixa: despesa, comissão paga, outra receita.
  cx:       { pre: "",   nome: "Lançamento de caixa" },
  // Documento com arquivo: contrato assinado, distrato, comprovante.
  doc:      { pre: "",   nome: "Documento" },
  // Foto da apresentação do empreendimento (toda a equipe vê — é material
  // de venda; só direção/escritório sobem e apagam).
  foto:     { pre: "",   nome: "Foto da apresentação" },
  // Gasto futuro previsto (Relatórios): única em um mês, ou mensal entre dois.
  prev:     { pre: "",   nome: "Gasto previsto" },
  // Etapa do cronograma da obra: valor previsto, início/término, e as
  // despesas pagas se vinculam a ela (cx.etapaId).
  etapa:    { pre: "",   nome: "Etapa do cronograma" },
};

export const NOMES_COLECOES = Object.keys(COLECOES);
