import { expect, it } from "vitest";
import { World } from "../src/ecs/World";
import { Animator } from "../src/animation/Animator";
import { AnimationClip } from "../src/animation/AnimationClip";
import { AnimationChannel } from "../src/animation/AnimationChannel";
import { AnimationSampler } from "../src/animation/AnimationSampler";
import { AnimationLayerPlayback } from "../src/animation/AnimationLayerPlayback";

const channel = (
  node: number,
  path: "translation" | "scale" | "rotation" | "weights",
  a: number[],
  b = a,
) =>
  new AnimationChannel(
    node,
    path,
    new AnimationSampler(
      new Float32Array([0, 2]),
      new Float32Array([...a, ...b]),
      "LINEAR",
      path === "rotation",
    ),
  );
const clips = [
  new AnimationClip("base", [
    channel(0, "translation", [1, 0, 0]),
    channel(0, "scale", [2, 2, 2]),
    channel(0, "rotation", [0, 0, 0, 1]),
    channel(0, "weights", [0.2, 0.4]),
  ]),
  new AnimationClip("layer", [
    channel(0, "translation", [0, 0, 0], [4, 0, 0]),
    channel(1, "translation", [0, 0, 0], [8, 0, 0]),
    channel(0, "scale", [1, 1, 1], [3, 3, 3]),
    channel(0, "rotation", [0, 0, 0, 1], [0, 0, 1, 0]),
    channel(0, "weights", [0, 0], [1, 1]),
  ]),
  new AnimationClip("next", [channel(0, "translation", [3, 0, 0])]),
];
function setup() {
  const world = new World(2),
    entities = new Int32Array([world.create(), world.create()]);
  for (const entity of entities) world.transforms.add(entity);
  const morph = {
    weightOffset: 0,
    targetCount: 2,
    weights: new Float32Array(2),
    dirty: false,
  };
  const animator = new Animator(
    clips,
    world,
    entities,
    new Map([[entities[0]!, morph]]),
  );
  animator.play();
  return { world, animator, morph };
}

it("composes override/additive TRS and morphs without accumulating across frames", () => {
  const { world, animator, morph } = setup();
  const layer = animator.addLayer({
    clip: 1,
    mode: "additive",
    time: 1,
    referenceTime: 0,
    weight: 0.5,
    playing: false,
  });
  for (let frame = 0; frame < 50; frame++) animator.update(0.01);
  expect(world.transforms.positionX[0]).toBe(2);
  expect(world.transforms.positionX[1]).toBe(2);
  expect(world.transforms.scaleX[0]).toBe(3);
  expect(world.transforms.rotationZ[0]).toBeCloseTo(Math.sin(Math.PI / 8));
  expect(morph.weights[0]).toBeCloseTo(0.45);
  layer.weight = 0;
  animator.update(0);
  expect(world.transforms.positionX[0]).toBe(1);
  expect(world.transforms.positionX[1]).toBe(0);
  layer.weight = 1;
  animator.addLayer({
    clip: 1,
    mode: "override",
    time: 2,
    weight: 0.5,
    playing: false,
    nodes: [0],
  });
  expect(world.transforms.positionX[0]).toBe(3.5);
  expect(world.transforms.positionX[1]).toBe(4);
  expect(animator.removeLayer(layer)).toBe(true);
  expect(animator.removeLayer(layer)).toBe(false);
  expect(world.transforms.positionX[1]).toBe(0);
  animator.clearLayers();
  expect(animator.layers).toHaveLength(0);
  expect(world.transforms.positionX[0]).toBe(1);
  expect(world.transforms.scaleX[0]).toBe(2);
  expect(morph.weights[0]).toBeCloseTo(0.2);
});

it("has independent masked playback, reverse/nonloop clocks and controller pause/stop", () => {
  const a = setup(),
    b = setup();
  const nodes = [1];
  const layer = a.animator.addLayer({
    clip: 1,
    mode: "override",
    time: 1,
    weight: 1,
    speed: -1,
    loop: false,
    nodes,
  });
  nodes.push(0);
  a.animator.update(0.5);
  expect(layer.time).toBe(0.5);
  expect(a.world.transforms.positionX[0]).toBe(1);
  expect(a.world.transforms.positionX[1]).toBe(2);
  expect(b.world.transforms.positionX[1]).toBe(0);
  a.animator.pause();
  layer.time = 1;
  a.animator.evaluate();
  expect(a.world.transforms.positionX[1]).toBe(4);
  layer.time = 0.5;
  a.animator.evaluate();
  a.animator.update(1);
  expect(layer.time).toBe(0.5);
  a.animator.play();
  a.animator.update(1);
  expect(layer.time).toBe(0);
  expect(layer.playing).toBe(false);
  layer.time = 1.9;
  layer.speed = 1;
  layer.loop = true;
  layer.playing = true;
  a.animator.update(0.3);
  expect(layer.time).toBeCloseTo(0.2);
  a.animator.stop();
  expect(layer.time).toBe(0);
  expect(() => {
    layer.weight = 2;
  }).toThrow();
  expect(() => {
    layer.speed = NaN;
  }).toThrow();
  expect(() => {
    layer.time = Infinity;
  }).toThrow();
  expect(() =>
    a.animator.addLayer({ clip: 99, mode: "override", time: 0, weight: 1 }),
  ).toThrow();
  expect(() =>
    a.animator.addLayer({
      clip: 1,
      mode: "override",
      time: 0,
      weight: 1,
      nodes: [-1],
    }),
  ).toThrow();
  expect(
    () =>
      new AnimationLayerPlayback(
        { clip: 0, mode: "additive", time: 0, weight: 1, referenceTime: NaN },
        2,
      ),
  ).toThrow();
});

it("does not double-apply layers when a base crossfade is interrupted", () => {
  const layered = setup(),
    base = setup();
  layered.animator.addLayer({
    clip: 1,
    mode: "additive",
    time: 1,
    weight: 1,
    playing: false,
    nodes: [0],
  });
  for (const animator of [layered.animator, base.animator]) {
    animator.crossFade(2, 1);
    animator.update(0.3);
    animator.crossFade(0, 1);
  }
  for (let frame = 0; frame < 60; frame++) {
    layered.animator.update(1 / 60);
    base.animator.update(1 / 60);
    expect(layered.world.transforms.positionX[0]).toBeCloseTo(
      base.world.transforms.positionX[0]! + 2,
      5,
    );
  }
});
