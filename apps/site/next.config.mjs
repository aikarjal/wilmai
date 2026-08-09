/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
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
