// Removes all global slash commands for this Discord application by sending
// an empty bulk-overwrite. Guild-scoped commands are not affected.
// Run: npm run clear-global-commands

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadDotEnv('.env.local');

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;

if (!appId || !token) {
  console.error('DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set in .env.local');
  process.exit(1);
}

const endpoint = `https://discord.com/api/v10/applications/${appId}/commands`;

console.log('Clearing all global slash commands...');

const res = await fetch(endpoint, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([]), // empty array = delete everything
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Discord API error ${res.status}: ${text}`);
  process.exit(1);
}

const remaining = await res.json();
console.log(`Done. Global commands remaining: ${remaining.length}`); // should be 0

// ---------------------------------------------------------------------------

function loadDotEnv(filename) {
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), filename), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] = val;
  }
}
