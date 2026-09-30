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
  },
};

export default nextConfig;
