"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useToast } from "./Toast";

export function LoginForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  const configured = isSupabaseConfigured();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configured) {
      toast("Supabase isn't configured — try guest mode instead.", "error");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const fn =
        mode === "signin"
          ? supabase.auth.signInWithPassword.bind(supabase.auth)
          : supabase.auth.signUp.bind(supabase.auth);
      const { error } = await fn({ email, password });
      if (error) {
        toast(error.message, "error");
      } else if (mode === "signup") {
        toast("Check your email to confirm your account.", "ok");
      } else {
        router.push("/app");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    if (!configured) {
      toast("Supabase isn't configured — try guest mode instead.", "error");
      return;
    }
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {!configured ? (
        <p className="rounded border border-ink-line bg-ink-surface px-3 py-2 text-xs text-ink-mute">
          Supabase env vars aren&apos;t set. You can still write songs in guest
          mode — they&apos;ll save to your browser.
        </p>
      ) : null}
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="Email"
        className="rounded border border-ink-line bg-ink-surface px-3 py-2 text-sm focus:border-amber-gold/60"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        required
        autoComplete={mode === "signin" ? "current-password" : "new-password"}
        placeholder="Password"
        className="rounded border border-ink-line bg-ink-surface px-3 py-2 text-sm focus:border-amber-gold/60"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-amber-gold/50 bg-amber-gold/10 px-3 py-2 text-sm text-amber-gold transition-colors duration-150 hover:bg-amber-gold/20 disabled:opacity-50"
      >
        {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        onClick={onGoogle}
        className="rounded border border-ink-line bg-ink-surface px-3 py-2 text-sm transition-colors duration-150 hover:border-ink-mute"
      >
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="text-xs text-ink-mute hover:text-ink-text"
      >
        {mode === "signin"
          ? "No account? Create one →"
          : "Already have an account? Sign in →"}
      </button>
    </form>
  );
}
