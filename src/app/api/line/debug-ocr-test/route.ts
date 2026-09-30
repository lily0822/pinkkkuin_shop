import { NextRequest, NextResponse } from "next/server";
import {
  backendAuthJsonError,
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";
import { recognizePriceFromPhoto } from "@/lib/line/price-ocr";

// TEMPORARY diagnostic-only route — not part of the app, gated behind the
// same backend admin session auth as every other backend API route. Exists
// solely to prove whether recognizePriceFromPhoto (tesseract.js) actually
// works inside a real deployed Vercel function, without needing a real
// bound LINE test account + the still-pending migrations to reach this
// code path through the normal webhook flow. Delete this file once the
// outputFileTracingIncludes fix is confirmed working on a real deployment.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const backendRuntime = getBackendRuntime();
  if (backendRuntime === "unknown") {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (shouldRequireBackendAuth() && !(await isBackendSessionValid(request))) {
    return backendAuthJsonError();
  }

  try {
    const buffer = Buffer.from(await request.arrayBuffer());
    if (!buffer.length) {
      return NextResponse.json({ ok: false, error: "empty body" }, { status: 400 });
    }
    const start = Date.now();
    const price = await recognizePriceFromPhoto(buffer);
    return NextResponse.json({ ok: true, price, ms: Date.now() - start });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.stack || error.message : String(error) },
      { status: 500 },
    );
  }
}
