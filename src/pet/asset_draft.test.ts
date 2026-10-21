import { describe, expect, it } from "vitest";
import { AssetDraft } from "./asset_draft";
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
    const a = draft.load("working", file("A"), "keep_alpha", async () => first.promise);
    const b = draft.load("working", file("B"), "keep_alpha", async () => second.promise);
    second.resolve(png("B")); await b;
    first.resolve(png("A")); await a;
    expect(draft.get("working")?.asset).toEqual(png("B"));
  });

  it("keeps another slot after a failed import and falls back to default", async () => {
    const draft = new AssetDraft();
    await draft.load("default", file("base"), "keep_alpha", async () => png("BASE"));
    await draft.load("working", file("bad"), "keep_alpha", async () => { throw new Error("broken GIF"); });
    expect(draft.get("default")?.asset).toEqual(png("BASE"));
    expect(draft.get("working")?.error).toContain("broken GIF");
    expect(draft.selected("states")).toEqual({ default: png("BASE") });
  });
});
