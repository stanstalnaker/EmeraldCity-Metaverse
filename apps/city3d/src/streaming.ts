import { AssetContainer, LoadAssetContainerAsync, TransformNode, Vector3 as V3, type Scene, type Vector3 } from "@babylonjs/core";
import type { WorldManifest, WorldModel } from "@emerald-city/world";

export interface StreamEvents {
  onLoaded(model: WorldModel, container: AssetContainer): void;
  onUnloaded(model: WorldModel, container: AssetContainer): void;
  onProgress(loading: number, loaded: number): void;
}

/**
 * Streams a world's models by distance: loads within `radius`, unloads beyond `radius × hysteresis`
 * so memory stays bounded as you travel (the legacy client only ever loaded).
 */
export class WorldStreamer {
  private readonly loaded = new Map<string, AssetContainer>();
  private readonly loading = new Set<string>();

  constructor(
    private readonly scene: Scene,
    private readonly world: WorldManifest,
    private readonly assetBase: string,
    private readonly events: StreamEvents,
    private readonly hysteresis = 1.3,
  ) {}

  update(at: Vector3): void {
    for (const m of this.world.models) {
      const d = m.anchor ? Math.hypot(at.x - m.anchor.x, at.y - m.anchor.y, at.z - m.anchor.z) : 0;
      const want = !m.anchor || m.radius === null || d <= m.radius;
      const drop = m.anchor && m.radius !== null && d > m.radius * this.hysteresis;
      if (want && !this.loaded.has(m.id) && !this.loading.has(m.id)) void this.load(m);
      else if (drop && this.loaded.has(m.id)) this.unload(m);
    }
    this.events.onProgress(this.loading.size, this.loaded.size);
  }

  /** Load everything near a point and wait (used for the initial spawn). */
  async preload(at: Vector3): Promise<void> {
    const near = this.world.models.filter((m) => !m.anchor || m.radius === null || Math.hypot(at.x - m.anchor.x, at.y - m.anchor.y, at.z - m.anchor.z) <= m.radius);
    await Promise.all(near.map((m) => this.load(m)));
  }

  private async load(m: WorldModel): Promise<void> {
    if (this.loaded.has(m.id) || this.loading.has(m.id)) return;
    this.loading.add(m.id);
    try {
      const container = await LoadAssetContainerAsync(`${this.assetBase}${m.file}`, this.scene);
      if (m.transform) {
        // Place the whole model with one parent transform (legacy newCoords placement).
        const root = new TransformNode(`${m.id}~placement`, this.scene);
        root.position = new V3(m.transform.position.x, m.transform.position.y, m.transform.position.z);
        root.scaling = new V3(m.transform.scale, m.transform.scale, m.transform.scale);
        root.rotation.y = m.transform.rotationY;
        for (const node of container.rootNodes) node.parent = root;
        container.transformNodes.push(root);
      }
      container.addAllToScene();
      this.loaded.set(m.id, container);
      this.events.onLoaded(m, container);
    } catch (err) {
      console.error(`failed to load ${m.file}`, err);
    } finally {
      this.loading.delete(m.id);
    }
  }

  private unload(m: WorldModel): void {
    const c = this.loaded.get(m.id);
    if (!c) return;
    this.loaded.delete(m.id);
    this.events.onUnloaded(m, c);
    c.removeAllFromScene();
    c.dispose();
  }
}
