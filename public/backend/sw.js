// 後台 PWA 化第一階段：最小可用的 service worker，純粹是為了讓瀏覽器
// 偵測到有 SW 註冊、進而顯示「加入主畫面」的安裝提示。
//
// 刻意不做任何快取（沒有 fetch 事件監聽、沒有 cache storage）——後台是
// 管理工具，每次都要抓到最新資料，不適合離線快取，避免管理員看到舊資料。
// skipWaiting/clients.claim() 只是讓每次部署後新版 SW 盡快生效，跟快取
// 邏輯無關。

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
