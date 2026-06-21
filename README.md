# Discord Docs Bot

A Discord slash-command bot that answers questions from your own documentation. Each Discord server uploads its own docs through a dashboard, then members use `/ask` to get grounded answers sourced only from that server's content.

---

## What it does

- Each Discord server connects its own documentation through a web dashboard.
- Server members run `/ask question: <their question>` in Discord.
- The bot retrieves relevant documentation chunks, sends them to a local LLM, and replies with a synthesized answer and source link.
- No server can query another server's documents — all retrieval is isolated by Discord guild ID.
- The LLM never invents information outside the provided documentation.

---

## Core features

- `/ask` slash command answered via Discord Interactions (not Gateway — the bot can appear offline and still work)
- Per-server document isolation using Supabase guild rows
- Import documentation by URL (single page or full site crawl), file upload (.txt, .md, .docx), or paste
- Keyword-scored retrieval (IDF + title/URL boosts) with intent-aware ranking
- Local LLM inference via Ollama (qwen3:4b) exposed through a secured gateway and Cloudflare tunnel
- `FINAL_ANSWER:` marker-based output extraction to prevent reasoning leaks reaching Discord
- Intent-aware source link selection (VM question → VM doc, tokenomics question → tokenomics doc)
- Light/dark mode dashboard with per-server guild ID stored in localStorage
- One-click Discord bot install flow via OAuth

---

## Architecture

```
User types /ask in Discord
        │
        ▼
Discord sends POST to Vercel /api/interactions
        │
        ├── Vercel responds immediately with type:5 (deferred)
        │
        └── waitUntil() keeps function alive for background work:
                │
                ▼
          Supabase: resolve guild_id → fetch + rank document chunks
                │
                ▼
          Ollama Gateway (local PC, secured)
          ← Cloudflare Quick Tunnel ←
                │
                ▼
          qwen3:4b generates answer
                │
                ▼
          Discord PATCH webhook → reply appears in channel
```

The web dashboard (Vercel) lets server admins manage their documentation independently of the bot answer flow.

---

## RAG flow

1. The user's question is expanded with project alias synonyms (e.g. "ionet" → "io.net io network decentralized gpu").
2. Intent is detected: broad overview / tokenomics / VM / install / specific feature.
3. Supabase returns up to 1000 document chunks for the guild.
4. Chunks are scored with TF-IDF weighting plus title/URL segment boosts.
5. Intent-aware penalties are applied: install docs are downranked for non-install questions; tokenomics docs are boosted for tokenomics questions, etc.
6. Up to 5 chunks are selected, each capped at 1000 characters, and sent to the LLM.
7. The model is instructed to output its answer only after a `FINAL_ANSWER:` marker, preventing reasoning leaks.
8. If reasoning is detected in the extracted answer, one retry is attempted with a stricter prompt.
9. The source link is chosen by intent: a VM question gets a VM doc link, not a staking page.

---

## Tech stack

| Layer | Technology |
|---|---|
| Web app & API | Next.js 16 (App Router), TypeScript, React 19 |
| Styling | Tailwind CSS v4 |
| Database | Supabase (PostgreSQL via PostgREST) |
| Discord | HTTP Interactions (Ed25519 signature verification, deferred responses) |
| LLM | Ollama — qwen3:4b running locally |
| LLM gateway | Custom Node.js HTTP proxy (`scripts/ollama-gateway.mjs`) with Bearer auth |
| Tunnel | Cloudflare Quick Tunnel (`cloudflared tunnel --url`) |
| Deployment | Vercel (serverless, `waitUntil` for background work) |
| File parsing | mammoth (.docx), native (.txt, .md) |

---

## Project structure

```
discord-docs-bot/
├── scripts/
│   ├── ollama-gateway.mjs        # Local HTTP gateway to Ollama with Bearer auth
│   ├── register-commands.mjs     # Register /ask command (guild or global)
│   ├── clear-global-commands.mjs # Remove global commands
│   └── crawl.mjs                 # Web crawler for site-index imports
│
├── src/
│   ├── app/
│   │   ├── page.tsx              # Landing page
│   │   ├── install/page.tsx      # Bot install instructions
│   │   ├── dashboard/
│   │   │   ├── page.tsx
│   │   │   ├── DocsForm.tsx      # Main dashboard UI (guild ID, doc list)
│   │   │   ├── FileImportForm.tsx
│   │   │   └── UrlImportForm.tsx
│   │   └── api/
│   │       ├── interactions/route.ts      # Discord slash command handler
│   │       ├── docs/route.ts              # List / paste docs
│   │       ├── docs/import-file/route.ts  # .txt/.md/.docx upload
│   │       ├── docs/import-url/route.ts   # URL/site crawl import
│   │       ├── discord/install/route.ts   # OAuth install redirect
│   │       └── debug/llm-clean/route.ts   # Dev-only: test answer processing
│   │
│   ├── lib/
│   │   ├── rag.ts      # Retrieval: chunking, IDF scoring, intent ranking
│   │   ├── llm.ts      # LLM call, FINAL_ANSWER: extraction, source selection
│   │   ├── supabase.ts # Supabase client
│   │   └── usage.ts    # Usage logging
│   │
│   └── components/
│       └── ThemeToggle.tsx
│
├── .env.example          # All required environment variables (no secrets)
├── CLAUDE.md / AGENTS.md # AI assistant project instructions
└── package.json
```

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side only, never exposed to browser) |
| `DISCORD_APPLICATION_ID` | Yes | Discord app ID from Developer Portal |
| `DISCORD_PUBLIC_KEY` | Yes | Ed25519 public key for signature verification |
| `DISCORD_BOT_TOKEN` | Yes | Bot token for command registration script |
| `DISCORD_GUILD_ID` | Optional | Default guild ID for guild-scoped command registration |
| `OLLAMA_BASE_URL` | Yes | URL of the local Ollama gateway (e.g. your Cloudflare tunnel URL) |
| `OLLAMA_GATEWAY_SECRET` | Yes | Bearer token shared between Vercel and the local gateway |
| `OLLAMA_MODEL` | Optional | Ollama model name (default: `qwen3:4b`) |
| `NEXT_PUBLIC_APP_URL` | Optional | Public app URL; used to generate dashboard links in Discord messages |

---

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Fill in all values — see the Environment variables table above
```

### 3. Set up Supabase

Create a Supabase project and run the schema below in the SQL editor:

```sql
-- guilds: one row per Discord server
create table guilds (
  id            uuid primary key default gen_random_uuid(),
  discord_guild_id text unique not null,
  created_at    timestamptz default now()
);

-- documents: one per uploaded/imported doc
create table documents (
  id          uuid primary key default gen_random_uuid(),
  guild_id    uuid references guilds(id) on delete cascade,
  title       text not null,
  source_type text not null,   -- 'url' | 'file' | 'paste'
  source_url  text,
  created_at  timestamptz default now()
);

-- document_chunks: IDF-scored retrieval units
create table document_chunks (
  id          uuid primary key default gen_random_uuid(),
  guild_id    uuid references guilds(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  created_at  timestamptz default now()
);

-- usage_logs: optional per-question logging
create table usage_logs (
  id               uuid primary key default gen_random_uuid(),
  discord_guild_id text,
  user_id          text,
  question         text,
  answered         boolean,
  created_at       timestamptz default now()
);
```

### 4. Start the local Ollama gateway

```bash
# In a separate terminal — must stay running
OLLAMA_GATEWAY_SECRET=your_secret OLLAMA_BASE_URL=http://localhost:11434 npm run gateway
# Listens on http://localhost:8787 by default
```

### 5. Start Cloudflare tunnel

```bash
# Exposes the local gateway to the internet
cloudflared tunnel --url http://localhost:8787
# Note the https://....trycloudflare.com URL and set it as OLLAMA_BASE_URL in Vercel
```

### 6. Run the dev server (UI only)

```bash
npm run dev
# http://localhost:3000
```

> The dev server is only useful for testing the dashboard UI. Discord slash commands require Vercel deployment because Discord needs a public HTTPS endpoint.

---

## Vercel deployment

1. Push the repo to GitHub.
2. Import the project in [vercel.com](https://vercel.com).
3. Add all environment variables from `.env.example` in the Vercel dashboard.
4. Set `OLLAMA_BASE_URL` to your Cloudflare tunnel URL (must be the gateway port, e.g. `https://xxxx.trycloudflare.com`).
5. Deploy. Vercel will build and assign a public URL.

---

## Discord Developer Portal setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, enable the bot and copy the bot token → `DISCORD_BOT_TOKEN`.
3. Under **General Information**, copy the Application ID → `DISCORD_APPLICATION_ID` and the Public Key → `DISCORD_PUBLIC_KEY`.
4. Under **Bot → Privileged Gateway Intents**, no intents are required (the bot uses Interactions, not Gateway).
5. Under **General Information → Interactions Endpoint URL**, set it to `https://your-vercel-url.vercel.app/api/interactions`.
6. Save. Discord will verify the endpoint responds correctly.

### Register the /ask command

```bash
# Register globally (all servers — takes up to 1 hour to propagate)
npm run discord:register:global

# Or register to one specific guild for instant testing
DISCORD_GUILD_ID=your_guild_id npm run register
```

---

## Ollama / Qwen local inference setup

```bash
# Install Ollama — see https://ollama.com
ollama pull qwen3:4b
ollama serve   # starts on http://localhost:11434
```

The local gateway (`npm run gateway`) sits in front of Ollama and adds Bearer token authentication. The Cloudflare tunnel exposes the gateway URL publicly so Vercel can reach it.

---

## Cloudflare tunnel setup

A Quick Tunnel works for prototyping but the URL changes every restart.

```bash
# One-time install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8787
```

For a stable URL, create a named tunnel via the Cloudflare dashboard and configure a custom domain — this eliminates the need to update `OLLAMA_BASE_URL` in Vercel on every restart.

---

## Usage examples

**Add the bot to a server**

Visit `https://your-vercel-url.vercel.app/install` or click "Add bot to Discord" on the landing page.

**Upload documentation**

Open `https://your-vercel-url.vercel.app/dashboard`, enter your Discord Server ID, then import a URL, upload a file, or paste text directly.

**Ask a question in Discord**

```
/ask question: what is io.net?
/ask question: does ionet offer vm on demand?
/ask question: how do I stake IO tokens?
```

The bot replies in the channel with a grounded answer and a link to the source document.

---

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is used only server-side (Next.js API routes / Vercel). It is never sent to the browser.
- All Discord interactions are verified with Ed25519 signature checking before processing.
- The Ollama gateway requires a `Authorization: Bearer <secret>` header on every request. The secret is shared between Vercel (env var) and the local gateway process.
- `.env.local` is gitignored. Never commit real secrets.

---

## Known limitations

- **Cloudflare Quick Tunnel URL changes on restart.** Every time `cloudflared tunnel --url` is restarted, a new URL is generated. `OLLAMA_BASE_URL` in Vercel must be updated accordingly. A named Cloudflare tunnel with a fixed domain avoids this.
- **Local PC must be online.** The LLM (qwen3:4b) runs on your local machine. If the PC is offline or the tunnel is down, `/ask` will return a graceful error message.
- **Keyword-based retrieval.** The current retrieval system uses TF-IDF scoring with title/URL boosts. It works well for specific factual questions but may miss semantically similar content that uses different wording. A future improvement would be vector embeddings (pgvector) for semantic search.
- **No authentication on the dashboard.** Any user with the URL can upload documents to any Discord server if they know the server ID. The dashboard is intended to be used by server administrators.
- **Prototype/MVP stage.** The project is functional but has not been hardened for multi-tenant production use.

---

## Future improvements

- Vector embeddings (pgvector) for semantic retrieval alongside keyword scoring
- Named Cloudflare tunnel with a fixed domain (removes manual URL update on restart)
- Dashboard authentication so only authorized users can manage a server's docs
- Document deletion from the dashboard
- Usage analytics page
- Support for additional file formats (PDF)
- Chunk quality improvements: better sentence boundary detection, overlap between chunks
