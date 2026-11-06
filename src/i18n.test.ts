import { describe, expect, it } from "vitest";
import { dictionaries, formatPetError, t } from "./i18n";

describe("interface language", () => {
  it("provides every interface key in both languages", () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries["zh-CN"]).sort());
    expect(t("en", "settings_title")).toBe("Customize Pet");
    expect(t("zh-CN", "settings_title")).toBe("自定义桌宠");
  });

  it("translates known validation and Rust errors while preserving unknown detail", () => {
    expect(formatPetError("en", { code: "gif_requires_animation" })).toContain("GIF");
    expect(formatPetError("zh-CN", { code: "gif_requires_animation" })).toContain("动图");
    expect(formatPetError("en", { code: "invalid_transform" })).toContain("0.5 and 3");
    expect(formatPetError("zh-CN", { code: "invalid_transform" })).toContain("0.5 到 3");
    expect(formatPetError("en", { code: "internal_error", detail: "disk denied" })).toContain("disk denied");
  });
});
