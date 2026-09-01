import { NextRequest, NextResponse } from "next/server";
import {
  getBackendRuntime,
  isBackendSessionValid,
  shouldRequireBackendAuth,
} from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const runtime = getBackendRuntime();
  const authenticated = shouldRequireBackendAuth()
    ? await isBackendSessionValid(request)
    : runtime === "staging";

  return NextResponse.json({
    ok: true,
    authenticated,
    environment: runtime,
  });
}
