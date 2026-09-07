export function isMemberSignupEnabled() {
  const value = process.env.MEMBER_SIGNUP_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}
