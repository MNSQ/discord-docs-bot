'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Doc = {
  id: string;
  title: string;
  source_type: string;
  created_at: string;
};

export default function DocsForm({ docs }: { docs: Doc[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setMessage('');

    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });

    const data = await res.json();

    if (res.ok) {
      setStatus('ok');
      setMessage(`Saved — ${data.chunks} chunk(s) stored.`);
      setTitle('');
      setContent('');
      router.refresh(); // re-run the Server Component to update the doc list
    } else {
      setStatus('error');
      setMessage(data.error ?? 'Something went wrong.');
    }
  }

  return (
    <div className="flex flex-col gap-10 max-w-2xl w-full">
      {/* Upload form */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Add Documentation</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
            rows={12}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
          />
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={status === 'saving'}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {status === 'saving' ? 'Saving…' : 'Add Documentation'}
            </button>
            {message && (
              <span className={`text-sm ${status === 'error' ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
                {message}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Existing docs */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Uploaded Documents</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map(doc => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-sm"
              >
                <span className="font-medium">{doc.title}</span>
                <span className="text-zinc-400 text-xs">
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
