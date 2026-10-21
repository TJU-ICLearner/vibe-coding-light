import type { ActivePet, AgentVisualState } from "./types";

export class PhotoRenderer {
  private active: ActivePet = { kind: "builtin" };
  private state: AgentVisualState = "idle";
  private completedPlayed = false;

  constructor(
    private readonly wrapper: HTMLElement,
    private readonly sprite: HTMLElement,
    private readonly frame: HTMLElement,
    private readonly image: HTMLImageElement,
  ) {
    image.addEventListener("animationend", (event) => {
      if (event.animationName === "pet-photo-completed" && this.active.kind === "photo" && this.state === "completed") {
        this.completedPlayed = true;
        this.image.className = "motion-idle";
      } else if (event.animationName === "pet-photo-react") {
        this.image.classList.remove("reacting");
      }
    });
  }

  applyPet(pet: ActivePet): void {
    this.active = pet;
    this.image.classList.remove("reacting");
    const isPhoto = pet.kind === "photo";
    this.wrapper.classList.toggle("photo-active", isPhoto);
    if (isPhoto) {
      this.image.src = pet.assets.default?.data_url ?? "";
      this.frame.style.transform = `translate(${pet.offset_x}px, ${pet.offset_y}px) scale(${pet.scale})`;
    } else {
      this.image.removeAttribute("src");
      this.frame.style.transform = "";
    }
    this.renderState();
  }

  applyState(state: AgentVisualState): void {
    if (state !== this.state) this.completedPlayed = false;
    this.state = state;
    this.renderState();
  }

  private renderState(): void {
    const visual = this.state === "unknown" ? "idle" : this.state;
    this.sprite.className = `pet-sprite state-${visual}`;
    this.image.className = `motion-${visual === "completed" && this.completedPlayed ? "idle" : visual}`;
  }

  react(): boolean {
    if (this.active.kind !== "photo") return false;
    this.image.classList.remove("reacting");
    void this.image.offsetWidth;
    this.image.classList.add("reacting");
    return true;
  }
}
