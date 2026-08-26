# Portal dos Bosques — Blueprint de reconstrução

> Se este sistema precisar ser refeito do zero (ou clonado para outro empreendimento),
> este documento é o suficiente. Escrito em 27/08/2026 (v42 do original); a
> reconstrução `portal-bosques` nasceu DELE em 26/08/2026 (v1, namespace pdb_*).
> **Nenhum segredo está aqui** — a seção 11 diz o NOME de cada um e onde mora.

## 1. Arquitetura em uma frase

PWA **vanilla** (HTML/CSS/JS, sem build) servida pelo **GitHub Pages** (repo público
`leogpereira-afk/portal-bosques`), falando com **Edge Functions** do Supabase (projeto
compartilhado "Projetos Léo", ref `reoghclxripktzpdwhiy`, namespace `pdb_*`),
que por sua vez falam com o **ERP Omie** (a verdade financeira). Offline-first:
fila local + cache em `localStorage`, pull a cada 90s.

## 2. Banco (Postgres via Supabase)

DDL completo em `supabase/migrations/0001_init.sql`. Resumo:

| Tabela | Papel |
|---|---|
| `pdb_registros (colecao, id, registro jsonb, atualizado_em, apagado)` | o cofre: TODA coleção vive aqui como JSONB |
| `pdb_cfg (id=true, config jsonb)` | linha única: empresa, regras, usuários (hashes nunca saem) |
| `pdb_seq` + `pdb_seq_idx` + fn `pdb_proximo_numero()` | numeração atômica (VD-0001, PR-0001, RB-0001) |
| `pdb_log` | auditoria de ações |
| `pdb_backup (dia, conteudo)` | retrato diário |
| `pdb_meta (chave, valor)` | rev de cache, estado da sync do Omie, saldos |
| Storage bucket `pdb-arquivos` | anexos/PDFs em partes |

**RLS ligada em tudo, SEM policies**: só as Edge Functions (service key) tocam o banco.
O navegador nunca fala com o Postgres.

## 3. Coleções (o modelo de dados)

Registro canônico: JSON com `id`, `criadoEm/Por`, `atualizadoEm/Por`, `historico[]`
(quem fez o quê), `apagadoEm` (lixeira). Lista única em
`supabase/functions/_shared/colecoes.ts` + `COLECOES_APP` no `store.js`.

- `lote` — espelho: quadra, lote, areaM2, preco, 4 parcelas de tabela
  (`parcFixa/parcFixaDesc/parcReaj/parcReajDesc`), `status` (SEMPRE decidido pelo
  servidor: venda viva → Vendido; reserva → Reservado; senão Disponível), `reservadoPor`.
- `venda` — loteId, clienteId (= CPF só dígitos), corretorId (+cor2Id/comissao2),
  plano (entrada, qtdeParcelas, valorParcela **com desconto**, tipoParcela
  Fixa|Reajustada|À vista, inicioParcelas), `situacao` (ativa|conferir|quitada|distratada),
  anexos[], cobrancas[], e **`parcelas[]` = O ESPELHO DO OMIE** (seção 7).
- `cliente` — id = CPF dígitos. Campos que o cadastro cobra: nome, cpf,
  whatsapp/celular, email, endereco, bairro, cidade, uf, cep (+rg, profissao,
  nacionalidade para contrato). O Omie MANDA nos dados (edição humana vence).
- `corretor` — id = CPF dígitos; comissões casam por cpf OU chavePix.
- `rec` — recebimento (RB-): vendaId, valor, data, forma, origem (omie|planilha|manual),
  `omie:{titulo…}`. Servidor: valor e vendaId IMUTÁVEIS na edição (definir vendaId
  vazio é permitido = vincular).
- `cx` — lançamento de caixa: tipo entrada|saida, categoria, `centroCusto`,
  etapaId (cronograma), corretorId/rateio (comissões), origem.
- `prop` (PR-) — proposta com interessado embutido + tokenPublico p/ link.
- `doc`, `foto`, `prev` (gasto previsto), `etapa` (cronograma: valorPrevisto, inicio, fim).

## 4. Edge Functions (os contratos)

Todas: POST JSON `{action, ...}`, CORS `*`, autorização por headers.

### 4.1 Camadas de autenticação
1. `x-token` = TOKEN leve (público, está no `config.js` do bundle) — barra robô.
2. `x-senha` = **sha256 da senha digitada**; o servidor guarda sha256(sha256).
   A SENHA é a identidade (o nome só assina). Perfis: direcao, escritorio, corretor
   (snapshot filtrado: corretor não vê caixa nem valores alheios).
3. `x-token` = ROTINA (segredo forte) abre APENAS `list`/`getCfg` (backup do hub)
   — nunca viaja no navegador.

### 4.2 `pdb-nucleo` (dados e regras)
`ping · entrar · snapshot · salvarLote{itens[]} · apagar · restaurarItem ·
esvaziarLixeira · reiniciarNumeracao · salvarCfg · salvarUsuario · apagarUsuario ·
minhaSenha · trocarSenha · saude · log · backup · importar · restaurar · list · getCfg`.
Regras do `prepararItem`: lote.status é do servidor; 1 venda viva por lote;
rec sem troca de valor/venda; venda distratada só reabre com `_reabrir` (direção);
CAMPOS_UNIAO (historico, anexos, versoes, documentos, cobrancas) unem por id no
servidor (nunca se perdem por upsert concorrente).

### 4.3 `pdb-omie` (a ponte com o ERP)
`sincronizar{completa?, pagina?, parcial?}` — paginada entre chamadas (15 págs/chamada,
devolve `continua`); `saude`; `saldos{forcar?}`; `boleto{cpf}`.
O que a sync faz: seção 7. Auto-dispara no login se >20h (front: `talvezSincronizarOmie`).

### 4.4 `pdb-acervo` (arquivos)
Upload/baixa em partes no bucket `pdb-arquivos` (anexos de venda, PDFs de proposta).

## 5. As réguas do negócio (fórmulas exatas)

- **Tabela oficial**: valor do lote = `m² × R$ 40`. Parcelas = valor × razão:
  fixa cheia `0,01090625` · fixa em dia `0,008725` · reajustada cheia `0,00840625`
  · reajustada em dia `0,006725`. Em dia = cheia × 0,8 SEMPRE.
- **Desconto de pontualidade**: boleto sai CHEIO; pagando até o vencimento = −20%.
  O sistema guarda o valor EM DIA (`valorParcela`); cheia = valor ÷ 0,8.
- **Reajustada**: +6% a cada 12 parcelas (config em `cfg.reajuste`).
- **Cota do título** (contrato): `quadra × 1000 + lote`.
- **VGV** = plano pagando em dia (entrada + Σ parcelas em dia) — `totalPlanoVenda()`.
- **Vencido** = SÓ parcela do espelho com status 'atrasada'. Venda sem boletos no
  Omie NÃO afirma atraso (mostra o plano, avisa "gere o carnê no Omie").

## 6. Integração Omie (o que aprendemos apanhando)

- API: `POST https://app.omie.com.br/api/v1/<mod>/` body `{call, app_key, app_secret, param:[{}]}`.
- **Filtros desconhecidos falham EM SILÊNCIO devolvendo total=500.** Confiáveis:
  `dDtAltDe` em `financas/mf/ListarMovimentos` (incremental) e `nCodCliente` em
  `financas/pesquisartitulos/PesquisarLancamentos` (boletos por cliente).
- `ListarMovimentos` duplica cada baixa (título + espelho `CONTA_CORRENTE_*`):
  contar SÓ `CONTA_A_RECEBER`/`CONTA_A_PAGAR`.
- Saldo de conta: `financas/extrato/ListarExtrato` → `nSaldoAtual` (os métodos
  "*ResumoContaCorrente" não existem).
- Formas por `cTipo`: PIX→PIX · BOL/CARNE→Boleto · DIN→Dinheiro · CRC→Cartão de
  Crédito · CRD→Cartão de Débito · TRF→Transferência.
- Categorias de CP → nossas por prefixo: 2.02.01 Comissão · 2.02.02 Marketing ·
  2.04.10 Contabilidade · 2.07.01/2.01 Obra · 2.07.04/2.04 Administrativo ·
  2.07.06 Telefone · 2.03 Funcionários · 2.05 Tarifas · 2.06 Impostos.
- HTTP 500 também é rate limit — sempre retry com pausa.

## 7. O ESPELHO DAS PARCELAS (a decisão de arquitetura mais importante)

Desde 26/08/2026 o carnê NÃO é derivado do plano: `venda.parcelas[]` é o espelho
dos títulos do Omie: `{tid, venc, valor(cheio), valorDia(×0,8), pago(data|null),
pagoValor, trava, conferir, obs, origem}`. Regras do merge (na sync):
- por `tid`; **trava (edição humana) vence** em venc/valores; o PAGAMENTO real
  sempre atualiza; parcela travada em OUTRA venda do cliente nunca é recriada.
- Cliente com N vendas de parcela igual: destino estável = vendas ordenadas
  `[tid % N]`, marcado `conferir` (a ficha permite mover).
- Recebimentos: CR RECEBIDO → `rec` `rbomie-{tid}` (respeita a data de corte
  `cfg.omie.corteEntradas`); estorno no Omie → rec vai à lixeira.
- Despesas: CP PAGO → `cx` `cxomie-{tid}`; dedupe dia+valor SÓ contra lançamento
  manual (título nunca duplica título); duvidoso (mês+valor) vira pendência
  listada, NUNCA lançamento.
- `resumoVenda()`/`totalPlanoVenda()` (espelho.js) são A régua de todas as telas.

## 8. Front (o que cada arquivo faz)

`config.js` (endereços+versão) · `ui.js` (helpers de UI, modal, TELAS) ·
`store.js` (offline-first: fila com seq, cache, pull 90s, api()) · `carne.js`
(motor derivado — hoje só simulação/proposta; 30 testes em scripts/testar.sh) ·
`pdf.js` (jsPDF vendorizado: proposta, recibo, venda, dash, DRE, espelho,
relatório, cronograma, lançamentos — **só Helvetica: NUNCA usar U+2212/emoji/⇄
em texto de PDF**) · `espelho.js` (mapa, lote, simuladores, resumoVenda) ·
`vendas.js` (carteira, ficha, parcelas editáveis, cobrança, propostas, simulação)
· `caixa.js` (caixa, lançamentos, relatórios, DRE, previsões, inconsistências)
· `cadastros.js` (clientes, corretores, comissões) · `cronograma.js` ·
`contratos.js` (modelo oficial + extenso pt-BR) · `omie.js` (sync UI, boletos,
saldos, status) · `apresentacao.js` · `app.js` (rotas, login, home, config).

**Service worker** (`sw.js`): shell cache `pdb-shell-vN` — **toda publicação
bumpa o N + `window.VERSAO`** e o usuário recarrega 2×. Install usa
`Request(u, {cache:'reload'})`.

## 9. Rituais de operação

- **Deploy função**: `supabase functions deploy <nome> --project-ref reoghclxripktzpdwhiy --no-verify-jwt --use-api`
- **Publicar app**: bump sw+VERSAO → commit → push → GitHub Pages (aguardar
  `curl config.js` mostrar a versão).
- **Sync completa do Omie**: `{action:'sincronizar', completa:true}` em loop
  (`continua`/`parcial`) até `continua:null`.
- **Testes**: `bash scripts/checar-js.sh` (sem args = TODOS os 15 arquivos) e
  `bash scripts/testar.sh` (carnê). Teste local: servir a pasta, desregistrar SW
  + apagar caches + recarregar (o memory cache da aba engana: na dúvida, reload
  simples deixa o SW novo servir).

## 10. Backups (dois, independentes)

1. **Hub Impresilk** (05:40): puxa `list` paginado via ROTINA e grava
   `portal-bosques/AAAA-MM-DD.json` no repo privado `backups-impresilk` (registro `SISTEMAS_BACKUP_PORTALBOSQUES` — PENDENTE).
2. **pdb_backup** no Supabase (rotina própria; indicador em Configurações).
Restauração: action `restaurar` do nucleo aceita o formato do backup.

## 11. Segredos (nomes e moradas — valores NUNCA aqui)

No Supabase (projeto Projetos Léo): `PDB_TOKEN` (leve, também no bundle),
`PDB_PAINEL_SENHA` (senha-mestra inicial), `PDB_ROTINA_TOKEN` (backup/portas
fortes), `PDB_OMIE_APP_KEY` + `PDB_OMIE_APP_SECRET` (painel do Omie),
`SB_SECRET_KEY` (service). Cópias de trabalho: pasta `seed/` local (gitignored).
No painel do hub: `SISTEMAS_BACKUP_PORTALBOSQUES` (registry com a rotina — PENDENTE de criar; o do original é `SISTEMAS_BACKUP_BOSQUES`).

## 12. Para recriar do zero (ordem)

1. Repo GitHub público + Pages (main/root).
2. Projeto Supabase (ou namespace novo num compartilhado): rodar
   `supabase/migrations/0001_init.sql` (trocar o prefixo se for outro sistema).
3. Secrets (seção 11) + deploy das 3 funções.
4. Front: copiar os .js, ajustar `config.js` (TOKEN novo + endereços).
5. Criar o app no painel do Omie → chaves → secrets → primeira sync completa.
6. Cadastrar lotes (ou importar), acessos, conta bancária, centros de custo.
7. Registrar no backup do hub (secret `SISTEMAS_BACKUP_<NOME>`).

> Padrões-mãe: este sistema é filho da Domo (`~/Projetos/domo`) — mesma fundação.
> O passo-a-passo genérico de sistema novo vive no comando `/novo-sistema`.
