"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Marketing landing page — light theme by default, regardless of the user's
 * stored app theme. The theme toggle on the app pages controls the *editor*
 * experience; this site is always sun-on-paper.
 */
export function Landing() {
  useEffect(() => {
    // Force light theme on the marketing site without persisting.
    const html = document.documentElement;
    const wasLight = html.classList.contains("light");
    html.classList.add("light");
    return () => {
      if (!wasLight) html.classList.remove("light");
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6 pb-24 pt-10">
      <header className="flex items-baseline justify-between">
        <span className="font-serif text-2xl tracking-tight text-amber-gold">
          Verses
        </span>
        <nav className="flex items-center gap-5 text-sm text-ink-mute">
          <a href="#download" className="hover:text-ink-text">
            Download
          </a>
          <a href="#why" className="hover:text-ink-text">
            Why
          </a>
          <Link
            href="/app"
            className="rounded-full border border-amber-gold/60 px-4 py-1.5 text-amber-gold transition-colors duration-150 hover:bg-amber-gold/10"
          >
            Open app →
          </Link>
        </nav>
      </header>

      <section className="mt-24 sm:mt-32">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber-gold">
          A blank page with a pen
        </p>
        <h1 className="mt-4 font-serif text-5xl leading-[1.05] tracking-tight text-ink-text sm:text-6xl">
          Write the next song
          <br />
          like nothing else exists.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-mute">
          Verses is a quiet writing surface for songwriters. Rhymes when you
          highlight a word. A YouTube beat that never steals focus. OCR for the
          page in your notebook. No dashboards. No streaks. No noise.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/app"
            className="rounded-full border border-amber-gold/60 bg-amber-gold/10 px-6 py-3 text-sm font-medium text-amber-gold transition-colors duration-150 hover:bg-amber-gold/20"
          >
            Open in browser
          </Link>
          <a
            href="#download"
            className="rounded-full border border-ink-line px-6 py-3 text-sm font-medium text-ink-text transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
          >
            Download for desktop
          </a>
        </div>
      </section>

      <section id="why" className="mt-32 grid gap-x-10 gap-y-12 sm:grid-cols-2">
        <Feature
          k="01"
          title="Rhymes the moment you ask"
          body="Highlight any word. A small chip floats in. Click it for perfect rhymes, near rhymes, and sounds-alikes — grouped by syllables, sorted by how often people actually say them."
        />
        <Feature
          k="02"
          title="Write to the beat"
          body="Paste a YouTube link. The bar sits at the bottom. ⌘P toggles play without ever stealing your cursor. Loop it. Keep going."
        />
        <Feature
          k="03"
          title="Page-to-screen"
          body="Took it to paper first? Snap a photo and Verses runs OCR in your browser — nothing leaves the device — and drops the words straight into your draft."
        />
        <Feature
          k="04"
          title="Quiet, by design"
          body="No streaks, no notifications, no cards, no AI suggestions. Saves every ten seconds. Versions you can restore. Export when you're ready."
        />
      </section>

      <section id="download" className="mt-32">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber-gold">
          Get Verses
        </p>
        <h2 className="mt-4 font-serif text-4xl tracking-tight text-ink-text">
          On every surface you write on.
        </h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DownloadCard
            os="Web"
            tag="Open instantly"
            href="/app"
            note="Same app, no install."
            primary
          />
          <DownloadCard
            os="Install as app"
            tag="PWA · all platforms"
            href="/app"
            note="In Chrome / Edge / Safari, click ⤓ in the address bar to install Verses with its own dock icon."
          />
          <DownloadCard
            os="macOS · Windows · Linux"
            tag="Native (Tauri)"
            href="https://github.com/jkdreamr/verses/releases"
            note="Tiny native binaries. .dmg, .exe, and .AppImage on the GitHub releases page once published."
            external
          />
        </div>
      </section>

      <footer className="mt-24 flex flex-wrap items-baseline justify-between gap-4 border-t border-ink-line pt-8 text-xs text-ink-mute">
        <span>
          Built for songwriters by{" "}
          <a
            href="https://github.com/jkdreamr/verses"
            className="underline hover:text-ink-text"
          >
            @jkdreamr
          </a>
          .
        </span>
        <span>
          <Link href="/app" className="hover:text-ink-text">
            Open the app →
          </Link>
        </span>
      </footer>
    </main>
  );
}

function Feature({
  k,
  title,
  body,
}: {
  k: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-amber-gold">
        {k}
      </p>
      <h3 className="mt-3 font-serif text-2xl text-ink-text">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-mute">{body}</p>
    </div>
  );
}

function DownloadCard({
  os,
  tag,
  href,
  note,
  primary,
  external,
}: {
  os: string;
  tag: string;
  href: string;
  note: string;
  primary?: boolean;
  external?: boolean;
}) {
  const Cmp = external ? "a" : Link;
  const extra = external ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <Cmp
      href={href}
      {...extra}
      className={`group flex flex-col rounded-md border p-6 transition-colors duration-150 ${
        primary
          ? "border-amber-gold/60 bg-amber-gold/5 hover:bg-amber-gold/10"
          : "border-ink-line hover:border-amber-gold/60"
      }`}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-mute">
        {tag}
      </span>
      <span className="mt-2 font-serif text-2xl text-ink-text">{os}</span>
      <span className="mt-3 flex-1 text-sm text-ink-mute">{note}</span>
      <span className="mt-4 text-sm text-amber-gold">
        {primary ? "Open →" : external ? "Releases →" : "Open →"}
      </span>
    </Cmp>
  );
}
