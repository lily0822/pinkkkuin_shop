import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships a native addon (@img/sharp-linux-x64) plus a separate
  // libvips-cpp.so shared library it dlopen()s at runtime — Next's output
  // file tracer doesn't preserve that native-binary/shared-lib relationship
  // correctly when it tries to bundle sharp itself, causing
  // ERR_DLOPEN_FAILED on Vercel even though the right platform package was
  // installed. Marking it external makes Next leave it as a plain
  // node_modules require instead, which Vercel includes wholesale.
  //
  // tesseract.js needs the same treatment for a different reason: it spawns
  // its OCR worker via `new Worker(path.join(__dirname, ...))` — Turbopack
  // rewrites `__dirname` for bundled modules, so that computed path no
  // longer matches where the file actually lives post-deploy, and the
  // worker thread's own independent module resolution then can't find it
  // ("Cannot find module '.../tesseract.js/src/worker-script/node/
  // index.js'", confirmed via a real Vercel crash log, exit status 129).
  // Marking it external leaves tesseract.js's own files untouched by the
  // bundler, so its real on-disk __dirname stays correct. This alone isn't
  // enough by itself (see naptha/tesseract.js#868) — also needs an explicit
  // `workerPath` passed to createWorker() (see price-ocr.ts) and the
  // outputFileTracingIncludes entries below for the actual file bytes
  // (particularly the .wasm files) to be included in the deployment at all.
  serverExternalPackages: ["sharp", "tesseract.js", "tesseract.js-core"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  outputFileTracingIncludes: {
    "/backend": [".backend-product-publish/lily-backend.html"],
    // tesseract.js spawns its worker via `new Worker(path.join(__dirname,
    // ...))` (src/worker/node/spawnWorker.js) — that file path is only ever
    // an opaque runtime string, never a `require`/`import`, so @vercel/nft's
    // static trace (which only follows import/require/fs usage) never
    // visits worker-script/node/index.js or anything it needs. Everything
    // that file (running in its own separate worker thread, with its own
    // independent module resolution) requires has to be force-included here
    // instead: tesseract.js's own worker-script + tesseract.js-core (the
    // actual WASM binaries, chosen at runtime by SIMD feature detection —
    // its LSTM/OEM.DEFAULT variants are the only ones this codebase ever
    // requests) + the smaller runtime deps that worker-script/node/index.js
    // and getCore.js pull in directly. Confirmed the exact missing file via
    // a Vercel Production crash: "Cannot find module '.../tesseract.js/src/
    // worker-script/node/index.js'", exit status 129 — not reproducible by
    // any local check (tsc/eslint/build/direct `node` run), only by an
    // actual Vercel deploy. Combined with serverExternalPackages above and
    // the explicit workerPath in price-ocr.ts, re-verified against a real
    // Vercel Staging deployment (a temporary diagnostic route, since
    // deleted, called recognizePriceFromPhoto directly on the 4 real
    // reference photos — all 4 matched the expected local results, no
    // crash in `vercel logs`). Scoped to every route under /api/line/, not
    // just /webhook, in case a future route there needs it too.
    "/api/line/*": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/bmp-js/**/*",
      "./node_modules/idb-keyval/**/*",
      "./node_modules/is-url/**/*",
      "./node_modules/node-fetch/**/*",
      "./node_modules/wasm-feature-detect/**/*",
      "./node_modules/zlibjs/**/*",
      "./node_modules/regenerator-runtime/**/*",
    ],
  },
};

export default nextConfig;
