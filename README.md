# Portal dos Bosques — Gestão do Loteamento

Sistema da Associação Campestre Portal dos Bosques (Montes Claros/MG):
espelho de lotes, propostas pelo WhatsApp, vendas com carnê espelhado do ERP,
recebimentos, distratos, contratos, caixa, comissões, cronograma da obra.

Mesma família da Domo Construtora e do Diamond Vendas: **HTML/CSS/JS puro,
sem build**, offline-first (PWA), backend em **Edge Functions do Supabase**
(Postgres + Storage), publicado como site estático no GitHub Pages.

> Este repositório é a **reconstrução** do sistema original (`bosques`),
> refeito em 26/08/2026 a partir do `docs/BLUEPRINT.md` — já nascendo com o
> financeiro 100% Omie e sem a sistemática da planilha (aposentada).

## A verdade financeira é o Omie

O ERP **Omie** manda no dinheiro: os títulos (carnês/boletos do Sicoob) são
sincronizados pela function `pdb-omie` e viram:

- `venda.parcelas[]` — **o espelho do carnê**, título a título (`tid`, venc,
  valor cheio, valor em dia ×0,8, pagamento real). Edição humana (`trava`)
  vence em venc/valores; o PAGAMENTO real sempre atualiza.
- `rec` — recebimentos (CR recebido → `rbomie-{tid}`).
- `cx` — despesas (CP pago → `cxomie-{tid}`), categoria por prefixo.

A sync roda no login (se >20h) ou pelo botão em Configurações; é paginada
entre chamadas (`continua`/`parcial`). Saldo bancário via `ListarExtrato`.

**Vencido = só parcela do espelho com status 'atrasada'.** Venda sem boletos
no Omie não afirma atraso (mostra o plano e avisa "gere o carnê no Omie").

## A API (aberta para integrar)

Tudo é `POST` com corpo JSON:

```
POST https://<projeto>.supabase.co/functions/v1/pdb-nucleo
headers:
  content-type: application/json
  x-token: <TOKEN leve — o mesmo do config.js>
  x-senha: <sha256 da senha, em hex>       ← quem autoriza de verdade
  x-quem:  <nome de quem assina, URL-encoded (opcional)>
corpo: { "action": "<ação>", ...parâmetros }
```

Ações principais:

| action | o que faz |
|---|---|
| `snapshot` | devolve tudo (cfg + registros), filtrado pelo perfil |
| `salvarLote` | grava registros `{itens:[{colecao, registro}]}` — recusa item a item, com motivo |
| `apagar` / `restaurarItem` | lixeira (estorno de recebimento passa por aqui, com log) |
| `backup` / `restaurar` | cópia completa / restauração |
| `log` | trilha de quem fez o quê |

Coleções: `lote`, `cliente`, `corretor`, `venda` (VD-0001…), `prop` (PR-…),
`rec` (RB-…), `cx`, `doc`, `foto`, `prev`, `etapa`.

**Regras que o servidor faz valer** (não adianta mandar diferente):
um lote só tem uma venda viva; o status do lote é derivado da venda;
recebimento nasce com autor carimbado e não muda de valor nem de venda
(vincular venda vazia é permitido; trocar não); corretor só grava proposta,
e só a própria; CAMPOS_UNIAO (historico, anexos, cobrancas…) unem por id no
servidor e nunca se perdem por upsert concorrente.

Arquivos (contratos, PDFs): `pdb-acervo`, protocolo em partes de 2,5 MB.
Proposta pública (link do WhatsApp): `pdb-p/<id>/<token>`.

## As réguas do negócio

- Valor do lote = `m² × R$ 40`; parcela = valor × razão (fixa cheia
  `0,01090625` · fixa em dia `0,008725` · reajustada cheia `0,00840625` ·
  reajustada em dia `0,006725`). Em dia = cheia × 0,8 SEMPRE.
- Boleto sai CHEIO; pagando até o vencimento = −20% (o sistema guarda o
  valor EM DIA; cheio = valor ÷ 0,8).
- Reajustada: +6% a cada 12 parcelas (`cfg.reajuste`).
- `resumoVenda()`/`totalPlanoVenda()` (espelho.js) são A régua de todas as
  telas — VGV, vencido, recebido saem dali.
- `carne.js` (motor derivado) hoje serve só a simulação/proposta — o carnê
  real é o espelho. Testes: `./scripts/testar.sh`.

## Estrutura

```
index.html        casca; ordem dos scripts importa (ui declara TELAS)
config.js         TOKEN leve + endereços (SEM segredo de verdade)
store.js          offline-first: cache local, fila, sync 90s
ui.js             fmt, modal, toast, campos
carne.js          motor derivado (simulação/proposta; puro, testado)
pdf.js            jsPDF vendorado — só Helvetica: NUNCA U+2212/emoji em PDF
espelho.js        espelho, ficha do lote, simuladores, resumoVenda
vendas.js         carteira, ficha, parcelas editáveis, cobrança, propostas
caixa.js          caixa, lançamentos, relatórios, DRE, previsões
cadastros.js      clientes, corretores, comissões
cronograma.js     etapas da obra (previsto × pago)
contratos.js      contrato oficial + extenso pt-BR
omie.js           sync UI, boletos, saldos, status
apresentacao.js   fotos do empreendimento
app.js            login, menu, roteador, home, configurações

supabase/
  migrations/     0001 schema (pdb_*) · 0002 pg_cron da rotina
  functions/
    _shared/      colecoes, acesso (perfis), dados, cors, arquivos
    pdb-nucleo/   a porta de dados (todas as regras)
    pdb-omie/     a ponte com o ERP (sync, boletos, saldos)
    pdb-acervo/   arquivos em partes (Storage)
    pdb-p/        landing pública da proposta
    pdb-rotina/   backup diário + limpezas (pg_cron 03:20)

scripts/
  testar.sh       testes do carnê (jsc do macOS, sem node)
  checar-js.sh    checagem de sintaxe (sem args = todos os .js)
```

⚠️ **`seed/` está no .gitignore de propósito**: tem chave do Omie e segredos
locais, e este repositório é público. Nunca tirar do gitignore.

## Perfis

| perfil | pode |
|---|---|
| **direcao** | tudo (config, acessos, lixeira, backup, log) |
| **escritorio** | opera: vendas, baixas, caixa, cadastros, contratos |
| **corretor** | espelho e as PRÓPRIAS propostas — nunca vê o dinheiro da casa |

A senha da equipe (env `PDB_PAINEL_SENHA` até a primeira troca) vale como
direção. Acessos individuais em Configurações. A SENHA é a identidade
(o nome só assina).

## Publicar

Deploy: siga o `DEPLOY.md`. A cada publicação do front, **subir o `CACHE` do
sw.js e o `VERSAO` do config.js** — senão o navegador serve o arquivo velho
(o usuário recarrega 2×). Blueprint completo: `docs/BLUEPRINT.md`.
