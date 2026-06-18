-- Guilds that have installed the bot
create table if not exists guilds (
  id text primary key,                   -- Discord guild (server) snowflake ID
  name text,
  installed_at timestamptz default now(),
  active boolean default true
);

-- Documentation sources uploaded per guild
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz default now()
);

-- Chunks derived from documents for retrieval
create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  guild_id text not null references guilds(id) on delete cascade,
  content text not null,
  chunk_index int not null,
  -- tsvector column for Postgres full-text search
  fts tsvector generated always as (to_tsvector('english', content)) stored
);

create index if not exists document_chunks_fts_idx on document_chunks using gin(fts);
create index if not exists document_chunks_guild_idx on document_chunks(guild_id);

-- Cache repeated questions to avoid redundant LLM calls
create table if not exists question_cache (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  question_hash text not null,           -- sha256 of normalized question
  answer text not null,
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '24 hours',
  unique (guild_id, question_hash)
);

-- Per-guild usage tracking for rate limiting and analytics
create table if not exists usage_logs (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references guilds(id) on delete cascade,
  user_id text not null,                 -- Discord user snowflake ID
  question text not null,
  answered boolean default false,
  cache_hit boolean default false,
  created_at timestamptz default now()
);
