import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp ships a native addon (@img/sharp-linux-x64) plus a separate
  // libvips-cpp.so shared library it dlopen()s at runtime — Next's output
  // file tracer doesn't preserve that native-binary/shared-lib relationship
  // correctly when it tries to bundle sharp itself, causing
  // ERR_DLOPEN_FAILED on Vercel even though the right platform package was
  // installed. Marking it external makes Next leave it as a plain
  // node_modules require instead, which Vercel includes wholesale.
  serverExternalPackages: ["sharp"],
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
    // actual Vercel deploy.
    "/api/line/webhook": [
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
