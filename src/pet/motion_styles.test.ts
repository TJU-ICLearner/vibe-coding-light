import { describe, expect, it } from "vitest";
// @ts-expect-error Test runtime provides node:fs; the frontend project omits Node typings.
import { readFileSync } from "node:fs";

const desktopCss = readFileSync("src/styles.css", "utf8");
const settingsCss = readFileSync("src/settings.css", "utf8");

describe("motion preview", () => {
  it("uses the same keyframes in settings and on the desktop", () => {
    const names = ["pet-photo-idle", "pet-photo-working", "pet-photo-waiting", "pet-photo-error", "pet-photo-completed", "pet-motion-sway", "pet-motion-float", "pet-motion-breathe", "pet-motion-bounce", "pet-motion-wobble"];
    for (const name of names) {
      const line = (css: string) => css.split("\n").find((value) => value.startsWith(`@keyframes ${name} `));
      expect(line(desktopCss), name).toBeDefined();
      expect(line(settingsCss), name).toBe(line(desktopCss));
    }
  });
});
