import { describe, expect, it, vi } from "vitest";
import { PetDragController } from "./drag_controller";

const monitor = {
  position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } }, scaleFactor: 2,
};

describe("pet drag controller", () => {
  it("does not move the window for a click", async () => {
    const window = {
      outerPosition: async () => ({ x: 1000, y: 500 }),
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: vi.fn(async () => {}),
    };
    const drag = new PetDragController(window, async () => [monitor]);
    const ready = drag.begin({ x: 200, y: 200 });
    const finished = drag.end({ x: 200, y: 200 });
    await Promise.all([ready, finished]);
    expect(window.setPosition).not.toHaveBeenCalled();
  });

  it("uses event coordinates for a short Retina drag while window position IPC is pending", async () => {
    let resolvePosition!: (point: { x: number; y: number }) => void;
    const initialPosition = new Promise<{ x: number; y: number }>((resolve) => { resolvePosition = resolve; });
    const positions: { x: number; y: number }[] = [];
    const window = {
      outerPosition: () => initialPosition,
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: async (position: { x: number; y: number }) => { positions.push({ x: position.x, y: position.y }); },
    };
    const drag = new PetDragController(window, async () => [monitor]);
    const ready = drag.begin({ x: 200, y: 200 });
    void drag.move({ x: 260, y: 230 });
    const finished = drag.end({ x: 260, y: 230 });
    resolvePosition({ x: 1000, y: 500 });
    await Promise.all([ready, finished]);
    expect(positions).toEqual([{ x: 560, y: 280 }]);
  });

  it("keeps the release position when the pointer moves elsewhere afterward", async () => {
    const positions: { x: number; y: number }[] = [];
    const window = {
      outerPosition: async () => ({ x: 1000, y: 500 }),
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: async (position: { x: number; y: number }) => { positions.push({ x: position.x, y: position.y }); },
    };
    const drag = new PetDragController(window, async () => [monitor]);
    await drag.begin({ x: 200, y: 200 });
    void drag.move({ x: 210, y: 200 });
    const finished = drag.end({ x: 260, y: 230 });
    void drag.move({ x: 900, y: 900 });
    await finished;
    expect(positions[positions.length - 1]).toEqual({ x: 560, y: 280 });
  });

  it("applies the latest event after a slow position update", async () => {
    let finishFirstPosition!: () => void;
    const firstPosition = new Promise<void>((resolve) => { finishFirstPosition = resolve; });
    const positions: { x: number; y: number }[] = [];
    const window = {
      outerPosition: async () => ({ x: 1000, y: 500 }),
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: vi.fn(async (position: { x: number; y: number }) => {
        positions.push({ x: position.x, y: position.y });
        if (positions.length === 1) await firstPosition;
      }),
    };
    const drag = new PetDragController(window, async () => [monitor]);
    await drag.begin({ x: 200, y: 200 });
    void drag.move({ x: 202, y: 200 });
    await vi.waitFor(() => expect(positions).toEqual([{ x: 502, y: 250 }]));
    void drag.move({ x: 240, y: 210 });
    const finished = drag.end({ x: 260, y: 230 });
    finishFirstPosition();
    await finished;
    expect(positions[positions.length - 1]).toEqual({ x: 560, y: 280 });
  });

  it("waits for the previous drag's final position before reading the next baseline", async () => {
    let finishFirstPosition!: () => void;
    const firstPosition = new Promise<void>((resolve) => { finishFirstPosition = resolve; });
    let current = { x: 1000, y: 500 };
    let positionsRead = 0;
    let positionsSet = 0;
    const window = {
      outerPosition: vi.fn(async () => { positionsRead++; return { ...current }; }),
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: async (position: { x: number; y: number }) => {
        positionsSet++;
        if (positionsSet === 1) await firstPosition;
        current = { x: position.x * 2, y: position.y * 2 };
      },
    };
    const drag = new PetDragController(window, async () => [monitor]);
    await drag.begin({ x: 200, y: 200 });
    void drag.move({ x: 250, y: 200 });
    const firstFinished = drag.end({ x: 250, y: 200 });
    const secondReady = drag.begin({ x: 300, y: 300 });
    await Promise.resolve();
    expect(positionsRead).toBe(1);
    finishFirstPosition();
    await Promise.all([firstFinished, secondReady]);
    void drag.move({ x: 330, y: 300 });
    await drag.end({ x: 330, y: 300 });
    expect(current).toEqual({ x: 1160, y: 500 });
  });

  it("keeps logical drag distance when moving from a 2x display to a 1x display", async () => {
    const mixedMonitors = [
      monitor,
      { position: { x: 1440, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { position: { x: 1440, y: 0 }, size: { width: 1920, height: 1080 } }, scaleFactor: 1 },
    ];
    const positions: { x: number; y: number }[] = [];
    const window = {
      outerPosition: async () => ({ x: 2600, y: 500 }),
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: async (position: { x: number; y: number }) => { positions.push({ x: position.x, y: position.y }); },
    };
    const drag = new PetDragController(window, async () => mixedMonitors);
    await drag.begin({ x: 1300, y: 250 });
    void drag.move({ x: 1600, y: 250 });
    await drag.end({ x: 1600, y: 250 });
    expect(positions[positions.length - 1]).toEqual({ x: 1600, y: 250 });
  });

  it("uses the just-submitted position if macOS acknowledges movement before its frame changes", async () => {
    const positions: { x: number; y: number }[] = [];
    const window = {
      outerPosition: async () => ({ x: 1000, y: 500 }),
      outerSize: async () => ({ width: 416, height: 416 }),
      scaleFactor: async () => 2,
      setPosition: async (position: { x: number; y: number }) => { positions.push({ x: position.x, y: position.y }); },
    };
    const drag = new PetDragController(window, async () => [monitor]);
    await drag.begin({ x: 200, y: 200 });
    void drag.move({ x: 250, y: 200 });
    await drag.end({ x: 250, y: 200 });
    await drag.begin({ x: 300, y: 300 });
    void drag.move({ x: 330, y: 300 });
    await drag.end({ x: 330, y: 300 });
    expect(positions[positions.length - 1]).toEqual({ x: 580, y: 250 });
  });

  it("retains the submitted baseline after a slow position IPC acknowledgement", async () => {
    let finishFirstPosition!: () => void;
    const firstPosition = new Promise<void>((resolve) => { finishFirstPosition = resolve; });
    let clock = 0;
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const positions: { x: number; y: number }[] = [];
      const window = {
        outerPosition: async () => ({ x: 1000, y: 500 }),
        outerSize: async () => ({ width: 416, height: 416 }),
        scaleFactor: async () => 2,
        setPosition: async (position: { x: number; y: number }) => {
          positions.push({ x: position.x, y: position.y });
          if (positions.length === 1) await firstPosition;
        },
      };
      const drag = new PetDragController(window, async () => [monitor]);
      await drag.begin({ x: 200, y: 200 });
      void drag.move({ x: 250, y: 200 });
      const firstFinished = drag.end({ x: 250, y: 200 });
      await vi.waitFor(() => expect(positions).toEqual([{ x: 550, y: 250 }]));
      clock = 600;
      finishFirstPosition();
      await firstFinished;
      await drag.begin({ x: 300, y: 300 });
      void drag.move({ x: 330, y: 300 });
      await drag.end({ x: 330, y: 300 });
      expect(positions[positions.length - 1]).toEqual({ x: 580, y: 250 });
    } finally {
      now.mockRestore();
    }
  });
});
