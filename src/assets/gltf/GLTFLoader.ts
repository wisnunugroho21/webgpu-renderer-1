import { Document, JSONDocument, WebIO } from "@gltf-transform/core";
import { RuntimeAsset } from "./RuntimeAsset";
import { GLTFCodecs } from "./GLTFCodecs";
import { convertRuntimeAsset } from "./convertRuntimeAsset";
/** Fetch/decode facade shared by main-thread and worker loading. Conversion owns only engine data. */
export class GLTFLoader {
  private readonly io = new WebIO();
  private readonly codecs = new GLTFCodecs();
  /** Fetches glTF/GLB bytes and resolves external buffers/images relative to the source URL. */
  async fetch(url: string, signal?: AbortSignal): Promise<JSONDocument> {
    return signal
      ? new WebIO({ signal }).readAsJSON(url)
      : this.io.readAsJSON(url);
  }
  /** Fetches and decodes one asset into renderer-independent engine data. */
  async load(url: string): Promise<RuntimeAsset> {
    return this.parseJSON(await this.fetch(url));
  }
  /** Validates binary glTF headers/chunks and extracts JSON plus binary buffer data. */
  async parseGLB(bytes: Uint8Array): Promise<RuntimeAsset> {
    return this.parseJSON(await this.io.binaryToJSON(bytes));
  }
  /** Parses textual glTF and prepares decoder inputs from its JSON definition. */
  async parseJSON(json: JSONDocument): Promise<RuntimeAsset> {
    await this.codecs.prepare(this.io, json);
    return this.convert(await this.io.readJSON(json));
  }
  /** Converts decoded glTF resources into the engine asset layout. */
  convert(document: Document): RuntimeAsset {
    return convertRuntimeAsset(document);
  }
}
