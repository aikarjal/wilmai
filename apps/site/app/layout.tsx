import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Atkinson_Hyperlegible,
  Caveat,
  JetBrains_Mono
} from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display"
});

const body = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-body"
});

const hand = Caveat({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hand"
});

const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "WilmAI — School data for AI agents",
  description:
    "Run Wilma from the CLI and wire it into agents like OpenAI, Claude Code, and OpenClaw."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${hand.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
