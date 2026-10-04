import { bench } from "vitest";
import { bakeEnvironment } from "../src/rendering/environment/bakeEnvironment";
import {
  encodeEnvironmentArchive,
  decodeEnvironmentArchive,
} from "../src/rendering/environment/EnvironmentArchive";
const data = bakeEnvironment((_direction, out) => out.fill(0.5), {
  specularSize: 16,
  diffuseSize: 4,
  brdfSize: 16,
  samples: 64,
});
const archive = encodeEnvironmentArchive(data);
bench("decode precomputed 16px environment (no convolution)", () => {
  decodeEnvironmentArchive(archive);
});
