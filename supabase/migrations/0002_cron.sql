-- ============================================================================
-- Cron diário do Portal dos Bosques: backup, limpeza de log/lixeira/órfãos.
--
-- Preencha os dois valores ANTES de rodar: a URL do projeto e o ROTINA_TOKEN
-- (o mesmo segredo definido nas envs da função pdb-rotina).
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 06:20 UTC = 03:20 em Montes Claros (UTC-3). Domo 06:00, bosques original 06:10.
select cron.schedule(
  'pdb-rotina-diaria',
  '20 6 * * *',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO.supabase.co/functions/v1/pdb-rotina',
    headers := jsonb_build_object('content-type', 'application/json', 'x-rotina-token', 'SEU_ROTINA_TOKEN'),
    body    := '{}'::jsonb
  );
  $$
);
