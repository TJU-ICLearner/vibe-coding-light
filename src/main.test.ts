import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import petHtml from "../index.html?raw";

const bus = vi.hoisted(() => ({ handlers: {} as Record<string, (event: { payload: unknown }) => void> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, handler) => {
  bus.handlers[name] = handler;
  return () => { delete bus.handlers[name]; };
}) }));
vi.mock("@tauri-apps/api/window", () => {
  const window = {
    outerPosition: async () => ({ x: 0, y: 0 }), outerSize: async () => ({ width: 128, height: 128 }),
    innerSize: async () => ({ width: 128, height: 128 }), scaleFactor: async () => 1,
    setPosition: async () => {}, setSize: async () => {},
  };
  return { getCurrentWindow: () => window, availableMonitors: async () => [], currentMonitor: async () => null };
});

beforeEach(() => {
  vi.resetModules();
  bus.handlers = {};
  document.body.innerHTML = petHtml.match(/<body>([\s\S]*?)<script/)?.[1] ?? "";
});

describe("desktop pet startup", () => {
  it("keeps a live state event that arrives while the initial state is loading", async () => {
    let finishInitial!: (value: { state: "idle"; message: string; timestamp: number; activeCount: number }) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_current_state") return new Promise((resolve) => { finishInitial = resolve; });
      if (command === "get_active_pet") return { kind: "builtin", id: "builtin-cat" };
      return null;
    });
    await import("./main");
    window.dispatchEvent(new Event("DOMContentLoaded"));
    await vi.waitFor(() => expect(bus.handlers["state-changed"]).toBeDefined());
    bus.handlers["state-changed"]({ payload: { state: "working", message: "Building", timestamp: 1, activeCount: 1 } });
    finishInitial({ state: "idle", message: "", timestamp: 0, activeCount: 0 });
    await vi.waitFor(() => expect(document.querySelector("#pet-sprite")?.className).toContain("state-working"));
  });
});
