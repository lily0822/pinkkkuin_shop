import "server-only";

import sharp from "sharp";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";

// 免費、離線可用的白框價格 OCR 備援——當 recognizeProductPhoto（Anthropic
// 視覺辨識，付費，目前也還沒設定金鑰）沒抓到價格時，用這支頂上去。
//
// 原理：社群賣家貼的價格標籤幾乎都是「純白底＋黑字」的貼紙，跟一般照片
// 背景的白色（曝光過度的天空、白牆、反光）比起來，純度更高（R/G/B 三個
// 通道幾乎相等）、而且通常是照片裡數一數二大的一塊連續區域——所以只要
// 找出「高純度白色連通區塊」，就能相當可靠地定位到價格貼紙，不需要真的
// 做物件偵測/訓練模型。
//
// 照片可能同時貼了不只一張白底文字貼紙（例如價格「990」跟另一張說明
// 用的「是一個盤子」），這兩張貼紙如果貼得很近，甚至可能在像素層級被
// 判斷成同一塊連通白色區域——所以這裡：(1) 不是只挑面積最大的一塊，
// 而是收集所有夠大的候選白色區塊，各自裁切、各自 OCR；(2) OCR 結果改
// 用逐行文字判斷（而不是整塊文字字串），每一行去除空白後如果不是純數字
// （含中文字、英文字母都算），直接排除，不列入候選。彙整所有區塊、所有
// 行的候選結果：剛好一個 → 採用；零個或多個（沒找到/有歧義）→ 回傳
// null，維持「不確定就跳過」原則，不瞎猜。
//
// 用 sharp 做像素掃描+裁切（Node 原生模組，Vercel Node.js runtime 可以
// 正常跑），tesseract.js 做裁切後小圖的文字辨識，兩者都是 MIT 授權、
// 完全免費，不需要任何 API 金鑰。

const DOWNSCALE_MAX_DIMENSION = 800; // 找白框只需要抓大致區域，不用原始解析度，加快連通元件掃描
const WHITE_MIN_CHANNEL = 225; // R/G/B 都要夠亮才算「白」（0-255）
const WHITE_MAX_CHANNEL_SPREAD = 20; // R/G/B 彼此最大最小值的差距要夠小，才算「高純度」白，排除偏黃/偏藍的亮色背景
const MIN_WHITE_BOX_AREA_RATIO = 0.01; // 候選白色區塊至少要佔縮圖總面積的 1%，濾掉雜訊小白點
const CROP_PADDING_RATIO = 0.08; // 裁切時白框寬高各留 8% 的邊界，避免切到貼紙邊緣的文字
const OCR_UPSCALE_TARGET_WIDTH = 400; // 裁切後的小圖如果比這個窄，放大到這個寬度再做 OCR——文字太小 Tesseract 容易認錯
const MIN_CROP_DIMENSION = 8; // 裁切結果任一邊小於這個像素數，視為定位失敗

type BoundingBox = { minX: number; minY: number; maxX: number; maxY: number; area: number };

// tesseract.js 的 Page 結果裡，逐行文字要從 blocks -> paragraphs -> lines
// 這樣的巢狀結構取得（見 tesseract.js/src/index.d.ts 的 Block/Paragraph/
// Line 型別）；這裡只取用得到的欄位，不依賴完整型別定義。
type OcrLine = { text?: string };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };

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

// 找出縮圖中所有面積夠大的高純度白色連通區塊（不是只挑最大的一塊）——
// 同一張照片可能貼了不只一張白底文字貼紙，只抓最大的一塊會漏掉其他
// 候選。用扁平的 Uint8Array 當 visited 遮罩 + 顯式佇列做 BFS（不用
// 遞迴），避免大圖在深度優先時爆 call stack。回傳的座標是縮圖座標系，
// 呼叫端要自己換算回原圖座標。
function findWhiteBoxCandidates(pixels: Buffer, width: number, height: number, channels: number): BoundingBox[] {
  const total = width * height;
  const minArea = total * MIN_WHITE_BOX_AREA_RATIO;
  const visited = new Uint8Array(total);
  const queueX = new Int32Array(total);
  const queueY = new Int32Array(total);

  const isWhiteAt = (x: number, y: number) => {
    const idx = (y * width + x) * channels;
    return isHighPurityWhite(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
  };

  const candidates: BoundingBox[] = [];

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

      if (area >= minArea) candidates.push({ minX, minY, maxX, maxY, area });
    }
  }

  return candidates;
}

// 裁切出單一個白框候選區域（含邊界留白），回傳一張放大+正規化過的小圖
// PNG buffer，比較利於後面的文字 OCR。裁切結果太小（例如貼到照片邊緣）
// 就回傳 null。
async function cropBoxToImage(
  normalized: Buffer,
  fullWidth: number,
  fullHeight: number,
  box: BoundingBox,
  scaleX: number,
  scaleY: number,
): Promise<Buffer | null> {
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

// 找出照片裡所有夠大的白框候選區域，各自裁切成獨立的小圖。找不到任何
// 候選（或圖片本身解析失敗）就回傳空陣列。
async function cropWhiteBoxRegions(buffer: Buffer): Promise<Buffer[]> {
  // 先把 EXIF 方向套用進去、輸出成一份「已經轉正」的 buffer，後面所有
  // 座標運算（縮圖找白框、換算回原圖座標、裁切）都對這同一份 buffer
  // 做，避免 metadata() 回傳的寬高跟實際旋轉後的像素方向對不上。
  const normalized = await sharp(buffer, { failOn: "none" }).rotate().toBuffer();

  const metadata = await sharp(normalized).metadata();
  const fullWidth = metadata.width || 0;
  const fullHeight = metadata.height || 0;
  if (!fullWidth || !fullHeight) return [];

  const scale = Math.min(1, DOWNSCALE_MAX_DIMENSION / Math.max(fullWidth, fullHeight));
  const smallWidth = Math.max(1, Math.round(fullWidth * scale));
  const smallHeight = Math.max(1, Math.round(fullHeight * scale));

  const { data: pixels, info } = await sharp(normalized)
    .resize(smallWidth, smallHeight, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const boxes = findWhiteBoxCandidates(pixels, info.width, info.height, info.channels);
  if (!boxes.length) return [];

  const scaleX = fullWidth / info.width;
  const scaleY = fullHeight / info.height;

  const crops: Buffer[] = [];
  for (const box of boxes) {
    const cropped = await cropBoxToImage(normalized, fullWidth, fullHeight, box, scaleX, scaleY);
    if (cropped) crops.push(cropped);
  }
  return crops;
}

// 共用一個 worker，讓它活在整個 serverless function 實例的生命週期裡
// （warm 起來後同一個容器處理下一張圖片可以直接重用，不用每次都重新
// 花時間啟動 WASM + 下載語言資料）——不主動呼叫 terminate()，容器被
// 回收時 worker thread 自然跟著結束。建立失敗時把 workerPromise 清空，
// 讓下一次呼叫可以重新嘗試，不會卡在一個壞掉的 promise 上。
//
// 刻意不設 tessedit_char_whitelist——這次要靠 Tesseract 老實讀出每一行
// 實際的文字（含中文字），再由呼叫端逐行判斷是否為純數字，藉此分辨
// 「990」跟緊貼在旁邊的「是一個盤子」。如果限制字集只能是數字/逗號，
// Tesseract 會被迫把中文筆畫也硬猜成數字，反而讓兩者更難分開。
let workerPromise: Promise<TesseractWorker> | null = null;

async function getTextWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    // cachePath 指到 /tmp——Vercel serverless function 唯一可寫的目錄，
    // 讓語言資料（eng.traineddata，第一次會從 jsdelivr CDN 下載）在同一個
    // warm 容器的後續呼叫間可以被快取住，不用每次都重新下載。
    workerPromise = createWorker("eng", undefined, { cachePath: "/tmp" }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function extractLineTexts(blocks: OcrBlock[] | null | undefined): string[] {
  const lines: string[] = [];
  (blocks || []).forEach((block) => {
    (block.paragraphs || []).forEach((paragraph) => {
      (paragraph.lines || []).forEach((line) => {
        if (typeof line.text === "string") lines.push(line.text);
      });
    });
  });
  return lines;
}

// 這一行去除空白後是否為「純數字（可含千分位逗號）」——含中文字/英文
// 字母/其他符號的行一律排除，不列入候選。
function extractNumericLineValue(rawLine: string): number | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;
  const withoutCommas = trimmed.replace(/,/g, "");
  if (!/^\d+$/.test(withoutCommas)) return null;
  const value = Number(withoutCommas);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 對整張商品照片跑「定位所有白框候選 + 逐行 OCR 判斷純數字」的免費備援
 * 流程。只在呼叫端已知 Anthropic 視覺辨識沒抓到價格時才需要呼叫。彙整
 * 所有白框、所有行的純數字候選：剛好一個才採用，零個（沒找到）或多個
 * （有歧義）一律回傳 null，不會拋出例外中斷呼叫端的流程。
 */
export async function recognizePriceFromPhoto(buffer: Buffer): Promise<number | null> {
  try {
    const crops = await cropWhiteBoxRegions(buffer);
    if (!crops.length) return null;

    const worker = await getTextWorker();
    const candidates: number[] = [];
    // 序列處理，不用 Promise.all——同一個共用 worker 實例一次只能跑一個
    // recognize()，平行呼叫會互相干擾。
    for (const crop of crops) {
      // output.blocks 預設是 false（tesseract.js 預設只回傳整塊 text 字
      // 串），要逐行判斷就得明確要求 blocks，才會拿到 blocks -> paragraphs
      // -> lines 這個結構。
      const { data } = await worker.recognize(crop, {}, { blocks: true });
      const lines = extractLineTexts(data.blocks as OcrBlock[] | null);
      for (const line of lines) {
        const value = extractNumericLineValue(line);
        if (value !== null) candidates.push(value);
      }
    }

    if (candidates.length !== 1) return null;
    return candidates[0];
  } catch (error) {
    logPriceOcrEvent("line_price_ocr_error", { message: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}
