import { Engine, WebGPUEngine, type AbstractEngine } from "@babylonjs/core";

/** WebGPU where the browser supports it, otherwise WebGL2. `?renderer=webgl` forces WebGL. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; kind: "webgpu" | "webgl" }> {
  const forceWebGL = new URLSearchParams(location.search).get("renderer") === "webgl";
  if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
      await engine.initAsync();
      return { engine, kind: "webgpu" };
    } catch (err) {
      console.warn("WebGPU init failed, falling back to WebGL2", err);
    }
  }
  return { engine: new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }, true), kind: "webgl" };
}
