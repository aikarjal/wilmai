import type { MetadataRoute } from "next";

const BASE = "https://wilm.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${BASE}/en`,
      changeFrequency: "weekly",
      priority: 1,
      alternates: {
        languages: {
          en: `${BASE}/en`,
          fi: `${BASE}/fi`
        }
      }
    },
    {
      url: `${BASE}/fi`,
      changeFrequency: "weekly",
      priority: 1,
      alternates: {
        languages: {
          en: `${BASE}/en`,
          fi: `${BASE}/fi`
        }
      }
    }
  ];
}
