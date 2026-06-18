// Registers slash commands with Discord's global command endpoint.
// Global commands propagate to all servers within ~1 hour.
// Run: npm run register
//
// To register instantly to one guild for testing, set DISCORD_GUILD_ID in
// .env.local and the script will use the guild-scoped endpoint instead.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotEnv('.env.local');

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID; // optional

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
    ? `Registering commands to guild ${guildId} (instant)...`
    : 'Registering global commands (takes up to 1 hour to propagate)...',
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
