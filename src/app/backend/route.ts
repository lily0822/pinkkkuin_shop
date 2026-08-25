import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_HTML_PATH = path.join(
  process.cwd(),
  ".backend-product-publish",
  "lily-backend.html",
);

const LOCAL_BACKEND_ENV_PATH = path.join(
  process.cwd(),
  ".backend-product-publish",
  "backend-env.local.js",
);

function isStagingRuntime() {
  return (
    process.env.APP_ENV?.trim().toLowerCase() === "staging" ||
    process.env.SUPABASE_ENV?.trim().toLowerCase() === "staging"
  );
}

async function readLocalBackendApiUrl() {
  if (process.env.NODE_ENV === "production") {
    return "";
  }

  try {
    const source = await readFile(LOCAL_BACKEND_ENV_PATH, "utf8");
    const match = source.match(
      /PINKKKUIN_BACKEND_API_URL\s*=\s*['"]([^'"]+)['"]/,
    );
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

async function getStagingBackendApiUrl() {
  return (
    process.env.STAGING_BACKEND_API_URL?.trim() ||
    (await readLocalBackendApiUrl())
  );
}

export async function GET(request: Request) {
  if (!isStagingRuntime()) {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const backendApiUrl = await getStagingBackendApiUrl();

  if (!backendApiUrl) {
    return new NextResponse("STAGING_BACKEND_API_URL is not configured.", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const origin = new URL(request.url).origin;
  const uploadApiUrl = `${origin}/api/upload`;
  const stagingConfig = [
    "<script>",
    "window.PINKKKUIN_BACKEND_ENV = 'STAGING';",
    `window.PINKKKUIN_BACKEND_API_URL = ${JSON.stringify(backendApiUrl)};`,
    `window.PINKKKUIN_UPLOAD_API_URL = ${JSON.stringify(uploadApiUrl)};`,
    "</script>",
  ].join("\n");

  const backendHtml = await readFile(BACKEND_HTML_PATH, "utf8");
  const html = backendHtml.includes("</head>")
    ? backendHtml.replace("</head>", `${stagingConfig}\n</head>`)
    : `${stagingConfig}\n${backendHtml}`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
