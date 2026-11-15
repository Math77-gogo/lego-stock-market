import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeScript } from "@/components/ThemeToggle";
import { ServiceWorker } from "@/components/ServiceWorker";

export const metadata: Metadata = {
  title: { default: "LEGO Stock Market", template: "%s · LEGO Stock Market" },
  description:
    "Track your LEGO collection like a stock portfolio, valued in CAD from BrickLink market data.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "LEGO Market", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#121213" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
