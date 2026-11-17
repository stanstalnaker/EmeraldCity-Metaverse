/**
 * Dev-only legacy model converter, driven by packages/world/scripts/convert-legacy.mjs.
 * Loads a legacy .babylon model in a real browser (so textures decode), and exports it as GLB with
 * Babylon's own glTF exporter. Mesh names are kept, so screens, lifts and interactions still match.
 */
import { Engine, LoadAssetContainerAsync, Scene } from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers/glTF";

async function convert(file: string): Promise<{ name: string; base64: string; meshes: number }> {
  const engine = new Engine(document.getElementById("c") as HTMLCanvasElement, false, { preserveDrawingBuffer: false });
  const scene = new Scene(engine);
  const container = await LoadAssetContainerAsync("/legacy/" + file, scene);
  container.addAllToScene();
  // Wait for every texture so it is embedded in the GLB.
  await scene.whenReadyAsync();
  const glb = await GLTF2Export.GLBAsync(scene, "model", {
    shouldExportNode: (n) => n.getClassName() !== "Light" && !n.getClassName().endsWith("Camera"),
  });
  const blob = Object.values(glb.files)[0] as Blob;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const meshes = container.meshes.length;
  scene.dispose();
  engine.dispose();
  return { name: file, base64: btoa(bin), meshes };
}

Object.assign(window, { __convert: convert, __converterReady: true });
