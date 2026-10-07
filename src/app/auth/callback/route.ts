import { NextRequest, NextResponse } from "next/server";
import { isMemberSignupEnabled } from "@/lib/member/signup";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { appendSupabaseCookies, createSupabaseRouteClient } from "@/lib/supabase/route";
import { safeRelativePath } from "@/lib/supabase/server";

const MAX_LOOKUP_PAGES = 10;
const LOOKUP_PAGE_SIZE = 200;

async function findDuplicateUserIdByEmail(email: string, excludeUserId: string): Promise<string | null> {
  const service = createSupabaseServiceClient();
  for (let page = 1; page <= MAX_LOOKUP_PAGES; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: LOOKUP_PAGE_SIZE });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((candidate) => candidate.id !== excludeUserId && candidate.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < LOOKUP_PAGE_SIZE) return null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.get("error");
  const next = safeRelativePath(requestUrl.searchParams.get("next"), "/member/orders");

  if (providerError) {
    return NextResponse.redirect(new URL("/login?oauth=failed", requestUrl.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL(next, requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL(next, requestUrl.origin));
  const supabase = createSupabaseRouteClient(request, response);
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL("/login?oauth=failed", requestUrl.origin));
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return response;

  const hasEmailIdentity = (user.identities || []).some((identity) => identity.provider === "email");
  const isNewUser = Date.now() - Date.parse(user.created_at) < 60_000;

  // Only a brand-new OAuth-created account (no pre-existing email identity) is gated here.
  // A normal login, or an existing session linking a new identity, never reaches this branch.
  if (isNewUser && !hasEmailIdentity) {
    const service = createSupabaseServiceClient();

    if (!isMemberSignupEnabled()) {
      await service.auth.admin.deleteUser(user.id, true);
      await supabase.auth.signOut();
      return appendSupabaseCookies(NextResponse.redirect(new URL("/login?oauth=signup-disabled", requestUrl.origin)), response);
    }

    const email = user.email;
    if (email) {
      const duplicateId = await findDuplicateUserIdByEmail(email, user.id);
      if (duplicateId) {
        await service.auth.admin.deleteUser(user.id, true);
        await supabase.auth.signOut();
        return appendSupabaseCookies(NextResponse.redirect(new URL("/login?oauth=email-exists", requestUrl.origin)), response);
      }
    }
  }

  return response;
}
