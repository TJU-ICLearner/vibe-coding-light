import { invoke } from "@tauri-apps/api/core";
import { AssetDraft, validatePetFile } from "./pet/asset_draft";
import type { DraftMode } from "./pet/asset_draft";
import type { ActivePet, AgentVisualState, ImportCapabilities, PetImageMode, PetManifest, PetSlot, PreparedAssetPayload } from "./pet/types";
import "./settings.css";
export { validatePetFile } from "./pet/asset_draft";

export function availableModes(capabilities: ImportCapabilities): PetImageMode[] {
  const modes: PetImageMode[] = [];
  if (capabilities.automatic) modes.push("remove_background");
  if (capabilities.transparent_png) modes.push("keep_alpha");
  if (capabilities.transparent_gif) modes.push("keep_animation");
  return modes;
}

export function validPetTransform(scale: number, offsetX: number, offsetY: number): boolean {
  if (![scale, offsetX, offsetY].every(Number.isFinite) || scale < 0.5 || scale > 0.95 ||
      !Number.isInteger(offsetX) || !Number.isInteger(offsetY)) return false;
  const { side, top } = petTransformBounds(scale);
  return offsetX >= -Math.max(side, 0) && offsetX <= side &&
    offsetY >= Math.max(top, -32) && offsetY <= side;
}

export function petTransformBounds(scale: number): { side: number; top: number } {
  return { side: Math.min(32, Math.floor(64 - scale * 61)), top: Math.max(-32, Math.ceil(scale * 72 - 64)) };
}

export function applyPreviewTransform(frame: HTMLElement, scale: number, offsetX: number, offsetY: number): boolean {
  frame.style.transform = [scale, offsetX, offsetY].every(Number.isFinite)
    ? `translate(${offsetX}px, ${offsetY}px) scale(${scale})` : "";
  return validPetTransform(scale, offsetX, offsetY);
}

export class PreviewController {
  private requestId = 0;
  constructor(
    private readonly process: (bytes: Uint8Array, mode: PetImageMode) => Promise<string>,
    private readonly onPreview: (result: string) => void,
    private readonly onError: (message: string) => void = () => {},
  ) {}

  async load(file: File, mode: PetImageMode): Promise<void> {
    const id = ++this.requestId;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id !== this.requestId) return;
      const result = await this.process(bytes, mode);
      if (id === this.requestId) this.onPreview(result);
    } catch (error) {
      if (id === this.requestId) this.onError(String(error instanceof Error ? error.message : error));
    }
  }

  clear(): void { this.requestId++; }
}

interface SettingsApi {
  prepare(bytes: Uint8Array, mode: PetImageMode): Promise<PreparedAssetPayload>;
  save(name: string, assets: Partial<Record<PetSlot, PreparedAssetPayload>>, scale: number, offsetX: number, offsetY: number): Promise<PetManifest>;
  list(): Promise<PetManifest[]>;
  select(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  active(): Promise<ActivePet>;
}

export class SettingsController {
  readonly draft: AssetDraft;
  mode: DraftMode = "single";
  error = "";
  busy = false;
  pets: PetManifest[] = [];
  selectedId = "builtin-cat";
  invalidSlots: PetSlot[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly api: SettingsApi) {
    this.draft = new AssetDraft(() => this.notify());
  }

  get previewUrl(): string | null { return this.draft.get("default")?.asset?.data_url ?? null; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private notify(): void { this.listeners.forEach((listener) => listener()); }

  async load(file: File, mode: PetImageMode): Promise<void> {
    await this.loadSlot("default", file, mode);
  }

  async loadSlot(slot: PetSlot, file: File, mode: PetImageMode): Promise<void> {
    this.error = "";
    await this.draft.load(slot, file, mode, this.api.prepare);
    this.error = this.draft.get("default")?.error ?? "";
    this.notify();
  }

  setMode(mode: DraftMode): void {
    this.mode = mode;
    this.error = "";
    this.notify();
  }

  async refresh(): Promise<void> {
    const [pets, active] = await Promise.all([this.api.list(), this.api.active()]);
    this.pets = pets;
    this.selectedId = active.kind === "photo" ? active.id : "builtin-cat";
    this.invalidSlots = active.kind === "photo" ? (active.invalid_slots ?? []) : [];
    this.notify();
  }

  async save(name: string, scale: number, offsetX: number, offsetY: number): Promise<PetManifest> {
    const assets = this.draft.selected(this.mode);
    if (!assets.default) throw new Error("请先生成默认素材预览");
    if (this.draft.isBusy(this.mode)) throw new Error("请等待图片处理完成");
    if (this.draft.blockingError(this.mode)) throw new Error(this.draft.blockingError(this.mode));
    if (!validPetTransform(scale, offsetX, offsetY)) throw new Error("大小或位置会使桌宠超出窗口");
    this.busy = true; this.error = ""; this.notify();
    try {
      const saved = await this.api.save(name, assets, scale, offsetX, offsetY);
      await this.refresh();
      return saved;
    } catch (error) {
      this.error = String(error instanceof Error ? error.message : error);
      throw error;
    } finally { this.busy = false; this.notify(); }
  }

  async select(id: string): Promise<void> {
    try {
      await this.api.select(id);
      this.selectedId = id;
      const active = await this.api.active();
      this.invalidSlots = active.kind === "photo" ? (active.invalid_slots ?? []) : [];
      this.notify();
    } catch (error) { this.error = String(error); this.notify(); throw error; }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.api.delete(id);
      this.pets = this.pets.filter((pet) => pet.id !== id);
      if (this.selectedId === id) this.selectedId = "builtin-cat";
      if (this.selectedId === "builtin-cat") this.invalidSlots = [];
      this.notify();
    } catch (error) { this.error = String(error); this.notify(); throw error; }
  }
}

const api: SettingsApi = {
  prepare: (bytes, mode) => invoke<PreparedAssetPayload>("prepare_pet_preview", { input: Array.from(bytes), mode }),
  save: (name, assets, scale, offsetX, offsetY) => invoke("save_pet_profile", { name, assets, scale, offsetX, offsetY }),
  list: () => invoke("list_photo_pets"),
  select: (id) => invoke("select_pet", { id }),
  delete: (id) => invoke("delete_photo_pet", { id }),
  active: () => invoke("get_active_pet"),
};

const stateLabels: Record<AgentVisualState, string> = {
  idle: "休息", unknown: "未知", working: "工作", waiting: "等待", error: "出错", completed: "完成",
};
const slotLabels: Record<PetSlot, string> = {
  default: "默认", working: "工作", waiting: "等待", error: "出错", completed: "完成",
};

export function mountSettings(): void {
  const root = document.getElementById("settings-app");
  if (!root) return;
  const controller = new SettingsController(api);
  const styleInput = document.querySelector<HTMLSelectElement>("#pet-style");
  const stateAssets = document.querySelector<HTMLElement>("#state-assets");
  const modeHint = document.querySelector<HTMLElement>("#mode-hint");
  const savedWarning = document.querySelector<HTMLElement>("#saved-warning");
  const fileInput = document.querySelector<HTMLInputElement>("#photo-file")!;
  const modeInput = document.querySelector<HTMLSelectElement>("#photo-mode")!;
  const original = document.querySelector<HTMLImageElement>("#original-preview")!;
  const processed = document.querySelector<HTMLImageElement>("#processed-preview")!;
  const processedFrame = document.querySelector<HTMLElement>("#processed-frame")!;
  const saveButton = document.querySelector<HTMLButtonElement>("#save-pet")!;
  const nameInput = document.querySelector<HTMLInputElement>("#pet-name")!;
  const scaleInput = document.querySelector<HTMLInputElement>("#pet-scale")!;
  const xInput = document.querySelector<HTMLInputElement>("#pet-offset-x")!;
  const yInput = document.querySelector<HTMLInputElement>("#pet-offset-y")!;
  const list = document.querySelector<HTMLElement>("#saved-pets")!;
  const status = document.querySelector<HTMLElement>("#status")!;
  const stateButtons = document.querySelector<HTMLElement>("#state-buttons")!;
  const originalUrls = new Map<PetSlot, string>();
  const slotControls = new Map<PetSlot, { file: HTMLInputElement; mode: HTMLSelectElement; original: HTMLImageElement; preview: HTMLImageElement; status: HTMLElement }>();
  const stateSlots: PetSlot[] = ["working", "waiting", "error", "completed"];
  let capabilities: ImportCapabilities = { automatic: false, transparent_png: false, transparent_gif: false };
  let selectedState: AgentVisualState = "idle";
  let suggestedName = "";

  const setOriginal = (slot: PetSlot, file: File, image: HTMLImageElement) => {
    const previous = originalUrls.get(slot);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    originalUrls.set(slot, url);
    image.src = url;
  };

  const modesFor = (file?: File): PetImageMode[] => {
    if (file?.name.toLowerCase().endsWith(".gif")) return capabilities.transparent_gif ? ["keep_animation"] : [];
    return availableModes(capabilities).filter((mode) => mode !== "keep_animation");
  };

  const configureModes = (select: HTMLSelectElement, file?: File) => {
    const previous = select.value;
    select.replaceChildren();
    for (const mode of modesFor(file)) {
      const label = mode === "remove_background" ? "自动去背景（macOS 14+）"
        : mode === "keep_alpha" ? "保留透明 PNG" : "保留透明 GIF 动画";
      select.add(new Option(label, mode));
    }
    if (modesFor(file).includes(previous as PetImageMode)) select.value = previous;
    select.disabled = select.options.length <= 1;
  };

  const chosenAsset = () => {
    const slot: PetSlot = controller.mode === "states" && selectedState !== "idle" && selectedState !== "unknown"
      ? selectedState : "default";
    return controller.draft.get(slot)?.asset ?? controller.draft.get("default")?.asset ?? null;
  };

  const updateTransform = () => {
    const scale = Number(scaleInput.value);
    if (Number.isFinite(scale) && scale >= 0.5 && scale <= 0.95) {
      const { side, top } = petTransformBounds(scale);
      xInput.min = String(-side); xInput.max = String(side);
      yInput.min = String(top); yInput.max = String(side);
    }
    const valid = applyPreviewTransform(processedFrame, scale, Number(xInput.value), Number(yInput.value));
    saveButton.disabled = controller.busy || controller.draft.isBusy(controller.mode) ||
      Boolean(controller.draft.blockingError(controller.mode)) || !controller.previewUrl || !valid;
    if (!valid && controller.previewUrl && !controller.error) {
      status.textContent = "大小或位置会使桌宠超出窗口，请调整参数";
      status.classList.add("error");
    }
  };

  const render = () => {
    const asset = chosenAsset();
    if (asset) {
      if (processed.getAttribute("src") !== asset.data_url) processed.src = asset.data_url;
    } else {
      processed.removeAttribute("src");
    }
    processed.style.visibility = asset ? "visible" : "hidden";
    processed.className = asset?.kind === "gif" ? "animated" : `motion-${selectedState}`;
    const slotError = controller.draft.blockingError(controller.mode);
    status.textContent = controller.error || slotError || (controller.busy || controller.draft.isBusy(controller.mode)
      ? "正在处理图片…" : asset ? "预览已生成，可调整并保存" : "请选择默认素材");
    status.classList.toggle("error", Boolean(controller.error || slotError));
    if (stateAssets) stateAssets.hidden = controller.mode !== "states";
    if (modeHint) modeHint.textContent = controller.mode === "single"
      ? "单图模式只保存默认素材。切换模式会保留当前草稿。"
      : "未设置专属素材的状态会使用默认素材。切回单图时只保存默认素材。";
    for (const slot of stateSlots) {
      const controls = slotControls.get(slot);
      if (!controls) continue;
      const entry = controller.draft.get(slot);
      if (entry?.asset) {
        if (controls.preview.getAttribute("src") !== entry.asset.data_url) controls.preview.src = entry.asset.data_url;
      } else controls.preview.removeAttribute("src");
      controls.status.textContent = entry?.error || (entry?.busy ? "正在处理…" : entry?.asset ? "预览已生成" : "未设置，使用默认素材");
      controls.status.classList.toggle("error", Boolean(entry?.error));
    }
    if (savedWarning) {
      savedWarning.hidden = controller.invalidSlots.length === 0;
      savedWarning.textContent = controller.invalidSlots.length
        ? `当前桌宠的${controller.invalidSlots.map((slot) => slotLabels[slot]).join("、")}素材不可用，已使用默认素材。请重新创建桌宠。` : "";
    }
    updateTransform();
    list.replaceChildren();
    const builtin = document.createElement("button");
    builtin.type = "button";
    builtin.textContent = "默认像素猫";
    builtin.className = controller.selectedId === "builtin-cat" ? "selected" : "";
    builtin.onclick = () => { void controller.select("builtin-cat").catch(() => {}); };
    list.append(builtin);
    for (const pet of controller.pets) {
      const row = document.createElement("div"); row.className = "saved-row";
      const choose = document.createElement("button"); choose.type = "button";
      choose.textContent = pet.name; choose.className = controller.selectedId === pet.id ? "selected" : "";
      choose.onclick = () => { void controller.select(pet.id).catch(() => {}); };
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "删除";
      remove.setAttribute("aria-label", `删除 ${pet.name}`);
      remove.onclick = () => { void controller.delete(pet.id).catch(() => {}); };
      row.append(choose, remove); list.append(row);
    }
  };
  controller.onChange(render);
  const chooseFile = async (slot: PetSlot, input: HTMLInputElement, mode: HTMLSelectElement, image: HTMLImageElement) => {
    const file = input.files?.[0]; if (!file) return;
    configureModes(mode, file);
    const selectedMode = mode.value as PetImageMode;
    if (!selectedMode) {
      status.textContent = "当前系统不支持这种图片导入";
      return;
    }
    if (!validatePetFile(file, selectedMode)) setOriginal(slot, file, image);
    if (slot === "default") {
      const nextName = file.name.replace(/\.[^.]+$/, "");
      if (!nameInput.value.trim() || nameInput.value === suggestedName) nameInput.value = nextName;
      suggestedName = nextName;
    }
    await controller.loadSlot(slot, file, selectedMode);
  };
  fileInput.onchange = () => { void chooseFile("default", fileInput, modeInput, original); };
  modeInput.onchange = () => { if (fileInput.files?.length) void chooseFile("default", fileInput, modeInput, original); };
  if (styleInput) styleInput.onchange = () => controller.setMode(styleInput.value as DraftMode);

  if (stateAssets) for (const slot of stateSlots) {
    const card = document.createElement("div"); card.className = "slot-card"; card.dataset.slot = slot;
    const title = document.createElement("h3"); title.textContent = `${slotLabels[slot]}素材（可选）`;
    const label = document.createElement("label"); label.textContent = "上传图片或透明 GIF";
    const input = document.createElement("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/gif";
    input.setAttribute("aria-label", `${slotLabels[slot]}素材`); label.append(input);
    const modeLabel = document.createElement("label"); modeLabel.textContent = "处理方式";
    const mode = document.createElement("select"); mode.setAttribute("aria-label", `${slotLabels[slot]}处理方式`); modeLabel.append(mode);
    const previewGrid = document.createElement("div"); previewGrid.className = "slot-preview-grid";
    const originalImage = document.createElement("img"); originalImage.alt = `${slotLabels[slot]}原图预览`;
    const previewImage = document.createElement("img"); previewImage.alt = `${slotLabels[slot]}桌宠预览`;
    previewGrid.append(originalImage, previewImage);
    const message = document.createElement("p"); message.className = "slot-status"; message.setAttribute("role", "status");
    const clear = document.createElement("button"); clear.type = "button"; clear.textContent = "移除该状态素材";
    clear.onclick = () => {
      controller.draft.clear(slot); input.value = "";
      const url = originalUrls.get(slot); if (url) URL.revokeObjectURL(url);
      originalUrls.delete(slot); originalImage.removeAttribute("src");
      configureModes(mode);
    };
    input.onchange = () => { void chooseFile(slot, input, mode, originalImage); };
    mode.onchange = () => { if (input.files?.length) void chooseFile(slot, input, mode, originalImage); };
    card.append(title, label, modeLabel, previewGrid, message, clear); stateAssets.append(card);
    slotControls.set(slot, { file: input, mode, original: originalImage, preview: previewImage, status: message });
  }
  for (const input of [scaleInput, xInput, yInput]) input.addEventListener("input", render);
  saveButton.onclick = () => {
    void controller.save(nameInput.value, Number(scaleInput.value), Number(xInput.value), Number(yInput.value)).catch(() => {});
  };
  for (const [state, label] of Object.entries(stateLabels) as [AgentVisualState, string][]) {
    if (state === "unknown") continue;
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.onclick = () => {
      selectedState = state;
      stateButtons.querySelectorAll("button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      render();
    };
    stateButtons.append(button);
  }
  stateButtons.querySelector("button")?.classList.add("selected");
  processed.addEventListener("animationend", (event) => {
    if (event.animationName === "pet-photo-completed" && !processed.classList.contains("animated")) processed.className = "motion-idle";
  });
  invoke<ImportCapabilities>("get_pet_import_capabilities").then((result) => {
    capabilities = result;
    configureModes(modeInput, fileInput.files?.[0]);
    for (const controls of slotControls.values()) configureModes(controls.mode, controls.file.files?.[0]);
    fileInput.disabled = availableModes(capabilities).length === 0;
    for (const controls of slotControls.values()) controls.file.disabled = fileInput.disabled;
    if (fileInput.disabled) status.textContent = "图片导入当前仅支持 macOS";
  }).catch((error) => { status.textContent = String(error); });
  window.addEventListener("beforeunload", () => { for (const url of originalUrls.values()) URL.revokeObjectURL(url); }, { once: true });
  void controller.refresh().catch((error) => { status.textContent = String(error); });
  render();
}

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", mountSettings);
}
