import type { Metadata, Viewport } from "next";
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
  manifest: "/manifest.webmanifest",
  applicationName: "Verses",
  appleWebApp: {
    capable: true,
    title: "Verses",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
  ],
};

// Inline script to apply theme before hydration so we never flash the wrong theme
const themeBootstrap = `
(function(){try{var t=localStorage.getItem('verses:theme');if(t==='light'){document.documentElement.classList.add('light')}}catch(e){}})();
`;

const swBootstrap = `
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${lora.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: swBootstrap }} />
      </head>
      <body className="min-h-screen bg-ink text-ink-text antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
