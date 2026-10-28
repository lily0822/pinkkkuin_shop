import "server-only";

import { LIVESTREAM_BANK_ACCOUNT_LABELS } from "./livestream-bank-info";

// 標準名稱清單直接沿用 LIVESTREAM_BANK_ACCOUNT_LABELS 的值（中信/富邦/
// 國泰），不另開一份容易跟實際收款帳號設定（功能三「收款帳號設定」）
// 對不起來的清單。第三階段起客人匯款時改成從這份固定清單用 LINE
// Quick Reply 選銀行（不再自由輸入文字），所以不會再出現「異常」的
// 新資料——這個判斷現在只用來標記第三階段以前、自由文字回報年代留下
// 的舊資料（當初同一家銀行可能打成「中國信託」「中信」等不同寫法，
// 查無此名的原文照存，不會擋下整筆匯款申報）。
export const LIVESTREAM_STANDARD_BANK_NAMES: string[] = Object.values(LIVESTREAM_BANK_ACCOUNT_LABELS);

// 後台「匯款紀錄」頁籤用這個判斷要不要顯示 ⚠ 異常標記、以及「異常」
// 快篩要撈哪些紀錄。
export function isLivestreamBankNameAnomaly(bankName: string | null | undefined): boolean {
  if (!bankName) return true;
  return !LIVESTREAM_STANDARD_BANK_NAMES.includes(bankName);
}
