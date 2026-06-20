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

export default function DocsForm() {

  // ── Guild ID ──────────────────────────────────────────────────────────────
  const [guildId, setGuildId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(LS_KEY) ?? '';
  });

  function handleGuildIdChange(value: string) {
    setGuildId(value);
    localStorage.setItem(LS_KEY, value);
  }

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('guild_id')?.trim();
    if (param) handleGuildIdChange(param);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Docs list ─────────────────────────────────────────────────────────────
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

  // ── Paste tab ─────────────────────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState<Tab>('url');
  const [title,        setTitle]        = useState('');
  const [content,      setContent]      = useState('');
  const [pasteStatus,  setPasteStatus]  = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [pasteMessage, setPasteMessage] = useState('');

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!guildId.trim()) {
      setPasteStatus('error');
      setPasteMessage('Enter a Discord Server ID above first.');
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
    if (activeTab === 'file')  return <FileImportForm guildId={guildId.trim()} onSuccess={fetchDocs} />;
    if (activeTab === 'paste') return (
      <form onSubmit={handlePaste} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Document title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          className={INPUT_CLS}
        />
        <textarea
          placeholder="Paste documentation text here…"
          value={content}
          onChange={e => setContent(e.target.value)}
          required
          rows={10}
          className={`${INPUT_CLS} font-mono resize-y`}
        />
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={pasteStatus === 'saving'} className={BTN_PRIMARY}>
            {pasteStatus === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {pasteMessage && (
            <StatusMessage ok={pasteStatus === 'ok'} message={pasteMessage} />
          )}
        </div>
      </form>
    );
    return <UrlImportForm guildId={guildId.trim()} onSuccess={fetchDocs} />;
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl w-full">

      {/* ── Setup card ───────────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold">Setup</h2>
        <ol className="flex flex-col gap-5 mt-4">

          <Step n={1} title="Add the bot to your Discord server">
            <a href="/api/discord/install" className={BTN_PRIMARY + ' self-start mt-1'}>
              Add bot to Discord
            </a>
          </Step>

          <Step n={2} title="Enter your Discord Server ID">
            <div className="flex flex-col gap-2 mt-1">
              <input
                id="guild-id-input"
                type="text"
                placeholder="e.g. 1292918593104777298"
                value={guildId}
                onChange={e => handleGuildIdChange(e.target.value)}
                className={INPUT_CLS + ' font-mono'}
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Enable Developer Mode in Discord → right-click your server → Copy Server ID.
              </p>
            </div>
          </Step>

          <Step n={3} title="Upload documentation">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">Use the import form below.</p>
          </Step>

          <Step n={4} title="Use /ask in Discord">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              Your server members can now run{' '}
              <code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">/ask</code>{' '}
              to query your documentation.
            </p>
          </Step>

        </ol>
      </Card>

      {/* ── Import card ──────────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold">Add Documentation</h2>
        <div className="flex gap-1 mt-4 rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1 text-sm">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex-1 rounded-md py-1.5 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-4">{renderPanel()}</div>
      </Card>

      {/* ── Documents card ───────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-base font-semibold">Uploaded Documents</h2>
        <div className="mt-4">
          {!guildId.trim() ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Enter a Discord Server ID above to see its documents.
            </p>
          ) : docsLoading ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No documents yet. Import some above.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {docs.map(doc => (
                <li key={doc.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-medium text-sm truncate text-zinc-900 dark:text-zinc-100">{doc.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-zinc-500 dark:text-zinc-400 font-medium">
                        {doc.source_type}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {doc.source_url && (
                    <a
                      href={doc.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-500 dark:text-indigo-400 hover:underline underline-offset-2 truncate"
                    >
                      {doc.source_url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

export const INPUT_CLS = [
  'w-full rounded-lg border border-zinc-300 dark:border-zinc-700',
  'bg-white dark:bg-zinc-900 px-3 py-2 text-sm',
  'outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
  'placeholder:text-zinc-400 dark:placeholder:text-zinc-500',
  'transition-shadow',
].join(' ');

export const BTN_PRIMARY = [
  'inline-flex items-center justify-center px-4 py-2 rounded-lg',
  'bg-indigo-600 text-white text-sm font-medium',
  'hover:bg-indigo-700 active:bg-indigo-800',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-colors shadow-sm',
].join(' ');

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-4 items-start">
      <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs flex items-center justify-center font-semibold tabular-nums">
        {n}
      </span>
      <div className="flex flex-col flex-1">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        {children}
      </div>
    </li>
  );
}

export function StatusMessage({ ok, message }: { ok: boolean; message: string }) {
  return (
    <span className={`text-sm ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {ok ? '✓ ' : ''}{message}
    </span>
  );
}
