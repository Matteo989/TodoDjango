/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Keep node-only libraries out of the client/edge bundles.
  serverExternalPackages: ['bullmq', 'ioredis', '@prisma/client', 'bcryptjs'],
  experimental: {
    // Video uploads travel through server actions/route handlers.
    serverActions: { bodySizeLimit: '512mb' },
  },
};

export default nextConfig;
