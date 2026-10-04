import type { MetadataRoute } from "next";

// Written once at build time (the site is static files).
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://wilm.ai/sitemap.xml"
  };
}
