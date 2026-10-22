import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import type { PhysicalPosition } from "@tauri-apps/api/dpi";
import { PhotoRenderer } from "./pet/photo_renderer";
import { PetWindowSizer } from "./pet/window_sizer";
import { PatController } from "./pet/pat_interaction";
import type { ActivePet, AgentVisualState } from "./pet/types";

interface StatePayload {
  state: AgentVisualState;
  message: string;
  timestamp: number;
  activeCount: number;
}

let photoRenderer: PhotoRenderer | null = null;
let patController: PatController | null = null;

function renderPetState(state: AgentVisualState): void {
  const sprite = document.getElementById("pet-sprite");
  if (!sprite) return;
  if (photoRenderer) photoRenderer.applyState(state);
  else sprite.className = `pet-sprite state-${state === "unknown" ? "idle" : state}`;
}

function setPetState(state: AgentVisualState): void {
  if (patController) patController.setAgentState(state);
  else renderPetState(state);
}

async function initDrag() {
  const appWindow = getCurrentWindow();
  let dragging = false;
  let startMouseX = 0;
  let startMouseY = 0;
  let startWinX = 0;
  let startWinY = 0;

  document.addEventListener("mousedown", async (e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    startMouseX = e.screenX;
    startMouseY = e.screenY;
    try {
      const pos = await appWindow.outerPosition();
      startWinX = pos.x;
      startWinY = pos.y;
    } catch {
      dragging = false;
    }
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.screenX - startMouseX;
    const dy = e.screenY - startMouseY;
    appWindow.setPosition({ type: "Physical", x: startWinX + dx, y: startWinY + dy } as PhysicalPosition);
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
  });
}

async function init() {
  window.addEventListener("keydown", (event) => {
    if (event.metaKey && event.key === ",") {
      event.preventDefault();
      void invoke("open_pet_settings");
    }
  });
  photoRenderer = new PhotoRenderer(
    document.getElementById("pet-wrapper")!,
    document.getElementById("pet-sprite")!,
    document.getElementById("photo-frame")!,
    document.getElementById("photo-pet") as HTMLImageElement,
  );
  patController = new PatController(
    document.getElementById("pet-wrapper")!,
    document.getElementById("pat-overlay")!,
    renderPetState,
  );
  window.addEventListener("beforeunload", () => patController?.dispose());
  const petWindowSizer = new PetWindowSizer(getCurrentWindow(), currentMonitor, (scale) => photoRenderer?.setFitScale(scale));
  const currentState = await invoke<StatePayload>("get_current_state");
  setPetState(currentState.state);

  let petRequestId = 0;
  const refreshPet = async () => {
    const id = ++petRequestId;
    const pet = await invoke<ActivePet>("get_active_pet");
    if (id !== petRequestId) return;
    patController?.setPetScale(pet.kind === "photo" ? pet.scale : 1);
    photoRenderer?.applyPet(pet);
    await petWindowSizer.request(pet);
  };
  await refreshPet();

  await listen("pet-changed", () => { void refreshPet(); });

  await listen<StatePayload>("state-changed", (event) => {
    setPetState(event.payload.state);
  });

  await listen("pet", () => {
    patController?.start();
  });

  await initDrag();
}

window.addEventListener("DOMContentLoaded", init);
