import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Cache Components (Next.js 16's new caching model) is left off so the
  // classic, widely-documented route-segment config (`export const dynamic`,
  // `revalidate`, `maxDuration`) works as written across this codebase —
  // the more predictable choice for a small free-tier production app.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
