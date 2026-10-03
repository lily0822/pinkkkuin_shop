import "server-only";

import { LIVESTREAM_BANK_ACCOUNT_LABELS } from "./livestream-bank-info";

// 客人自助回報匯款時打的銀行名稱是自由文字（parseRemittanceReport 解析
// 出來的原始字串），同一家銀行常見好幾種寫法（「中國信託」/「中信」
// ...）。這裡只做「常見別名 → 標準名稱」的正規化，之後要擴充別名
// 很容易加一行；對照不到的名稱原文照存，不會因為查無此名就擋下整筆
// 匯款申報——後台用「這個名稱不在標準清單裡」判斷「異常」，不用額外
// 欄位記錄，也不會擋住客人正常使用。
//
// 標準名稱清單直接沿用 LIVESTREAM_BANK_ACCOUNT_LABELS 的值（中信/富邦/
// 國泰），不另開一份容易跟實際收款帳號設定（功能三「收款帳號設定」）
// 對不起來的清單。
export const LIVESTREAM_STANDARD_BANK_NAMES: string[] = Object.values(LIVESTREAM_BANK_ACCOUNT_LABELS);

// key 是客人可能打的寫法，value 是要存成的標準名稱——標準名稱本身也
// 各自列一條「自己對應自己」，這樣呼叫端不用另外判斷「這個字串本身
// 已經是標準名稱」這個特例。
const BANK_NAME_ALIASES: Record<string, string> = {
  中國信託: "中信",
  中信: "中信",
  富邦: "富邦",
  國泰: "國泰",
};

export function normalizeLivestreamBankName(rawBankName: string): string {
  const trimmed = rawBankName.trim();
  return BANK_NAME_ALIASES[trimmed] || trimmed;
}

// 後台「匯款紀錄」頁籤用這個判斷要不要顯示 ⚠ 異常標記、以及「異常」
// 快篩要撈哪些紀錄——跟 normalizeLivestreamBankName 共用同一份標準
// 名稱清單，兩邊永遠不會對不起來。
export function isLivestreamBankNameAnomaly(bankName: string | null | undefined): boolean {
  if (!bankName) return true;
  return !LIVESTREAM_STANDARD_BANK_NAMES.includes(bankName);
}
