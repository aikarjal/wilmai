/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // lib/tenants.ts imports the tenant list from packages/wilma-client.
    externalDir: true,
  },
};

export default nextConfig;
