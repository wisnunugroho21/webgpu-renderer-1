import { expect, it, vi } from "vitest";
import {
  bakeEnvironment,
  cubeDirection,
  panoramaSampler,
} from "../src/rendering/environment/bakeEnvironment";
import {
  packHalf,
  validateEnvironment,
} from "../src/rendering/environment/EnvironmentData";
import { EnvironmentLighting } from "../src/rendering/environment/EnvironmentLighting";
import { Resources } from "../src/gpu/Resources";
const constant = () =>
  bakeEnvironment((_direction, out) => out.set([2, 0.5, 4]), {
    specularSize: 4,
    diffuseSize: 2,
    brdfSize: 4,
    samples: 64,
  });
it("preserves constant HDR radiance through diffuse and every GGX mip; integrates finite BRDF", () => {
  const data = constant();
  validateEnvironment(data);
  for (const cube of [data.diffuse, ...data.specular])
    for (const face of cube.faces)
      for (let i = 0; i < face.length; i += 4)
        expect(Array.from(face.subarray(i, i + 4))).toEqual([2, 0.5, 4, 1]);
  for (const value of data.brdf.pixels)
    expect(Number.isFinite(value)).toBe(true);
  const nearNormalSmooth = (0 * 4 + 3) * 4;
  expect(data.brdf.pixels[nearNormalSmooth]).toBeGreaterThan(0.9);
  expect(data.brdf.pixels[nearNormalSmooth + 1]).toBeLessThan(0.01);
  const half = packHalf(
    new Float32Array([
      0,
      -0,
      1,
      -2,
      65504,
      2 ** -24,
      2 ** -25,
      3 * 2 ** -25,
      1 + 2 ** -11,
      1 + 3 * 2 ** -11,
    ]),
  );
  expect(Array.from(half)).toEqual([
    0, 0x8000, 0x3c00, 0xc000, 0x7bff, 1, 0, 2, 0x3c00, 0x3c02,
  ]);
});
it("uses WebGPU cube directions and bilinear panorama seams/poles", () => {
  const out = new Float64Array(3);
  for (const [face, direction] of [
    [0, [1, 0, 0]],
    [1, [-1, 0, 0]],
    [2, [0, 1, 0]],
    [3, [0, -1, 0]],
    [4, [0, 0, 1]],
    [5, [0, 0, -1]],
  ] as const) {
    cubeDirection(face, 0, 0, out);
    expect(Array.from(out).map((n) => n || 0)).toEqual(direction);
  }
  const sample = panoramaSampler(
    2,
    2,
    new Float32Array([1, 0, 0, 3, 0, 0, 5, 0, 0, 7, 0, 0]),
  );
  sample(new Float64Array([-1, 0, 0]), out);
  expect(out[0]).toBe(4);
  sample(new Float64Array([0, 1, 0]), out);
  expect(out[0]).toBe(2);
  sample(new Float64Array([0, -1, 0]), out);
  expect(out[0]).toBe(6);
  expect(() => panoramaSampler(2, 2, new Float32Array(0))).toThrow();
});
it("broadens a directional environment with increasing GGX roughness", () => {
  const data = bakeEnvironment(
    (direction, out) => out.fill(Math.max(0, direction[2]!) ** 32),
    { specularSize: 16, diffuseSize: 2, brdfSize: 4, samples: 256 },
  );
  const variance = (cube: typeof data.diffuse) => {
    const values = cube.faces.flatMap((face) =>
      Array.from(face).filter((_, i) => i % 4 === 0),
    );
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  };
  expect(variance(data.specular.at(-1)!)).toBeLessThan(
    variance(data.specular[0]!),
  );
});
it("rejects malformed environments and sampling settings", () => {
  const data = constant();
  expect(() =>
    validateEnvironment({ ...data, specular: data.specular.slice(0, 1) }),
  ).toThrow();
  expect(() =>
    validateEnvironment({ ...data, diffuse: { ...data.diffuse, faces: [] } }),
  ).toThrow();
  data.diffuse.faces[0]![0] = NaN;
  expect(() => validateEnvironment(data)).toThrow();
  expect(() =>
    bakeEnvironment((_, out) => out.fill(-1), {
      specularSize: 1,
      diffuseSize: 1,
      brdfSize: 1,
    }),
  ).toThrow();
  expect(() => bakeEnvironment(() => {}, { specularSize: 3 })).toThrow();
});

function mock() {
  vi.stubGlobal("GPUShaderStage", { FRAGMENT: 2 });
  vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 4, COPY_DST: 2 });
  vi.stubGlobal("GPUBufferUsage", { UNIFORM: 4, COPY_DST: 2 });
  const textures = new Set<unknown>(),
    buffers = new Set<unknown>();
  const queue = {
    writeTexture: vi.fn(),
    writeBuffer: vi.fn(),
    onSubmittedWorkDone: vi.fn(async () => {}),
  };
  const device = {
    queue,
    limits: { maxTextureDimension2D: 8192 },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async (): Promise<{ message: string } | null> => null),
    createBindGroupLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
  };
  const resources = {
    textures: {
      create: vi.fn(() => {
        const texture = { createView: () => ({}) };
        textures.add(texture);
        return texture;
      }),
      destroy: vi.fn((texture) => textures.delete(texture)),
    },
    buffers: {
      create: vi.fn(() => {
        const buffer = {};
        buffers.add(buffer);
        return buffer;
      }),
      destroy: vi.fn((buffer) => buffers.delete(buffer)),
    },
    samplers: { get: vi.fn(() => ({})) },
  };
  return {
    device,
    queue,
    textures,
    buffers,
    resources,
    environment: new EnvironmentLighting(
      device as unknown as GPUDevice,
      resources as unknown as Resources,
      () => {},
    ),
  };
}
it("installs transactionally, serializes replacements, releases resources and reuses warm parameters", async () => {
  const m = mock();
  expect(m.environment.active).toBe(false);
  expect(m.textures.size).toBe(0);
  await m.environment.set(constant());
  expect(m.textures.size).toBe(3);
  expect(m.buffers.size).toBe(1);
  const original = m.environment.group;
  m.device.popErrorScope.mockResolvedValueOnce({ message: "bad upload" });
  await expect(m.environment.set(constant())).rejects.toThrow("bad upload");
  expect(m.environment.group).toBe(original);
  expect(m.textures.size).toBe(3);
  expect(m.buffers.size).toBe(1);
  m.environment.intensity = 2;
  m.environment.rotationY = Math.PI / 2;
  m.environment.flush();
  const writes = m.queue.writeBuffer.mock.calls.length;
  m.environment.flush();
  expect(m.queue.writeBuffer.mock.calls.length).toBe(writes);
  m.environment.enabled = false;
  expect(m.environment.active).toBe(false);
  m.environment.enabled = true;
  await Promise.all([
    m.environment.set(constant()),
    m.environment.set(constant()),
  ]);
  expect(m.textures.size).toBe(3);
  expect(m.buffers.size).toBe(1);
  await m.environment.set(null);
  expect(m.textures.size).toBe(0);
  expect(m.buffers.size).toBe(0);
  m.environment.dispose();
  await expect(m.environment.set(constant())).rejects.toThrow("disposed");
  expect(() => {
    m.environment.intensity = -1;
  }).toThrow();
  expect(() => {
    m.environment.rotationY = NaN;
  }).toThrow();
  vi.unstubAllGlobals();
});
it("fences retired resources and rejects an installation arriving after disposal", async () => {
  const m = mock();
  await m.environment.set(constant());
  let finish!: () => void;
  m.queue.onSubmittedWorkDone.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const clearing = m.environment.set(null);
  await vi.waitFor(() => expect(m.environment.active).toBe(false));
  expect(m.textures.size).toBe(3);
  finish();
  await clearing;
  expect(m.textures.size).toBe(0);
  let pop!: (error: null) => void;
  m.device.popErrorScope.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        pop = resolve;
      }),
  );
  const installing = m.environment.set(constant());
  await vi.waitFor(() => expect(m.textures.size).toBe(3));
  m.environment.dispose();
  pop(null);
  await expect(installing).rejects.toThrow("disposed");
  expect(m.textures.size).toBe(0);
  expect(m.buffers.size).toBe(0);
  vi.unstubAllGlobals();
});
