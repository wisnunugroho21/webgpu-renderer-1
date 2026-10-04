/** Small deterministic gameplay model: collision/state stay independent of rendering and DOM input. */
export class CollectGame {
  readonly itemX = new Float32Array([-6, -3, 4, 6, 2, -5]);
  readonly itemZ = new Float32Array([-3, 3, 2, -3, -4, 0]);
  readonly collected = new Uint8Array(this.itemX.length);
  x = 0;
  z = 0;
  previousX = 0;
  previousZ = 0;
  score = 0;
  /** Restores player position, collectible flags and score for a new round. */
  reset(): void {
    this.x = this.z = this.previousX = this.previousZ = this.score = 0;
    this.collected.fill(0);
  }
  /** Normalizes movement input, advances fixed-step gameplay and collects nearby items using simulation coordinates. */
  step(dt: number, horizontal: number, vertical: number): void {
    if (
      !Number.isFinite(dt) ||
      dt < 0 ||
      !Number.isFinite(horizontal) ||
      !Number.isFinite(vertical)
    )
      throw new Error("Invalid game movement");
    this.previousX = this.x;
    this.previousZ = this.z;
    const length = Math.hypot(horizontal, vertical),
      scale = length > 0 ? (5 * dt) / Math.max(1, length) : 0;
    this.x = Math.max(-8, Math.min(8, this.x + horizontal * scale));
    this.z = Math.max(-5, Math.min(5, this.z + vertical * scale));
    for (let i = 0; i < this.collected.length; i++)
      if (
        !this.collected[i] &&
        (this.x - this.itemX[i]!) ** 2 + (this.z - this.itemZ[i]!) ** 2 <
          0.65 ** 2
      ) {
        this.collected[i] = 1;
        this.score++;
      }
  }
}
