import { NextRequest } from "next/server";
import { handleCommunityLineCallback } from "@/lib/community-line-callback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return handleCommunityLineCallback(request);
}
