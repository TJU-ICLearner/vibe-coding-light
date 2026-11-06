import { describe, expect, it } from "vitest";
import { appearanceLabel, resolveTheme, type Appearance } from "./appearance";

const base: Appearance = { followSystem: true, manualTheme: "shaxi" };

describe("appearance", () => {
  it("maps system light and dark to the two system choices", () => {
    expect(resolveTheme(base, false)).toBe("system_light");
    expect(resolveTheme(base, true)).toBe("system_dark");
  });

  it("uses a manual theme regardless of system appearance", () => {
    expect(resolveTheme({ ...base, followSystem: false }, false)).toBe("shaxi");
    expect(resolveTheme({ ...base, followSystem: false }, true)).toBe("shaxi");
  });

  it("uses concise names in Chinese and English", () => {
    expect(appearanceLabel("system_dark", "zh-CN")).toBe("系统深色");
    expect(appearanceLabel("shaxi", "zh-CN")).toBe("社戏");
    expect(appearanceLabel("zhiqiu", "zh-CN")).toBe("知秋");
    expect(appearanceLabel("bajiao", "en")).toBe("Banana Rain");
  });
});
