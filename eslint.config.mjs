import { defineConfig, globalIgnores } from "eslint/config";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs, so they are spread directly
// rather than wrapped in FlatCompat — the compat layer looks for a legacy
// `.eslintrc`-shaped export that this version no longer publishes.
const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    // Output of `npm run build:check`, which builds to its own directory so a
    // verification build cannot corrupt a running dev server's cache.
    ".next-check/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Emscripten output vendored from @mediapipe/tasks-vision. Machine
    // generated, never edited by hand, and it trips every rule we have.
    "public/mediapipe/**",
  ]),
  ...coreWebVitals,
  ...typescript,
]);

export default eslintConfig;
