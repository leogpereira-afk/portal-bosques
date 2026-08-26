# Como o Portal dos Bosques (portal-bosques) está no ar

Reconstrução deployada em **26/08/2026** — dentro do projeto Supabase
**"Projetos Léo"** (`reoghclxripktzpdwhiy`), o mesmo da Domo, do Diamond e do
sistema original (`bsq_*`), como namespace próprio `pdb_*`.

## O mapa do projeto compartilhado

| Sistema | Tabelas | Functions | Segredos |
|---|---|---|---|
| Domo | `domo_*` | `domo-nucleo/acervo/rotina` | `TOKEN`, `PAINEL_SENHA`, `ROTINA_TOKEN` (os nomes CRUS são da Domo!) |
| Diamond | Blobs-shim | `dmd-api`, `dmd-p` | `DMD_TOKEN` |
| Bosques original | `bsq_*` | `bsq-*` | `BSQ_*` (aposentar na virada) |
| **portal-bosques** | `pdb_*` | `pdb-nucleo/omie/acervo/p/rotina` | `PDB_TOKEN`, `PDB_PAINEL_SENHA`, `PDB_ROTINA_TOKEN`, `PDB_OMIE_APP_KEY`, `PDB_OMIE_APP_SECRET` |

**Regra da casa:** segredo de Edge Function é DO PROJETO INTEIRO. Sistema novo
aqui dentro SEMPRE prefixa os seus (`XXX_TOKEN`) — gravar `TOKEN` de novo
derruba a Domo.

## O que foi feito (e como refazer, se um dia precisar)

1. **Tabelas**: `supabase/migrations/0001_init.sql` (tudo `pdb_*`,
   `if not exists`, RLS ligada sem policy; bucket `pdb-arquivos`).
   Rodado via uma function temporária `pdb-setup` (apagada depois) que executa
   SQL pela env automática `SUPABASE_DB_URL`.
2. **Dados**: copiados DIRETO no Postgres do namespace `bsq_*` (o estado
   resolvido: financeiro 100% Omie): `pdb_registros`, `pdb_cfg` (usuários e
   senhas intactos), `pdb_seq`/`pdb_seq_idx` (numeração continua), `pdb_meta`
   (estado da sync do Omie e corte), `pdb_log`. `bsq_backup` NÃO veio (o novo
   faz o seu). Arquivos do bucket copiados `bsq-arquivos → pdb-arquivos`.
3. **Functions**: `supabase functions deploy pdb-nucleo pdb-omie pdb-acervo
   pdb-p pdb-rotina --project-ref reoghclxripktzpdwhiy --no-verify-jwt
   --use-api` (CLI em `~/apps/node20/bin`, logada; `--use-api` dispensa Docker).
4. **Segredos**: `supabase secrets set PDB_TOKEN=… PDB_PAINEL_SENHA=…
   PDB_ROTINA_TOKEN=… PDB_OMIE_APP_KEY=… PDB_OMIE_APP_SECRET=…`
   (cópias locais fora do git em `seed/`; chaves do Omie são as MESMAS do
   sistema original — mesma empresa no ERP).
5. **Cron**: job `pdb-rotina-diaria` às **06:20 UTC** (03:20 em Montes
   Claros) — Domo 06:00, bosques original 06:10.
6. **Site**: GitHub Pages do repo `portal-bosques` (branch `main`, raiz).

## Convivência com o sistema original (até a virada)

- Os dois no ar; o Omie sincroniza nos dois (leitura, sem conflito).
- Lançamento manual feito num NÃO aparece no outro — **na virada, re-copiar
  os dados** (mesmo mecanismo do passo 2) e só então mudar a equipe de
  endereço. Depois: desligar o cron `bsq-rotina-diaria`, aviso/redirect no
  repo velho, aposentar os secrets `BSQ_*`.
- Pendência: registrar `SISTEMAS_BACKUP_PORTALBOSQUES` no hub (backup das
  05:40 no repo privado `backups-impresilk`).

## A prova das portas (refazer depois de qualquer mexida em auth)

| chamada | esperado |
|---|---|
| `ping` com `x-token` certo | 200 `{"ok":true}` |
| qualquer coisa sem `x-token` | 401 |
| `snapshot` sem `x-senha` | 403 |
| `snapshot` com senha errada | 403 |
| `list` com `x-token` = ROTINA | 200 (porta do backup) |

## Lembretes de publicação do front

- Subir `CACHE` do `sw.js` e `VERSAO` do `config.js` a cada deploy.
- `seed/` NUNCA entra no git (chaves do Omie; repo é público).
- Testes antes de subir: `bash scripts/checar-js.sh` + `bash scripts/testar.sh`.
