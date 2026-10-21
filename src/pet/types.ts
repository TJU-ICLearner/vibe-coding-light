export type AgentVisualState = "idle" | "unknown" | "working" | "waiting" | "error" | "completed";
export type PetImageMode = "remove_background" | "keep_alpha";
export type ActivePet =
  | { kind: "builtin" }
  | { kind: "photo"; id: string; image_data_url: string; scale: number; offset_x: number; offset_y: number };
export interface PetManifest {
  schema_version: number;
  id: string;
  name: string;
  scale: number;
  offset_x: number;
  offset_y: number;
  created_at: number;
}
export interface ImportCapabilities { automatic: boolean; transparent_png: boolean }
