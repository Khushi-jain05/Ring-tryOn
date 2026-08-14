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

  async headers() {
    return [
      {
        /**
         * The tracking runtime and models are the largest thing this app serves —
         * an 11.7 MB WASM binary plus a 7.5 MB model for rings, and another 5.5 MB
         * for necklaces. Next.js serves `public/` with `max-age=0` by default, so
         * without this every visit revalidates all of it.
         *
         * They are safe to cache forever because they are versioned artifacts, not
         * content that changes: the WASM is pinned by the installed package version
         * and each model URL carries its own version number. A different version is
         * a different file at a different path.
         */
        source: "/mediapipe/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
