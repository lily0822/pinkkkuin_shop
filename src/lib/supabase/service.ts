import "server-only";

import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function createSupabaseServiceClient() {
  const url = (env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/+$/, "");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service client is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
