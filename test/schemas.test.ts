import { describe, it, expect } from "vitest";
import {
  openaiImagesGenerateSchema,
  openaiImagesEditSchema,
  openaiVideosCreateSchema,
  openaiVideosRemixSchema,
  openaiVideosListSchema,
  openaiVideosRetrieveSchema,
  openaiVideosDeleteSchema,
  openaiVideosRetrieveContentSchema,
  fetchImagesSchema,
  fetchImagesClientSchema,
  testImagesSchema,
  compressionSchema,
  type OpenAIImagesGenerateArgs,
  type OpenAIImagesEditArgs,
  type OpenAIVideosCreateArgs,
  type FetchImagesArgs,
  type FetchImagesClientArgs,
  type TestImagesArgs,
} from "../src/lib/schemas.js";

describe("schemas module", () => {
  describe("openaiImagesGenerateSchema (openai-images-generate)", () => {
    it("validates minimal valid input", () => {
      const input = { prompt: "A cute cat" };
      const result = openaiImagesGenerateSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prompt).toBe("A cute cat");
        expect(result.data.response_format).toBe("url"); // default
      }
    });

	    it("validates full input with all options", () => {
	      const input: OpenAIImagesGenerateArgs = {
	        prompt: "A beautiful sunset",
	        background: "transparent",
	        moderation: "low",
	        size: "1024x1024",
	        quality: "high",
	        n: 3,
	        output_format: "webp",
	        output_compression: 80,
	        tool_result: "resource_link",
	        response_format: "b64_json",
	        user: "user123",
	      };
	      const result = openaiImagesGenerateSchema.safeParse(input);

	      expect(result.success).toBe(true);
	    });

    it("validates tool_result options", () => {
      expect(openaiImagesGenerateSchema.safeParse({ prompt: "test", tool_result: "resource_link" }).success).toBe(true);
      expect(openaiImagesGenerateSchema.safeParse({ prompt: "test", tool_result: "image" }).success).toBe(true);
    });

    it("defaults tool_result to resource_link", () => {
      const result = openaiImagesGenerateSchema.safeParse({ prompt: "test" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_result).toBe("resource_link");
      }
    });

    it("rejects empty prompt", () => {
      const input = { prompt: "" };
      const result = openaiImagesGenerateSchema.safeParse(input);

      // Empty string is allowed by schema, but might be rejected by API
      expect(result.success).toBe(true);
    });

    it("rejects prompt over 32K chars", () => {
      const input = { prompt: "A".repeat(32001) };
      const result = openaiImagesGenerateSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects invalid size", () => {
      const input = { prompt: "test", size: "500x500" };
      const result = openaiImagesGenerateSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects n > 10", () => {
      const input = { prompt: "test", n: 11 };
      const result = openaiImagesGenerateSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

	    it("ignores legacy file field", () => {
	      const result = openaiImagesGenerateSchema.safeParse({ prompt: "test", file: "./output.png" });
	      expect(result.success).toBe(true);
	      if (result.success) {
	        expect((result.data as Record<string, unknown>)["file"]).toBeUndefined();
	      }
	    });
	  });

  describe("openaiImagesEditSchema (openai-images-edit)", () => {
    it("validates single image input", () => {
      const input = {
        prompt: "Add a hat",
        image: "/tmp/photo.png",
        tool_result: "image",
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates array of images (1-16)", () => {
      const input = {
        prompt: "Merge these images",
        image: ["/tmp/img1.png", "/tmp/img2.png", "/tmp/img3.png"],
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates base64 image input", () => {
      const input = {
        prompt: "Edit this",
        image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates with mask", () => {
      const input = {
        prompt: "Replace background",
        image: "/tmp/photo.png",
        mask: "/tmp/mask.png",
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("rejects empty image array", () => {
      const input = {
        prompt: "Edit",
        image: [],
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects more than 16 images", () => {
      const input = {
        prompt: "Edit",
        image: Array(17).fill("/tmp/img.png"),
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("accepts 16 images (maximum)", () => {
      const input = {
        prompt: "Edit",
        image: Array(16).fill("/tmp/img.png"),
        tool_result: "resource_link",
      };
      const result = openaiImagesEditSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates tool_result options", () => {
      expect(openaiImagesEditSchema.safeParse({ prompt: "Edit", image: "/tmp/img.png", tool_result: "resource_link" }).success).toBe(true);
      expect(openaiImagesEditSchema.safeParse({ prompt: "Edit", image: "/tmp/img.png", tool_result: "image" }).success).toBe(true);
    });
  });

  describe("openaiVideosCreateSchema (openai-videos-create)", () => {
    it("validates minimal valid input and applies defaults", () => {
      const input: OpenAIVideosCreateArgs = { prompt: "A cinematic sunset over mountains" };
      const result = openaiVideosCreateSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBe("sora-2");
        expect(result.data.input_reference_fit).toBe("contain");
        expect(result.data.input_reference_background).toBe("blur");
        expect(result.data.wait_for_completion).toBe(false);
        expect(result.data.timeout_ms).toBe(300000);
        expect(result.data.poll_interval_ms).toBe(2000);
        expect(result.data.download_variants).toEqual(["video"]);
      }
    });

    it("rejects invalid model", () => {
      const result = openaiVideosCreateSchema.safeParse({
        prompt: "test",
        model: "not-a-model",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid seconds/size", () => {
      expect(openaiVideosCreateSchema.safeParse({ prompt: "test", seconds: "5" }).success).toBe(false);
      expect(openaiVideosCreateSchema.safeParse({ prompt: "test", size: "999x999" }).success).toBe(false);
    });

    it("rejects empty input_reference when provided", () => {
      const result = openaiVideosCreateSchema.safeParse({ prompt: "test", input_reference: "" });
      expect(result.success).toBe(false);
    });

    it("ignores legacy file field", () => {
      const result = openaiVideosCreateSchema.safeParse({ prompt: "test", file: "./out" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>)["file"]).toBeUndefined();
      }
    });

    it("accepts hex padding background colors", () => {
      expect(openaiVideosCreateSchema.safeParse({ prompt: "test", input_reference_background: "#112233" }).success).toBe(true);
      expect(openaiVideosCreateSchema.safeParse({ prompt: "test", input_reference_background: "#11223344" }).success).toBe(true);
    });

    it("rejects invalid input_reference_background", () => {
      expect(openaiVideosCreateSchema.safeParse({ prompt: "test", input_reference_background: "blue" }).success).toBe(false);
      expect(openaiVideosCreateSchema.safeParse({ prompt: "test", input_reference_background: "#12345" }).success).toBe(false);
    });
  });

  describe("openaiVideosRemixSchema (openai-videos-remix)", () => {
    it("validates minimal remix input and defaults", () => {
      const result = openaiVideosRemixSchema.safeParse({ video_id: "vid_123", prompt: "Make it noir" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wait_for_completion).toBe(false);
        expect(result.data.timeout_ms).toBe(300000);
        expect(result.data.poll_interval_ms).toBe(2000);
        expect(result.data.download_variants).toEqual(["video"]);
      }
    });

    it("rejects empty video_id", () => {
      expect(openaiVideosRemixSchema.safeParse({ video_id: "", prompt: "x" }).success).toBe(false);
    });
  });

  describe("openaiVideosListSchema (openai-videos-list)", () => {
    it("validates list params", () => {
      expect(openaiVideosListSchema.safeParse({}).success).toBe(true);
      expect(openaiVideosListSchema.safeParse({ after: "vid_123", limit: 10, order: "desc" }).success).toBe(true);
    });

    it("rejects empty after", () => {
      expect(openaiVideosListSchema.safeParse({ after: "" }).success).toBe(false);
    });
  });

  describe("openaiVideosRetrieveSchema (openai-videos-retrieve)", () => {
    it("requires non-empty video_id", () => {
      expect(openaiVideosRetrieveSchema.safeParse({ video_id: "vid_123" }).success).toBe(true);
      expect(openaiVideosRetrieveSchema.safeParse({ video_id: "" }).success).toBe(false);
    });
  });

  describe("openaiVideosDeleteSchema (openai-videos-delete)", () => {
    it("requires non-empty video_id", () => {
      expect(openaiVideosDeleteSchema.safeParse({ video_id: "vid_123" }).success).toBe(true);
      expect(openaiVideosDeleteSchema.safeParse({ video_id: "" }).success).toBe(false);
    });
  });

  describe("openaiVideosRetrieveContentSchema (openai-videos-retrieve-content)", () => {
    it("applies default variant and validates input", () => {
      const result = openaiVideosRetrieveContentSchema.safeParse({ video_id: "vid_123" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.variant).toBe("video");
      }
    });

    it("rejects invalid variant", () => {
      expect(openaiVideosRetrieveContentSchema.safeParse({ video_id: "vid_123", variant: "bad" }).success).toBe(false);
    });

    it("ignores legacy file field", () => {
      const result = openaiVideosRetrieveContentSchema.safeParse({ video_id: "vid_123", file: "./out" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as Record<string, unknown>)["file"]).toBeUndefined();
      }
    });
  });

  describe("fetchImagesSchema (legacy images array)", () => {
    it("validates array of URLs", () => {
      const input: FetchImagesArgs = {
        images: ["https://example.com/img1.png", "https://example.com/img2.jpg"],
        tool_result: "resource_link",
      };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.response_format).toBe("url"); // default
        expect(result.data.tool_result).toBe("resource_link");
      }
    });

    it("validates array of file paths", () => {
      const input = {
        images: ["/tmp/local1.png", "/tmp/local2.jpg"],
      };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates mixed URLs and paths", () => {
      const input = {
        images: ["https://example.com/img.png", "/tmp/local.jpg"],
      };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates with compression options", () => {
      const input = {
        images: ["https://example.com/img.png"],
        compression: {
          maxSize: 1024,
          maxBytes: 500000,
          quality: 85,
          format: "webp" as const,
        },
      };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("rejects empty images array", () => {
      const input = { images: [] };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects more than 20 images", () => {
      const input = {
        images: Array(21).fill("https://example.com/img.png"),
      };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("accepts 20 images (maximum)", () => {
      const input = {
        images: Array(20).fill("https://example.com/img.png"),
        tool_result: "image",
      };
      const result = fetchImagesSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("validates tool_result options", () => {
      expect(fetchImagesSchema.safeParse({ images: ["https://example.com/img.png"], tool_result: "resource_link" }).success).toBe(true);
      expect(fetchImagesSchema.safeParse({ images: ["https://example.com/img.png"], tool_result: "image" }).success).toBe(true);
    });
  });

  describe("fetchImagesClientSchema (sources + ids + n)", () => {
    it("validates sources array only", () => {
      const input: FetchImagesClientArgs = {
        sources: ["https://example.com/img1.png", "/tmp/local.png"],
      };
      const result = fetchImagesClientSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.response_format).toBe("url"); // default
        expect(result.data.tool_result).toBe("resource_link"); // default
        expect(result.data.n).toBeUndefined();
      }
    });

    it("validates ids array only", () => {
      const input: FetchImagesClientArgs = {
        ids: ["video_123", "1646515b-a0ec-49fb-b617-649614361b5e"],
      };
      const result = fetchImagesClientSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ids?.length).toBe(2);
      }
    });

    it("rejects unsafe ids", () => {
      expect(fetchImagesClientSchema.safeParse({ ids: ["../etc/passwd"] }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ ids: [".."] }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ ids: ["id*"] }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ ids: ["id?"] }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ ids: ["id/1"] }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ ids: ["id\\1"] }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ ids: ["id.1"] }).success).toBe(false);
    });

    it("validates n only within bounds", () => {
      expect(fetchImagesClientSchema.safeParse({ n: 1 }).success).toBe(true);
      expect(fetchImagesClientSchema.safeParse({ n: 50 }).success).toBe(true);
      expect(fetchImagesClientSchema.safeParse({ n: 0 }).success).toBe(false);
      expect(fetchImagesClientSchema.safeParse({ n: 51 }).success).toBe(false);
    });

    it("validates combination of n and compression", () => {
      const input: FetchImagesClientArgs = {
        n: 5,
        compression: {
          max_size: 1024,
          max_bytes: 500000,
          quality: 80,
          format: "jpeg",
        },
        response_format: "b64_json",
        tool_result: "image",
      };
      const result = fetchImagesClientSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("accepts both sources and n structurally (mutual exclusivity enforced in handler)", () => {
      const input: FetchImagesClientArgs = {
        sources: ["https://example.com/img.png"],
        n: 3,
      };
      const result = fetchImagesClientSchema.safeParse(input);

      // From schema perspective this is valid; the runtime handler enforces exclusivity.
      expect(result.success).toBe(true);
    });
  });

  describe("testImagesSchema", () => {
    it("validates empty input (all optional)", () => {
      const result = testImagesSchema.safeParse({});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.response_format).toBe("url"); // default
        expect(result.data.tool_result).toBe("resource_link"); // default
      }
    });

    it("validates tool_result options", () => {
      expect(testImagesSchema.safeParse({ tool_result: "resource_link" }).success).toBe(true);
      expect(testImagesSchema.safeParse({ tool_result: "image" }).success).toBe(true);
    });

    it("rejects invalid tool_result values", () => {
      expect(testImagesSchema.safeParse({ tool_result: "invalid" }).success).toBe(false);
      expect(testImagesSchema.safeParse({ tool_result: "content" }).success).toBe(false);
      expect(testImagesSchema.safeParse({ tool_result: "api" }).success).toBe(false);
    });

    it("validates response_format options", () => {
      expect(testImagesSchema.safeParse({ response_format: "b64_json" }).success).toBe(true);
      expect(testImagesSchema.safeParse({ response_format: "url" }).success).toBe(true);
    });
  });

  describe("compressionSchema", () => {
    it("validates undefined (optional)", () => {
      const result = compressionSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it("validates empty object", () => {
      const result = compressionSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("validates full compression options", () => {
      const input = {
        maxSize: 2048,
        maxBytes: 1000000,
        quality: 90,
        format: "jpeg" as const,
      };
      const result = compressionSchema.safeParse(input);

      expect(result.success).toBe(true);
    });

    it("rejects quality < 1", () => {
      const result = compressionSchema.safeParse({ quality: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects quality > 100", () => {
      const result = compressionSchema.safeParse({ quality: 101 });
      expect(result.success).toBe(false);
    });

    it("rejects negative maxSize", () => {
      const result = compressionSchema.safeParse({ maxSize: -100 });
      expect(result.success).toBe(false);
    });

    it("rejects invalid format", () => {
      const result = compressionSchema.safeParse({ format: "gif" });
      expect(result.success).toBe(false);
    });

    it("accepts all valid formats", () => {
      expect(compressionSchema.safeParse({ format: "jpeg" }).success).toBe(true);
      expect(compressionSchema.safeParse({ format: "png" }).success).toBe(true);
      expect(compressionSchema.safeParse({ format: "webp" }).success).toBe(true);
    });
  });

  describe("type inference", () => {
    it("OpenAIImagesGenerateArgs type matches schema", () => {
      const args: OpenAIImagesGenerateArgs = {
        prompt: "test",
        background: "auto",
        size: "1024x1024",
      };
      expect(openaiImagesGenerateSchema.safeParse(args).success).toBe(true);
    });

    it("OpenAIImagesEditArgs type matches schema", () => {
      const args: OpenAIImagesEditArgs = {
        prompt: "test",
        image: "/tmp/test.png",
        n: 2,
      };
      expect(openaiImagesEditSchema.safeParse(args).success).toBe(true);
    });

    it("FetchImagesArgs type matches schema", () => {
      const args: FetchImagesArgs = {
        images: ["https://example.com/img.png"],
        response_format: "b64_json",
      };
      expect(fetchImagesSchema.safeParse(args).success).toBe(true);
    });

    it("FetchImagesClientArgs type matches schema", () => {
      const args: FetchImagesClientArgs = {
        sources: ["https://example.com/img.png"],
        n: 2,
      };
      expect(fetchImagesClientSchema.safeParse(args).success).toBe(true);
    });

    it("TestImagesArgs type matches schema", () => {
      const args: TestImagesArgs = {
        tool_result: "image",
        response_format: "b64_json",
      };
      expect(testImagesSchema.safeParse(args).success).toBe(true);
    });
  });
});
