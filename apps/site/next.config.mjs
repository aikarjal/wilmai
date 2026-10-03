const dev = process.env.NODE_ENV !== "production";

// The site is static: Next's own inline bootstrap scripts need 'unsafe-inline'
// (nonces would make every page dynamic); everything else is locked down.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  // The GitHub stars button.
  "frame-src https://ghbtns.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  },
  async redirects() {
    return [
      // Claude Desktop extension: the rolling "claude-desktop" release, which
      // .github/workflows/release-mcpb.yml updates on every CLI release.
      {
        source: "/get/claude",
        destination: "https://github.com/aikarjal/wilmai/releases/download/claude-desktop/wilmai.mcpb",
        permanent: false
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.wilm.ai" }],
        destination: "https://wilm.ai/:path*",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
