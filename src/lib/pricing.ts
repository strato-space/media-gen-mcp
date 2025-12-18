/**
 * Pricing helpers for media-gen-mcp.
 *
 * Notes:
 * - These are *estimates* based on a static price list and should be treated as
 *   informational (the OpenAI API does not return price on Video objects).
 */

export type SoraVideoModel = "sora-2" | "sora-2-pro";
export type SoraVideoSeconds = "4" | "8" | "12";
export type SoraVideoSize = "720x1280" | "1280x720" | "1024x1792" | "1792x1024";

export interface SoraVideoPricingEstimate {
  currency: "USD";
  model: SoraVideoModel;
  size: SoraVideoSize;
  seconds: number;
  price: number;
  cost: number;
}

export type GptImageModel = "gpt-image-1" | "gpt-image-1.5";

export interface GptImagePricingEstimate {
  currency: "USD";
  model: GptImageModel;
  text_input_tokens: number;
  text_cached_input_tokens: number;
  image_input_tokens: number;
  image_cached_input_tokens: number;
  text_output_tokens: number;
  image_output_tokens: number;
  cost: number;
}

function isSoraVideoModel(value: unknown): value is SoraVideoModel {
  return value === "sora-2" || value === "sora-2-pro";
}

function isGptImageModel(value: unknown): value is GptImageModel {
  return value === "gpt-image-1" || value === "gpt-image-1.5";
}

function isSoraVideoSeconds(value: unknown): value is SoraVideoSeconds {
  return value === "4" || value === "8" || value === "12";
}

function isSoraVideoSize(value: unknown): value is SoraVideoSize {
  return value === "720x1280"
    || value === "1280x720"
    || value === "1024x1792"
    || value === "1792x1024";
}

function centsToUsd(cents: number): number {
  return cents / 100;
}

function estimateSoraPricePerSecondCents(model: SoraVideoModel, size: SoraVideoSize): number | null {
  // Source: OpenAI Sora Video API price list (USD per second).
  if (model === "sora-2") {
    if (size === "720x1280" || size === "1280x720") return 10;
    return null;
  }

  // sora-2-pro
  if (size === "720x1280" || size === "1280x720") return 30;
  if (size === "1024x1792" || size === "1792x1024") return 50;
  return null;
}

export function estimateSoraVideoCost(input: {
  model: unknown;
  seconds: unknown;
  size: unknown;
}): SoraVideoPricingEstimate | null {
  if (!isSoraVideoModel(input.model)) return null;
  if (!isSoraVideoSeconds(input.seconds)) return null;
  if (!isSoraVideoSize(input.size)) return null;

  const seconds = Number.parseInt(input.seconds, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const pricePerSecondCents = estimateSoraPricePerSecondCents(input.model, input.size);
  if (pricePerSecondCents === null) return null;

  const estimatedCostCents = seconds * pricePerSecondCents;

  return {
    currency: "USD",
    model: input.model,
    size: input.size,
    seconds,
    price: centsToUsd(pricePerSecondCents),
    cost: centsToUsd(estimatedCostCents),
  };
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function estimateGptImageCost(input: {
  model: unknown;
  usage: unknown;
}): GptImagePricingEstimate | null {
  if (!isGptImageModel(input.model)) return null;
  if (!input.usage || typeof input.usage !== "object") return null;
  const record = input.usage as Record<string, unknown>;

  const inputTokensDetails = record["input_tokens_details"];
  if (!inputTokensDetails || typeof inputTokensDetails !== "object" || Array.isArray(inputTokensDetails)) return null;
  const details = inputTokensDetails as Record<string, unknown>;

  const textTokens = details["text_tokens"];
  const imageTokens = details["image_tokens"];
  const outputTokens = record["output_tokens"];

  if (!isFiniteNonNegativeNumber(textTokens)) return null;
  if (!isFiniteNonNegativeNumber(imageTokens)) return null;

  let cachedTextTokens = 0;
  let cachedImageTokens = 0;

  const cachedDetailsRaw = details["cached_tokens_details"];
  if (cachedDetailsRaw && typeof cachedDetailsRaw === "object" && !Array.isArray(cachedDetailsRaw)) {
    const cachedDetails = cachedDetailsRaw as Record<string, unknown>;
    const cachedText = cachedDetails["text_tokens"];
    const cachedImage = cachedDetails["image_tokens"];
    if (isFiniteNonNegativeNumber(cachedText)) cachedTextTokens = cachedText;
    if (isFiniteNonNegativeNumber(cachedImage)) cachedImageTokens = cachedImage;
  }

  cachedTextTokens = Math.min(cachedTextTokens, textTokens);
  cachedImageTokens = Math.min(cachedImageTokens, imageTokens);

  const uncachedTextTokens = textTokens - cachedTextTokens;
  const uncachedImageTokens = imageTokens - cachedImageTokens;

  // Output tokens:
  // - gpt-image-1: output_tokens (single bucket) priced as image output tokens.
  // - gpt-image-1.5: output_tokens_details may include separate text/image buckets.
  let textOutputTokens = 0;
  let imageOutputTokens = 0;

  if (input.model === "gpt-image-1.5") {
    const outputTokensDetailsRaw = record["output_tokens_details"];
    if (outputTokensDetailsRaw && typeof outputTokensDetailsRaw === "object" && !Array.isArray(outputTokensDetailsRaw)) {
      const outputDetails = outputTokensDetailsRaw as Record<string, unknown>;
      const outText = outputDetails["text_tokens"];
      const outImage = outputDetails["image_tokens"];
      if (isFiniteNonNegativeNumber(outText)) textOutputTokens = outText;
      if (isFiniteNonNegativeNumber(outImage)) imageOutputTokens = outImage;
    }

    if (textOutputTokens === 0 && imageOutputTokens === 0) {
      if (!isFiniteNonNegativeNumber(outputTokens)) return null;
      imageOutputTokens = outputTokens;
    }

    // Source: OpenAI pricing page (GPT Image 1.5).
    // - Text input:   $5.00  / 1M tokens
    // - Text cached:  $1.25  / 1M cached input tokens
    // - Text output:  $10.00 / 1M output tokens
    // - Image input:  $8.00  / 1M tokens
    // - Image cached: $2.00  / 1M cached input tokens
    // - Image output: $32.00 / 1M output tokens
    const cost = (uncachedTextTokens / 1_000_000) * 5
      + (cachedTextTokens / 1_000_000) * 1.25
      + (uncachedImageTokens / 1_000_000) * 8
      + (cachedImageTokens / 1_000_000) * 2
      + (textOutputTokens / 1_000_000) * 10
      + (imageOutputTokens / 1_000_000) * 32;

    return {
      currency: "USD",
      model: input.model,
      text_input_tokens: uncachedTextTokens,
      text_cached_input_tokens: cachedTextTokens,
      image_input_tokens: uncachedImageTokens,
      image_cached_input_tokens: cachedImageTokens,
      text_output_tokens: textOutputTokens,
      image_output_tokens: imageOutputTokens,
      cost,
    };
  }

  if (!isFiniteNonNegativeNumber(outputTokens)) return null;

  return {
    currency: "USD",
    model: input.model,
    text_input_tokens: uncachedTextTokens,
    text_cached_input_tokens: cachedTextTokens,
    image_input_tokens: uncachedImageTokens,
    image_cached_input_tokens: cachedImageTokens,
    text_output_tokens: 0,
    image_output_tokens: outputTokens,
    // Source: https://openai.com/api/pricing/ (Image Generation API)
    // - Text input:  $5.00 / 1M tokens
    // - Text cached: $1.25 / 1M cached input tokens
    // - Image input: $10.00 / 1M tokens
    // - Image cached:$2.50 / 1M cached input tokens
    // - Output:      $40.00 / 1M output tokens
    cost: (uncachedTextTokens / 1_000_000) * 5
      + (cachedTextTokens / 1_000_000) * 1.25
      + (uncachedImageTokens / 1_000_000) * 10
      + (cachedImageTokens / 1_000_000) * 2.5
      + (outputTokens / 1_000_000) * 40,
  };
}

export function estimateGptImage1Cost(usage: unknown): GptImagePricingEstimate | null {
  return estimateGptImageCost({ model: "gpt-image-1", usage });
}
