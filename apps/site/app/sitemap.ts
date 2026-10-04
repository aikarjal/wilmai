import type { MetadataRoute } from "next";

// Written once at build time (the site is static files).
export const dynamic = "force-static";

const BASE = "https://wilm.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return (["en", "fi"] as const).map((lang) => ({
    url: `${BASE}/${lang}`,
    changeFrequency: "weekly",
    priority: 1,
    alternates: {
      languages: {
        en: `${BASE}/en`,
        fi: `${BASE}/fi`
      }
    }
  }));
}
