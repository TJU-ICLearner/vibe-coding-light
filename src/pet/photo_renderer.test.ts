import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoRenderer } from "./photo_renderer";

const photo = { kind: "photo" as const, id: "p1", assets: { default: { kind: "png" as const, data_url: "data:image/png;base64,YQ==" } }, motions: {}, invalid_slots: [], scale: 0.8, offset_x: 4, offset_y: -3 };
const statePhoto = { ...photo, assets: { ...photo.assets, working: { kind: "gif" as const, data_url: "data:image/gif;base64,R0lG" } } };

function fixture() {
  document.body.innerHTML = `<div id="pet-wrapper"><div id="pet-sprite"></div><div id="photo-frame"><img id="photo-pet"></div><div id="whip-overlay"></div></div>`;
  return new PhotoRenderer(
    document.querySelector<HTMLElement>("#pet-wrapper")!,
    document.querySelector<HTMLElement>("#pet-sprite")!,
    document.querySelector<HTMLElement>("#photo-frame")!,
    document.querySelector<HTMLImageElement>("#photo-pet")!,
  );
}

describe("photo pet renderer", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("uses each static image's motion and inherits default motion for missing slots", () => {
    const renderer = fixture();
    renderer.applyPet({ ...photo, motions: { default: "sway", working: "float" }, assets: { ...photo.assets, working: { kind: "png", data_url: "data:image/png;base64,Vw==" } } });
    renderer.applyState("working");
    expect(document.querySelector("#photo-pet")?.className).toBe("motion-float");
    renderer.applyState("waiting");
    expect(document.querySelector("#photo-pet")?.className).toBe("motion-sway");
    for (const motion of ["still", "sway", "float", "breathe", "bounce", "wobble"] as const) {
      renderer.applyPet({ ...photo, motions: { default: motion } });
      expect(document.querySelector("#photo-pet")?.className).toBe(`motion-${motion}`);
    }
  });

  it("does not apply a motion class to a GIF even with malformed motion metadata", () => {
    const renderer = fixture();
    renderer.applyPet({ ...statePhoto, motions: { working: "bounce" } });
    renderer.applyState("working");
    expect(document.querySelector("#photo-pet")?.className).toBe("animated");
  });

  it("maps states to motion and unknown to idle", () => {
    const renderer = fixture(); renderer.applyPet(photo);
    renderer.applyState("working"); expect(document.querySelector("#photo-pet")?.className).toBe("motion-working");
    renderer.applyState("unknown"); expect(document.querySelector("#photo-pet")?.className).toBe("motion-idle");
  });

  it("finishes a one-shot completed jump into idle motion", () => {
    const renderer = fixture(); renderer.applyPet(photo); renderer.applyState("completed");
    const image = document.querySelector<HTMLImageElement>("#photo-pet")!;
    expect(image.className).toBe("motion-completed");
    image.dispatchEvent(Object.assign(new Event("animationend"), { animationName: "pet-photo-completed" }));
    expect(image.className).toBe("motion-idle");
  });

  it("switches pet while working and restores the built-in cat", () => {
    const renderer = fixture(); renderer.applyState("working"); renderer.applyPet(photo);
    expect(document.querySelector("#photo-pet")?.className).toBe("motion-working");
    expect(document.querySelector<HTMLElement>("#photo-frame")?.style.transform).toContain("0.8");
    renderer.applyPet({ kind: "builtin" });
    expect(document.querySelector("#pet-wrapper")?.classList.contains("photo-active")).toBe(false);
    expect(document.querySelector("#pet-sprite")?.className).toBe("pet-sprite state-working");
  });

  it("fits an enlarged photo when the native window cannot grow", () => {
    const renderer = fixture();
    renderer.applyPet({ ...photo, scale: 3 });
    renderer.setFitScale(0.875);
    expect(document.querySelector<HTMLElement>("#photo-frame")?.style.transform).toBe("translate(4px, -3px) scale(0.875)");
    renderer.setFitScale(null);
    expect(document.querySelector<HTMLElement>("#photo-frame")?.style.transform).toBe("translate(4px, -3px) scale(3)");
  });

  it("uses a photo reaction without enabling fixed cat overlays", () => {
    const renderer = fixture();
    expect(renderer.react()).toBe(false);
    renderer.applyPet(photo);
    expect(renderer.react()).toBe(true);
    expect(document.querySelector("#pet-wrapper")?.classList.contains("photo-active")).toBe(true);
    expect(document.querySelector("#photo-pet")?.classList.contains("reacting")).toBe(true);
  });

  it("selects state asset or default", () => {
    const renderer = fixture();
    const image = document.querySelector<HTMLImageElement>("#photo-pet")!;
    renderer.applyPet(statePhoto);
    renderer.applyState("working");
    expect(image.getAttribute("src")).toBe("data:image/gif;base64,R0lG");
    renderer.applyState("waiting");
    expect(image.getAttribute("src")).toBe("data:image/png;base64,YQ==");
    renderer.applyState("unknown");
    expect(image.getAttribute("src")).toBe("data:image/png;base64,YQ==");
  });

  it("does not restart same state GIF", () => {
    const renderer = fixture();
    const image = document.querySelector<HTMLImageElement>("#photo-pet")!;
    renderer.applyPet(statePhoto);
    const setter = vi.spyOn(image, "src", "set");
    renderer.applyState("working");
    expect(setter).toHaveBeenCalledTimes(1);
    renderer.applyState("working");
    expect(setter).toHaveBeenCalledTimes(1);
    renderer.applyState("waiting");
    renderer.applyState("working");
    expect(setter).toHaveBeenCalledTimes(3);
  });

  it("keeps static motion only", () => {
    const renderer = fixture();
    const image = document.querySelector<HTMLImageElement>("#photo-pet")!;
    renderer.applyPet(statePhoto);
    renderer.applyState("working");
    expect(image.className).not.toContain("motion-");
    renderer.applyState("waiting");
    expect(image.className).toBe("motion-waiting");
    renderer.applyPet({ kind: "builtin" });
    expect(image.hasAttribute("src")).toBe(false);
  });
});
