import { NextResponse } from "next/server";

import { isStagingEmailRuntime, sendTestEmail } from "@/lib/email/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!isStagingEmailRuntime()) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  try {
    const result = await sendTestEmail();
    return NextResponse.json({
      success: true,
      provider: result.provider,
      id: result.id,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Email 寄送失敗" }, { status: 500 });
  }
}
