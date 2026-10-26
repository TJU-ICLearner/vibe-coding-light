import { describe, expect, it } from "vitest";
import { clampPetDragPosition } from "./drag_bounds";

describe("pet drag bounds", () => {
  it("keeps the pet below the menu bar and inside the work area", () => {
    const monitor = { position: { x: 0, y: 0 }, size: { width: 1440, height: 900 }, workArea: { position: { x: 0, y: 25 }, size: { width: 1440, height: 830 } }, scaleFactor: 1 };
    expect(clampPetDragPosition({ x: 1400, y: -40 }, { width: 208, height: 208 }, [monitor])).toEqual({ x: 1232, y: 48 });
  });

  it("reserves physical pixels for the menu bar even in a full-screen space", () => {
    const monitor = { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } }, scaleFactor: 2 };
    expect(clampPetDragPosition({ x: 100, y: 0 }, { width: 416, height: 416 }, [monitor])).toEqual({ x: 100, y: 96 });
  });

  it("allows moving the pet to another monitor", () => {
    const first = { position: { x: 0, y: 0 }, size: { width: 1000, height: 800 }, workArea: { position: { x: 0, y: 24 }, size: { width: 1000, height: 750 } }, scaleFactor: 1 };
    const second = { position: { x: 1000, y: 0 }, size: { width: 1000, height: 800 }, workArea: { position: { x: 1000, y: 24 }, size: { width: 1000, height: 750 } }, scaleFactor: 1 };
    expect(clampPetDragPosition({ x: 1200, y: 300 }, { width: 208, height: 208 }, [first, second])).toEqual({ x: 1200, y: 300 });
    expect(clampPetDragPosition({ x: 900, y: 300 }, { width: 208, height: 208 }, [first, second])).toEqual({ x: 900, y: 300 });
  });

  it("keeps the pet on a narrower lower display", () => {
    const upper = { position: { x: 0, y: 0 }, size: { width: 2000, height: 800 }, workArea: { position: { x: 0, y: 24 }, size: { width: 2000, height: 750 } }, scaleFactor: 1 };
    const lower = { position: { x: 0, y: 800 }, size: { width: 1000, height: 800 }, workArea: { position: { x: 0, y: 800 }, size: { width: 1000, height: 800 } }, scaleFactor: 1 };
    expect(clampPetDragPosition({ x: 950, y: 1000 }, { width: 208, height: 208 }, [upper, lower], { x: 980, y: 1100 })).toEqual({ x: 792, y: 1000 });
  });
});
