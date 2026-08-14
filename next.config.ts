import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next build` and `next dev` share `.next` by default, and building while the
   * dev server is running overwrites artifacts it still depends on. The dev server
   * then returns 500 on every route with
   *
   *   Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
   *
   * which reads like a code fault, is not one, and survives until `.next` is
   * cleared. Setting BUILD_DIST_DIR gives a verification build its own directory so
   * it cannot touch a live dev server — see `npm run build:check`.
   */
  distDir: process.env.BUILD_DIST_DIR || ".next",
};

export default nextConfig;
