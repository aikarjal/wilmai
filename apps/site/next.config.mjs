// The site is built as static files (out/) and served by Cloudflare Workers:
// see wrangler.jsonc. Headers and redirects live in public/_headers and
// public/_redirects; the "/" language redirect is in worker/index.ts.

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  reactStrictMode: true,
  poweredByHeader: false,
  // No image server on a static site; the images are small PNGs already.
  images: { unoptimized: true }
};

export default nextConfig;
