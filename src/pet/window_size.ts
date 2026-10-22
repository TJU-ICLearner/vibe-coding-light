const SOURCE_SIDE = 128;

export function validPetScale(scale: number): boolean {
  return Number.isFinite(scale) && scale >= 0.5 && scale <= 3;
}

export function petWindowSide(scale: number): number {
  if (!validPetScale(scale)) throw new RangeError("Invalid pet scale");
  return Math.max(SOURCE_SIDE, Math.ceil(SOURCE_SIDE * scale + 16));
}

export function petFitScale(scale: number, availableSide: number): number {
  return Math.min(scale, Math.max(0, (availableSide - 16) / SOURCE_SIDE));
}
