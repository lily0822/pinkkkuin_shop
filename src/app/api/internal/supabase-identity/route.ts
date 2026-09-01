import { NextRequest, NextResponse } from "next/server";
import { backendAuthJsonError, getBackendRuntime, isBackendSessionValid } from "@/lib/backend-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseSupabaseIdentity() {
  const rawUrl = process.env.SUPABASE_URL?.trim() || "";
  if (!rawUrl) return { host: "", supabaseProjectRef: "" };

  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const match = host.match(/^([^.]+)\.supabase\.co$/);
    return {
      host,
      supabaseProjectRef: match?.[1] || "",
    };
  } catch {
    return { host: "", supabaseProjectRef: "" };
  }
}

export async function GET(request: NextRequest) {
  const runtime = getBackendRuntime();

  if (runtime !== "production") {
    return new NextResponse("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (!isBackendSessionValid(request)) {
    return backendAuthJsonError("需要重新登入後台。");
  }

  const identity = parseSupabaseIdentity();
  if (!identity.host || !identity.supabaseProjectRef) {
    return NextResponse.json(
      {
        ok: false,
        environment: runtime,
        error: "Production Supabase URL is not configured.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      environment: runtime,
      supabaseProjectRef: identity.supabaseProjectRef,
      host: identity.host,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
