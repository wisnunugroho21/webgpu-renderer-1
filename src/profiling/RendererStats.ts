export class RendererStats {
  drawCalls = 0;
  triangles = 0;
  instances = 0;
  pipelineSwitches = 0;
  materialSwitches = 0;
  meshSwitches = 0;
  bufferUploadBytes = 0;
  totalRenderables = 0;
  frustumTested = 0;
  frustumRejected = 0;
  visibleObjects = 0;
  bvhNodesTested = 0;
  reset(): void {
    this.drawCalls =
      this.triangles =
      this.instances =
      this.pipelineSwitches =
      this.materialSwitches =
      this.meshSwitches =
      this.bufferUploadBytes =
        0;
  }
}
