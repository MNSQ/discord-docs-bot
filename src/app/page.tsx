import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <span className="font-semibold text-lg tracking-tight">DocBot</span>
        <nav className="flex gap-6 text-sm">
          <Link href="/install" className="hover:underline underline-offset-4">Add to Discord</Link>
          <Link href="/dashboard" className="hover:underline underline-offset-4">Dashboard</Link>
        </nav>
      </header>

      <main className="flex flex-col flex-1 items-center justify-center px-6 text-center gap-10 py-24">
        <div className="flex flex-col gap-4 max-w-xl">
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            Answer your Discord questions<br />straight from your docs.
          </h1>
          <p className="text-lg text-zinc-500 dark:text-zinc-400">
            Add DocBot to your server, upload your documentation, and let your
            community get instant answers with <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">/ask</code>.
          </p>
        </div>

        <div className="flex gap-3 flex-wrap justify-center">
          <Link
            href="/install"
            className="px-5 py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
          >
            Add to Discord
          </Link>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            Open Dashboard
          </Link>
        </div>

        <div className="grid sm:grid-cols-3 gap-6 max-w-3xl w-full text-left mt-4">
          <Feature
            title="Upload your docs"
            body="Paste or upload text-based documentation directly in the dashboard. No PDFs or embeds needed to start."
          />
          <Feature
            title="Slash command /ask"
            body="Discord users type /ask followed by their question. DocBot searches your docs and replies in seconds."
          />
          <Feature
            title="Stays on-topic"
            body="If the answer isn't in your docs, DocBot says so. No hallucinations, no off-topic answers."
          />
        </div>
      </main>

      <footer className="text-center py-6 text-xs text-zinc-400 dark:text-zinc-600">
        DocBot &mdash; powered by Next.js &amp; Vercel
      </footer>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{body}</p>
    </div>
  );
}
