import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { clampPetDragPosition, type DragMonitor } from "./drag_bounds";

interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface WindowPort {
  outerPosition(): Promise<Point>;
  outerSize(): Promise<Size>;
  setPosition(position: PhysicalPosition): Promise<void>;
}

export class PetDragController {
  private generation = 0;
  private latestMove = 0;
  private active: { cursor: Point; position: Point; size: Size; monitors: DragMonitor[] } | null = null;
  private movement: Promise<void> = Promise.resolve();

  constructor(
    private readonly window: WindowPort,
    private readonly cursor: () => Promise<Point>,
    private readonly monitors: () => Promise<DragMonitor[]>,
  ) {}

  async begin(): Promise<void> {
    const generation = ++this.generation;
    this.active = null;
    const [position, size, cursor, monitors] = await Promise.all([
      this.window.outerPosition(), this.window.outerSize(), this.cursor(), this.monitors(),
    ]);
    if (generation === this.generation) this.active = { cursor, position, size, monitors };
  }

  move(): Promise<void> {
    const active = this.active;
    if (!active) return Promise.resolve();
    const move = ++this.latestMove;
    const next = this.movement.catch(() => {}).then(async () => {
      if (this.active !== active || move !== this.latestMove) return;
      const cursor = await this.cursor();
      if (this.active !== active || move !== this.latestMove) return;
      const position = clampPetDragPosition({
        x: active.position.x + cursor.x - active.cursor.x,
        y: active.position.y + cursor.y - active.cursor.y,
      }, active.size, active.monitors, cursor);
      await this.window.setPosition(new PhysicalPosition(position.x, position.y));
    });
    this.movement = next;
    return next;
  }

  end(): void {
    ++this.generation;
    ++this.latestMove;
    this.active = null;
  }
}
