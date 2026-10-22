import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import type { ActivePet } from "./types";
import { BUILTIN_PET_WINDOW_SIDE, petFitScale, petWindowSide } from "./window_size";

interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface Area { position: Point; size: Size }
interface WindowPort {
  scaleFactor(): Promise<number>;
  innerSize(): Promise<Size>;
  outerPosition(): Promise<Point>;
  setSize(size: LogicalSize): Promise<void>;
  setPosition(position: PhysicalPosition): Promise<void>;
}

export function clampCenteredPosition(oldPosition: Point, oldSide: number, newSide: number, area: Area | null): Point {
  const centered = {
    x: Math.round(oldPosition.x + (oldSide - newSide) / 2),
    y: Math.round(oldPosition.y + (oldSide - newSide) / 2),
  };
  if (!area) return centered;
  return {
    x: Math.min(Math.max(centered.x, area.position.x), Math.max(area.position.x, area.position.x + area.size.width - newSide)),
    y: Math.min(Math.max(centered.y, area.position.y), Math.max(area.position.y, area.position.y + area.size.height - newSide)),
  };
}

export class PetWindowSizer {
  private latest = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly window: WindowPort,
    private readonly monitor: () => Promise<{ workArea: Area } | null>,
    private readonly onFit: (scale: number | null) => void,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  request(pet: ActivePet): Promise<void> {
    const requestId = ++this.latest;
    this.queue = this.queue.catch(this.onError).then(async () => {
      if (requestId !== this.latest) return;
      const side = pet.kind === "builtin" ? BUILTIN_PET_WINDOW_SIDE : petWindowSide(pet.scale);
      const [factor, oldSize, oldPosition, currentMonitor] = await Promise.all([
        this.window.scaleFactor(), this.window.innerSize(), this.window.outerPosition(), this.monitor(),
      ]);
      if (requestId !== this.latest) return;
      try {
        await this.window.setSize(new LogicalSize(side, side));
      } catch (error) {
        this.onError(error);
        if (requestId === this.latest) this.onFit(pet.kind === "photo" ? petFitScale(pet.scale, Math.min(oldSize.width, oldSize.height) / factor) : null);
        return;
      }
      if (requestId === this.latest) this.onFit(null);
      const oldSide = Math.max(oldSize.width, oldSize.height);
      const nextPosition = clampCenteredPosition(oldPosition, oldSide, Math.round(side * factor), currentMonitor?.workArea ?? null);
      try {
        await this.window.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
      } catch (error) { this.onError(error); }
    }).catch(this.onError);
    return this.queue;
  }
}
