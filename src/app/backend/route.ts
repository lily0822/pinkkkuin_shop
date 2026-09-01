import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  getBackendRuntime,
  isBackendAuthConfigured,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";

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
  if (process.env.NODE_ENV === "production") return "";

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

function renderBackendLoginPage(environment: string, message = "") {
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
    <span class="badge">${environment}</span>
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

function renderAuthToolsScript() {
  return `
document.addEventListener('DOMContentLoaded', function(){
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;gap:8px;align-items:center;';
  function makeButton(text, bg){
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = 'border:0;border-radius:999px;background:' + bg + ';color:#fff;padding:10px 16px;font-weight:800;box-shadow:0 10px 24px rgba(190,24,93,.22);cursor:pointer;';
    return button;
  }
  var changeButton = makeButton('修改密碼', '#ec4899');
  var logoutButton = makeButton('登出', '#be185d');
  logoutButton.addEventListener('click', async function(){
    await fetch('/api/backend/auth/logout', { method: 'POST' });
    location.reload();
  });
  changeButton.addEventListener('click', openBackendPasswordModal);
  wrap.appendChild(changeButton);
  wrap.appendChild(logoutButton);
  document.body.appendChild(wrap);

  function openBackendPasswordModal(){
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.38);display:grid;place-items:center;padding:16px;';
    overlay.innerHTML =
      '<form id="backend-password-form" style="width:min(420px,100%);background:#fff;border:1px solid #fbcfe8;border-radius:24px;box-shadow:0 24px 60px rgba(236,72,153,.22);padding:24px;font-family:&quot;Noto Sans TC&quot;,system-ui,sans-serif;color:#1f2937">' +
      '<h2 style="margin:0 0 8px;font-size:22px;color:#be185d">修改後台密碼</h2>' +
      '<p style="margin:0 0 18px;color:#6b7280;font-size:14px">密碼更新後會自動登出，請使用新密碼重新登入。</p>' +
      '<label style="display:block;margin:12px 0 6px;font-weight:800">目前密碼</label>' +
      '<input name="currentPassword" type="password" autocomplete="current-password" required style="width:100%;height:42px;border:1px solid #f9a8d4;border-radius:12px;padding:0 12px;box-sizing:border-box">' +
      '<label style="display:block;margin:12px 0 6px;font-weight:800">新密碼</label>' +
      '<input name="newPassword" type="password" autocomplete="new-password" required style="width:100%;height:42px;border:1px solid #f9a8d4;border-radius:12px;padding:0 12px;box-sizing:border-box">' +
      '<label style="display:block;margin:12px 0 6px;font-weight:800">再次輸入新密碼</label>' +
      '<input name="confirmPassword" type="password" autocomplete="new-password" required style="width:100%;height:42px;border:1px solid #f9a8d4;border-radius:12px;padding:0 12px;box-sizing:border-box">' +
      '<div id="backend-password-error" style="min-height:22px;margin-top:12px;color:#be123c;font-size:14px"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">' +
      '<button type="button" data-cancel style="border:1px solid #f9a8d4;border-radius:999px;background:#fff;color:#be185d;padding:10px 16px;font-weight:800;cursor:pointer">取消</button>' +
      '<button type="submit" style="border:0;border-radius:999px;background:#ec4899;color:#fff;padding:10px 16px;font-weight:800;cursor:pointer">儲存密碼</button>' +
      '</div></form>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-cancel]').addEventListener('click', function(){ overlay.remove(); });
    overlay.addEventListener('click', function(event){ if(event.target === overlay) overlay.remove(); });
    overlay.querySelector('form').addEventListener('submit', async function(event){
      event.preventDefault();
      var form = event.currentTarget;
      var submit = form.querySelector('button[type=submit]');
      var error = form.querySelector('#backend-password-error');
      submit.disabled = true;
      error.textContent = '';
      try {
        var response = await fetch('/api/backend/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
        });
        var result = await response.json().catch(function(){ return null; });
        if(!response.ok || !result || !result.ok) throw new Error((result && result.error) || '變更密碼失敗。');
        error.style.color = '#047857';
        error.textContent = '密碼已更新，請重新登入。';
        setTimeout(function(){ location.reload(); }, 900);
      } catch(err) {
        error.textContent = err && err.message ? err.message : '變更密碼失敗。';
      } finally {
        submit.disabled = false;
      }
    });
  }
});`;
}

export async function GET(request: NextRequest) {
  const backendRuntime = getBackendRuntime();
  if (backendRuntime === "unknown") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const environment = backendRuntime.toUpperCase();

  if (shouldRequireBackendAuth() && !(await isBackendSessionValid(request))) {
    const message = isBackendAuthConfigured() ? "" : "後台登入尚未完成環境設定。";
    return new NextResponse(renderBackendLoginPage(environment, message), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  const backendApiUrl =
    backendRuntime === "staging" ? await getStagingBackendApiUrl() : "";

  if (backendRuntime === "staging" && !backendApiUrl) {
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
    `window.PINKKKUIN_BACKEND_ENV = ${JSON.stringify(environment)};`,
    ...(backendApiUrl ? [`window.PINKKKUIN_BACKEND_API_URL = ${JSON.stringify(backendApiUrl)};`] : []),
    `window.PINKKKUIN_UPLOAD_API_URL = ${JSON.stringify(uploadApiUrl)};`,
    ...(shouldRequireBackendAuth()
      ? [
          "window.PINKKKUIN_BACKEND_AUTHENTICATED = true;",
          renderAuthToolsScript(),
        ]
      : []),
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
