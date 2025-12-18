import { describe, it, expect } from "vitest";
import { estimateSoraVideoCost, estimateGptImageCost } from "../src/lib/pricing.js";

describe("pricing module", () => {
  describe("estimateSoraVideoCost", () => {
    it("estimates cost for sora-2 (720x1280)", () => {
      expect(estimateSoraVideoCost({
        model: "sora-2",
        size: "720x1280",
        seconds: "4",
      })).toEqual({
        currency: "USD",
        model: "sora-2",
        size: "720x1280",
        seconds: 4,
        price: 0.1,
        cost: 0.4,
      });
    });

    it("estimates cost for sora-2-pro (720x1280)", () => {
      const result = estimateSoraVideoCost({
        model: "sora-2-pro",
        size: "720x1280",
        seconds: "12",
      });
      expect(result).toMatchObject({
        currency: "USD",
        model: "sora-2-pro",
        size: "720x1280",
        seconds: 12,
        price: 0.3,
        cost: 3.6,
      });
    });

    it("estimates cost for sora-2-pro (1024x1792)", () => {
      const result = estimateSoraVideoCost({
        model: "sora-2-pro",
        size: "1024x1792",
        seconds: "8",
      });
      expect(result).toMatchObject({
        currency: "USD",
        model: "sora-2-pro",
        size: "1024x1792",
        seconds: 8,
        price: 0.5,
        cost: 4,
      });
    });

    it("returns null for unknown model", () => {
      expect(estimateSoraVideoCost({
        model: "unknown-model",
        size: "720x1280",
        seconds: "4",
      })).toBeNull();
    });

    it("returns null for unknown seconds", () => {
      expect(estimateSoraVideoCost({
        model: "sora-2",
        size: "720x1280",
        seconds: "999",
      })).toBeNull();
    });
  });

  describe("estimateGptImageCost", () => {
    it("estimates token-based cost for gpt-image-1.5", () => {
      // Text input: 1000 @ $5/1M   = $0.005
      // Image input: 2000 @ $8/1M  = $0.016
      // Text output: 500 @ $10/1M  = $0.005
      // Image output: 2500 @ $32/1M = $0.08
      // total = $0.106
      const result = estimateGptImageCost({
        model: "gpt-image-1.5",
        usage: {
          input_tokens: 3000,
          input_tokens_details: { text_tokens: 1000, image_tokens: 2000 },
          output_tokens: 3000,
          output_tokens_details: { text_tokens: 500, image_tokens: 2500 },
          total_tokens: 6000,
        },
      });
      expect(result).toMatchObject({
        currency: "USD",
        model: "gpt-image-1.5",
        text_input_tokens: 1000,
        text_cached_input_tokens: 0,
        image_input_tokens: 2000,
        image_cached_input_tokens: 0,
        text_output_tokens: 500,
        image_output_tokens: 2500,
      });
      expect(result?.cost ?? NaN).toBeCloseTo(0.106, 12);
    });

    it("uses cached token rates when provided", () => {
      // Text: 1000 total, 400 cached
      // - uncached: 600 @ $5/1M  = 0.003
      // - cached:   400 @ $1.25/1M = 0.0005
      // Image: 2000 total, 500 cached
      // - uncached: 1500 @ $8/1M = 0.012
      // - cached:   500 @ $2/1M = 0.001
      // Output: text 600 @ $10/1M = 0.006, image 2400 @ $32/1M = 0.0768
      // total = 0.0993
      const result = estimateGptImageCost({
        model: "gpt-image-1.5",
        usage: {
          input_tokens: 3000,
          input_tokens_details: {
            text_tokens: 1000,
            image_tokens: 2000,
            cached_tokens_details: { text_tokens: 400, image_tokens: 500 },
          },
          output_tokens: 3000,
          output_tokens_details: { text_tokens: 600, image_tokens: 2400 },
          total_tokens: 6000,
        },
      });
      expect(result).toMatchObject({
        currency: "USD",
        model: "gpt-image-1.5",
        text_input_tokens: 600,
        text_cached_input_tokens: 400,
        image_input_tokens: 1500,
        image_cached_input_tokens: 500,
        text_output_tokens: 600,
        image_output_tokens: 2400,
      });
      expect(result?.cost ?? NaN).toBeCloseTo(0.0993, 12);
    });

    it("returns null when usage is missing required fields", () => {
      expect(estimateGptImageCost({ model: "gpt-image-1.5", usage: null })).toBeNull();
      expect(estimateGptImageCost({ model: "gpt-image-1.5", usage: {} })).toBeNull();
      expect(estimateGptImageCost({
        model: "gpt-image-1.5",
        usage: { input_tokens_details: { text_tokens: 1, image_tokens: 1 } },
      })).toBeNull();
      expect(estimateGptImageCost({
        model: "gpt-image-1.5",
        usage: { input_tokens_details: { text_tokens: "1", image_tokens: 1 }, output_tokens: 1 },
      })).toBeNull();
    });

    it("returns null for unknown model", () => {
      expect(estimateGptImageCost({
        model: "gpt-image-unknown",
        usage: {
          input_tokens_details: { text_tokens: 1, image_tokens: 1 },
          output_tokens: 1,
        },
      })).toBeNull();
    });
  });
});
