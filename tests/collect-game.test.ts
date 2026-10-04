import { expect, it } from "vitest";
import { CollectGame } from "../src/examples/CollectGame";
it("keeps diagonal speed consistent, clamps the play area, and remembers prior poses", () => {
  // Verifies keeps diagonal speed consistent, clamps the play area, and remembers prior poses.

  const game = new CollectGame();
  game.step(0.1, 1, 1);
  expect(Math.hypot(game.x, game.z)).toBeCloseTo(0.5);
  expect(game.previousX).toBe(0);
  game.step(10, 1, 1);
  expect(game.x).toBe(8);
  expect(game.z).toBe(5);
});
it("collects each item once and restarts without allocating new item state", () => {
  // Verifies collects each item once and restarts without allocating new item state.

  const game = new CollectGame(),
    collected = game.collected;
  for (let i = 0; i < game.itemX.length; i++) {
    game.x = game.itemX[i]!;
    game.z = game.itemZ[i]!;
    game.step(0, 0, 0);
    game.step(0, 0, 0);
  }
  expect(game.score).toBe(6);
  game.reset();
  expect(game.collected).toBe(collected);
  expect(game.score).toBe(0);
  expect(Array.from(collected)).toEqual([0, 0, 0, 0, 0, 0]);
});
