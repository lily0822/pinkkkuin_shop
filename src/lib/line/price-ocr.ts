import "server-only";

import sharp from "sharp";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";

// 免費、離線可用的白框價格 OCR 備援——當 recognizeProductPhoto（Anthropic
// 視覺辨識，付費，目前也還沒設定金鑰）沒抓到價格時，用這支頂上去。
//
// 原理：社群賣家貼的價格標籤幾乎都是「純白底＋黑字」的貼紙，跟一般照片
// 背景的白色（曝光過度的天空、白牆、反光）比起來，純度更高（R/G/B 三個
// 通道幾乎相等）、而且通常是照片裡數一數二大的一塊連續區域——所以只要
// 找出「面積最大的高純度白色連通區塊」，就能相當可靠地定位到價格貼紙，
// 不需要真的做物件偵測/訓練模型。完全找不到白框、或裁切後 OCR 認不出
// 數字，一律回傳 null（維持「不確定就跳過」原則，不瞎猜）。
//
// 用 sharp 做像素掃描+裁切（Node 原生模組，Vercel Node.js runtime 可以
// 正常跑），tesseract.js 做裁切後小圖的數字辨識，兩者都是 MIT 授權、
// 完全免費，不需要任何 API 金鑰。

const DOWNSCALE_MAX_DIMENSION = 800; // 找白框只需要抓大致區域，不用原始解析度，加快連通元件掃描
const WHITE_MIN_CHANNEL = 225; // R/G/B 都要夠亮才算「白」（0-255）
const WHITE_MAX_CHANNEL_SPREAD = 20; // R/G/B 彼此最大最小值的差距要夠小，才算「高純度」白，排除偏黃/偏藍的亮色背景
const MIN_WHITE_BOX_AREA_RATIO = 0.01; // 候選白色區塊至少要佔縮圖總面積的 1%，濾掉雜訊小白點
const CROP_PADDING_RATIO = 0.08; // 裁切時白框寬高各留 8% 的邊界，避免切到貼紙邊緣的數字
const OCR_UPSCALE_TARGET_WIDTH = 400; // 裁切後的小圖如果比這個窄，放大到這個寬度再做 OCR——數字太小 Tesseract 容易認錯
const MIN_CROP_DIMENSION = 8; // 裁切結果任一邊小於這個像素數，視為定位失敗

type BoundingBox = { minX: number; minY: number; maxX: number; maxY: number; area: number };

function logPriceOcrEvent(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "price-ocr",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function isHighPurityWhite(r: number, g: number, b: number): boolean {
  if (r < WHITE_MIN_CHANNEL || g < WHITE_MIN_CHANNEL || b < WHITE_MIN_CHANNEL) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) <= WHITE_MAX_CHANNEL_SPREAD;
}

// 找出縮圖中面積最大的高純度白色連通區塊。用扁平的 Uint8Array 當
// visited 遮罩 + 顯式佇列做 BFS（不用遞迴），避免大圖在深度優先時
// 爆 call stack。回傳的座標是縮圖座標系，呼叫端要自己換算回原圖座標。
function findLargestWhiteBox(pixels: Buffer, width: number, height: number, channels: number): BoundingBox | null {
  const total = width * height;
  const visited = new Uint8Array(total);
  const queueX = new Int32Array(total);
  const queueY = new Int32Array(total);

  const isWhiteAt = (x: number, y: number) => {
    const idx = (y * width + x) * channels;
    return isHighPurityWhite(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
  };

  let best: BoundingBox | null = null;

  for (let startY = 0; startY < height; startY++) {
    for (let startX = 0; startX < width; startX++) {
      const startPos = startY * width + startX;
      if (visited[startPos] || !isWhiteAt(startX, startY)) continue;

      let head = 0;
      let tail = 0;
      queueX[tail] = startX;
      queueY[tail] = startY;
      tail++;
      visited[startPos] = 1;

      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      let area = 0;

      while (head < tail) {
        const cx = queueX[head];
        const cy = queueY[head];
        head++;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors: [number, number][] = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const npos = ny * width + nx;
          if (visited[npos] || !isWhiteAt(nx, ny)) continue;
          visited[npos] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail++;
        }
      }

      if (!best || area > best.area) best = { minX, minY, maxX, maxY, area };
    }
  }

  return best;
}

// 裁切出白框區域（含邊界留白），回傳一張放大+灰階+正規化過的小圖 PNG
// buffer，比較利於後面的數字 OCR。找不到夠大的白框就回傳 null。
async function cropWhiteBoxRegion(buffer: Buffer): Promise<Buffer | null> {
  // 先把 EXIF 方向套用進去、輸出成一份「已經轉正」的 buffer，後面所有
  // 座標運算（縮圖找白框、換算回原圖座標、裁切）都對這同一份 buffer
  // 做，避免 metadata() 回傳的寬高跟實際旋轉後的像素方向對不上。
  const normalized = await sharp(buffer, { failOn: "none" }).rotate().toBuffer();

  const metadata = await sharp(normalized).metadata();
  const fullWidth = metadata.width || 0;
  const fullHeight = metadata.height || 0;
  if (!fullWidth || !fullHeight) return null;

  const scale = Math.min(1, DOWNSCALE_MAX_DIMENSION / Math.max(fullWidth, fullHeight));
  const smallWidth = Math.max(1, Math.round(fullWidth * scale));
  const smallHeight = Math.max(1, Math.round(fullHeight * scale));

  const { data: pixels, info } = await sharp(normalized)
    .resize(smallWidth, smallHeight, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const box = findLargestWhiteBox(pixels, info.width, info.height, info.channels);
  if (!box) return null;
  if (box.area < info.width * info.height * MIN_WHITE_BOX_AREA_RATIO) return null;

  const scaleX = fullWidth / info.width;
  const scaleY = fullHeight / info.height;
  const boxWidth = (box.maxX - box.minX + 1) * scaleX;
  const boxHeight = (box.maxY - box.minY + 1) * scaleY;
  const padX = boxWidth * CROP_PADDING_RATIO;
  const padY = boxHeight * CROP_PADDING_RATIO;

  const left = Math.max(0, Math.round(box.minX * scaleX - padX));
  const top = Math.max(0, Math.round(box.minY * scaleY - padY));
  const right = Math.min(fullWidth, Math.round((box.maxX + 1) * scaleX + padX));
  const bottom = Math.min(fullHeight, Math.round((box.maxY + 1) * scaleY + padY));
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth < MIN_CROP_DIMENSION || cropHeight < MIN_CROP_DIMENSION) return null;

  // 刻意不呼叫 .greyscale()——sharp 的灰階輸出是單一色版 PNG，這個版本
  // 的 tesseract.js（WASM／Leptonica）讀取單色版 PNG 時會直接辨識不出
  // 任何文字（實測 confidence 直接掉到 0），維持三色版反而正常；
  // .normalise() 本身已經足夠把白底黑字的對比拉到最大，不需要再轉灰階。
  let pipeline = sharp(normalized).extract({ left, top, width: cropWidth, height: cropHeight }).normalise();
  if (cropWidth < OCR_UPSCALE_TARGET_WIDTH) {
    const upscale = OCR_UPSCALE_TARGET_WIDTH / cropWidth;
    pipeline = pipeline.resize(Math.round(cropWidth * upscale), Math.round(cropHeight * upscale), { kernel: "lanczos3" });
  }

  return pipeline.png().toBuffer();
}

// 共用一個 worker，讓它活在整個 serverless function 實例的生命週期裡
// （warm 起來後同一個容器處理下一張圖片可以直接重用，不用每次都重新
// 花時間啟動 WASM + 下載語言資料）——不主動呼叫 terminate()，容器被
// 回收時 worker thread 自然跟著結束。建立失敗時把 workerPromise 清空，
// 讓下一次呼叫可以重新嘗試，不會卡在一個壞掉的 promise 上。
let workerPromise: Promise<TesseractWorker> | null = null;

async function getDigitsOnlyWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // cachePath 指到 /tmp——Vercel serverless function 唯一可寫的目錄，
      // 讓語言資料（eng.traineddata，第一次會從 jsdelivr CDN 下載）在同一個
      // warm 容器的後續呼叫間可以被快取住，不用每次都重新下載。
      const worker = await createWorker("eng", undefined, { cachePath: "/tmp" });
      await worker.setParameters({ tessedit_char_whitelist: "0123456789," });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

// OCR 只認得數字跟逗號，所以辨識結果理論上只會剩數字/逗號/空白/換行——
// 去掉逗號（千分位）、依空白/換行切成片段，挑出「全部都是數字」且
// 位數最多的那個片段當作最終結果（位數最多通常就是真正的價格數字，
// 排除掉可能被誤判進來的單一雜訊字元）。
function parseDigitsFromOcrText(text: string): number | null {
  const candidates = text
    .split(/\s+/)
    .map((chunk) => chunk.replace(/,/g, ""))
    .filter((chunk) => /^\d+$/.test(chunk));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length);
  const value = Number(candidates[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 對整張商品照片跑「定位白框價格貼紙 + OCR 辨識數字」的免費備援流程。
 * 只在呼叫端已知 Anthropic 視覺辨識沒抓到價格時才需要呼叫。任何一步
 * （找不到夠大的白框、OCR 認不出數字、圖片本身解析失敗）都回傳 null，
 * 不會拋出例外中斷呼叫端的流程。
 */
export async function recognizePriceFromPhoto(buffer: Buffer): Promise<number | null> {
  try {
    const cropped = await cropWhiteBoxRegion(buffer);
    if (!cropped) return null;

    const worker = await getDigitsOnlyWorker();
    const { data } = await worker.recognize(cropped);
    return parseDigitsFromOcrText(data.text || "");
  } catch (error) {
    logPriceOcrEvent("line_price_ocr_error", { message: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}
