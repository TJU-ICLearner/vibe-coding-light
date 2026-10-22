import { afterEach, describe, expect, it, vi } from "vitest";
import petHtml from "../../index.html?raw";
import { PatController } from "./pat_interaction";
import { PhotoRenderer } from "./photo_renderer";

function fixture() {
  document.body.innerHTML = `<div id="pet-wrapper"><div id="pet-sprite"></div><div id="photo-reaction"><div id="photo-frame"><img id="photo-pet"></div></div><div id="pat-overlay"></div></div>`;
  const wrapper = document.querySelector<HTMLElement>("#pet-wrapper")!;
  const sprite = document.querySelector<HTMLElement>("#pet-sprite")!;
  const frame = document.querySelector<HTMLElement>("#photo-frame")!;
  const image = document.querySelector<HTMLImageElement>("#photo-pet")!;
  const renderer = new PhotoRenderer(wrapper, sprite, frame, image);
  const pat = new PatController(wrapper, document.querySelector<HTMLElement>("#pat-overlay")!, (state) => renderer.applyState(state));
  return { wrapper, sprite, image, renderer, pat };
}

describe("pat interaction", () => {
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  it("has one hand and no punishment overlays", () => {
    expect(petHtml).toContain('id="pat-overlay"');
    expect(petHtml).not.toMatch(/id="(?:whip|stick|car|water|egg)-overlay"/);
  });

  it("pats the built-in cat twice without stacking overlays and restores the latest state", () => {
    vi.useFakeTimers();
    const { wrapper, sprite, pat } = fixture();
    pat.setAgentState("working");
    pat.start();
    expect(wrapper.classList.contains("patting")).toBe(true);
    expect(sprite.className).toBe("pet-sprite state-working");
    vi.advanceTimersByTime(300);
    pat.start();
    pat.setAgentState("completed");
    vi.advanceTimersByTime(500);
    expect(wrapper.classList.contains("patting")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(wrapper.classList.contains("patting")).toBe(false);
    expect(sprite.className).toBe("pet-sprite state-completed");
  });

  it("keeps a GIF source and clears the hand on a pet switch", () => {
    vi.useFakeTimers();
    const { wrapper, image, renderer, pat } = fixture();
    renderer.applyPet({ kind: "photo", id: "p", scale: 3, offset_x: 0, offset_y: 0, invalid_slots: [], motions: {}, assets: { default: { kind: "gif", data_url: "data:image/gif;base64,R0lG" } } });
    pat.setPetScale(3);
    pat.start();
    expect(image.getAttribute("src")).toBe("data:image/gif;base64,R0lG");
    expect(wrapper.style.getPropertyValue("--pat-head-offset")).toBe("90px");
    pat.cancel();
    expect(wrapper.classList.contains("patting")).toBe(false);
    renderer.applyPet({ kind: "builtin" });
    pat.setPetScale(1);
    vi.runAllTimers();
    expect(image.hasAttribute("src")).toBe(false);
  });
});
