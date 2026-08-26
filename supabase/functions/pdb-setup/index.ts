// pdb-setup — function TEMPORÁRIA de fundação (sucessora do truque bsq-setup).
//
// Todas as ações são FIXAS (nenhum SQL vem de fora): ddl, copiar_dados,
// conferir, cron e copiar_arquivos. Usa a env automática SUPABASE_DB_URL
// porque não há como rodar SQL de fora sem a senha do banco. Guardada pelo
// PDB_ROTINA_TOKEN (segredo forte, nunca no navegador).
// APAGAR DEPOIS DO USO — como foi feito com a bsq-setup.

import postgres from "npm:postgres@3";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-rotina-token",
};

function resposta(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// O DDL de supabase/migrations/0001_init.sql, na íntegra (tudo idempotente).
const DDL = `
create table if not exists public.pdb_registros (
  colecao       text not null,
  id            text not null,
  registro      jsonb not null,
  atualizado_em timestamptz not null default now(),
  apagado       boolean not null default false,
  primary key (colecao, id)
);
create index if not exists pdb_registros_colecao_idx on public.pdb_registros (colecao);
create index if not exists pdb_registros_apagado_idx on public.pdb_registros (apagado) where apagado;
alter table public.pdb_registros enable row level security;

create table if not exists public.pdb_cfg (
  id            boolean primary key default true check (id),
  config        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
alter table public.pdb_cfg enable row level security;
insert into public.pdb_cfg (id, config) values (true, '{}'::jsonb) on conflict (id) do nothing;

create table if not exists public.pdb_seq (
  colecao text primary key,
  n       integer not null default 0
);
alter table public.pdb_seq enable row level security;

create table if not exists public.pdb_seq_idx (
  colecao text not null,
  numero  integer not null,
  reg_id  text not null,
  primary key (colecao, numero)
);
alter table public.pdb_seq_idx enable row level security;

create or replace function public.pdb_proximo_numero(p_colecao text)
returns integer
language plpgsql
as $fn$
declare v_n integer;
begin
  insert into public.pdb_seq (colecao, n) values (p_colecao, 1)
  on conflict (colecao) do update set n = public.pdb_seq.n + 1
  returning public.pdb_seq.n into v_n;
  return v_n;
end;
$fn$;

create table if not exists public.pdb_log (
  id      bigserial primary key,
  em      timestamptz not null default now(),
  entrada jsonb not null
);
create index if not exists pdb_log_em_idx on public.pdb_log (em desc);
alter table public.pdb_log enable row level security;

create table if not exists public.pdb_backup (
  dia      date primary key,
  conteudo jsonb not null,
  em       timestamptz not null default now()
);
alter table public.pdb_backup enable row level security;

create table if not exists public.pdb_meta (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.pdb_meta enable row level security;

insert into storage.buckets (id, name, public)
values ('pdb-arquivos', 'pdb-arquivos', false)
on conflict (id) do nothing;
`;

// A cópia dos dados do namespace original (bsq_*) para o novo (pdb_*).
// bsq_backup NÃO vem (o novo sistema faz o seu próprio, às 06:20 UTC).
const COPIA = [
  `insert into public.pdb_registros (colecao, id, registro, atualizado_em, apagado)
   select colecao, id, registro, atualizado_em, apagado from public.bsq_registros`,
  `insert into public.pdb_cfg (id, config, atualizado_em)
   select id, config, atualizado_em from public.bsq_cfg
   on conflict (id) do update set config = excluded.config, atualizado_em = excluded.atualizado_em`,
  `insert into public.pdb_seq (colecao, n) select colecao, n from public.bsq_seq`,
  `insert into public.pdb_seq_idx (colecao, numero, reg_id) select colecao, numero, reg_id from public.bsq_seq_idx`,
  `insert into public.pdb_meta (chave, valor, atualizado_em) select chave, valor, atualizado_em from public.bsq_meta`,
  `insert into public.pdb_log (em, entrada) select em, entrada from public.bsq_log`,
];

// A limpeza que precede uma RE-cópia (usada na virada). Só tabelas pdb_*.
const LIMPA = [
  `truncate public.pdb_registros`,
  `truncate public.pdb_seq`,
  `truncate public.pdb_seq_idx`,
  `truncate public.pdb_meta`,
  `truncate public.pdb_log restart identity`,
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const segredo = Deno.env.get("PDB_ROTINA_TOKEN");
  if (!segredo || req.headers.get("x-rotina-token") !== segredo) {
    return resposta({ erro: "não autorizado" }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) return resposta({ erro: "sem SUPABASE_DB_URL" }, 500);

  // ── ddl: cria as tabelas pdb_* (idempotente) ──────────────────────────────
  if (body.action === "ddl") {
    const sql = postgres(url, { prepare: false });
    try {
      await sql.unsafe(DDL);
      return resposta({ ok: true });
    } catch (e) {
      return resposta({ erro: String((e as Error)?.message || e) }, 400);
    } finally { await sql.end({ timeout: 2 }); }
  }

  // ── copiar_dados: bsq_* → pdb_* (com {limpar:true} trunca pdb_* antes) ────
  if (body.action === "copiar_dados") {
    const sql = postgres(url, { prepare: false });
    try {
      const feito: Record<string, number> = {};
      await sql.begin(async (tx) => {
        if (body.limpar === true) for (const c of LIMPA) await tx.unsafe(c);
        for (const c of COPIA) {
          const r = await tx.unsafe(c);
          feito[c.slice(12, 60).trim()] = (r as unknown as { count: number }).count ?? 0;
        }
      });
      return resposta({ ok: true, feito });
    } catch (e) {
      return resposta({ erro: String((e as Error)?.message || e) }, 400);
    } finally { await sql.end({ timeout: 2 }); }
  }

  // ── conferir: contagens e somas lado a lado, bsq × pdb ────────────────────
  if (body.action === "conferir") {
    const sql = postgres(url, { prepare: false });
    try {
      const colecoes = await sql`
        select coalesce(a.colecao, b.colecao) as colecao,
               coalesce(a.n, 0) as bsq, coalesce(b.n, 0) as pdb
        from (select colecao, count(*) n from public.bsq_registros group by 1) a
        full join (select colecao, count(*) n from public.pdb_registros group by 1) b
          using (colecao)
        order by 1`;
      const dinheiro = await sql`
        select lado, colecao, mes, round(soma::numeric, 2) as soma, n from (
          select 'bsq' as lado, colecao,
                 left(registro->>'data', 7) as mes,
                 sum((registro->>'valor')::numeric) as soma, count(*) n
          from public.bsq_registros
          where colecao in ('rec','cx') and not apagado
            and coalesce(registro->>'apagadoEm','') = ''
          group by 1, 2, 3
          union all
          select 'pdb', colecao, left(registro->>'data', 7),
                 sum((registro->>'valor')::numeric), count(*)
          from public.pdb_registros
          where colecao in ('rec','cx') and not apagado
            and coalesce(registro->>'apagadoEm','') = ''
          group by 1, 2, 3
        ) t order by colecao, mes, lado`;
      const extras = await sql`
        select 'cfg' as tabela,
               (select count(*) from public.bsq_cfg) as bsq,
               (select count(*) from public.pdb_cfg) as pdb
        union all select 'seq',
               (select count(*) from public.bsq_seq),
               (select count(*) from public.pdb_seq)
        union all select 'seq_idx',
               (select count(*) from public.bsq_seq_idx),
               (select count(*) from public.pdb_seq_idx)
        union all select 'meta',
               (select count(*) from public.bsq_meta),
               (select count(*) from public.pdb_meta)
        union all select 'log',
               (select count(*) from public.bsq_log),
               (select count(*) from public.pdb_log)
        union all select 'arquivos',
               (select count(*) from storage.objects where bucket_id = 'bsq-arquivos'),
               (select count(*) from storage.objects where bucket_id = 'pdb-arquivos')`;
      return resposta({ ok: true, colecoes, dinheiro, extras });
    } catch (e) {
      return resposta({ erro: String((e as Error)?.message || e) }, 400);
    } finally { await sql.end({ timeout: 2 }); }
  }

  // ── cron: agenda a rotina diária 06:20 UTC (id fixo, idempotente) ─────────
  if (body.action === "cron") {
    const sql = postgres(url, { prepare: false });
    try {
      const alvo = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/pdb-rotina";
      await sql`select cron.unschedule('pdb-rotina-diaria')
                where exists (select 1 from cron.job where jobname = 'pdb-rotina-diaria')`;
      await sql`select cron.schedule('pdb-rotina-diaria', '20 6 * * *',
        format($j$select net.http_post(
          url := %L,
          headers := jsonb_build_object('content-type', 'application/json', 'x-rotina-token', %L),
          body := '{}'::jsonb
        )$j$, ${alvo}::text, ${segredo}::text))`;
      return resposta({ ok: true, alvo });
    } catch (e) {
      return resposta({ erro: String((e as Error)?.message || e) }, 400);
    } finally { await sql.end({ timeout: 2 }); }
  }

  // ── copiar_arquivos: bsq-arquivos → pdb-arquivos, paginado por nome ───────
  if (body.action === "copiar_arquivos") {
    const KEY = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(Deno.env.get("SUPABASE_URL")!, KEY);
    const sql = postgres(url, { prepare: false });
    try {
      const depois = String(body.depois || "");
      const lote = await sql`
        select name, metadata->>'mimetype' as tipo
        from storage.objects
        where bucket_id = 'bsq-arquivos' and name > ${depois}
        order by name
        limit 25`;
      let feitos = 0;
      const erros: string[] = [];
      for (const o of lote) {
        const { data, error } = await db.storage.from("bsq-arquivos").download(o.name);
        if (error || !data) { erros.push(o.name + ": " + (error?.message || "vazio")); continue; }
        const { error: e2 } = await db.storage.from("pdb-arquivos")
          .upload(o.name, data, { contentType: o.tipo || "application/octet-stream", upsert: true });
        if (e2) { erros.push(o.name + ": " + e2.message); continue; }
        feitos++;
      }
      const ultimo = lote.length ? lote[lote.length - 1].name : null;
      return resposta({ ok: true, feitos, erros, ultimo, continua: lote.length === 25 ? ultimo : null });
    } catch (e) {
      return resposta({ erro: String((e as Error)?.message || e) }, 400);
    } finally { await sql.end({ timeout: 2 }); }
  }

  return resposta({ erro: "action desconhecida" }, 400);
});
