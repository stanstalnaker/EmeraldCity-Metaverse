import { EngineInstrumentation, SceneInstrumentation, type AbstractEngine, type Scene, type UniversalCamera, Vector3 } from "@babylonjs/core";

/**
 * Performance tools for testing on real devices (docs/DEVICE-TESTING.md).
 *
 *  ?quality=low|medium|high  render quality; default chosen from the device (phones get low)
 *  ?perf                     live overlay: fps, frame time, draw calls, triangles, memory, GPU
 *  ?bench                    20-second fly-through on a fixed path, then a results card (copyable JSON)
 */
export type Quality = "low" | "medium" | "high";

export interface QualitySettings {
  quality: Quality;
  shadows: boolean;
  shadowMapSize: number;
  cascades: number;
  ssao: boolean;
  msaa: number;
  /** Render at 1/scale resolution (1 = native). */
  hardwareScaling: number;
}

export function chooseQuality(param: string | null): QualitySettings {
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const small = Math.min(screen.width, screen.height) < 820;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const auto: Quality = touch && small ? "low" : cores <= 4 || memory <= 4 ? "medium" : "high";
  const q = (param === "low" || param === "medium" || param === "high" ? param : auto) as Quality;
  const dpr = window.devicePixelRatio || 1;
  return {
    quality: q,
    shadows: q !== "low",
    shadowMapSize: q === "high" ? 2048 : 1024,
    cascades: q === "high" ? 4 : 2,
    ssao: q === "high",
    msaa: q === "high" ? 4 : q === "medium" ? 2 : 1,
    // Phones with 3x screens don't need 3x pixels for a 3D scene.
    hardwareScaling: q === "low" ? Math.max(1, dpr / 1.5) : q === "medium" ? Math.max(1, dpr / 2) : 1,
  };
}

export interface PerfSample {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  heapMB: number | null;
}

export function startPerfOverlay(engine: AbstractEngine, scene: Scene, kind: string, q: QualitySettings, loadMs: () => number | null) {
  const si = new SceneInstrumentation(scene);
  si.captureFrameTime = true;
  const ei = new EngineInstrumentation(engine);
  ei.captureGPUFrameTime = true;
  const el = document.createElement("div");
  el.id = "perf";
  el.style.cssText = "position:fixed;right:12px;top:56px;z-index:30;font:12px/1.45 ui-monospace,monospace;background:#000c;color:#cfe;padding:8px 10px;border-radius:8px;white-space:pre;pointer-events:none";
  document.body.appendChild(el);
  const info = engineInfo(engine, kind);
  const sample = (): PerfSample => ({
    fps: engine.getFps(),
    frameMs: si.frameTimeCounter.lastSecAverage,
    drawCalls: Math.round(si.drawCallsCounter.lastSecAverage || si.drawCallsCounter.current),
    triangles: Math.round(scene.getActiveIndices() / 3),
    heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576)
      : null,
  });
  setInterval(() => {
    const s = sample();
    const gpu = ei.gpuFrameTimeCounter.lastSecAverage;
    const load = loadMs();
    el.textContent = [
      `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms cpu${gpu ? ` · ${(gpu * 1e-6).toFixed(1)} ms gpu` : ""}`,
      `${s.drawCalls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ${scene.getActiveMeshes().length} meshes`,
      `${s.heapMB !== null ? `${s.heapMB} MB heap · ` : ""}${scene.textures.length} textures`,
      `${info.renderer} · ${q.quality} quality · ${engine.getRenderWidth()}×${engine.getRenderHeight()}`,
      load !== null ? `ready in ${(load / 1000).toFixed(1)} s` : "loading…",
    ].join("\n");
  }, 500);
  return sample;
}

export function engineInfo(engine: AbstractEngine, kind: string) {
  const gl = (engine as unknown as { getGlInfo?: () => { renderer: string; vendor: string } }).getGlInfo?.();
  return { kind, renderer: gl?.renderer ? `${kind} (${gl.renderer})` : kind };
}

/** Fixed 20 s path over the plaza and the BTG building: comparable numbers across devices. */
export function runBenchmark(scene: Scene, camera: UniversalCamera, sample: () => PerfSample, meta: Record<string, unknown>) {
  const path = [new Vector3(52, 30, 388), new Vector3(250, 45, 600), new Vector3(460, 35, 900), new Vector3(150, 60, 650), new Vector3(52, 30, 388)];
  camera.applyGravity = false;
  camera.checkCollisions = false;
  const t0 = performance.now(), dur = 20000;
  const fps: number[] = [], frames: number[] = [];
  let worstDraws = 0, worstTris = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const seg = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
    const f = t * (path.length - 1) - seg;
    Vector3.LerpToRef(path[seg]!, path[seg + 1]!, f, camera.position);
    camera.setTarget(new Vector3(260, 10, 700));
    const s = sample();
    if (Number.isFinite(s.fps) && s.fps > 0) fps.push(s.fps);
    frames.push(scene.getEngine().getDeltaTime());
    worstDraws = Math.max(worstDraws, s.drawCalls);
    worstTris = Math.max(worstTris, s.triangles);
    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(obs);
      const sorted = [...frames].sort((a, b) => a - b);
      const result = {
        ...meta,
        avgFps: fps.length ? +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1) : null,
        p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1),
        worstDrawCalls: worstDraws,
        worstTriangles: worstTris,
        heapMB: sample().heapMB,
        userAgent: navigator.userAgent,
        at: new Date().toISOString(),
      };
      const card = document.createElement("div");
      card.style.cssText = "position:fixed;inset:auto 12px 12px auto;max-width:min(520px,90vw);z-index:40;background:#0c1411;color:#e6efeb;border:1px solid #1fa37a;border-radius:10px;padding:12px;font:13px system-ui";
      card.innerHTML = `<b>Benchmark done</b> — ${result.avgFps} fps average, ${result.p95FrameMs} ms 95th-percentile frame.<br>Send this to the team:<textarea readonly style="width:100%;height:150px;margin-top:6px;font:11px ui-monospace,monospace">${JSON.stringify(result, null, 1)}</textarea>`;
      document.body.appendChild(card);
      (window as unknown as { __bench: unknown }).__bench = result;
    }
  });
}
