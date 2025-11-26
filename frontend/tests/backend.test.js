import { describe, expect, it } from "vitest";
import { resolveUrlWithBase } from "../src/lib/backend.js";

describe("resolveUrlWithBase", () => {
  it("keeps relative paths when no API base", () => {
    expect(resolveUrlWithBase("/api/test", "")).toBe("/api/test");
    expect(resolveUrlWithBase("frames/abc", "")).toBe("/frames/abc");
  });

  it("prefixes when base is provided", () => {
    expect(resolveUrlWithBase("/api/test", "http://backend.test")).toBe(
      "http://backend.test/api/test",
    );
    expect(resolveUrlWithBase("frames/abc", "http://backend.test")).toBe(
      "http://backend.test/frames/abc",
    );
  });

  it("returns absolute URLs unchanged", () => {
    const abs = "https://example.com/video.mp4";
    expect(resolveUrlWithBase(abs, "http://backend.test")).toBe(abs);
  });
});
