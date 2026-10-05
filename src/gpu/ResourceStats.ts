export class ResourceStats {
  pipelineCreations = 0;
  shaderModules = 0;
  bufferCreations = 0;
  textureCreations = 0;
  textureBytes = 0;
  textureMipBytes = 0;
  compressedTextureBytes = 0;
  renderTargetBytes = 0;
  /** Logical owned GPU storage; excludes driver overhead and the browser-owned swapchain. */
  get gpuBytes(): number {
    return this.bufferBytes + this.textureBytes;
  }
  samplerCreations = 0;
  buffers = 0;
  textures = 0;
  bufferBytes = 0;
  cacheHits = 0;
  cacheMisses = 0;
}
