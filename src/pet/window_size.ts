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

/** Motion distances are measured in source-image pixels, before the image is scaled. */
export function petMotionMetrics(scale: number) {
  const allowance = Math.max(0, (petWindowSide(scale) - SOURCE_SIDE * scale) / 2 - 1);
  const travel = allowance / scale;
  return {
    shiftPx: Math.min(5, travel),
    bouncePx: Math.min(8, travel),
    idlePx: Math.min(3, travel),
    errorPx: Math.min(3, travel),
    angleDeg: Math.min(5, allowance / (SOURCE_SIDE * scale) * 180 / Math.PI),
    expand: 1 + Math.min(0.035, allowance / (SOURCE_SIDE / 2 * scale)),
    completeExpand: 1 + Math.min(0.06, allowance / (SOURCE_SIDE * scale)),
    completeLiftPx: Math.min(12, allowance / (2 * scale)),
  };
}

export function applyPetMotionMetrics(image: HTMLElement, scale: number): void {
  const motion = petMotionMetrics(scale);
  image.style.setProperty("--pet-motion-shift", `${motion.shiftPx}px`);
  image.style.setProperty("--pet-motion-left", `${-motion.shiftPx}px`);
  image.style.setProperty("--pet-motion-idle-rise", `${-motion.idlePx}px`);
  image.style.setProperty("--pet-motion-error-shift", `${motion.errorPx}px`);
  image.style.setProperty("--pet-motion-bounce-rise", `${-motion.bouncePx}px`);
  image.style.setProperty("--pet-motion-angle", `${motion.angleDeg}deg`);
  image.style.setProperty("--pet-motion-angle-left", `${-motion.angleDeg}deg`);
  image.style.setProperty("--pet-motion-expand", String(motion.expand));
  image.style.setProperty("--pet-motion-complete-expand", String(motion.completeExpand));
  image.style.setProperty("--pet-motion-complete-rise", `${-motion.completeLiftPx}px`);
}
