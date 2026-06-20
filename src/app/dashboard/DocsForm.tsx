'use client';

import { useState, useEffect, useCallback } from 'react';
import UrlImportForm from './UrlImportForm';
import FileImportForm from './FileImportForm';

export type Doc = {
  id: string;
  title: string;
  source_type: string;
  source_url: string | null;
  created_at: string;
};

type Tab = 'url' | 'file' | 'paste';

const TABS: { id: Tab; label: string }[] = [
  { id: 'url',   label: 'From URL'    },
  { id: 'file',  label: 'Upload File' },
  { id: 'paste', label: 'Paste Text'  },
];

const LS_KEY = 'discord_guild_id';

function Step({ n }: { n: number }) {
  return (
    <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs flex items-center justify-center font-semibold">
      {n}
    </span>
  );
}

export default function DocsForm() {
  // ── Guild ID — persisted in localStorage, prefilled from URL param ─────────
  const [guildId, setGuildId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(LS_KEY) ?? '';
  });

  function handleGuildIdChange(value: string) {
    setGuildId(value);
    localStorage.setItem(LS_KEY, value);
  }

  // On mount, prefer the ?guild_id= query param over localStorage
  useEffect(() => {
    const urlGuildId = new URLSearchParams(window.location.search).get('guild_id')?.trim();
    if (urlGuildId) handleGuildIdChange(urlGuildId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Docs list — fetched client-side whenever guildId changes ───────────────
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const fetchDocs = useCallback(() => {
    const id = guildId.trim();
    if (!id) { setDocs([]); return; }
    setDocsLoading(true);
    fetch(`/api/docs?guild_id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => setDocs(Array.isArray(d.docs) ? d.docs : []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [guildId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // ── Tabs / paste form ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('url');

  const [title,        setTitle]        = useState('');
  const [content,      setContent]      = useState('');
  const [pasteStatus,  setPasteStatus]  = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [pasteMessage, setPasteMessage] = useState('');

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!guildId.trim()) {
      setPasteStatus('error');
      setPasteMessage('Enter a Discord Server ID first.');
      return;
    }
    setPasteStatus('saving');
    setPasteMessage('');

    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: guildId.trim(), title, content }),
    });
    const data = await res.json();

    if (res.ok) {
      setPasteStatus('ok');
      setPasteMessage(`Saved — ${data.chunks} chunk(s) stored.`);
      setTitle('');
      setContent('');
      fetchDocs();
    } else {
      setPasteStatus('error');
      setPasteMessage(data.error ?? 'Something went wrong.');
    }
  }

  function renderPanel() {
    if (activeTab === 'file') {
      return <FileImportForm guildId={guildId.trim()} onSuccess={fetchDocs} />;
    }

    if (activeTab === 'paste') {
      return (
        <form onSubmit={handlePaste} className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Document title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <textarea
            placeholder="Paste documentation text here…"
            value={content}
            onChange={e => setContent(e.target.value)}
            required
            rows={10}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={pasteStatus === 'saving'}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {pasteStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {pasteMessage && (
              <span className={`text-sm ${pasteStatus === 'error' ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                {pasteMessage}
              </span>
            )}
          </div>
        </form>
      );
    }

    return <UrlImportForm guildId={guildId.trim()} onSuccess={fetchDocs} />;
  }

  return (
    <div className="flex flex-col gap-10 max-w-2xl w-full">

      {/* ── Onboarding steps ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold">Get started</h2>
        <ol className="flex flex-col gap-4 text-sm text-zinc-700 dark:text-zinc-300">

          <li className="flex gap-3 items-start">
            <Step n={1} />
            <div className="flex flex-col gap-2">
              <span>Add the bot to your Discord server.</span>
              <a
                href="/api/discord/install"
                className="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                Add bot to Discord
              </a>
            </div>
          </li>

          <li className="flex gap-3 items-start">
            <Step n={2} />
            <div className="flex flex-col gap-2 w-full">
              <span>Copy your Discord Server ID and paste it here.</span>
              <input
                id="guild-id-input"
                type="text"
                placeholder="e.g. 1292918593104777298"
                value={guildId}
                onChange={e => handleGuildIdChange(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Enable Developer Mode in Discord, right-click your server, then Copy Server ID.
              </p>
            </div>
          </li>

          <li className="flex gap-3 items-start">
            <Step n={3} />
            <span>Upload your documentation using the form below.</span>
          </li>

          <li className="flex gap-3 items-start">
            <Step n={4} />
            <span>
              Use{' '}
              <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                /ask
              </code>{' '}
              in that Discord server.
            </span>
          </li>

        </ol>
      </section>

      {/* ── Import panel ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold">Add Documentation</h2>

        <div className="flex gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 text-sm">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex-1 rounded-md py-1.5 font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {renderPanel()}
      </section>

      {/* ── Document list ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Uploaded Documents</h2>
        {!guildId.trim() ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            Enter a Discord Server ID above to see its documents.
          </p>
        ) : docsLoading ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents yet for this server.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map(doc => (
              <li
                key={doc.id}
                className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium truncate">{doc.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-zinc-500 dark:text-zinc-400">
                      {doc.source_type}
                    </span>
                    <span className="text-zinc-400 text-xs">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {doc.source_url && (
                  <a
                    href={doc.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-400 hover:underline truncate"
                  >
                    {doc.source_url}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}
