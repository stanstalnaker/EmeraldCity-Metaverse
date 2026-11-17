# Testing the 3D city on real devices

All automated checks so far ran in a headless browser with software rendering, which says nothing
about speed. This is the checklist for real devices.

## What to open

Use city.beta.hubculture.city, or `pnpm --filter @emerald-city/city3d dev` on your laptop and open it from the device on the same network.

| URL | What it does |
|---|---|
| `/?perf&assets=glb` | Live overlay: fps, frame time (CPU and GPU), draw calls, triangles, memory, renderer, quality, load time |
| `/?bench&assets=glb` | 20-second fly-through on a fixed path, then a results card with JSON to copy and send |
| `/?bench&assets=glb&quality=low` | The same, forcing a quality level (`low`, `medium` or `high`) |
| `/?world=davos&perf` | The large Davos terrain and forest |

Quality is chosen automatically:
- **Phones** (touch and a small screen) get `low`: no shadows, no SSAO, no MSAA, reduced resolution.
- **Devices with 4 cores or less, or 4 GB memory or less**, get `medium`: 2 shadow cascades, 2x MSAA.
- **Everything else** gets `high`.

## Devices and what "good" looks like

| Device | Target |
|---|---|
| MacBook (Apple silicon), Chrome/Safari, WebGPU | 60 fps at high, ready in under 8 s on broadband |
| Windows laptop, integrated GPU | 45 fps or more at medium |
| iPhone 13 or newer, Safari | 30 fps or more at low, no crash after 5 minutes of walking |
| Recent Android, Chrome | 30 fps or more at low |
| Quest 3 browser (WebXR) | 72 fps in headset at low |

For each device, record:
- the benchmark JSON;
- whether the city loaded fully;
- any crash, or the page reloading by itself (usually running out of memory on phones);
- how hot the device got.

## Known costs (measured headless at the plaza, Nov 2026)

At the plaza, the city draws about **600 objects and 2.2 million triangles** per frame. That's fine for a laptop GPU, but heavy for phones. If phones miss the target, the next steps are:
1. merge static meshes that share a material (fewer draw calls);
2. add simplified lower-detail versions of the big buildings, for distance (fewer triangles);
3. compress textures to KTX2, which uses less GPU memory than WebP.
