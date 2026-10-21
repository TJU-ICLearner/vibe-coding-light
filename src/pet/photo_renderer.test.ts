import { beforeEach, describe, expect, it } from "vitest";
import { PhotoRenderer } from "./photo_renderer";

const photo = { kind: "photo" as const, id: "p1", assets: { default: { kind: "png" as const, data_url: "data:image/png;base64,YQ==" } }, invalid_slots: [], scale: 0.8, offset_x: 4, offset_y: -3 };

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

  it("uses a photo reaction without enabling fixed cat overlays", () => {
    const renderer = fixture();
    expect(renderer.react()).toBe(false);
    renderer.applyPet(photo);
    expect(renderer.react()).toBe(true);
    expect(document.querySelector("#pet-wrapper")?.classList.contains("photo-active")).toBe(true);
    expect(document.querySelector("#photo-pet")?.classList.contains("reacting")).toBe(true);
  });
});
