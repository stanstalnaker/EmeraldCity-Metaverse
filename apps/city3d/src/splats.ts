import "@babylonjs/loaders/SPLAT";
import { LoadAssetContainerAsync, TransformNode, type AbstractMesh, type Scene } from "@babylonjs/core";
import type { WorldManifest } from "@emerald-city/world";

/**
 * Gaussian splats: photoreal captures of real places (.splat, .ply, .spz), placed as the world says.
 * A failed capture is skipped with a console note; the rest of the world is unaffected.
 */
export async function loadSplats(scene: Scene, splats: NonNullable<WorldManifest["splats"]>): Promise<AbstractMesh[]> {
  const out: AbstractMesh[] = [];
  for (const s of splats) {
    try {
      const container = await LoadAssetContainerAsync(s.url, scene);
      const root = new TransformNode(`splat-${s.label ?? out.length}`, scene);
      root.position.set(...s.position);
      root.rotation.y = s.rotationY ?? 0;
      root.scaling.setAll(s.scale ?? 1);
      for (const n of container.rootNodes) n.parent = root;
      container.addAllToScene();
      // Splats are lit by their own captured colour; keep them out of shadow casting and picking.
      for (const m of container.meshes) m.isPickable = false;
      out.push(...container.meshes);
    } catch (e) {
      console.warn(`splat ${s.label ?? s.url} could not be loaded`, e);
    }
  }
  return out;
}
