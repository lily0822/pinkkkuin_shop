export type MemberProfileInput = {
  displayName: string;
  phone: string;
};

export type MemberAddressInput = {
  recipientName: string;
  phone: string;
  postalCode: string;
  city: string;
  district: string;
  addressLine: string;
  isDefault: boolean;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function normalizeProfileInput(input: Record<string, unknown>): MemberProfileInput {
  return {
    displayName: text(input.displayName),
    phone: text(input.phone),
  };
}

export function validateProfileInput(input: MemberProfileInput) {
  if (input.displayName.length > 40) return "顯示名稱最多 40 個字。";
  if (input.phone && (input.phone.length < 8 || input.phone.length > 20)) return "電話長度不正確。";
  if (input.phone && !/^[0-9+\-\s()]+$/.test(input.phone)) return "電話格式不正確。";
  return "";
}

export function normalizeAddressInput(input: Record<string, unknown>): MemberAddressInput {
  return {
    recipientName: text(input.recipientName),
    phone: text(input.phone),
    postalCode: text(input.postalCode),
    city: text(input.city),
    district: text(input.district),
    addressLine: text(input.addressLine),
    isDefault: bool(input.isDefault),
  };
}

export function validateAddressInput(input: MemberAddressInput) {
  if (!input.recipientName) return "請填寫收件人姓名。";
  if (input.recipientName.length > 40) return "收件人姓名最多 40 個字。";
  if (!input.phone) return "請填寫收件人電話。";
  if (input.phone.length < 8 || input.phone.length > 20 || !/^[0-9+\-\s()]+$/.test(input.phone)) return "收件人電話格式不正確。";
  if (!/^\d{3,6}$/.test(input.postalCode)) return "郵遞區號格式不正確。";
  if (!input.city) return "請填寫縣市。";
  if (!input.district) return "請填寫鄉鎮市區。";
  if (!input.addressLine) return "請填寫詳細地址。";
  if (input.city.length > 30 || input.district.length > 30 || input.addressLine.length > 120) return "地址內容太長。";
  return "";
}
