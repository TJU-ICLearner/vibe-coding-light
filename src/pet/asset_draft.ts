import type { PetImageMode, PetSlot, PreparedAssetPayload } from "./types";
import { asPetError } from "../i18n";
import type { PetError } from "../i18n";

export type DraftMode = "single" | "states";
export interface DraftSlot {
  asset: PreparedAssetPayload | null;
  error: PetError | null;
  busy: boolean;
  filename: string;
}

const slots: PetSlot[] = ["default", "working", "waiting", "error", "completed"];
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export type ValidationCode = "too_large" | "gif_requires_animation" | "animation_requires_gif" | "unsupported_format" | "alpha_requires_png";

export function validatePetFile(file: File, mode: PetImageMode): ValidationCode | null {
  if (file.size > MAX_INPUT_BYTES) return "too_large";
  const extension = file.name.split(".").pop()?.toLowerCase();
  const isPng = extension === "png" && (file.type === "image/png" || file.type === "");
  const isJpeg = (extension === "jpg" || extension === "jpeg") && (file.type === "image/jpeg" || file.type === "");
  const isGif = extension === "gif" && (file.type === "image/gif" || file.type === "");
  if (isGif) return mode === "keep_animation" ? null : "gif_requires_animation";
  if (mode === "keep_animation") return "animation_requires_gif";
  if (!isPng && !isJpeg) return "unsupported_format";
  if (mode === "keep_alpha" && !isPng) return "alpha_requires_png";
  return null;
}

export class AssetDraft {
  private entries = new Map<PetSlot, DraftSlot>();
  private generations = new Map<PetSlot, number>();

  constructor(private readonly onChange: () => void = () => {}) {}

  get(slot: PetSlot): DraftSlot | undefined { return this.entries.get(slot); }

  clear(slot: PetSlot): void {
    this.generations.set(slot, (this.generations.get(slot) ?? 0) + 1);
    this.entries.delete(slot);
    this.onChange();
  }

  async load(
    slot: PetSlot,
    file: File,
    mode: PetImageMode,
    prepare: (bytes: Uint8Array, mode: PetImageMode) => Promise<PreparedAssetPayload>,
  ): Promise<void> {
    const generation = (this.generations.get(slot) ?? 0) + 1;
    this.generations.set(slot, generation);
    const validation = validatePetFile(file, mode);
    this.entries.set(slot, { asset: null, error: validation ? { code: validation } : null, busy: !validation, filename: file.name });
    this.onChange();
    if (validation) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (this.generations.get(slot) !== generation) return;
      const asset = await prepare(bytes, mode);
      if (this.generations.get(slot) !== generation) return;
      this.entries.set(slot, { asset, error: null, busy: false, filename: file.name });
    } catch (error) {
      if (this.generations.get(slot) !== generation) return;
      this.entries.set(slot, {
        asset: null, error: asPetError(error), busy: false, filename: file.name,
      });
    }
    this.onChange();
  }

  selected(mode: DraftMode): Partial<Record<PetSlot, PreparedAssetPayload>> {
    const result: Partial<Record<PetSlot, PreparedAssetPayload>> = {};
    for (const slot of slots) {
      if (mode === "single" && slot !== "default") break;
      const asset = this.entries.get(slot)?.asset;
      if (asset) result[slot] = asset;
    }
    return result;
  }

  blockingError(mode: DraftMode): PetError | null {
    for (const slot of slots) {
      if (mode === "single" && slot !== "default") break;
      const entry = this.entries.get(slot);
      if (entry?.error) return entry.error;
    }
    return null;
  }

  isBusy(mode: DraftMode): boolean {
    return slots.some((slot) => (mode === "states" || slot === "default") && Boolean(this.entries.get(slot)?.busy));
  }
}
