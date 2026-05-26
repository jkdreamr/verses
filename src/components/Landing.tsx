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
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-8 pb-32 pt-10">

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <header className="flex items-baseline justify-between">
        <span className="font-serif text-3xl tracking-tight text-ink-text">
          Verses
        </span>
        <nav className="flex items-center gap-8 text-sm text-ink-mute">
          <a href="#features" className="transition-colors duration-150 hover:text-ink-text">
            About
          </a>
          <Link
            href="/app"
            className="border border-ink-text/30 px-4 py-1.5 text-sm text-ink-text transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
          >
            Open app →
          </Link>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="mt-32 sm:mt-40">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-gold">
          Songwriting tool
        </p>
        <h1 className="mt-6 max-w-3xl font-serif text-6xl leading-[1.05] tracking-tight text-ink-text sm:text-7xl lg:text-8xl">
          Write the lyric.
          <br />
          Play the chord.
          <br />
          Keep going.
        </h1>
        <p className="mt-10 max-w-[58ch] text-base leading-relaxed text-ink-mute sm:text-lg">
          Verses is a quiet writing surface for songwriters. Rhymes on demand.
          A beat loop that never steals focus. Your notebook page, scanned and
          typed. Nothing more.
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            href="/app"
            className="border border-amber-gold/60 bg-amber-gold/10 px-6 py-3 text-sm text-amber-gold transition-colors duration-150 hover:bg-amber-gold/20"
          >
            Open in browser
          </Link>
          <a
            href="#download"
            className="border border-ink-text/20 px-6 py-3 text-sm text-ink-text transition-colors duration-150 hover:border-amber-gold/50 hover:text-amber-gold"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <div className="mt-40 border-t border-ink-line" />

      {/* ── Features ───────────────────────────────────────────────────── */}
      <section id="features" className="mt-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-gold">
          Features
        </p>
        <div className="mt-14 grid gap-x-16 gap-y-16 sm:grid-cols-2">
          <Feature
            k="01"
            title="Rhymes on demand"
            body="Highlight any word. A small chip floats in. Click for perfect rhymes, near rhymes, and sound-alikes — grouped by syllables, sorted by how often people actually say them."
          />
          <Feature
            k="02"
            title="Write to the beat"
            body="Paste a YouTube link. The bar sits at the bottom. ⌘P toggles play without ever stealing your cursor. Loop it. Keep going."
          />
          <Feature
            k="03"
            title="Page to screen"
            body="Took it to paper first? Snap a photo and Verses runs OCR in your browser — nothing leaves the device — and drops the words straight into your draft."
          />
          <Feature
            k="04"
            title="Quiet, by design"
            body="No streaks. No notifications. No AI suggestions. Saves every ten seconds. Version history you can restore. Export when you're ready."
          />
        </div>
      </section>

      {/* ── New features highlight ─────────────────────────────────────── */}
      <section className="mt-40">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-gold">
          New in Verses
        </p>
        <div className="mt-14 grid gap-px border border-ink-line sm:grid-cols-2">
          <NewFeature
            index="05"
            title="Perform Mode"
            body="A full-screen teleprompter for your lyrics. Auto-scroll locks to your pace. Dark stage, white words. Nothing else on screen."
          />
          <NewFeature
            index="06"
            title="Voice to Score"
            body="Hum a melody or speak a phrase. Verses transcribes your voice into notation and drops it into your song as a chord or lyric suggestion."
          />
        </div>
      </section>

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <div className="mt-40 border-t border-ink-line" />

      {/* ── Download ───────────────────────────────────────────────────── */}
      <section id="download" className="mt-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-gold">
          Get Verses
        </p>
        <h2 className="mt-6 font-serif text-4xl tracking-tight text-ink-text sm:text-5xl">
          On every surface you write on.
        </h2>
        <div className="mt-14 flex flex-col divide-y divide-ink-line border-y border-ink-line">
          <DownloadOption
            label="Web"
            tag="Open instantly · no install"
            href="/app"
            cta="Open →"
            primary
          />
          <DownloadOption
            label="Install as app"
            tag="PWA · Chrome, Edge, Safari"
            href="/app"
            note="Click ⤓ in the address bar to install Verses with its own dock icon."
            cta="Open →"
          />
          <DownloadOption
            label="macOS · Windows · Linux"
            tag="Native · Tauri"
            href="https://github.com/jkdreamr/verses/releases"
            note="Tiny native binaries. .dmg, .exe, and .AppImage on the GitHub releases page."
            cta="Releases →"
            external
          />
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="mt-32 flex flex-wrap items-baseline justify-between gap-4 border-t border-ink-line pt-8">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-mute">
          Built by{" "}
          <a
            href="https://github.com/jkdreamr/verses"
            className="text-ink-mute underline decoration-ink-line underline-offset-4 transition-colors duration-150 hover:text-ink-text"
          >
            @jkdreamr
          </a>
        </span>
        <Link
          href="/app"
          className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-mute transition-colors duration-150 hover:text-amber-gold"
        >
          Open app →
        </Link>
      </footer>
    </main>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

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
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-gold">
        {k}
      </p>
      <h3 className="mt-4 font-serif text-2xl tracking-tight text-ink-text">
        {title}
      </h3>
      <p className="mt-4 text-sm leading-relaxed text-ink-mute">{body}</p>
    </div>
  );
}

function NewFeature({
  index,
  title,
  body,
}: {
  index: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-ink-surface px-10 py-12">
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-amber-gold">
        {index}
      </p>
      <h3 className="mt-5 font-serif text-3xl tracking-tight text-ink-text sm:text-4xl">
        {title}
      </h3>
      <p className="mt-5 max-w-[42ch] text-sm leading-relaxed text-ink-mute">
        {body}
      </p>
    </div>
  );
}

function DownloadOption({
  label,
  tag,
  href,
  note,
  cta,
  primary,
  external,
}: {
  label: string;
  tag: string;
  href: string;
  note?: string;
  cta: string;
  primary?: boolean;
  external?: boolean;
}) {
  const Cmp = external ? "a" : Link;
  const extra = external ? { target: "_blank", rel: "noreferrer" } : {};
  return (
    <Cmp
      href={href}
      {...(extra as object)}
      className={`group flex items-baseline justify-between gap-6 py-6 transition-colors duration-150 ${
        primary ? "text-amber-gold" : "text-ink-text hover:text-amber-gold"
      }`}
    >
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-8">
        <span
          className={`font-serif text-xl tracking-tight ${
            primary ? "text-amber-gold" : "text-ink-text"
          }`}
        >
          {label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink-mute">
          {tag}
        </span>
        {note ? (
          <span className="hidden text-sm text-ink-mute sm:inline">{note}</span>
        ) : null}
      </div>
      <span
        className={`shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors duration-150 ${
          primary
            ? "text-amber-gold"
            : "text-ink-mute group-hover:text-amber-gold"
        }`}
      >
        {cta}
      </span>
    </Cmp>
  );
}
