'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UrlImportForm() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [fullSite, setFullSite] = useState(false);
  const [status, setStatus] = useState<'idle' | 'importing' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('importing');
    setMessage('');

    const res = await fetch('/api/docs/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode: fullSite ? 'site_index' : 'single_page' }),
    });

    const data = await res.json();

    if (res.ok) {
      setStatus('ok');
      const replaced = data.replaced > 0 ? `, ${data.replaced} updated` : '';
      setMessage(
        fullSite
          ? `Imported ${data.imported} page(s)${replaced}, ${data.skipped} skipped — ${data.chunks} chunk(s) stored.`
          : `Imported — ${data.chunks} chunk(s) stored.`,
      );
      setUrl('');
      router.refresh();
    } else {
      setStatus('error');
      setMessage(data.error ?? 'Import failed.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="url"
        placeholder="https://example.com/docs/page"
        value={url}
        onChange={e => setUrl(e.target.value)}
        required
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
          <input
            type="radio"
            name="scope"
            checked={!fullSite}
            onChange={() => setFullSite(false)}
            className="accent-indigo-600"
          />
          <span>Import only this page</span>
        </label>
        <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
          <input
            type="radio"
            name="scope"
            checked={fullSite}
            onChange={() => setFullSite(true)}
            className="accent-indigo-600"
          />
          <span>
            Import the full documentation site
            <span className="ml-1 text-zinc-400 dark:text-zinc-500 text-xs">(max 100 pages)</span>
          </span>
        </label>
      </div>

      <div className="flex items-center gap-4 mt-1">
        <button
          type="submit"
          disabled={status === 'importing'}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {status === 'importing' ? 'Importing…' : 'Import'}
        </button>
        {message && (
          <span
            className={`text-sm ${
              status === 'error' ? 'text-red-500' : 'text-green-600 dark:text-green-400'
            }`}
          >
            {message}
          </span>
        )}
      </div>

      {fullSite && status === 'idle' && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Discovers all pages on the site and imports them. This may take a minute.
        </p>
      )}
    </form>
  );
}
