import { describe, expect, it, vi } from "vitest";
import { PetDragController } from "./drag_controller";

const monitor = { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 }, workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } }, scaleFactor: 2 };

describe("pet drag controller", () => {
  it("ignores moves while initialization is pending and after mouse release", async () => {
    let resolvePosition!: (position: { x: number; y: number }) => void;
    const position = new Promise<{ x: number; y: number }>((resolve) => { resolvePosition = resolve; });
    const window = { outerPosition: vi.fn(() => position), outerSize: vi.fn(async () => ({ width: 416, height: 416 })), setPosition: vi.fn(async () => {}) };
    const drag = new PetDragController(window, async () => ({ x: 200, y: 200 }), async () => [monitor]);
    const starting = drag.begin();
    await drag.move();
    expect(window.setPosition).not.toHaveBeenCalled();
    drag.end();
    resolvePosition({ x: 1000, y: 500 });
    await starting;
    await drag.move();
    expect(window.setPosition).not.toHaveBeenCalled();
  });

  it("uses physical cursor coordinates for accurate Retina movement", async () => {
    const window = { outerPosition: vi.fn(async () => ({ x: 1000, y: 500 })), outerSize: vi.fn(async () => ({ width: 416, height: 416 })), setPosition: vi.fn(async () => {}) };
    const cursor = vi.fn().mockResolvedValueOnce({ x: 400, y: 300 }).mockResolvedValueOnce({ x: 500, y: 350 });
    const drag = new PetDragController(window, cursor, async () => [monitor]);
    await drag.begin();
    await drag.move();
    expect(window.setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 1100, y: 550 }));
  });
});
