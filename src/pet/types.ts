export type AgentVisualState = "idle" | "unknown" | "working" | "waiting" | "error" | "completed";
export type PetImageMode = "remove_background" | "keep_alpha" | "keep_animation";
export type PetSlot = "default" | "working" | "waiting" | "error" | "completed";
export type PetAssetKind = "png" | "gif";
export type PetMotion = "follow_state" | "still" | "sway" | "float" | "breathe" | "bounce" | "wobble";
export interface PreparedAssetPayload { kind: PetAssetKind; data_url: string }
export type ActivePet =
  | { kind: "builtin" }
  | { kind: "photo"; id: string; assets: Partial<Record<PetSlot, PreparedAssetPayload>>; motions: Partial<Record<PetSlot, PetMotion>>; invalid_slots: PetSlot[]; scale: number; offset_x: number; offset_y: number };
export interface PetManifest {
  schema_version: number;
  id: string;
  name: string;
  scale: number;
  offset_x: number;
  offset_y: number;
  created_at: number;
  assets?: Partial<Record<PetSlot, PetAssetKind>>;
  motions?: Partial<Record<PetSlot, PetMotion>>;
}
export interface ImportCapabilities { automatic: boolean; transparent_png: boolean; transparent_gif: boolean }
