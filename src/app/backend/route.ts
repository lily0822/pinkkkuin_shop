import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getBackendRuntime, isBackendAuthConfigured, isBackendSessionValid } from "@/lib/backend-auth";

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

function renderBackendLoginPage(message = "") {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>後台登入 | 小企鵝選物</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fdf2f8;color:#1f2937;font-family:"Noto Sans TC",system-ui,sans-serif}
    main{width:min(420px,calc(100vw - 32px));background:#fff;border:1px solid #fbcfe8;border-radius:24px;box-shadow:0 24px 60px rgba(236,72,153,.16);padding:32px}
    h1{margin:0 0 8px;font-size:26px;color:#be185d}
    p{margin:0 0 24px;color:#6b7280;font-size:14px}
    label{display:block;margin-bottom:8px;font-weight:700}
    input{width:100%;height:46px;border:1px solid #f9a8d4;border-radius:14px;padding:0 14px;font-size:16px;box-sizing:border-box}
    button{width:100%;height:46px;margin-top:16px;border:0;border-radius:999px;background:#ec4899;color:white;font-size:16px;font-weight:800;cursor:pointer}
    button:disabled{opacity:.65;cursor:wait}
    .error{min-height:22px;margin-top:12px;color:#be123c;font-size:14px}
    .badge{display:inline-flex;align-items:center;border-radius:999px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;padding:4px 10px;font-size:12px;font-weight:800;margin-bottom:14px}
  </style>
</head>
<body>
  <main>
    <span class="badge">PRODUCTION</span>
    <h1>後台登入</h1>
    <p>${message || "請輸入後台管理密碼。"}</p>
    <form id="backend-login-form">
      <label for="backend-password">後台密碼</label>
      <input id="backend-password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">登入後台</button>
      <div class="error" id="backend-login-error"></div>
    </form>
  </main>
  <script>
    document.getElementById('backend-login-form').addEventListener('submit', async function(event) {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button');
      const error = document.getElementById('backend-login-error');
      button.disabled = true;
      error.textContent = '';
      try {
        const response = await fetch('/api/backend/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: document.getElementById('backend-password').value })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) throw new Error(result?.error || '登入失敗，請再試一次。');
        location.reload();
      } catch (err) {
        error.textContent = err.message || '登入失敗，請再試一次。';
      } finally {
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function injectBackendRuntimeConfig(html: string, config: string) {
  return html.includes("</head>") ? html.replace("</head>", `${config}\n</head>`) : `${config}\n${html}`;
}

export async function GET(request: NextRequest) {
  const runtime = getBackendRuntime();
  if (runtime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (runtime === "production" && !isBackendSessionValid(request)) {
    const message = isBackendAuthConfigured() ? "" : "Production 後台登入尚未完成環境設定。";
    return new NextResponse(renderBackendLoginPage(message), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  const backendApiUrl = runtime === "staging" ? await getStagingBackendApiUrl() : "";

  if (runtime === "staging" && !backendApiUrl) {
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
  const runtimeConfig = [
    "<script>",
    `window.PINKKKUIN_BACKEND_ENV = ${JSON.stringify(runtime.toUpperCase())};`,
    ...(backendApiUrl ? [`window.PINKKKUIN_BACKEND_API_URL = ${JSON.stringify(backendApiUrl)};`] : []),
    `window.PINKKKUIN_UPLOAD_API_URL = ${JSON.stringify(uploadApiUrl)};`,
    ...(runtime === "production" ? [
      "window.PINKKKUIN_BACKEND_AUTHENTICATED = true;",
      "document.addEventListener('DOMContentLoaded', function(){",
      "  var button = document.createElement('button');",
      "  button.type = 'button';",
      "  button.textContent = '登出';",
      "  button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;border:0;border-radius:999px;background:#be185d;color:#fff;padding:10px 16px;font-weight:800;box-shadow:0 10px 24px rgba(190,24,93,.22);cursor:pointer;';",
      "  button.addEventListener('click', async function(){ await fetch('/api/backend/auth/logout', { method: 'POST' }); location.reload(); });",
      "  document.body.appendChild(button);",
      "});",
    ] : []),
    "</script>",
  ].join("\n");

  const backendHtml = await readFile(BACKEND_HTML_PATH, "utf8");
  const html = injectBackendRuntimeConfig(backendHtml, runtimeConfig);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
