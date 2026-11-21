import { AssetDraft } from "../pet/asset_draft";
import { asPetError } from "../i18n";
import type { PetError, UiKey } from "../i18n";
import type { DraftMode } from "../pet/asset_draft";
import type { ActivePet, ImportCapabilities, PetImageMode, PetManifest, PetMotion, PetSlot, PreparedAssetPayload } from "../pet/types";
import { BUILTIN_BUBU_ID, isBuiltinPetId } from "../pet/builtin";
import { validPetScale } from "../pet/window_size";
export { validatePetFile } from "../pet/asset_draft";

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

export interface SettingsApi {
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
  refreshFailed = false;
  busy = false;
  selectionPending = 0;
  pets: PetManifest[] = [];
  selectedId: string = BUILTIN_BUBU_ID;
  activePet: ActivePet = { kind: "builtin", id: BUILTIN_BUBU_ID };
  invalidSlots: PetSlot[] = [];
  private listeners = new Set<() => void>();
  private selectionQueue: Promise<void> = Promise.resolve();
  private activeGeneration = 0;
  private petsGeneration = 0;

  constructor(private readonly api: SettingsApi) {
    this.draft = new AssetDraft(() => this.notify());
  }

  get previewUrl(): string | null { return this.draft.get("default")?.asset?.data_url ?? null; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private notify(): void { this.listeners.forEach((listener) => listener()); }

  private enqueueSelection(work: () => Promise<void>): Promise<void> {
    this.selectionPending++;
    this.notify();
    const operation = this.selectionQueue.then(work).finally(() => {
      this.selectionPending--;
      this.notify();
    });
    this.selectionQueue = operation.catch(() => {});
    return operation;
  }

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

  async refresh(): Promise<boolean> {
    const activeGeneration = ++this.activeGeneration;
    const petsGeneration = ++this.petsGeneration;
    const petsRead = this.api.list().then((pets) => {
      if (petsGeneration === this.petsGeneration) { this.pets = pets; this.notify(); }
      return true;
    }, () => false);
    const activeRead = this.api.active().then((active) => {
      if (activeGeneration === this.activeGeneration) {
        this.activePet = active;
        this.selectedId = active.kind === "photo" ? active.id : active.id ?? BUILTIN_BUBU_ID;
        this.invalidSlots = active.kind === "photo" ? (active.invalid_slots ?? []) : [];
        this.notify();
      }
      return true;
    }, () => false);
    const [petsOk, activeOk] = await Promise.all([petsRead, activeRead]);
    const complete = petsOk && activeOk;
    if (petsGeneration === this.petsGeneration && activeGeneration === this.activeGeneration) {
      this.refreshFailed = !complete;
      this.notify();
    }
    return complete;
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
      this.pets = [saved, ...this.pets.filter((pet) => pet.id !== saved.id)];
      this.selectedId = saved.id;
      this.activePet = { kind: "photo", id: saved.id, assets, motions: selectedMotions, invalid_slots: [], scale: saved.scale, offset_x: 0, offset_y: 0 };
      this.invalidSlots = [];
      this.notify();
      const refreshed = await this.refresh();
      this.feedback = refreshed ? "saved_success" : "saved_refresh_failed";
      return saved;
    } catch (error) {
      const partial = error && typeof error === "object" && "code" in error && error.code === "saved_not_selected"
        && "saved_pet" in error && error.saved_pet && typeof error.saved_pet === "object"
        && "id" in error.saved_pet && typeof error.saved_pet.id === "string"
        ? error.saved_pet as PetManifest : null;
      if (partial) {
        this.pets = [partial, ...this.pets.filter((pet) => pet.id !== partial.id)];
        this.error = null;
        this.feedback = "saved_not_selected";
        return partial;
      }
      this.error = asPetError(error);
      throw error;
    } finally { this.busy = false; this.notify(); }
  }

  select(id: string): Promise<void> {
    this.activeGeneration++;
    return this.enqueueSelection(async () => {
      try {
        await this.api.select(id);
        this.selectedId = id;
        if (isBuiltinPetId(id)) this.activePet = { kind: "builtin", id };
        else if (this.activePet.kind !== "photo" || this.activePet.id !== id) {
          this.activePet = { kind: "photo", id, assets: {}, motions: {}, invalid_slots: [], scale: this.pets.find((pet) => pet.id === id)?.scale ?? 1, offset_x: 0, offset_y: 0 };
        }
        this.invalidSlots = [];
        this.error = null;
        this.notify();
        try {
          const active = await this.api.active();
          this.activePet = active;
          this.invalidSlots = active.kind === "photo" ? (active.invalid_slots ?? []) : [];
          this.feedback = "selected_success";
        } catch {
          this.refreshFailed = true;
          this.feedback = "selected_refresh_failed";
        }
        this.notify();
      } catch (error) { this.error = asPetError(error); this.notify(); throw error; }
    });
  }

  delete(id: string): Promise<void> {
    this.activeGeneration++;
    this.petsGeneration++;
    return this.enqueueSelection(async () => {
      try {
        await this.api.delete(id);
        this.pets = this.pets.filter((pet) => pet.id !== id);
        if (this.selectedId === id) {
          this.activePet = { kind: "builtin", id: BUILTIN_BUBU_ID };
          this.selectedId = BUILTIN_BUBU_ID;
        }
        if (isBuiltinPetId(this.selectedId)) this.invalidSlots = [];
        this.error = null;
        this.notify();
        try {
          const active = await this.api.active();
          this.activePet = active;
          this.selectedId = active.kind === "photo" ? active.id : active.id ?? BUILTIN_BUBU_ID;
          this.feedback = "deleted_success";
        } catch {
          this.refreshFailed = true;
          this.feedback = "deleted_refresh_failed";
        }
        this.notify();
      } catch (error) { this.error = asPetError(error); this.notify(); throw error; }
    });
  }
}
