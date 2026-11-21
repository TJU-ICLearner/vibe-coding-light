import { applyAppearance } from "../appearance";
import type { TrayPanelApi, TrayPanelState } from "./api";
export type TrayTab = "overview" | "agents" | "settings";
export interface TrayViewState { state: TrayPanelState | null; tab: TrayTab; pending: boolean; refreshing: boolean; error: boolean }
export class TrayPanelModel {
  private snapshot: TrayViewState = { state: null, tab: "overview", pending: false, refreshing: false, error: false };
  private listeners = new Set<() => void>();
  private refreshGeneration = 0;
  private disposed = false;
  constructor(private readonly api: TrayPanelApi) {}
  getSnapshot = (): TrayViewState => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<TrayViewState>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    if (patch.state) {
      document.documentElement.lang = patch.state.locale;
      applyAppearance(patch.state.appearance, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
    }
    for (const listener of this.listeners) listener();
  }
  setTab(tab: TrayTab): void { if (tab !== this.snapshot.tab) this.publish({ tab }); }
  async init(): Promise<void> { await this.refresh(); }
  async refresh(): Promise<void> {
    if (this.snapshot.pending || this.snapshot.refreshing) return;
    const generation = ++this.refreshGeneration;
    this.publish({ refreshing: true });
    try {
      const state = await this.api.getState();
      if (generation !== this.refreshGeneration) return;
      if (JSON.stringify(state) !== JSON.stringify(this.snapshot.state) || this.snapshot.error) this.publish({ state, error: false });
    } catch { if (generation === this.refreshGeneration) this.publish({ error: true }); }
    finally { if (generation === this.refreshGeneration) this.publish({ refreshing: false }); }
  }
  async performAction(action: string): Promise<void> {
    if (this.snapshot.pending) return;
    ++this.refreshGeneration;
    this.publish({ pending: true, refreshing: false, error: false });
    try { const state = await this.api.performAction(action); this.publish({ state }); }
    catch { this.publish({ error: true }); }
    finally { this.publish({ pending: false }); }
  }
  hide(): Promise<void> { return this.api.hide(); }
  dispose(): void { this.disposed = true; this.listeners.clear(); }
}
