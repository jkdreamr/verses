import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Verses — distraction-free lyric writing",
  description:
    "A blank page with a pen, made for songwriters. Rhymes, beats, and your words.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <body className="min-h-screen bg-ink text-ink-text antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
