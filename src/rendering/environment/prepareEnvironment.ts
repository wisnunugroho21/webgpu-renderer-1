import type { PreparedEnvironment } from "./EnvironmentWorkerProtocol";
import {
  decodeEnvironmentArchive,
  isEnvironmentArchive,
} from "./EnvironmentArchive";
import {
  bakeEnvironment,
  EnvironmentBakeOptions,
  panoramaSampler,
} from "./bakeEnvironment";
import { decodeEnvironmentPanorama } from "./decodeEnvironmentPanorama";
/** Shared main/worker/offline preparation path; no device or DOM ownership. */
export async function prepareEnvironment(
  bytes: Uint8Array,
  options: EnvironmentBakeOptions = {},
): Promise<PreparedEnvironment> {
  if (isEnvironmentArchive(bytes))
    return { data: decodeEnvironmentArchive(bytes), precomputed: true };
  const panorama = await decodeEnvironmentPanorama(bytes);
  return {
    data: bakeEnvironment(
      panoramaSampler(panorama.width, panorama.height, panorama.pixels),
      options,
    ),
    precomputed: false,
  };
}
export { encodeEnvironmentArchive } from "./EnvironmentArchive";
