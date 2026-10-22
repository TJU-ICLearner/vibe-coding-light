import { describe, expect, it } from "vitest";
import { petWindowSide, validPetScale } from "./window_size";

describe("pet window size", () => {
  it("keeps small pets at 128 and gives 3x pets a 400px window", () => {
    expect(petWindowSide(0.5)).toBe(128);
    expect(petWindowSide(0.8)).toBe(128);
    expect(petWindowSide(3)).toBe(400);
  });

  it("rejects non-finite and out-of-range scale", () => {
    for (const scale of [NaN, Infinity, -Infinity, 0.49, 3.01]) expect(validPetScale(scale)).toBe(false);
    expect(validPetScale(0.5)).toBe(true);
    expect(validPetScale(3)).toBe(true);
  });
});
