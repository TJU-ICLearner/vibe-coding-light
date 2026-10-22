import { describe, expect, it, vi } from "vitest";
import { PetWindowSizer, clampCenteredPosition } from "./window_sizer";
import type { ActivePet } from "./types";

const photo = (scale: number): ActivePet => ({ kind: "photo", id: "p", assets: {}, motions: {}, invalid_slots: [], scale, offset_x: 0, offset_y: 0 });

describe("pet window resize", () => {
  it("keeps the old center and clamps to the monitor work area", () => {
    expect(clampCenteredPosition({ x: 200, y: 150 }, 128, 400, { position: { x: 0, y: 0 }, size: { width: 1000, height: 800 } })).toEqual({ x: 64, y: 14 });
    expect(clampCenteredPosition({ x: 900, y: 700 }, 128, 400, { position: { x: 0, y: 0 }, size: { width: 1000, height: 800 } })).toEqual({ x: 600, y: 400 });
  });

  it("serializes rapid selection and ends at the built-in window size", async () => {
    const sizes: number[] = [];
    const port = {
      scaleFactor: vi.fn(async () => 1), innerSize: vi.fn(async () => ({ width: sizes[sizes.length - 1] ?? 128, height: sizes[sizes.length - 1] ?? 128 })),
      outerPosition: vi.fn(async () => ({ x: 100, y: 100 })),
      setSize: vi.fn(async (size: { width: number }) => { sizes.push(size.width); }),
      setPosition: vi.fn(async () => {}),
    };
    const fit = vi.fn();
    const sizer = new PetWindowSizer(port, async () => null, fit);
    await Promise.all([sizer.request(photo(3)), sizer.request(photo(0.8)), sizer.request({ kind: "builtin" })]);
    expect(sizes[sizes.length - 1]).toBe(128);
    expect(fit).toHaveBeenLastCalledWith(null);
  });

  it("reports a fit scale when native resize rejects", async () => {
    const port = {
      scaleFactor: vi.fn(async () => 1), innerSize: vi.fn(async () => ({ width: 128, height: 128 })),
      outerPosition: vi.fn(async () => ({ x: 100, y: 100 })),
      setSize: vi.fn(async () => { throw new Error("resize failed"); }),
      setPosition: vi.fn(async () => {}),
    };
    const fit = vi.fn();
    const sizer = new PetWindowSizer(port, async () => null, fit);
    await sizer.request(photo(3));
    expect(fit).toHaveBeenCalledWith(0.875);
  });

  it("uses physical pixels for centering on a high-density display", async () => {
    const port = {
      scaleFactor: vi.fn(async () => 2), innerSize: vi.fn(async () => ({ width: 256, height: 256 })),
      outerPosition: vi.fn(async () => ({ x: 1700, y: 900 })),
      setSize: vi.fn(async (_size: { width: number }) => {}), setPosition: vi.fn(async (_position: { x: number; y: number }) => {}),
    };
    await new PetWindowSizer(port, async () => ({ workArea: { position: { x: 0, y: 0 }, size: { width: 2000, height: 1200 } } }), vi.fn()).request(photo(3));
    expect(port.setSize.mock.calls[0][0]).toMatchObject({ width: 400, height: 400 });
    expect(port.setPosition.mock.calls[0][0]).toMatchObject({ x: 1200, y: 400 });
  });
});
