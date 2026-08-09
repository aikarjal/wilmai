import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Atkinson_Hyperlegible,
  Caveat,
  JetBrains_Mono
} from "next/font/google";
import { dictionaries, locales, isLang, type Lang } from "../../lib/i18n";
import "../globals.css";

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

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export function generateMetadata({
  params
}: {
  params: { lang: string };
}): Metadata {
  const lang: Lang = isLang(params.lang) ? params.lang : "en";
  const dict = dictionaries[lang];
  return {
    metadataBase: new URL("https://wilm.ai"),
    title: dict.meta.title,
    description: dict.meta.description,
    alternates: {
      canonical: `/${lang}`,
      languages: {
        en: "/en",
        fi: "/fi",
        "x-default": "/"
      }
    }
  };
}

export default function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { lang: string };
}) {
  const lang: Lang = isLang(params.lang) ? params.lang : "en";
  return (
    <html
      lang={lang}
      className={`${display.variable} ${body.variable} ${hand.variable} ${mono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
