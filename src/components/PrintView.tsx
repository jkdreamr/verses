"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localStore } from "@/lib/storage";
import type { Song } from "@/lib/types";

export function PrintView({ songId }: { songId: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isSupabaseConfigured()) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase
            .from("songs")
            .select("*")
            .eq("id", songId)
            .eq("user_id", user.id)
            .maybeSingle();
          if (!cancelled && data) {
            setSong(data as Song);
            setLoaded(true);
            return;
          }
        }
      }
      if (cancelled) return;
      setSong(localStore.getSong(songId));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [songId]);

  useEffect(() => {
    if (loaded && song) {
      // tiny delay to let fonts render
      const t = window.setTimeout(() => window.print(), 250);
      return () => window.clearTimeout(t);
    }
  }, [loaded, song]);

  if (!loaded) return null;
  if (!song) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-sm text-ink-mute">
        Song not found.
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl bg-white p-8 text-black print:p-0">
      <h1 className="serif mb-6 text-3xl">{song.title?.trim() || "Untitled"}</h1>
      <pre className="serif whitespace-pre-wrap break-words text-base leading-relaxed">
        {song.content || ""}
      </pre>
      <p className="print-hide mt-8 text-xs text-ink-mute">
        Print dialog should open automatically. If not, use ⌘P.
      </p>
    </main>
  );
}
