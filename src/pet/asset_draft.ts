import type { PetImageMode, PetSlot, PreparedAssetPayload } from "./types";

export type DraftMode = "single" | "states";
export interface DraftSlot {
  asset: PreparedAssetPayload | null;
  error: string;
  busy: boolean;
  filename: string;
}

const slots: PetSlot[] = ["default", "working", "waiting", "error", "completed"];
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export function validatePetFile(file: File, mode: PetImageMode): string | null {
  if (file.size > MAX_INPUT_BYTES) return "图片不能超过 10 MiB";
  const extension = file.name.split(".").pop()?.toLowerCase();
  const isPng = extension === "png" && (file.type === "image/png" || file.type === "");
  const isJpeg = (extension === "jpg" || extension === "jpeg") && (file.type === "image/jpeg" || file.type === "");
  const isGif = extension === "gif" && (file.type === "image/gif" || file.type === "");
  if (isGif) return mode === "keep_animation" ? null : "GIF 仅支持保留透明背景";
  if (mode === "keep_animation") return "保留动图需要透明 GIF";
  if (!isPng && !isJpeg) return "请选择 PNG、JPEG 或透明 GIF 图片";
  if (mode === "keep_alpha" && !isPng) return "保留透明背景需要 PNG 图片";
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
    this.entries.set(slot, { asset: null, error: validation ?? "", busy: !validation, filename: file.name });
    this.onChange();
    if (validation) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (this.generations.get(slot) !== generation) return;
      const asset = await prepare(bytes, mode);
      if (this.generations.get(slot) !== generation) return;
      this.entries.set(slot, { asset, error: "", busy: false, filename: file.name });
    } catch (error) {
      if (this.generations.get(slot) !== generation) return;
      this.entries.set(slot, {
        asset: null, error: String(error instanceof Error ? error.message : error), busy: false, filename: file.name,
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

  blockingError(mode: DraftMode): string {
    for (const slot of slots) {
      if (mode === "single" && slot !== "default") break;
      const entry = this.entries.get(slot);
      if (entry?.error) return entry.error;
    }
    return "";
  }

  isBusy(mode: DraftMode): boolean {
    return slots.some((slot) => (mode === "states" || slot === "default") && Boolean(this.entries.get(slot)?.busy));
  }
}
