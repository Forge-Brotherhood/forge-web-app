import type { NextConfig } from "next";

// @ts-ignore - Bundle analyzer doesn't have TypeScript definitions
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Experimental features for better performance
  experimental: {
    // Better tree shaking and optimization
    optimizePackageImports: ['@mux/mux-player-react', 'lucide-react', '@radix-ui/*'],
    // Enable CSS optimization
    optimizeCss: true,
  },

  // Headers for Universal Links (iOS app association)
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);