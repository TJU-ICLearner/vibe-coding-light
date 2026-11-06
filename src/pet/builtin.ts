import type { AgentVisualState, PetSlot } from "./types";

export const BUILTIN_BUBU_ID = "builtin-cat";
export const BUILTIN_YIER_ID = "builtin-yier";
export type BuiltinPetId = typeof BUILTIN_BUBU_ID | typeof BUILTIN_YIER_ID;

export function isBuiltinPetId(id: string): id is BuiltinPetId {
  return id === BUILTIN_BUBU_ID || id === BUILTIN_YIER_ID;
}

export function builtinGif(id: string | undefined, state: AgentVisualState | PetSlot): string {
  const directory = id === BUILTIN_YIER_ID ? "yier" : "bubu";
  const file = state === "idle" || state === "unknown" ? "default" : state;
  return `/pet/${directory}/${file}.gif`;
}
