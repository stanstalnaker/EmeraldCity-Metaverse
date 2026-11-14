# Emerald City 3D (Babylon.js 9)

The rebuilt 3D client. It renders a **world manifest** (`packages/world`), so every city (Emerald City,
partner islands, Davos) uses the same client. Emerald City's manifest is imported from the live
vr.hubculture.city code (152 screens bound to property zones, 19 models, spawns, kiosk and lifts).

## Run

The legacy models and textures (≈1.5 GB, including partners' branded content) are **not** in this
repo. Check out `hub/vr-hubculture-city` next to this repo, or point `LEGACY_ASSETS_DIR` at its `src/`:

```bash
pnpm --filter @emerald-city/city3d dev            # http://localhost:5174
LEGACY_ASSETS_DIR=/path/to/vr-hubculture-city/src pnpm --filter @emerald-city/city3d dev
```

Useful URLs:
- `?pavilion_id=209` spawns at a property (same links as the live site)
- `?look=legacy` shows the old flat lighting for comparison
- `?renderer=webgl` forces WebGL2 (WebGPU is used when available)
- `?fly&pos=150,60,650&yaw=-1.84&pitch=0.16` positions a free camera
- `?off=ssao,shadows,detail` switches effects off for debugging

Controls: WASD/arrows + mouse (virtual joysticks on touch screens); **M** opens the map with the 14
destinations; Fly/Walk toggle; compass; Teleport menu; VR headsets via WebXR.

In-world features ported from the live client (`src/interactions.ts`, with legacy line references):
- arrival kiosk and all lift buttons (Cognizant, Fashion Boulevard, University, BTG) teleport on click;
- Cognizant magazines flip pages; the memorial slideshow advances; university seats sit you down;
- underwater wellness centre: fog below the surface, glowing pyramid, pulsing sphere light, star dome;
- planetarium sun and orbits glow; spatial ambient sound near the beach;
- screens open their real content (live pages, YouTube, Hub Culture Radio). Property-zone screens
  show where their content comes from until the beta is connected to staging HubID.

## Rendering

- WebGPU with WebGL2 fallback.
- A physically based sky (Preetham) that also lights the scene, through a reflection-probe environment.
- Sun with cascaded soft shadows; ACES tone mapping, bloom, FXAA, sharpening and vignette; SSAO; exponential haze.
- Legacy Standard materials are upgraded to PBR:
  - flat colours authored for the old over-bright lights are rescaled into realistic reflectance;
  - water becomes glossy and reflects the sky;
  - procedural surface detail is added on untextured surfaces.
- Models stream in by distance and **unload** when you leave (the legacy client only ever loaded).
- The legacy island's boundary wall stays solid but invisible, opening the horizon.

## Next

- Convert the assets to compressed GLB/KTX2 with LODs, hosted on a CDN, and re-author key materials per building.
- Render screens inside the world, fed live from HubID property zones.
- Presence avatars, LiveKit spatial voice, agents, and the Gaia/neon map mode.
