import { NextRequest, NextResponse } from "next/server";
import { clearBackendSessionCookie } from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true, authenticated: false });
  clearBackendSessionCookie(response, request);
  return response;
}
