export class RendererStats {
  fps = 0;
  frameTimeMs = 0;
  cpuFrameMs = 0;
  indirectDraws = 0;
  indirectUploadBytes = 0;
  gpuCandidates = 0;
  gpuObjectUploadBytes = 0;
  depthPasses = 0;
  depthDrawCalls = 0;
  depthTriangles = 0;
  shadowPasses = 0;
  shadowDrawCalls = 0;
  shadowTriangles = 0;
  shadowRejected = 0;
  shadowCacheHits = 0;
  shadowUploadBytes = 0;
  activeAnimators = 0;
  culledObjects = 0;
  clusters = 0;
  lights = 0;
  lightUploadBytes = 0;
  lod0 = 0;
  lod1 = 0;
  lod2 = 0;
  lodOther = 0;
  lodCulled = 0;
  activeMorphStates = 0;
  activeMorphTargets = 0;
  morphTargets = 0;
  morphUploadBytes = 0;
  activeSkeletons = 0;
  jointCount = 0;
  updatedJoints = 0;
  jointUploadBytes = 0;
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
    this.indirectDraws = this.indirectUploadBytes = 0;
    this.depthPasses = this.depthDrawCalls = this.depthTriangles = 0;
    this.shadowPasses =
      this.shadowDrawCalls =
      this.shadowTriangles =
      this.shadowRejected =
      this.shadowCacheHits =
      this.shadowUploadBytes =
        0;
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
