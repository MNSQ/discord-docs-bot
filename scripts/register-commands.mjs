// Registers slash commands with Discord.
//
// Guild mode (fast, test-only):
//   npm run register              ← uses DISCORD_GUILD_ID from .env.local
//
// Global mode (all servers, propagates within ~1 hour):
//   npm run discord:register:global   ← ignores DISCORD_GUILD_ID

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotEnv('.env.local');

const appId   = process.env.DISCORD_APPLICATION_ID;
const token   = process.env.DISCORD_BOT_TOKEN;
const forceGlobal = process.argv.includes('--global');
const guildId = forceGlobal ? null : (process.env.DISCORD_GUILD_ID ?? null);

if (!appId || !token) {
  console.error('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set in .env.local');
  process.exit(1);
}

const commands = [
  {
    name: 'ask',
    description: 'Ask a question answered from your server documentation',
    options: [
      {
        type: 3, // STRING
        name: 'question',
        description: 'The question you want answered',
        required: true,
      },
    ],
  },
];

const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

console.log(
  guildId
    ? `Registering guild commands for ${guildId}`
    : 'Registering global commands',
);

const res = await fetch(endpoint, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Discord API error ${res.status}: ${text}`);
  process.exit(1);
}

const registered = await res.json();
console.log(`Done. Registered ${registered.length} command(s):`);
for (const cmd of registered) {
  console.log(`  /${cmd.name}  (id: ${cmd.id})`);
}

// ---------------------------------------------------------------------------

function loadDotEnv(filename) {
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), filename), 'utf8');
  } catch {
    return; // file absent — rely on existing process.env
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Don't overwrite vars already set in the environment
    if (key in process.env) continue;
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] = val;
  }
}
