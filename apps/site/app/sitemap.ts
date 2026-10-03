import type { MetadataRoute } from "next";

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
