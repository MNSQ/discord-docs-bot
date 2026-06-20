'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function DocsForm({ docs }: { docs: Doc[] }) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('url');

  // Paste-form state
  const [title,        setTitle]        = useState('');
  const [content,      setContent]      = useState('');
  const [pasteStatus,  setPasteStatus]  = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [pasteMessage, setPasteMessage] = useState('');

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    setPasteStatus('saving');
    setPasteMessage('');

    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    const data = await res.json();

    if (res.ok) {
      setPasteStatus('ok');
      setPasteMessage(`Saved — ${data.chunks} chunk(s) stored.`);
      setTitle('');
      setContent('');
      router.refresh();
    } else {
      setPasteStatus('error');
      setPasteMessage(data.error ?? 'Something went wrong.');
    }
  }

  // Render only the active tab's content — one branch, explicit.
  function renderPanel() {
    if (activeTab === 'file') {
      return <FileImportForm />;
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

    // Default: 'url'
    return <UrlImportForm />;
  }

  return (
    <div className="flex flex-col gap-10 max-w-2xl w-full">

      {/* ── Import panel ───────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h2 className="text-xl font-semibold">Add Documentation</h2>

        {/* Tab bar */}
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

        {/* Active panel */}
        {renderPanel()}
      </section>

      {/* ── Document list ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Uploaded Documents</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents yet.</p>
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
