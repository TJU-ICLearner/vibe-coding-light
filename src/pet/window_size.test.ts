import { describe, expect, it } from "vitest";
import { petMotionMetrics, petWindowSide, validPetScale } from "./window_size";

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

  it("keeps every motion inside the window at 3x, including the completed jump", () => {
    for (const scale of [0.5, 0.8, 3]) {
      const side = petWindowSide(scale);
      const motion = petMotionMetrics(scale);
      const half = 64 * scale;
      const limit = side / 2 - 1;
      expect(half + motion.shiftPx * scale).toBeLessThanOrEqual(limit);
      expect(half * motion.expand).toBeLessThanOrEqual(limit);
      expect(half * motion.completeExpand + motion.completeLiftPx * scale).toBeLessThanOrEqual(limit);
      const angle = motion.angleDeg * Math.PI / 180;
      expect(half * (Math.cos(angle) + Math.sin(angle))).toBeLessThanOrEqual(limit);
    }
  });
});
