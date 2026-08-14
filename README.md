# Ring Try-On

Virtual ring try-on in the browser. Your camera tracks your hand, and a ring is
rendered as real 3D geometry onto your finger — sized in millimetres, oriented in
3D, and correctly hidden where your hand passes in front of it.

Everything runs on-device. No video is uploaded.

## Running it

```bash
npm install     # also fetches the MediaPipe runtime + model into public/
npm run dev     # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run verify` | Solver + geometry test suites (no camera needed) |
| `npm run setup:mediapipe` | Re-fetch the tracking runtime and model |

The MediaPipe WASM runtime and the 7.5 MB hand-landmarker model are **not** in
git — they are 41 MB of fully reproducible binaries, restored by
`scripts/fetch-mediapipe.mjs` on install. They are served from this origin rather
than a CDN so the try-on works offline, under a strict CSP, and without a third
party learning that anyone opened the page.

## Deploying to Vercel

Works with no configuration — import the repo and deploy. Framework detection picks
up Next.js, and `postinstall` fetches the tracking assets during install, before the
build runs.

Two things worth knowing, both already handled:

- **The 47 MB of tracking assets are not in git.** They are restored on the build
  server by `scripts/fetch-mediapipe.mjs`, which needs outbound network access to
  `storage.googleapis.com`. On a build server (`CI` or `VERCEL` set) a failed or
  truncated download **fails the build deliberately**. Deploying without them would
  produce a green build and a try-on that silently cannot track anything — nothing
  would surface until a visitor opened their camera. If your build environment has
  no network access, commit `public/mediapipe/` instead and drop it from
  `.gitignore`.
- **They are cached for a year.** A visitor downloads an 11.7 MB WASM runtime plus a
  7.5 MB model for rings, and 5.5 MB more for necklaces. Next.js serves `public/`
  with `max-age=0` by default, which would revalidate all of it on every visit, so
  `next.config.ts` marks `/mediapipe/*` immutable. They are versioned artifacts —
  the runtime is pinned by the installed package and each model URL carries its own
  version — so a different version is a different file.

The camera needs a secure context, which Vercel provides. Nothing runs server-side:
tracking and rendering are entirely in the browser, and no video is uploaded, so
there is nothing to configure and no environment variables to set.

Verified by building a clean `git archive` checkout with `npm ci` and serving it: all
seven routes return 200, both models and the WASM runtime are reachable, and the
cache headers apply to the assets without touching the pages.

## How the placement works

Two landmark sets come back from MediaPipe each frame, and each is reliable at
exactly one thing:

- **Where** the ring goes comes from the normalized *image* landmarks. Anchoring
  to the image guarantees the band sits on the pixels of the finger, with no
  dependence on an unknown camera intrinsic. The seat is
  `lerp(MCP, PIP, positionAlongFinger)` — recomputed every frame, never a fixed
  screen coordinate.
- **Which way it is turned** comes from the metric *world* landmarks, which carry
  real 3D structure that flat image coordinates cannot express. The band's axis is
  the finger's own direction; the roll comes from the palm plane.
- **How big** it is comes from both. The world landmarks measure the finger in
  millimetres; a least-squares fit between the two spaces gives pixels-per-metre.
  That is what lets a US 7 render as an actual US 7.

Depth is referenced to the palm, so the band has a real Z — not pinned to a
plane — and lives in the same 3D space as the occluders. Displacing it in Z would
move it on screen, so the position and scale are both compensated by the
perspective divide; the test suite asserts that identity to 1e-9.

### Occlusion

A ring is a closed loop, so half of it is behind your finger — but the renderer
has no idea your finger exists. So there is a depth-only stand-in for the hand: a
cylinder through the band, tapered capsules down every finger, and a slab for the
palm, all writing depth and no colour. Anything behind them fails the depth test
and vanishes behind a hand that was never drawn. A translucent sleeve just outside
the band darkens the skin at its edges — the contact shadow that stops the ring
looking stuck on top of the picture.

### Sizing accuracy

A camera alone cannot know how big your hand is. MediaPipe's world landmarks are
regressed against a canonical hand, so for anyone whose hands are not average the
millimetres carry a constant error that no filtering removes.

Two ways to fix it, both in the studio's sizing panel:

- **Bank card.** Every card is 85.60 mm wide by ISO/IEC 7810. Hold one against
  your fingers, line it up with the outline, and that one frame gives true scale.
- **A size you already know.** Enter it and every later measurement is corrected
  to match.

The panel labels the reading **Estimate** or **Exact** so it is always clear which
you are looking at.

## Testing

`npm run verify` runs two suites against synthetic data, so neither needs a
camera:

- **Solver** — drives the pose solver with a synthetic hand built from known
  anthropometric dimensions and a real pinhole projection, then asserts scale
  recovery, finger measurement, seat position, orientation, true-scale sizing,
  metric bias, mirroring, depth placement, chirality on a flat hand, a full 360°
  rotation sweep, and a pose matrix (tilts, rolls, near/far, bent finger, frame
  edge, mirrored selfie).
- **Geometry** — checks every generated ring for degenerate triangles, inverted
  winding via signed volume, physically plausible band dimensions, and that the
  floral head clears its shank.

Press the **Show diagnostics** toggle in the studio to overlay the tracked
skeleton, the finger axis, the ring's bounding box, and the numeric rotation,
scale and measured width.

## Layout

```
src/lib/hand/          tracking: landmarks, filtering, projection, pose solver
src/lib/rings/         ring geometry, catalogue, sizing tables
src/components/three/  3D rendering: rings, materials, occluders, shadows
src/components/tryon/  the try-on studio UI
src/components/site/   catalogue and product pages
scripts/               verification suites and asset setup
```

## Known limitations

- Occlusion is geometric, not per-pixel. Commercial try-ons use a hand
  segmentation mask, which is exact at every angle; capsules approximate it.
- One hand at a time.
- MediaPipe's relative depth is its noisiest output, so neighbouring-finger
  occlusion is biased slightly backwards — the failure mode is showing a little
  too much ring rather than deleting part of it.
- Measuring the finger from video pixels is off by default; it is unbiased when it
  works, and undersizes the ring when it mistakes a crease for the finger's edge.
