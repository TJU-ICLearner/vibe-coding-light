import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AssetDraft, validatePetFile } from "./pet/asset_draft";
import { asPetError, formatPetError, t } from "./i18n";
import type { Locale, PetError, UiKey } from "./i18n";
import type { DraftMode } from "./pet/asset_draft";
import type { ActivePet, ImportCapabilities, PetImageMode, PetManifest, PetMotion, PetSlot, PreparedAssetPayload } from "./pet/types";
import { petWindowSide, validPetScale } from "./pet/window_size";
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
  save(name: string, assets: Partial<Record<PetSlot, PreparedAssetPayload>>, scale: number, motions: Partial<Record<PetSlot, PetMotion>>): Promise<PetManifest>;
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

  async save(name: string, scale: number, motions: Partial<Record<PetSlot, PetMotion>>): Promise<PetManifest> {
    const assets = this.draft.selected(this.mode);
    if (!assets.default) this.fail("default_required");
    if (this.draft.isBusy(this.mode)) this.fail("wait_processing");
    if (this.draft.blockingError(this.mode)) this.fail(this.draft.blockingError(this.mode)!.code);
    if (!validPetScale(scale)) {
      this.fail("invalid_transform");
    }
    const selectedMotions: Partial<Record<PetSlot, PetMotion>> = {};
    for (const slot of ["default", "working", "waiting", "error", "completed"] as const) {
      const motion = motions[slot];
      if (assets[slot]?.kind === "png" && motion && motion !== "follow_state") selectedMotions[slot] = motion;
    }
    this.busy = true; this.error = null; this.feedback = null; this.notify();
    try {
      const saved = await this.api.save(name, assets, scale, selectedMotions);
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
  save: (name, assets, scale, motions) => invoke("save_pet_profile", { name, assets, scale, motions }),
  list: () => invoke("list_photo_pets"),
  select: (id) => invoke("select_pet", { id }),
  delete: (id) => invoke("delete_photo_pet", { id }),
  active: () => invoke("get_active_pet"),
};

const slotKeys: Record<PetSlot, UiKey> = {
  default: "state_default", working: "state_working", waiting: "state_waiting", error: "state_error", completed: "state_completed",
};

export function mountSettings(): void {
  const root = document.getElementById("settings-app");
  if (!root) return;
  const controller = new SettingsController(api);
  const styleInput = root.querySelector<HTMLSelectElement>("#pet-style")!;
  const tabs = root.querySelector<HTMLElement>("#slot-tabs")!;
  const waitingHelp = root.querySelector<HTMLElement>("#waiting-help")!;
  const modeHint = root.querySelector<HTMLElement>("#mode-hint")!;
  const slotTitle = root.querySelector<HTMLElement>("#slot-editor-title")!;
  const slotCompletion = root.querySelector<HTMLElement>("#slot-completion")!;
  const slotFileLabel = root.querySelector<HTMLElement>("#slot-file-label")!;
  const slotFileName = root.querySelector<HTMLElement>("#slot-file-name")!;
  const slotStatus = root.querySelector<HTMLElement>("#slot-status")!;
  const slotClear = root.querySelector<HTMLButtonElement>("#slot-clear")!;
  const savedWarning = root.querySelector<HTMLElement>("#saved-warning")!;
  const fileInput = root.querySelector<HTMLInputElement>("#photo-file")!;
  const modeInput = root.querySelector<HTMLSelectElement>("#photo-mode")!;
  const motionInput = root.querySelector<HTMLSelectElement>("#pet-motion")!;
  const motionHint = root.querySelector<HTMLElement>("#motion-hint")!;
  const original = root.querySelector<HTMLImageElement>("#original-preview")!;
  const processed = root.querySelector<HTMLImageElement>("#processed-preview")!;
  const processedFrame = root.querySelector<HTMLElement>("#processed-frame")!;
  const previewViewport = root.querySelector<HTMLElement>(".preview-viewport")!;
  const previewWindow = root.querySelector<HTMLElement>(".preview-window")!;
  const previewSize = root.querySelector<HTMLElement>(".preview-size")!;
  const saveButton = root.querySelector<HTMLButtonElement>("#save-pet")!;
  const nameInput = root.querySelector<HTMLInputElement>("#pet-name")!;
  const scaleInput = root.querySelector<HTMLInputElement>("#pet-scale")!;
  const list = root.querySelector<HTMLElement>("#saved-pets")!;
  const status = root.querySelector<HTMLElement>("#status")!;
  const slots: PetSlot[] = ["default", "working", "waiting", "error", "completed"];
  const originalUrls = new Map<PetSlot, string>();
  const files = new Map<PetSlot, File>();
  const modes = new Map<PetSlot, PetImageMode>();
  const motions = new Map<PetSlot, PetMotion>();
  let selectedSlot: PetSlot = "default";
  let lastStateSlot: PetSlot = "default";
  let capabilities: ImportCapabilities = { automatic: false, transparent_png: false, transparent_gif: false };
  let capabilitiesLoaded = false;
  let suggestedName = "";
  let locale: Locale = "zh-CN";
  let localeEventSeen = false;

  const renderStaticCopy = () => {
    document.documentElement.lang = locale;
    document.title = `${t(locale, "settings_title")} · Vibe Coding Light`;
    root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      element.textContent = t(locale, element.dataset.i18n as UiKey);
    });
    root.querySelectorAll<HTMLElement>("[data-i18n-alt]").forEach((element) => {
      element.setAttribute("alt", t(locale, element.dataset.i18nAlt as UiKey));
    });
    root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(locale, element.dataset.i18nAriaLabel as UiKey));
    });
    root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = t(locale, element.dataset.i18nPlaceholder as UiKey);
    });
  };

  const modesFor = (file?: File): PetImageMode[] => {
    if (file?.name.toLowerCase().endsWith(".gif")) return capabilities.transparent_gif ? ["keep_animation"] : [];
    return availableModes(capabilities).filter((mode) => mode !== "keep_animation");
  };

  const configureModes = () => {
    const available = modesFor(files.get(selectedSlot));
    const remembered = modes.get(selectedSlot);
    modeInput.replaceChildren();
    for (const mode of available) modeInput.add(new Option(t(locale, mode), mode));
    if (remembered && available.includes(remembered)) modeInput.value = remembered;
    else if (available.length) modes.set(selectedSlot, available[0]);
    modeInput.disabled = available.length <= 1;
  };

  const selectedAsset = () =>
    controller.draft.get(selectedSlot)?.asset ?? controller.draft.get("default")?.asset ?? null;

  const motionValues: PetMotion[] = ["follow_state", "still", "sway", "float", "breathe", "bounce", "wobble"];
  const configureMotion = () => {
    motionInput.replaceChildren(...motionValues.map((motion) => new Option(t(locale, `motion_${motion}` as UiKey), motion)));
    motionInput.value = motions.get(selectedSlot) ?? "follow_state";
    const ownAsset = controller.draft.get(selectedSlot)?.asset;
    motionInput.disabled = ownAsset?.kind !== "png";
    motionHint.hidden = ownAsset?.kind === "png";
    motionHint.textContent = t(locale, ownAsset?.kind === "gif" ? "motion_gif_hint" : "motion_upload_hint");
  };

  const selectSlot = (slot: PetSlot, focus = false) => {
    selectedSlot = slot;
    if (controller.mode === "states") lastStateSlot = slot;
    fileInput.value = "";
    configureModes();
    render();
    if (focus) tabs.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)?.focus();
  };

  const updateTransform = () => {
    const scale = Number(scaleInput.value);
    const valid = validPetScale(scale);
    if (valid) {
      const side = petWindowSide(scale);
      const displaySide = Math.min(side, 160);
      previewViewport.style.width = `${displaySide}px`;
      previewViewport.style.height = `${displaySide}px`;
      previewWindow.style.width = `${side}px`;
      previewWindow.style.height = `${side}px`;
      previewWindow.style.transform = `scale(${displaySide / side})`;
      processedFrame.style.transform = `scale(${scale})`;
      previewSize.textContent = `${side} × ${side}`;
    }
    saveButton.disabled = controller.busy || controller.draft.isBusy(controller.mode) ||
      Boolean(controller.draft.blockingError(controller.mode)) || !controller.previewUrl || !valid;
    if (!valid && controller.previewUrl && !controller.error) {
      status.textContent = t(locale, "invalid_transform_hint");
      status.classList.add("error");
    }
  };

  const render = () => {
    renderStaticCopy();
    tabs.hidden = controller.mode !== "states";
    waitingHelp.hidden = controller.mode !== "states";
    modeHint.textContent = t(locale, controller.mode === "single" ? "single_hint" : "states_hint");
    const selectedEntry = controller.draft.get(selectedSlot);
    const asset = selectedAsset();
    const originalUrl = originalUrls.get(selectedSlot) ?? originalUrls.get("default");
    if (originalUrl) original.src = originalUrl;
    else original.removeAttribute("src");
    if (asset) {
      if (processed.getAttribute("src") !== asset.data_url) processed.src = asset.data_url;
    } else processed.removeAttribute("src");
    processed.style.visibility = asset ? "visible" : "hidden";
    const previewMotion = motions.get(selectedEntry?.asset ? selectedSlot : "default") ?? "follow_state";
    processed.className = asset?.kind === "gif" ? "animated"
      : `motion-${previewMotion === "follow_state" ? selectedSlot === "default" ? "idle" : selectedSlot : previewMotion}`;
    configureMotion();
    slotTitle.textContent = t(locale, slotKeys[selectedSlot]);
    slotFileLabel.textContent = t(locale, selectedSlot === "default" ? "default_asset" : "upload_image");
    slotFileName.textContent = files.has(selectedSlot) ? t(locale, "file_selected", { name: files.get(selectedSlot)!.name }) : "";
    slotCompletion.textContent = t(locale, selectedEntry?.asset ? "slot_set" : selectedSlot === "default" ? "slot_required" : "slot_fallback");
    slotCompletion.classList.toggle("complete", Boolean(selectedEntry?.asset));
    slotStatus.textContent = selectedEntry?.error ? formatPetError(locale, selectedEntry.error)
      : selectedEntry?.busy ? t(locale, "processing_short")
      : selectedEntry?.asset ? t(locale, "preview_ready_short")
      : selectedSlot === "default" ? t(locale, "select_default") : t(locale, "fallback_default");
    slotStatus.classList.toggle("error", Boolean(selectedEntry?.error));
    slotClear.hidden = selectedSlot === "default" || !files.has(selectedSlot);
    slotClear.textContent = t(locale, "remove_slot");
    tabs.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((tab) => {
      const slot = tab.dataset.slot as PetSlot;
      const active = slot === selectedSlot;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("selected", active);
      tab.replaceChildren();
      const label = document.createElement("span"); label.className = "tab-label"; label.textContent = t(locale, slotKeys[slot]);
      const detail = document.createElement("span"); detail.className = "tab-detail";
      detail.textContent = t(locale, controller.draft.get(slot)?.asset ? "slot_set" : slot === "default" ? "slot_required" : "slot_fallback");
      tab.append(label, detail);
    });
    const blocking = controller.draft.blockingError(controller.mode);
    status.textContent = controller.error ? formatPetError(locale, controller.error)
      : blocking ? formatPetError(locale, blocking)
      : capabilitiesLoaded && fileInput.disabled ? t(locale, "mac_only")
      : controller.busy || controller.draft.isBusy(controller.mode) ? t(locale, "processing")
      : controller.feedback ? t(locale, controller.feedback)
      : asset ? t(locale, "preview_ready") : t(locale, "select_default");
    status.classList.toggle("error", Boolean(controller.error || blocking));
    savedWarning.hidden = controller.invalidSlots.length === 0;
    savedWarning.textContent = controller.invalidSlots.length
      ? t(locale, "invalid_saved_slots", { slots: controller.invalidSlots.map((slot) => t(locale, slotKeys[slot])).join(locale === "en" ? ", " : "、") }) : "";
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
  };

  for (const slot of slots) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.role = "tab";
    tab.dataset.slot = slot;
    tab.onclick = () => selectSlot(slot);
    tab.onkeydown = (event) => {
      let next = slots.indexOf(slot);
      if (event.key === "ArrowRight") next = (next + 1) % slots.length;
      else if (event.key === "ArrowLeft") next = (next + slots.length - 1) % slots.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = slots.length - 1;
      else return;
      event.preventDefault();
      selectSlot(slots[next], true);
    };
    tabs.append(tab);
  }
  controller.onChange(render);
  styleInput.onchange = () => {
    const nextMode = styleInput.value as DraftMode;
    controller.setMode(nextMode);
    selectSlot(nextMode === "single" ? "default" : lastStateSlot);
  };
  fileInput.onchange = () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    files.set(selectedSlot, file);
    motions.delete(selectedSlot);
    configureModes();
    const mode = modeInput.value as PetImageMode;
    if (!mode) { status.textContent = t(locale, "mode_unsupported"); return; }
    modes.set(selectedSlot, mode);
    const previous = originalUrls.get(selectedSlot);
    if (previous && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previous);
    if (!validatePetFile(file, mode) && typeof URL.createObjectURL === "function") {
      originalUrls.set(selectedSlot, URL.createObjectURL(file));
    } else originalUrls.delete(selectedSlot);
    if (selectedSlot === "default") {
      const nextName = file.name.replace(/\.[^.]+$/, "");
      if (!nameInput.value.trim() || nameInput.value === suggestedName) nameInput.value = nextName;
      suggestedName = nextName;
    }
    void controller.loadSlot(selectedSlot, file, mode);
  };
  modeInput.onchange = () => {
    const file = files.get(selectedSlot);
    const mode = modeInput.value as PetImageMode;
    modes.set(selectedSlot, mode);
    if (file) void controller.loadSlot(selectedSlot, file, mode);
  };
  motionInput.onchange = () => {
    if (controller.draft.get(selectedSlot)?.asset?.kind !== "png") return;
    motions.set(selectedSlot, motionInput.value as PetMotion);
    render();
  };
  slotClear.onclick = () => {
    const slot = selectedSlot;
    controller.draft.clear(slot);
    files.delete(slot);
    const url = originalUrls.get(slot);
    if (url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    originalUrls.delete(slot);
    fileInput.value = "";
    modes.delete(slot);
    motions.delete(slot);
    configureModes();
    render();
  };
  scaleInput.addEventListener("input", render);
  saveButton.onclick = () => {
    void controller.save(nameInput.value, Number(scaleInput.value), Object.fromEntries(motions) as Partial<Record<PetSlot, PetMotion>>).catch(() => {});
  };
  processed.addEventListener("animationend", (event) => {
    if (event.animationName === "pet-photo-completed" && !processed.classList.contains("animated")) processed.className = "motion-idle";
  });
  void invoke<ImportCapabilities>("get_pet_import_capabilities").then((result) => {
    capabilities = result;
    capabilitiesLoaded = true;
    configureModes();
    fileInput.disabled = availableModes(capabilities).length === 0;
    render();
  }).catch((error) => { status.textContent = formatPetError(locale, error); });
  let unlisten: (() => void) | undefined;
  void listen<Locale>("locale-changed", (event) => {
    if (event.payload !== "zh-CN" && event.payload !== "en") return;
    localeEventSeen = true;
    locale = event.payload;
    configureModes();
    root.classList.add("ready");
    render();
  }).then((stop) => { unlisten = stop; }).catch(() => {});
  void invoke<Locale>("get_app_locale").then((current) => {
    if (localeEventSeen || (current !== "zh-CN" && current !== "en")) return;
    locale = current;
    configureModes();
    root.classList.add("ready");
    render();
  }).catch(() => { root.classList.add("ready"); });
  window.addEventListener("beforeunload", () => {
    unlisten?.();
    for (const url of originalUrls.values()) if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }, { once: true });
  void controller.refresh().catch((error) => { status.textContent = formatPetError(locale, error); });
  render();
}

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", mountSettings);
}
