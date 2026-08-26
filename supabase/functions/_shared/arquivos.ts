// Todos os ids de arquivo que UM registro usa. ÚNICO lugar de verdade —
// nucleo, acervo e rotina importam daqui (cópias divergiram noutro sistema e o
// varredor de órfãos apagava arquivo de registro ATIVO).
//
// No Bosques os arquivos moram em: doc (contrato assinado, comprovante),
// prop (o PDF da proposta enviada), venda (anexos da ficha) e rec
// (comprovante da baixa).
export function arquivosDoRegistro(o: any): string[] {
  const ids: string[] = [];
  if (o.arquivoId) ids.push(o.arquivoId);
  for (const v of (o.versoes || [])) if (v && v.arquivoId) ids.push(v.arquivoId);
  for (const a of (o.anexos || [])) if (a && a.arquivoId) ids.push(a.arquivoId);
  for (const d of (o.documentos || [])) if (d && d.arquivoId) ids.push(d.arquivoId);
  return Array.from(new Set(ids));
}
