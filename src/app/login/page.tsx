import { LoginForm } from "@/components/LoginForm";
import Link from "next/link";

export const metadata = { title: "Sign in — Verses" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center font-serif text-2xl tracking-tight text-amber-gold"
        >
          Verses
        </Link>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-ink-mute">
          You can also{" "}
          <Link href="/editor" className="underline hover:text-ink-text">
            keep writing as a guest
          </Link>
          . Songs save to this browser.
        </p>
      </div>
    </main>
  );
}
