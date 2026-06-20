'use client';

import { useState } from 'react';
import { BTN_PRIMARY, INPUT_CLS, StatusMessage } from './DocsForm';

interface Props {
  guildId: string;
  onSuccess: () => void;
}

export default function UrlImportForm({ guildId, onSuccess }: Props) {
  const [url,      setUrl]      = useState('');
  const [fullSite, setFullSite] = useState(false);
  const [status,   setStatus]   = useState<'idle' | 'importing' | 'ok' | 'error'>('idle');
  const [message,  setMessage]  = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!guildId) {
      setStatus('error');
      setMessage('Enter a Discord Server ID first.');
      return;
    }
    setStatus('importing');
    setMessage('');

    const res  = await fetch('/api/docs/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guild_id: guildId, url, mode: fullSite ? 'site_index' : 'single_page' }),
    });
    const data = await res.json();

    if (res.ok) {
      setStatus('ok');
      const extra = data.replaced > 0 ? `, ${data.replaced} updated` : '';
      setMessage(
        fullSite
          ? `Imported ${data.imported} page(s)${extra}, ${data.skipped} skipped — ${data.chunks} chunk(s) stored.`
          : `Imported — ${data.chunks} chunk(s) stored.`,
      );
      setUrl('');
      onSuccess();
    } else {
      setStatus('error');
      setMessage(data.error ?? 'Import failed.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input
        type="url"
        placeholder="https://example.com/docs/page"
        value={url}
        onChange={e => setUrl(e.target.value)}
        required
        className={INPUT_CLS}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Import scope</legend>
        <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
          <input type="radio" name="scope" checked={!fullSite} onChange={() => setFullSite(false)} className="accent-indigo-600" />
          <span className="text-zinc-700 dark:text-zinc-300">Import only this page</span>
        </label>
        <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
          <input type="radio" name="scope" checked={fullSite} onChange={() => setFullSite(true)} className="accent-indigo-600" />
          <span className="text-zinc-700 dark:text-zinc-300">
            Import the full documentation site{' '}
            <span className="text-zinc-400 dark:text-zinc-500">(max 100 pages)</span>
          </span>
        </label>
      </fieldset>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={status === 'importing'} className={BTN_PRIMARY}>
          {status === 'importing' ? 'Importing…' : 'Import'}
        </button>
        {message && <StatusMessage ok={status === 'ok'} message={message} />}
      </div>

      {fullSite && status === 'idle' && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Crawls all pages from the site index and imports them. This may take a minute.
        </p>
      )}
    </form>
  );
}
