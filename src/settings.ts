import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AssetDraft, validatePetFile } from "./pet/asset_draft";
import { asPetError, formatPetError, t } from "./i18n";
import type { Locale, PetError, UiKey } from "./i18n";
import type { DraftMode } from "./pet/asset_draft";
import type { ActivePet, AgentVisualState, ImportCapabilities, PetImageMode, PetManifest, PetSlot, PreparedAssetPayload } from "./pet/types";
import "./settings.css";
export { validatePetFile } from "./pet/asset_draft";

function codedError(code: string): Error & PetError { return Object.assign(new Error(code), { code }); }

export function availableModes(capabilities: ImportCapabilities): PetImageMode[] {
  const modes: PetImageMode[] = [];
  if (capabilities.automatic) modes.push("remove_background");
  if (capabilities.transparent_png) modes.push("keep_alpha");
  if (capabilities.transparent_gif) modes.push("keep_animation");
  return modes;
}

export function validPetTransform(scale: number, offsetX: number, offsetY: number, hasGif = false): boolean {
  if (![scale, offsetX, offsetY].every(Number.isFinite) || scale < 0.5 || scale > 0.95 ||
      !Number.isInteger(offsetX) || !Number.isInteger(offsetY)) return false;
  const { side, top } = petTransformBounds(scale, hasGif);
  return offsetX >= -Math.max(side, 0) && offsetX <= side &&
    offsetY >= Math.max(top, -32) && offsetY <= side;
}

export function petTransformBounds(scale: number, hasGif = false): { side: number; top: number } {
  if (hasGif) {
    // A GIF may fill its whole canvas. Reserve two source pixels for the click reaction.
    const side = Math.min(32, Math.floor(64 - scale * 66));
    return { side, top: -side };
  }
  return { side: Math.min(32, Math.floor(64 - scale * 61)), top: Math.max(-32, Math.ceil(scale * 72 - 64)) };
}

export function applyPreviewTransform(frame: HTMLElement, scale: number, offsetX: number, offsetY: number, hasGif = false): boolean {
  frame.style.transform = [scale, offsetX, offsetY].every(Number.isFinite)
    ? `translate(${offsetX}px, ${offsetY}px) scale(${scale})` : "";
  return validPetTransform(scale, offsetX, offsetY, hasGif);
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
  error: PetError | null = null;
  feedback: UiKey | null = null;
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

  private fail(code: string): never {
    const error = codedError(code);
    this.error = asPetError(error);
    this.notify();
    throw error;
  }

  async load(file: File, mode: PetImageMode): Promise<void> {
    await this.loadSlot("default", file, mode);
  }

  async loadSlot(slot: PetSlot, file: File, mode: PetImageMode): Promise<void> {
    this.error = null;
    this.feedback = null;
    await this.draft.load(slot, file, mode, this.api.prepare);
    this.error = this.draft.get("default")?.error ?? null;
    this.notify();
  }

  setMode(mode: DraftMode): void {
    this.mode = mode;
    this.error = null;
    this.feedback = null;
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
    if (!assets.default) this.fail("default_required");
    if (this.draft.isBusy(this.mode)) this.fail("wait_processing");
    if (this.draft.blockingError(this.mode)) this.fail(this.draft.blockingError(this.mode)!.code);
    if (!validPetTransform(scale, offsetX, offsetY, Object.values(assets).some((asset) => asset?.kind === "gif"))) {
      this.fail("invalid_transform");
    }
    this.busy = true; this.error = null; this.feedback = null; this.notify();
    try {
      const saved = await this.api.save(name, assets, scale, offsetX, offsetY);
      await this.refresh();
      this.feedback = "saved_success";
      return saved;
    } catch (error) {
      this.error = asPetError(error);
      throw error;
    } finally { this.busy = false; this.notify(); }
  }

  async select(id: string): Promise<void> {
    try {
      await this.api.select(id);
      this.selectedId = id;
      const active = await this.api.active();
      this.invalidSlots = active.kind === "photo" ? (active.invalid_slots ?? []) : [];
      this.feedback = "selected_success";
      this.notify();
    } catch (error) { this.error = asPetError(error); this.notify(); throw error; }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.api.delete(id);
      this.pets = this.pets.filter((pet) => pet.id !== id);
      if (this.selectedId === id) this.selectedId = "builtin-cat";
      if (this.selectedId === "builtin-cat") this.invalidSlots = [];
      this.feedback = "deleted_success";
      this.notify();
    } catch (error) { this.error = asPetError(error); this.notify(); throw error; }
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

const stateKeys: Record<AgentVisualState, UiKey> = {
  idle: "state_default", unknown: "state_unknown", working: "state_working", waiting: "state_waiting", error: "state_error", completed: "state_completed",
};
const slotKeys: Record<PetSlot, UiKey> = {
  default: "state_default", working: "state_working", waiting: "state_waiting", error: "state_error", completed: "state_completed",
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
  const slotControls = new Map<PetSlot, { card: HTMLElement; file: HTMLInputElement; mode: HTMLSelectElement; original: HTMLImageElement; preview: HTMLImageElement; status: HTMLElement }>();
  const stateSlots: PetSlot[] = ["working", "waiting", "error", "completed"];
  let capabilities: ImportCapabilities = { automatic: false, transparent_png: false, transparent_gif: false };
  let selectedState: AgentVisualState = "idle";
  let suggestedName = "";
  let locale: Locale = "zh-CN";
  let localeEventSeen = false;
  let capabilitiesLoaded = false;

  const renderStaticCopy = () => {
    document.documentElement.lang = locale;
    document.title = `${t(locale, "settings_title")} · Vibe Coding Light`;
    root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n as UiKey;
      element.textContent = t(locale, key);
    });
    root.querySelectorAll<HTMLElement>("[data-i18n-alt]").forEach((element) => element.setAttribute("alt", t(locale, element.dataset.i18nAlt as UiKey)));
    root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => element.placeholder = t(locale, element.dataset.i18nPlaceholder as UiKey));
  };

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
      const label = t(locale, mode);
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
    const hasGif = Object.values(controller.draft.selected(controller.mode)).some((asset) => asset?.kind === "gif");
    if (Number.isFinite(scale) && scale >= 0.5 && scale <= 0.95) {
      const { side, top } = petTransformBounds(scale, hasGif);
      xInput.min = String(-side); xInput.max = String(side);
      yInput.min = String(top); yInput.max = String(side);
    }
    const valid = applyPreviewTransform(processedFrame, scale, Number(xInput.value), Number(yInput.value), hasGif);
    saveButton.disabled = controller.busy || controller.draft.isBusy(controller.mode) ||
      Boolean(controller.draft.blockingError(controller.mode)) || !controller.previewUrl || !valid;
    if (!valid && controller.previewUrl && !controller.error) {
      status.textContent = t(locale, "invalid_transform_hint");
      status.classList.add("error");
    }
  };

  const render = () => {
    renderStaticCopy();
    const asset = chosenAsset();
    if (asset) {
      if (processed.getAttribute("src") !== asset.data_url) processed.src = asset.data_url;
    } else {
      processed.removeAttribute("src");
    }
    processed.style.visibility = asset ? "visible" : "hidden";
    processed.className = asset?.kind === "gif" ? "animated" : `motion-${selectedState}`;
    const slotError = controller.draft.blockingError(controller.mode);
    status.textContent = controller.error ? formatPetError(locale, controller.error)
      : slotError ? formatPetError(locale, slotError)
      : capabilitiesLoaded && fileInput.disabled ? t(locale, "mac_only")
      : controller.busy || controller.draft.isBusy(controller.mode) ? t(locale, "processing")
      : controller.feedback ? t(locale, controller.feedback)
      : asset ? t(locale, "preview_ready") : t(locale, "select_default");
    status.classList.toggle("error", Boolean(controller.error || slotError));
    if (stateAssets) stateAssets.hidden = controller.mode !== "states";
    if (modeHint) modeHint.textContent = t(locale, controller.mode === "single" ? "single_hint" : "states_hint");
    for (const slot of stateSlots) {
      const controls = slotControls.get(slot);
      if (!controls) continue;
      const slotLabel = t(locale, slotKeys[slot]);
      controls.card.querySelector("h3")!.textContent = `${slotLabel} · ${t(locale, "optional_asset")}`;
      controls.card.querySelector("label")!.firstChild!.textContent = t(locale, "upload_image");
      controls.card.querySelectorAll("label")[1].firstChild!.textContent = t(locale, "processing_mode");
      controls.file.setAttribute("aria-label", `${slotLabel} · ${t(locale, "optional_asset")}`);
      controls.mode.setAttribute("aria-label", `${slotLabel} · ${t(locale, "processing_mode")}`);
      controls.original.alt = `${slotLabel} · ${t(locale, "original_alt")}`;
      controls.preview.alt = `${slotLabel} · ${t(locale, "processed_alt")}`;
      controls.card.querySelector("button")!.textContent = t(locale, "remove_slot");
      const entry = controller.draft.get(slot);
      if (entry?.asset) {
        if (controls.preview.getAttribute("src") !== entry.asset.data_url) controls.preview.src = entry.asset.data_url;
      } else controls.preview.removeAttribute("src");
      controls.status.textContent = entry?.error ? formatPetError(locale, entry.error)
        : entry?.busy ? t(locale, "processing_short") : entry?.asset ? t(locale, "preview_ready_short") : t(locale, "fallback_default");
      controls.status.classList.toggle("error", Boolean(entry?.error));
    }
    if (savedWarning) {
      savedWarning.hidden = controller.invalidSlots.length === 0;
      savedWarning.textContent = controller.invalidSlots.length
        ? t(locale, "invalid_saved_slots", { slots: controller.invalidSlots.map((slot) => t(locale, slotKeys[slot])).join(locale === "en" ? ", " : "、") }) : "";
    }
    updateTransform();
    list.replaceChildren();
    const builtin = document.createElement("button");
    builtin.type = "button";
    builtin.textContent = t(locale, "builtin_cat");
    builtin.className = controller.selectedId === "builtin-cat" ? "selected" : "";
    builtin.onclick = () => { void controller.select("builtin-cat").catch(() => {}); };
    list.append(builtin);
    for (const pet of controller.pets) {
      const row = document.createElement("div"); row.className = "saved-row";
      const choose = document.createElement("button"); choose.type = "button";
      choose.textContent = pet.name; choose.className = controller.selectedId === pet.id ? "selected" : "";
      choose.onclick = () => { void controller.select(pet.id).catch(() => {}); };
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = t(locale, "delete");
      remove.setAttribute("aria-label", t(locale, "delete_named", { name: pet.name }));
      remove.onclick = () => { void controller.delete(pet.id).catch(() => {}); };
      row.append(choose, remove); list.append(row);
    }
    stateButtons.querySelectorAll<HTMLButtonElement>("button[data-state]").forEach((button) => {
      button.textContent = t(locale, stateKeys[button.dataset.state as AgentVisualState]);
    });
  };
  controller.onChange(render);
  const chooseFile = async (slot: PetSlot, input: HTMLInputElement, mode: HTMLSelectElement, image: HTMLImageElement) => {
    const file = input.files?.[0]; if (!file) return;
    configureModes(mode, file);
    const selectedMode = mode.value as PetImageMode;
    if (!selectedMode) {
      status.textContent = t(locale, "mode_unsupported");
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
    const title = document.createElement("h3"); title.textContent = `${t(locale, slotKeys[slot])} · ${t(locale, "optional_asset")}`;
    const label = document.createElement("label"); label.textContent = t(locale, "upload_image");
    const input = document.createElement("input"); input.type = "file"; input.accept = "image/png,image/jpeg,image/gif";
    input.setAttribute("aria-label", `${t(locale, slotKeys[slot])} · ${t(locale, "optional_asset")}`); label.append(input);
    const modeLabel = document.createElement("label"); modeLabel.textContent = t(locale, "processing_mode");
    const mode = document.createElement("select"); mode.setAttribute("aria-label", `${t(locale, slotKeys[slot])} · ${t(locale, "processing_mode")}`); modeLabel.append(mode);
    const previewGrid = document.createElement("div"); previewGrid.className = "slot-preview-grid";
    const originalImage = document.createElement("img"); originalImage.alt = `${t(locale, slotKeys[slot])} · ${t(locale, "original_alt")}`;
    const previewImage = document.createElement("img"); previewImage.alt = `${t(locale, slotKeys[slot])} · ${t(locale, "processed_alt")}`;
    previewGrid.append(originalImage, previewImage);
    const message = document.createElement("p"); message.className = "slot-status"; message.setAttribute("role", "status");
    const clear = document.createElement("button"); clear.type = "button"; clear.textContent = t(locale, "remove_slot");
    clear.onclick = () => {
      controller.draft.clear(slot); input.value = "";
      const url = originalUrls.get(slot); if (url) URL.revokeObjectURL(url);
      originalUrls.delete(slot); originalImage.removeAttribute("src");
      configureModes(mode);
    };
    input.onchange = () => { void chooseFile(slot, input, mode, originalImage); };
    mode.onchange = () => { if (input.files?.length) void chooseFile(slot, input, mode, originalImage); };
    card.append(title, label, modeLabel, previewGrid, message, clear); stateAssets.append(card);
    slotControls.set(slot, { card, file: input, mode, original: originalImage, preview: previewImage, status: message });
  }
  for (const input of [scaleInput, xInput, yInput]) input.addEventListener("input", render);
  saveButton.onclick = () => {
    void controller.save(nameInput.value, Number(scaleInput.value), Number(xInput.value), Number(yInput.value)).catch(() => {});
  };
  for (const state of Object.keys(stateKeys) as AgentVisualState[]) {
    if (state === "unknown") continue;
    const button = document.createElement("button"); button.type = "button"; button.dataset.state = state; button.textContent = t(locale, stateKeys[state]);
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
    capabilitiesLoaded = true;
    configureModes(modeInput, fileInput.files?.[0]);
    for (const controls of slotControls.values()) configureModes(controls.mode, controls.file.files?.[0]);
    fileInput.disabled = availableModes(capabilities).length === 0;
    for (const controls of slotControls.values()) controls.file.disabled = fileInput.disabled;
    render();
  }).catch((error) => { status.textContent = formatPetError(locale, error); });
  let unlisten: (() => void) | undefined;
  void listen<Locale>("locale-changed", (event) => {
    if (event.payload !== "zh-CN" && event.payload !== "en") return;
    localeEventSeen = true;
    locale = event.payload;
    configureModes(modeInput, fileInput.files?.[0]);
    for (const controls of slotControls.values()) configureModes(controls.mode, controls.file.files?.[0]);
    render();
  }).then((stop) => { unlisten = stop; }).catch(() => {});
  void invoke<Locale>("get_app_locale").then((current) => {
    if (localeEventSeen || (current !== "zh-CN" && current !== "en")) return;
    locale = current;
    configureModes(modeInput, fileInput.files?.[0]);
    for (const controls of slotControls.values()) configureModes(controls.mode, controls.file.files?.[0]);
    render();
  }).catch(() => {});
  window.addEventListener("beforeunload", () => { unlisten?.(); for (const url of originalUrls.values()) URL.revokeObjectURL(url); }, { once: true });
  void controller.refresh().catch((error) => { status.textContent = formatPetError(locale, error); });
  render();
}

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", mountSettings);
}
