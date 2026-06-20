'use client';

import { useRef, useState } from 'react';

interface Props {
  guildId: string;
  onSuccess: () => void;
}

export default function FileImportForm({ guildId, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'ok' | 'error'>('idle');
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

    const formData = new FormData();
    formData.append('file', file);
    formData.append('guild_id', guildId);

    const res = await fetch('/api/docs/import-file', {
      method: 'POST',
      body: formData,
    });

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
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.docx"
        onChange={handleChange}
        style={{ display: 'none' }}
      />

      <div
        onClick={openPicker}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && openPicker()}
        className={[
          'flex items-center justify-center gap-2 rounded-lg border-2 border-dashed',
          'px-6 py-8 text-sm transition-colors select-none',
          status === 'uploading'
            ? 'border-zinc-300 dark:border-zinc-700 text-zinc-400 cursor-wait'
            : 'border-zinc-300 dark:border-zinc-700 cursor-pointer',
          status !== 'uploading'
            ? 'hover:border-indigo-400 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 text-zinc-500 dark:text-zinc-400'
            : '',
        ].join(' ')}
      >
        {status === 'uploading' ? (
          <span>Uploading…</span>
        ) : (
          <>
            <span>Click to choose a file</span>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">.txt · .md · .docx</span>
          </>
        )}
      </div>

      {message && (
        <span className={`text-sm ${status === 'error' ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
          {message}
        </span>
      )}
    </div>
  );
}
