import { RenderWorld } from "./RenderWorld";
import { Streaming, StreamLease } from "../assets/Streaming";
import {
  RuntimeAsset,
  RuntimePrimitive,
  RuntimeMaterial,
} from "../assets/gltf/RuntimeAsset";
import { MeshManager } from "./MeshManager";
import { LODGroups } from "./lod/LODGroups";
import { MaterialTextures } from "./materials/MaterialTextures";
import { MaterialManager } from "./materials/MaterialManager";
type Resident =
  | { mesh: number }
  | { groups: GPUBindGroup[]; slots: RuntimeMaterial["textures"] };
/** Bound slots own leases. Detach to a resident fallback before allowing eviction. */
export class RendererStreaming {
  readonly resources: Streaming<Resident>;
  private readonly lodSlots = new Map<
    string,
    { lease: StreamLease<Resident>; fallback: number }
  >();
  private readonly materialSlots = new Map<
    number,
    {
      lease: StreamLease<Resident>;
      fallback: GPUBindGroup;
      layout: Float32Array;
    }
  >();
  constructor(
    queue: GPUQueue,
    private readonly meshes: MeshManager,
    private readonly lods: LODGroups,
    private readonly textures: MaterialTextures,
    private readonly materials: MaterialManager,
    private readonly frame: () => number,
    private readonly world: RenderWorld,
  ) {
    this.resources = new Streaming(
      () => queue.onSubmittedWorkDone(),
      (resident) => {
        if ("mesh" in resident) {
          for (let i = 0; i < this.world.count; i++)
            if (this.world.meshId[i] === resident.mesh) return true;
          for (const group of this.lods.entries)
            for (const id of group.meshes)
              if (id === resident.mesh) return true;
        } else {
          for (const group of this.textures.groups)
            if (resident.groups.includes(group)) return true;
        }
        return false;
      },
    );
  }
  async bindLOD(
    group: number,
    level: number,
    key: string,
    load: () => Promise<RuntimePrimitive>,
  ): Promise<void> {
    const slot = `${group}:${level}`;
    const entry = this.lods.entries[group];
    if (!entry || level < 1 || level >= entry.meshes.length)
      throw new Error("Invalid streamed LOD slot");
    this.releaseLOD(group, level);
    const fallback = entry.meshes[level]!;
    const lease = this.resources.acquire(
      `mesh:${key}`,
      this.frame(),
      async () => ({ mesh: this.meshes.upload(await load()) }),
      (r) => {
        if ("mesh" in r) this.meshes.destroy(r.mesh);
      },
    );
    this.lodSlots.set(slot, { lease, fallback });
    try {
      const resident = await lease.ready;
      if (this.lodSlots.get(slot)?.lease !== lease) return;
      if (!("mesh" in resident))
        throw new Error("Streaming resource kind mismatch");
      this.lods.replace(group, level, resident.mesh, this.meshes);
    } catch (error) {
      if (this.lodSlots.get(slot)?.lease === lease)
        this.releaseLOD(group, level);
      throw error;
    }
  }
  releaseLOD(group: number, level: number): void {
    const key = `${group}:${level}`,
      slot = this.lodSlots.get(key);
    if (!slot) return;
    this.lods.replace(group, level, slot.fallback, this.meshes);
    this.lodSlots.delete(key);
    slot.lease.release();
  }
  async bindMaterial(
    material: number,
    key: string,
    load: () => Promise<RuntimeAsset>,
  ): Promise<void> {
    if (material < 0 || material >= this.materials.count)
      throw new Error("Unknown streamed material");
    this.releaseMaterial(material);
    const fallback = this.textures.groups[material] ?? this.textures.fallback;
    const lease = this.resources.acquire(
      `texture:${key}`,
      this.frame(),
      async () => {
        const asset = await load();
        if (asset.materials.length !== 1)
          throw new Error("Streamed texture asset must contain one material");
        return {
          groups: await this.textures.prepare(asset),
          slots: asset.materials[0]!.textures,
        };
      },
      async (r) => {
        if ("groups" in r) await this.textures.release(r.groups);
      },
    );
    this.materialSlots.set(material, {
      lease,
      fallback,
      layout: this.materials.textureLayout(material),
    });
    try {
      const resident = await lease.ready;
      if (this.materialSlots.get(material)?.lease !== lease) return;
      if (!("groups" in resident))
        throw new Error("Streaming resource kind mismatch");
      this.materials.setTextureSlots(material, resident.slots);
      this.textures.groups[material] = resident.groups[0]!;
    } catch (error) {
      if (this.materialSlots.get(material)?.lease === lease)
        this.releaseMaterial(material);
      throw error;
    }
  }
  releaseMaterial(material: number): void {
    const slot = this.materialSlots.get(material);
    if (!slot) return;
    this.materials.setTextureLayout(material, slot.layout);
    this.textures.groups[material] = slot.fallback;
    this.materialSlots.delete(material);
    slot.lease.release();
  }
  touch(frame: number): void {
    for (const slot of this.lodSlots.values()) slot.lease.touch(frame);
    for (const slot of this.materialSlots.values()) slot.lease.touch(frame);
  }
  evictUnused(minimumAge = 60): Promise<number> {
    return this.resources.evictUnused(this.frame(), minimumAge);
  }
}
