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

function isSoraVideoModel(value: unknown): value is SoraVideoModel {
  return value === "sora-2" || value === "sora-2-pro";
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
