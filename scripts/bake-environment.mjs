import { build } from "vite";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [input, output, ...args] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: npm run bake:environment -- input.hdr output.envbin [--samples N] [--specular-size N] [--diffuse-size N] [--brdf-size N]",
  );
const names = {
    "--samples": "samples",
    "--specular-size": "specularSize",
    "--diffuse-size": "diffuseSize",
    "--brdf-size": "brdfSize",
  },
  options = {};
for (let i = 0; i < args.length; i += 2) {
  const name = names[args[i]];
  if (!name || !args[i + 1]) throw new Error("Invalid bake option");
  options[name] = Number(args[i + 1]);
}
await mkdir("artifacts", { recursive: true });
// Bundle the exact runtime CPU implementation; temporary output stays near node_modules.
const temporary = await mkdtemp(resolve("artifacts/environment-baker-"));
try {
  const result = await build({
    configFile: false,
    logLevel: "error",
    build: {
      ssr: resolve("src/rendering/environment/prepareEnvironment.ts"),
      write: false,
      rolldownOptions: { output: { codeSplitting: false, format: "esm" } },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(
    (bundle) => bundle.output,
  );
  const code = chunks.find(
    (chunk) => chunk.type === "chunk" && chunk.isEntry,
  ).code;
  const modulePath = resolve(temporary, "baker.mjs");
  await writeFile(modulePath, code);
  const { prepareEnvironment, encodeEnvironmentArchive } = await import(
    pathToFileURL(modulePath).href
  );
  const bytes = new Uint8Array(await readFile(input));
  if (bytes.byteLength > 64 * 1024 * 1024)
    throw new Error("Environment file exceeds 64 MiB");
  const start = performance.now(),
    { data } = await prepareEnvironment(bytes, options),
    archive = encodeEnvironmentArchive(data);
  await writeFile(output, archive);
  console.log(
    JSON.stringify({
      output,
      bytes: archive.byteLength,
      bakeMs: performance.now() - start,
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
