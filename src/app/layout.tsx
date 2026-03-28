import type { Metadata } from "next";
import Link from "next/link";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Baba Mimoun Ops",
  description: "OpenClaw operational dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <div style={{ background: "#020617", borderBottom: "1px solid #1e293b" }}>
          <nav style={{ maxWidth: 980, margin: "0 auto", padding: "10px 16px", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/" style={{ color: "#cbd5e1", textDecoration: "none" }}>Dashboard</Link>
            <Link href="/cost" style={{ color: "#93c5fd", textDecoration: "none" }}>Cost</Link>
          </nav>
        </div>
        {children}
      </body>
    </html>
  );
}
