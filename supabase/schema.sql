-- ============================================================
-- DocBot schema  –  run this in the Supabase SQL editor
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE
-- ============================================================

-- guilds ─────────────────────────────────────────────────────
create table if not exists guilds (
  id               uuid primary key default gen_random_uuid(),
  discord_guild_id text not null unique,   -- Discord snowflake string
  name             text,
  created_at       timestamptz default now()
);

-- documents ──────────────────────────────────────────────────
-- Stores metadata only; actual text lives in document_chunks.
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  guild_id    uuid not null references guilds(id) on delete cascade,
  title       text not null,
  source_type text not null default 'paste',
  source_url  text,                            -- set for source_type = 'url'
  created_at  timestamptz default now()
);

-- Migration: add source_url if upgrading from an earlier schema version.
alter table documents add column if not exists source_url text;

-- document_chunks ────────────────────────────────────────────
create table if not exists document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  guild_id    uuid not null references guilds(id) on delete cascade,
  chunk_index int  not null,
  content     text not null,
  created_at  timestamptz default now(),
  -- generated tsvector for full-text search (uses GIN index below)
  fts tsvector generated always as (to_tsvector('english', content)) stored
);

create index if not exists document_chunks_fts_idx   on document_chunks using gin(fts);
create index if not exists document_chunks_guild_idx on document_chunks(guild_id);

-- question_cache ──────────────────────────────────────────────
-- Avoids redundant LLM calls for repeated questions.
-- question_hash = sha256 of lowercased, trimmed question text.
create table if not exists question_cache (
  id            uuid primary key default gen_random_uuid(),
  guild_id      uuid not null references guilds(id) on delete cascade,
  question_hash text not null,
  answer        text not null,
  created_at    timestamptz default now(),
  expires_at    timestamptz default now() + interval '24 hours',
  unique (guild_id, question_hash)
);

create index if not exists question_cache_guild_idx   on question_cache(guild_id);
create index if not exists question_cache_expires_idx on question_cache(expires_at);

-- usage_logs ──────────────────────────────────────────────────
create table if not exists usage_logs (
  id         uuid primary key default gen_random_uuid(),
  guild_id   uuid not null references guilds(id) on delete cascade,
  user_id    text not null,   -- Discord user snowflake
  question   text not null,
  answered   boolean default false,
  cache_hit  boolean default false,
  created_at timestamptz default now()
);

create index if not exists usage_logs_guild_idx on usage_logs(guild_id);

-- Migrations: add columns that may be missing in databases created from earlier
-- schema versions. These are idempotent and safe to run multiple times.
alter table usage_logs add column if not exists answered      boolean default false;
alter table usage_logs add column if not exists best_chunk_id uuid    default null;

-- ============================================================
-- search_chunks(discord_guild_id, query, limit)
--
-- 1. Resolves discord_guild_id → internal uuid
-- 2. Ranked full-text search via the GIN index
-- 3. Falls back to ilike when FTS returns nothing
--    (handles stop-word-only queries like "what is the")
-- ============================================================
create or replace function search_chunks(
  p_discord_guild_id text,
  p_query            text,
  p_limit            int default 3
)
returns table(id uuid, content text, chunk_index int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guild_id uuid;
  v_tsquery  tsquery;
  v_count    int := 0;
  v_row      record;
begin
  select g.id into v_guild_id
  from guilds g
  where g.discord_guild_id = p_discord_guild_id;

  if v_guild_id is null then
    return;
  end if;

  v_tsquery := websearch_to_tsquery('english', p_query);

  -- FTS (only when tsquery is non-empty)
  if numnode(v_tsquery) > 0 then
    for v_row in
      select dc.id, dc.content, dc.chunk_index
      from document_chunks dc
      where dc.guild_id = v_guild_id
        and dc.fts @@ v_tsquery
      order by ts_rank(dc.fts, v_tsquery) desc
      limit p_limit
    loop
      id          := v_row.id;
      content     := v_row.content;
      chunk_index := v_row.chunk_index;
      v_count     := v_count + 1;
      return next;
    end loop;
  end if;

  -- ilike fallback
  if v_count = 0 then
    for v_row in
      select dc.id, dc.content, dc.chunk_index
      from document_chunks dc
      where dc.guild_id = v_guild_id
        and dc.content ilike '%' || p_query || '%'
      limit p_limit
    loop
      id          := v_row.id;
      content     := v_row.content;
      chunk_index := v_row.chunk_index;
      return next;
    end loop;
  end if;
end;
$$;
