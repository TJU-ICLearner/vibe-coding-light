import { describe, expect, it, vi } from "vitest";
import { AssetDraft, validatePetFile } from "./asset_draft";
import type { PreparedAssetPayload } from "./types";

const png = (value: string): PreparedAssetPayload => ({ kind: "png", data_url: `data:image/png;base64,${value}` });
const file = (content: string) => new File([content], `${content}.png`, { type: "image/png" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("asset draft", () => {
  it("returns stable validation codes for size, format and transparent modes", () => {
    const huge = file("huge");
    Object.defineProperty(huge, "size", { value: 10 * 1024 * 1024 + 1 });
    expect(validatePetFile(huge, "keep_alpha")).toBe("too_large");
    expect(validatePetFile(new File(["x"], "x.gif", { type: "image/gif" }), "keep_alpha")).toBe("gif_requires_animation");
    expect(validatePetFile(file("still"), "keep_animation")).toBe("animation_requires_gif");
    expect(validatePetFile(new File(["x"], "x.webp", { type: "image/webp" }), "remove_background")).toBe("unsupported_format");
    expect(validatePetFile(new File(["x"], "x.jpg", { type: "image/jpeg" }), "keep_alpha")).toBe("alpha_requires_png");
  });
  it("selects only default in single mode and optional images in state mode", async () => {
    const draft = new AssetDraft();
    await draft.load("default", file("base"), "keep_alpha", async () => png("BASE"));
    await draft.load("working", file("work"), "keep_alpha", async () => png("WORK"));
    expect(draft.selected("single")).toEqual({ default: png("BASE") });
    expect(draft.selected("states")).toEqual({ default: png("BASE"), working: png("WORK") });
    expect(draft.get("working")?.asset).toEqual(png("WORK"));
  });

  it("keeps latest preview per slot when requests resolve out of order", async () => {
    const first = deferred<PreparedAssetPayload>();
    const second = deferred<PreparedAssetPayload>();
    const draft = new AssetDraft();
    const prepare = vi.fn((bytes: Uint8Array) => bytes[0] === 65 ? first.promise : second.promise);
    const a = draft.load("working", file("A"), "keep_alpha", prepare);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    const b = draft.load("working", file("B"), "keep_alpha", prepare);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    second.resolve(png("B")); await b;
    first.resolve(png("A")); await a;
    expect(draft.get("working")?.asset).toEqual(png("B"));
  });

  it("keeps another slot after a failed import and falls back to default", async () => {
    const draft = new AssetDraft();
    await draft.load("default", file("base"), "keep_alpha", async () => png("BASE"));
    await draft.load("working", file("bad"), "keep_alpha", async () => { throw new Error("broken GIF"); });
    expect(draft.get("default")?.asset).toEqual(png("BASE"));
    expect(draft.get("working")?.error).toEqual({ code: "internal_error", detail: "broken GIF" });
    expect(draft.selected("states")).toEqual({ default: png("BASE") });
  });
});
