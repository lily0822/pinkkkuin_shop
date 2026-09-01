import { NextRequest, NextResponse } from "next/server";
import { getBackendRuntime, isBackendSessionValid } from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const runtime = getBackendRuntime();
  return NextResponse.json({
    ok: true,
    authenticated: runtime === "staging" || (runtime === "production" && isBackendSessionValid(request)),
    environment: runtime,
  });
}
