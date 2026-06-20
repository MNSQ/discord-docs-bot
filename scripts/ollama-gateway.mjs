import { createServer } from 'node:http';

const PORT   = parseInt(process.env.OLLAMA_GATEWAY_PORT ?? '8787', 10);
const SECRET = process.env.OLLAMA_GATEWAY_SECRET;
const OLLAMA = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

if (!SECRET) {
  console.error('[gateway] OLLAMA_GATEWAY_SECRET is not set — refusing to start');
  process.exit(1);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

const server = createServer(async (req, res) => {
  // Health check — no auth required
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, service: 'ollama-gateway' });
  }

  // Auth check for all other routes
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader !== `Bearer ${SECRET}`) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  // Only proxy POST /api/chat
  if (req.method === 'POST' && req.url === '/api/chat') {
    console.log('[gateway] POST /api/chat');

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    try {
      const ollamaRes = await fetch(`${OLLAMA}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const responseBody = await ollamaRes.arrayBuffer();

      if (!ollamaRes.ok) {
        console.error('[gateway] Ollama error:', ollamaRes.status);
      } else {
        console.log('[gateway] forwarded to Ollama');
      }

      res.writeHead(ollamaRes.status, { 'Content-Type': 'application/json' });
      res.end(Buffer.from(responseBody));
    } catch (err) {
      console.error('[gateway] Ollama error:', err.message);
      send(res, 502, { error: 'Ollama unreachable', detail: err.message });
    }
    return;
  }

  send(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
});
