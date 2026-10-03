/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // Claude Desktop extension: always the latest GitHub release asset
      // (built and attached by .github/workflows/release-mcpb.yml).
      {
        source: "/get/claude",
        destination: "https://github.com/aikarjal/wilmai/releases/latest/download/wilmai.mcpb",
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
