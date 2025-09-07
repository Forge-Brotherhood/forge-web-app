import type { NextConfig } from "next";

// @ts-ignore - Bundle analyzer doesn't have TypeScript definitions
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  
  // Webpack optimizations for large string handling
  webpack: (config, { dev, isServer }) => {
    // Simple optimization focused on media libraries
    if (config.optimization?.splitChunks) {
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks.cacheGroups,
          // Separate media libraries to reduce main bundle
          media: {
            test: /[\\/]node_modules[\\/](@mux|photoswipe)[\\/]/,
            name: 'media-libs',
            chunks: 'all',
            priority: 10,
          },
        },
      };
    }

    return config;
  },

  // Enable experimental features for better performance
  experimental: {
    // Enable webpack memory optimization
    optimizeCss: true,
    // Better tree shaking
    optimizePackageImports: ['@mux/mux-player-react', 'lucide-react'],
  },
};

export default withBundleAnalyzer(nextConfig);