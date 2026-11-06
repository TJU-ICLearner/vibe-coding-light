import type { ActivePet, AgentVisualState, PetMotion, PetSlot, PreparedAssetPayload } from "./types";

type PhotoPet = Extract<ActivePet, { kind: "photo" }>;

function slotForState(state: AgentVisualState): PetSlot {
  return state === "working" || state === "waiting" || state === "error" || state === "completed" ? state : "default";
}

export function imageForState(pet: PhotoPet, state: AgentVisualState): { slot: PetSlot; asset: PreparedAssetPayload } | null {
  const requested = slotForState(state);
  const slot = pet.assets[requested] ? requested : "default";
  const asset = pet.assets[slot];
  return asset ? { slot, asset } : null;
}

export function motionForState(pet: PhotoPet, state: AgentVisualState): PetMotion | "gif" {
  const selected = imageForState(pet, state);
  if (!selected) return "follow_state";
  if (selected.asset.kind === "gif") return "gif";
  return pet.motions[selected.slot] ?? "follow_state";
}
