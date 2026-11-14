#!/usr/bin/env python3
"""
Build the Davos and Bermuda world manifests from the Unity import (extract-unity.py) and, for
Davos, real elevation (fetch-dem.py). Run after both:

  python3 build-unity-worlds.py

Davos: the real 14 km Landwasser valley is the terrain. The Unity Davos content (chalet, ski
area, Zeke, portal) keeps its own layout and is set down as one group on the flattest open
hillside near the town, at the real ground height. Forest is generated on the real slopes
between 1,450 m and the 2,100 m treeline.
Bermuda: the Unity island terrain, house, pool, court and palms as they were, with the ocean.
"""
import json, math, os
import numpy as np
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
data = os.path.join(here, "..", "data")
load = lambda n: json.load(open(os.path.join(data, n)))
heights = lambda n: np.asarray(Image.open(os.path.join(data, n))).astype(np.float64)


def sampler(hm, size, height, origin):
    """Bilinear ground height at world (x, z). Row 0 of the PNG is the max-z (north) edge."""
    res = hm.shape[0]
    def at(x, z):
        u = (x - origin[0]) / size[0] * (res - 1)
        v = (1 - (z - origin[2]) / size[1]) * (res - 1)
        u, v = min(max(u, 0), res - 1.001), min(max(v, 0), res - 1.001)
        i, j = int(v), int(u)
        fu, fv = u - j, v - i
        h = (hm[i, j] * (1 - fu) * (1 - fv) + hm[i, j + 1] * fu * (1 - fv) + hm[i + 1, j] * (1 - fu) * fv + hm[i + 1, j + 1] * fu * fv)
        return h / 65535 * height + origin[1]
    return at


def shift(items, d):
    out = []
    for it in items:
        it = dict(it)
        it["position"] = [round(it["position"][0] + d[0], 3), round(it["position"][1] + d[1], 3), round(it["position"][2] + d[2], 3)]
        out.append(it)
    return out


def write_r16(name, png, unity_scale=False):
    a = heights(png)
    if unity_scale:
        a = a / 65532 * 65535
    a.clip(0, 65535).astype("<u2").tofile(os.path.join(data, f"{name}.r16"))
    return f"{name}.r16"


def write(name, manifest):
    with open(os.path.join(data, f"{name}.world.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print(name, {k: (len(v) if isinstance(v, list) else "…") for k, v in manifest.items() if isinstance(v, (list, dict))})


# ---------------------------------------------------------------- Davos
dem = load("davos.dem.json")
dhm = heights("davos.dem.png")
size = dem["size"]
origin = [-size[0] / 2, 0.0, -size[1] / 2]  # terrain min corner; y=0 is the lowest point (dem base)
ground = sampler(dhm, size, dem["height"], origin)

u = load("davos.unity.json")
ut = u["terrain"]
uhm = heights(ut["heightmap"]) / 2 * 65535 / 32766  # back to 0..65535 scale
uground = sampler(uhm, ut["size"], ut["height"], ut["position"])

objs = u["meshes"] + u["primitives"]
xs = [o["position"][0] for o in objs]; zs = [o["position"][2] for o in objs]
ax, az = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2

# Flattest open spot 40-250 m above the valley floor within 2.5 km of the town centre.
town = ground(0, 0)
best = None
rng = np.random.default_rng(7)
for _ in range(4000):
    x, z = rng.uniform(-2500, 2500, 2)
    h = ground(x, z)
    if not (town + 40 < h < town + 250):
        continue
    slope = max(abs(ground(x + 30, z) - ground(x - 30, z)), abs(ground(x, z + 30) - ground(x, z - 30))) / 60
    # Prefer slopes facing the winter sun (south, i.e. ground falling towards -z), like the town's sunny side.
    south = (ground(x, z + 30) - ground(x, z - 30)) / 60
    score = slope + math.hypot(x, z) / 20000 - 0.6 * min(max(south, 0), 0.25)
    if best is None or score < best[0]:
        best = (score, x, z, h)
_, wx, wz, wh = best
# Set the group down by its lowest point (the Unity house stood on a raised pad).
d = [wx - ax, wh - min(o["position"][1] for o in objs) - 0.3, wz - az]
davos_objs_m = shift(u["meshes"], d)
davos_objs_p = shift(u["primitives"], d)

# Forest on the real slopes.
trees = []
for _ in range(400000):
    x, z = rng.uniform(-size[0] / 2 + 50, size[0] / 2 - 50, 2)
    h = ground(x, z)
    elev = h + dem["base"]
    if not (1450 < elev < 2100):
        continue
    slope = math.hypot(ground(x + 15, z) - ground(x - 15, z), ground(x, z + 15) - ground(x, z - 15)) / 30
    if slope > 0.9 or (math.hypot(x - wx, z - wz) < 120):
        continue
    # Thinner near the treeline and on the valley floor (meadows and town).
    p = min(1, (2100 - elev) / 200) * min(1, (elev - 1450) / 120) * (1 - min(1, slope / 1.2) * 0.4)
    if rng.random() > p * 0.55:
        continue
    trees.append([round(x, 1), round(h, 1), round(z, 1), round(float(rng.uniform(1.0, 1.9)), 2)])
    if len(trees) >= 70000:
        break

# Lake Davos (1,558 m), north-east of the town.
lake_lat, lake_lon = 46.8135, 9.8565
lx = (lake_lon - dem["center"][1]) * 111320 * math.cos(math.radians(dem["center"][0]))
lz = (lake_lat - dem["center"][0]) * 110574

spawn = [round(wx + 25, 1), round(wh + 2, 1), round(wz - 25, 1)]
write("davos", {
    "version": 1, "slug": "davos", "name": "Davos",
    "source": "Real terrain: AWS Terrain Tiles around Davos Platz. Chalet, ski area, Zeke and portal: hub/VR-HubCulture (2017-18).",
    "attribution": dem["attribution"],
    "assetBase": "unity",
    "environment": {"style": "alpine", "snowline": 1900 - dem["base"], "treeline": 2100 - dem["base"], "fog": 0.000035,
                    "water": [{"kind": "lake", "center": [round(lx, 1), round(1558 - dem["base"] - 1.5, 1), round(lz, 1)], "radius": 420}]},
    "terrain": {"heightmap": write_r16("davos", dem["heightmap"]), "resolution": dem["resolution"], "size": size, "height": dem["height"],
                "origin": origin, "base": dem["base"], "style": "alpine"},
    "trees": {"kind": "conifer", "instances": trees},
    "primitives": davos_objs_p, "meshes": davos_objs_m,
    "models": [], "screens": [], "zones": [],
    "defaultSpawn": {"position": {"x": spawn[0], "y": spawn[1], "z": spawn[2]}, "rotationY": 3.0},  # looking south over the town
    "spawns": {"town": {"position": {"x": 0, "y": round(town + 2, 1), "z": 0}, "rotationY": 0.8}},
    "teleports": [
        {"id": "chalet", "label": "Chalet", "position": {"x": spawn[0], "y": spawn[1], "z": spawn[2]}, "group": "kiosk"},
        {"id": "town", "label": "Davos Platz", "position": {"x": 0, "y": round(town + 2, 1), "z": 0}, "group": "kiosk"},
        {"id": "lake", "label": "Lake Davos", "position": {"x": round(lx - 500, 1), "y": round(ground(lx - 500, lz) + 2, 1), "z": round(lz, 1)}, "group": "kiosk"},
    ],
    "portals": [{"to": "emerald-city", "label": "Emerald City", "position": [round(wx - 20, 1), round(wh, 1), round(wz + 10, 1)]},
                {"to": "bermuda", "label": "Bermuda", "position": [round(wx - 20, 1), round(wh, 1), round(wz + 22, 1)]}],
})

# ---------------------------------------------------------------- Bermuda
b = load("bermuda.unity.json")
bt = b["terrain"]
bhm = heights(bt["heightmap"]) / 2 * 65535 / 32766
bground = sampler(bhm, bt["size"], bt["height"], bt["position"])
house = [m for m in b["meshes"] if "House" in m.get("name", "") or "home_" in m["file"]]
hx = np.mean([m["position"][0] for m in b["meshes"]]); hz = np.mean([m["position"][2] for m in b["meshes"]])
water = [m for m in b["meshes"] if "OceanPlane" in m["file"]]
level = min((m["position"][1] for m in water), default=0.5)
palms = [[t[0] + bt["position"][0], t[1] + bt["position"][1], t[2] + bt["position"][2], t[3]] for t in bt["trees"]]
write("bermuda", {
    "version": 1, "slug": "bermuda", "name": "Bermuda",
    "source": "hub/VR-HubCulture (2017-18): island terrain, beach house, pool, tennis court, palms.",
    "assetBase": "unity",
    "environment": {"style": "tropical", "fog": 0.0012,
                    "water": [{"kind": "ocean", "center": [128, round(level, 2), 128], "radius": 4000}]},
    "terrain": {"heightmap": write_r16("bermuda", bt["heightmap"], True), "resolution": bt["resolution"], "size": bt["size"], "height": bt["height"],
                "origin": bt["position"], "style": "tropical"},
    "trees": {"kind": "palm", "instances": palms},
    "primitives": [p for p in b["primitives"]],
    "meshes": [m for m in b["meshes"] if "OceanPlane" not in m["file"]],
    "models": [], "screens": [], "zones": [],
    "defaultSpawn": {"position": {"x": round(hx + 10, 1), "y": round(bground(hx + 10, hz - 20) + 2, 1), "z": round(hz - 20, 1)}, "rotationY": 0},
    "spawns": {}, "teleports": [],
    "portals": [{"to": "emerald-city", "label": "Emerald City", "position": [round(hx - 12, 1), round(bground(hx - 12, hz - 25), 2), round(hz - 25, 1)]},
                {"to": "davos", "label": "Davos", "position": [round(hx - 24, 1), round(bground(hx - 24, hz - 25), 2), round(hz - 25, 1)]}],
})
