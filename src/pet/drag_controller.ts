import { LogicalPosition } from "@tauri-apps/api/dpi";
import { clampPetDragPosition, type DragMonitor } from "./drag_bounds";

interface Point { x: number; y: number }
interface Size { width: number; height: number }
interface WindowPort {
  outerPosition(): Promise<Point>;
  outerSize(): Promise<Size>;
  scaleFactor(): Promise<number>;
  setPosition(position: LogicalPosition): Promise<void>;
}

interface DragSession {
  start: Point;
  latest: Point;
  moved: boolean;
  released: boolean;
  dirty: boolean;
  ready: Promise<void>;
  position?: Point;
  size?: Size;
  monitors?: DragMonitor[];
  worker: Promise<void> | null;
}

export class PetDragController {
  private active: DragSession | null = null;
  private previousDrag: Promise<void> = Promise.resolve();
  private lastRequested: { position: Point; at: number } | null = null;

  constructor(
    private readonly window: WindowPort,
    private readonly monitors: () => Promise<DragMonitor[]>,
  ) {}

  begin(point: Point): Promise<void> {
    if (this.active) void this.end(this.active.latest);
    const session: DragSession = {
      start: { ...point }, latest: { ...point }, moved: false, released: false, dirty: false,
      ready: Promise.resolve(), worker: null,
    };
    this.active = session;
    const previousDrag = this.previousDrag.catch(() => {});
    session.ready = (async () => {
      await previousDrag;
      const [physicalPosition, physicalSize, scaleFactor, physicalMonitors] = await Promise.all([
        this.window.outerPosition(), this.window.outerSize(), this.window.scaleFactor(), this.monitors(),
      ]);
      const actual = { x: physicalPosition.x / scaleFactor, y: physicalPosition.y / scaleFactor };
      const recent = this.lastRequested && Date.now() - this.lastRequested.at < 500;
      session.position = recent ? this.lastRequested!.position : actual;
      this.lastRequested = null;
      session.size = { width: physicalSize.width / scaleFactor, height: physicalSize.height / scaleFactor };
      session.monitors = physicalMonitors.map((item) => ({
        position: { x: item.position.x / item.scaleFactor, y: item.position.y / item.scaleFactor },
        size: { width: item.size.width / item.scaleFactor, height: item.size.height / item.scaleFactor },
        workArea: {
          position: { x: item.workArea.position.x / item.scaleFactor, y: item.workArea.position.y / item.scaleFactor },
          size: { width: item.workArea.size.width / item.scaleFactor, height: item.workArea.size.height / item.scaleFactor },
        },
        scaleFactor: 1,
      }));
    })();
    return session.ready;
  }

  move(point: Point): Promise<void> {
    const session = this.active;
    if (!session || session.released) return Promise.resolve();
    session.latest = { ...point };
    session.moved = true;
    session.dirty = true;
    return session.ready.then(() => this.drain(session));
  }

  end(point: Point): Promise<void> {
    const session = this.active;
    if (!session) return Promise.resolve();
    session.released = true;
    this.active = null;
    if (session.moved) {
      session.latest = { ...point };
      session.dirty = true;
    }
    this.previousDrag = session.ready.then(() => this.drain(session));
    return this.previousDrag;
  }

  private drain(session: DragSession): Promise<void> {
    if (session.worker) return session.worker;
    if (!session.dirty) return Promise.resolve();
    const worker = (async () => {
      while (session.dirty) {
        session.dirty = false;
        const point = session.latest;
        const position = clampPetDragPosition({
          x: Math.round(session.position!.x + point.x - session.start.x),
          y: Math.round(session.position!.y + point.y - session.start.y),
        }, session.size!, session.monitors!);
        await this.window.setPosition(new LogicalPosition(position.x, position.y));
        this.lastRequested = { position, at: Date.now() };
      }
    })();
    session.worker = worker.finally(() => { session.worker = null; });
    return session.worker;
  }
}
