import { describe, it, expect } from "vitest";
import { estimateSoraVideoCost } from "../src/lib/pricing.js";

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
});
