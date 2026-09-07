import "server-only";

export async function isMemberDisabled(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("member_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  return data?.status === "disabled";
}
