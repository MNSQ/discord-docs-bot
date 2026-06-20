'use client';

import { useRef, useState } from 'react';
import { BTN_PRIMARY, StatusMessage } from './DocsForm';

interface Props {
  guildId: string;
  onSuccess: () => void;
}

export default function FileImportForm({ guildId, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status,  setStatus]  = useState<'idle' | 'uploading' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  function openPicker() {
    if (status === 'uploading') return;
    if (!guildId) {
      setStatus('error');
      setMessage('Enter a Discord Server ID first.');
      return;
    }
    setStatus('idle');
    setMessage('');
    inputRef.current?.click();
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('uploading');
    setMessage('');

    const form = new FormData();
    form.append('file', file);
    form.append('guild_id', guildId);

    const res  = await fetch('/api/docs/import-file', { method: 'POST', body: form });
    const data = await res.json();

    if (inputRef.current) inputRef.current.value = '';

    if (res.ok) {
      setStatus('ok');
      setMessage(`"${data.title}" imported — ${data.chunks} chunk(s) stored.`);
      onSuccess();
    } else {
      setStatus('error');
      setMessage(data.error ?? 'Upload failed.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input ref={inputRef} type="file" accept=".txt,.md,.docx" onChange={handleChange} className="hidden" />

      <button
        type="button"
        onClick={openPicker}
        disabled={status === 'uploading'}
        className={[
          'w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10',
          'text-sm transition-colors cursor-pointer disabled:cursor-wait',
          'border-zinc-300 dark:border-zinc-700',
          'hover:border-indigo-400 dark:hover:border-indigo-600',
          'hover:bg-indigo-50 dark:hover:bg-indigo-950/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
          'text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400',
          'disabled:opacity-60',
        ].join(' ')}
      >
        {status === 'uploading' ? (
          <span>Uploading…</span>
        ) : (
          <>
            <span className="font-medium">Click to choose a file</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">.txt · .md · .docx</span>
          </>
        )}
      </button>

      {message && <StatusMessage ok={status === 'ok'} message={message} />}
    </div>
  );
}

export { BTN_PRIMARY };
