# 文檔索引

本目錄收錄 `workspace` repo(麗與牛工作區域 / 商品站後台)的所有文檔。
根目錄 `CLAUDE.md` 僅保留工作規則與重點索引,細節一律在此。

## 總覽文檔(不綁定單一模塊)

| 文檔 | 內容 |
| --- | --- |
| [architecture.md](architecture.md) | 系統架構、資料源呼叫關係、寫入/讀取路徑、風險點 |
| [environments.md](environments.md) | 開發 / staging / production 環境、分支策略、部署流程 |
| [data-model.md](data-model.md) | Google Sheet 欄位 ↔ Supabase 資料表 ↔ 前端物件的三方對應 |
| [risk-review.md](risk-review.md) | **風險登錄冊**:全站風險依 S1–S4 分級,含影響、觸發條件與建議處置 |
| [env-snapshot-2026-08-25.md](env-snapshot-2026-08-25.md) | 2026-08-25 的原始環境盤點紀錄(備查,不再更新) |

## 模塊文檔

依 `CLAUDE.md` 規範,每個功能模塊一份 `module-{英文名稱}.md`。

| 模塊文檔 | 對應後台選單 | 主要檔案 |
| --- | --- | --- |
| [module-backend-api.md](module-backend-api.md) | (基礎層,無選單) | `lily-backend-Code.gs` |
| [module-media-upload.md](module-media-upload.md) | (基礎層,無選單) | `lily-backend.html` |
| [module-purchasing.md](module-purchasing.md) | 叫貨管理 | `lily-backend.html` / `daniel-backend.html` |
| [module-customer-orders.md](module-customer-orders.md) | 訂單管理 → 客戶訂單明細 | `lily-backend.html` |
| [module-product-management.md](module-product-management.md) | 商品管理 → 現貨 / 預購商品管理 | `lily-backend.html` |
| [module-product-tags.md](module-product-tags.md) | 商品管理 → 商品標籤管理 | `lily-backend.html` |
| [module-schedules.md](module-schedules.md) | 擺攤連線管理 | `lily-backend.html` |
| [module-brand-appearance.md](module-brand-appearance.md) | 運營管理 → 品牌管理 | `lily-backend.html` |
| [module-accounting.md](module-accounting.md) | 帳表管理 | `lily-backend.html` / `accounting.html` |
| [module-exchange-rates.md](module-exchange-rates.md) | 運營管理 → 匯率報表 | `lily-backend.html` |
| [module-legacy-portal.md](module-legacy-portal.md) | (Portal 與 legacy 頁面) | `index.html` / `stalls.html` / `connection.html` |

## 撰寫規則

- 模塊文檔固定五段:**需求 / 選項與取捨 / 定案(現況實作) / 資料源與呼叫關係 / 後續待辦**。
- **風險一律登錄在 [risk-review.md](risk-review.md)**,模塊文檔的「後續待辦」只放一行連結與嚴重度,不重複描述細節。
- 模塊需求變動時,程式碼與文檔**同一次提交**,不留到之後補。
