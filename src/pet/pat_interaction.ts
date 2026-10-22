import type { AgentVisualState } from "./types";

const PAT_DURATION_MS = 800;

export class PatController {
  private timeout: number | null = null;
  private disposed = false;
  private latestState: AgentVisualState = "idle";

  constructor(
    private readonly wrapper: HTMLElement,
    private readonly hand: HTMLElement,
    private readonly renderState: (state: AgentVisualState) => void,
  ) {}

  setAgentState(state: AgentVisualState): void {
    this.latestState = state;
    this.renderState(state);
  }

  setPetScale(scale: number): void {
    this.cancel();
    const safeScale = Number.isFinite(scale) ? Math.min(3, Math.max(0.5, scale)) : 1;
    this.wrapper.style.setProperty("--pat-head-offset", `${Math.round(30 * safeScale)}px`);
  }

  start(): void {
    if (this.disposed) return;
    this.cancel();
    void this.hand.offsetWidth;
    this.wrapper.classList.add("patting");
    this.timeout = window.setTimeout(() => {
      this.timeout = null;
      this.wrapper.classList.remove("patting");
      this.renderState(this.latestState);
    }, PAT_DURATION_MS);
  }

  cancel(): void {
    if (this.timeout !== null) window.clearTimeout(this.timeout);
    this.timeout = null;
    this.wrapper.classList.remove("patting");
    this.renderState(this.latestState);
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }
}
