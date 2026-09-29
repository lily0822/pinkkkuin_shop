import "server-only";

// Vision-LLM product recognition for 社群連線訂單 (LINE image ordering).
// Deliberately NOT a regex+OCR pipeline — customer photos are real-world
// product shots (often with a handwritten/printed price tag, imperfect
// lighting/angle), which a vision-capable LLM handles far more reliably
// than classic OCR. Any field the model can't confidently determine comes
// back null rather than a guess.

export type RecognizedProduct = {
  productName: string | null;
  price: number | null;
  confidence: number | null;
};

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const VISION_MODEL = "claude-sonnet-5";
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function isVisionRecognitionConfigured() {
  return Boolean(env("ANTHROPIC_API_KEY"));
}

function normalizeMediaType(contentType: string) {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() || "";
  return ALLOWED_MEDIA_TYPES.includes(normalized) ? normalized : "image/jpeg";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function logVisionEvent(event: string, details: Record<string, unknown>) {
  console.warn(
    JSON.stringify({
      event,
      provider: "anthropic-vision",
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

/**
 * Recognizes a customer-submitted product photo. Returns null only when
 * recognition couldn't run at all (missing API key, network/provider
 * failure) — a photo the model genuinely can't read still returns an object
 * with productName/price set to null so the caller can still create the
 * pending order row (per spec: unrecognized fields are null, never guessed,
 * and the row is created either way so nothing gets silently dropped).
 */
export async function recognizeProductPhoto(buffer: Buffer, contentType: string): Promise<RecognizedProduct | null> {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    logVisionEvent("line_vision_disabled", { hasApiKey: false });
    return null;
  }

  const prompt = [
    "這是一張商品實體照片（不是截圖），可能包含手寫或印刷的價格標籤，拍攝角度、光線、標籤清晰度都可能不理想。",
    "請盡力辨識照片中「主要商品」的名稱與價格。",
    "只回傳一個 JSON 物件，不要有其他文字、不要用 markdown code fence，格式為：",
    '{"product_name": string | null, "price": number | null, "confidence": number}',
    "confidence 是 0 到 1 之間的小數，代表你對這次辨識結果整體的信心程度。",
    "如果完全無法判斷商品名稱，product_name 填 null；如果完全無法判斷價格，price 填 null。",
    "絕對不要瞎猜或編造數字，寧可回傳 null。",
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: normalizeMediaType(contentType), data: buffer.toString("base64") },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    logVisionEvent("line_vision_network_error", { message: error instanceof Error ? error.message : "unknown" });
    return null;
  }

  if (!response.ok) {
    logVisionEvent("line_vision_provider_error", { status: response.status });
    return null;
  }

  try {
    const data = (await response.json()) as { content?: { type?: string; text?: string }[] };
    const textBlock = (data.content || []).find((block) => block?.type === "text" && typeof block.text === "string");
    if (!textBlock?.text) return { productName: null, price: null, confidence: null };

    const parsed = extractJsonObject(textBlock.text);
    if (!parsed) return { productName: null, price: null, confidence: null };

    const productName =
      typeof parsed.product_name === "string" && parsed.product_name.trim() ? parsed.product_name.trim().slice(0, 200) : null;
    const priceRaw = typeof parsed.price === "number" ? parsed.price : null;
    const price = priceRaw !== null && Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : null;
    const confidenceRaw = typeof parsed.confidence === "number" ? parsed.confidence : null;
    const confidence = confidenceRaw === null || !Number.isFinite(confidenceRaw) ? null : Math.max(0, Math.min(1, confidenceRaw));

    return { productName, price, confidence };
  } catch (error) {
    logVisionEvent("line_vision_parse_error", { message: error instanceof Error ? error.message : "unknown" });
    return { productName: null, price: null, confidence: null };
  }
}
