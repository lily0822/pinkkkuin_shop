export function validatePassword(password: string, confirmPassword: string) {
  if (password.length < 8) return "密碼至少需要 8 個字元。";
  if (password.trim().length !== password.length || !password.trim()) return "密碼不可空白或包含前後空格。";
  if (password !== confirmPassword) return "兩次輸入的密碼不一致。";
  return "";
}
