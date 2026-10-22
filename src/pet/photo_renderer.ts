import type { ActivePet, AgentVisualState } from "./types";
import { imageForState, motionForState } from "./motion";

export class PhotoRenderer {
  private active: ActivePet = { kind: "builtin" };
  private state: AgentVisualState = "idle";
  private completedPlayed = false;
  private currentSource: string | null = null;
  private fitScale: number | null = null;

  constructor(
    private readonly wrapper: HTMLElement,
    private readonly sprite: HTMLElement,
    private readonly frame: HTMLElement,
    private readonly image: HTMLImageElement,
  ) {
    image.addEventListener("animationend", (event) => {
      if (event.animationName === "pet-photo-completed" && this.image.classList.contains("motion-completed") && this.active.kind === "photo" && this.state === "completed") {
        this.completedPlayed = true;
        this.image.className = "motion-idle";
      }
    });
  }

  applyPet(pet: ActivePet): void {
    this.active = pet;
    this.fitScale = null;
    this.currentSource = null;
    this.completedPlayed = false;
    const isPhoto = pet.kind === "photo";
    this.wrapper.classList.toggle("photo-active", isPhoto);
    if (isPhoto) {
      this.updateTransform();
    } else {
      this.image.removeAttribute("src");
      this.frame.style.transform = "";
    }
    this.renderState();
  }

  setFitScale(scale: number | null): void {
    this.fitScale = scale;
    if (this.active.kind === "photo") this.updateTransform();
  }

  private updateTransform(): void {
    if (this.active.kind !== "photo") return;
    const pet = this.active;
    this.frame.style.transform = `translate(${pet.offset_x}px, ${pet.offset_y}px) scale(${this.fitScale ?? pet.scale})`;
  }

  applyState(state: AgentVisualState): void {
    if (state !== this.state) this.completedPlayed = false;
    this.state = state;
    this.renderState();
  }

  private renderState(): void {
    const visual = this.state === "unknown" ? "idle" : this.state;
    this.sprite.className = `pet-sprite state-${visual}`;
    if (this.active.kind !== "photo") {
      this.image.className = "";
      return;
    }
    const selected = imageForState(this.active, this.state);
    if (!selected) {
      this.image.removeAttribute("src");
      this.currentSource = null;
      this.image.className = "";
      return;
    }
    if (this.currentSource !== selected.asset.data_url) {
      this.image.src = selected.asset.data_url;
      this.currentSource = selected.asset.data_url;
    }
    const motion = motionForState(this.active, this.state);
    this.image.className = motion === "gif" ? "animated"
      : motion === "follow_state" ? `motion-${visual === "completed" && this.completedPlayed ? "idle" : visual}`
      : `motion-${motion}`;
  }

}
