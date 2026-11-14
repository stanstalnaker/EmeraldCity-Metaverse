#!/usr/bin/env python3
"""
Import a Unity scene (the 2017-18 Hub Culture VR app, hub/VR-HubCulture) as an Emerald City world
manifest, without Unity. Reads the text-serialised scene and prefab YAML, the .meta GUID table,
materials and the terrain asset (via UnityPy). Unity and Babylon are both left-handed and y-up,
so positions and quaternions carry over unchanged.

  python3 extract-unity.py /path/to/VR-HubCulture davos   > ../data/davos.unity.json
  python3 extract-unity.py /path/to/VR-HubCulture bermuda > ../data/bermuda.unity.json

Output lists: terrain (heightmap written next to the JSON as 16-bit PNG), primitives (Unity cubes,
cylinders, planes, quads, spheres with colour/texture), meshes (FBX file + mesh name, converted to
GLB separately) and trees. Asset paths stay relative to the Unity project's Assets folder; assets
are never copied into this repo.
"""
import json, os, re, sys
import numpy as np
import yaml

SCENES = {"davos": "davos.unity", "bermuda": "bahamas.unity"}  # the Unity file is misnamed "bahamas"
TERRAINS = {"davos": "Hub Culture/Davos/SnowTerrain.asset", "bermuda": "Hub Culture/Bahamas/BahamasTerrain.asset"}
BUILTIN = {10202: "cube", 10206: "cylinder", 10207: "sphere", 10208: "capsule", 10209: "plane", 10210: "quad"}
SKIP_PREFABS = ("Vive-Teleporter", "NewtonVR", "SteamVR", "UI/Prefabs", "HubApi", "PlayerObjectGroup",
                "ThirdPersonCharacter", "ZekeEventPoints", "Navmesh", "Pointer")

root = sys.argv[1].rstrip("/") + "/Assets"
world = sys.argv[2]

# --- GUID table -------------------------------------------------------------------------------
g2p, recycle = {}, {}
for d, _, fs in os.walk(root):
    for f in fs:
        if not f.endswith(".meta"):
            continue
        txt = open(os.path.join(d, f), errors="ignore").read()
        m = re.search(r"^guid: ([0-9a-f]+)", txt, re.M)
        if not m:
            continue
        rel = os.path.relpath(os.path.join(d, f[:-5]), root)
        g2p[m.group(1)] = rel
        r = re.search(r"fileIDToRecycleName:\n((?:    \d+: .*\n)+)", txt)
        if r:
            recycle[rel] = {int(a): b.strip() for a, b in re.findall(r"    (\d+): (.*)", r.group(1))}

# --- Unity YAML -------------------------------------------------------------------------------
class Loader(yaml.SafeLoader):
    pass
Loader.add_multi_constructor("", lambda l, s, n: l.construct_mapping(n) if isinstance(n, yaml.MappingNode) else None)

_cache = {}
def docs(path):
    if path in _cache:
        return _cache[path]
    text = open(os.path.join(root, path), errors="ignore").read()
    out = {}
    for m in re.finditer(r"^--- !u!(\d+) &(-?\d+)[^\n]*\n(.*?)(?=^--- !u!|\Z)", text, re.S | re.M):
        try:
            body = yaml.load(m.group(3), Loader=Loader)
        except yaml.YAMLError:
            continue
        if isinstance(body, dict) and body:
            (kind, val), = list(body.items())[:1]
            out[int(m.group(2))] = (int(m.group(1)), kind, val or {})
    _cache[path] = out
    return out

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

def trs(p, q, s):
    p = {k: num(v) for k, v in p.items()}; q = {k: num(v) for k, v in q.items()}; s = {k: num(v) for k, v in s.items()}
    x, y, z, w = q["x"], q["y"], q["z"], q["w"]
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * np.array([s["x"], s["y"], s["z"]])
    m[:3, 3] = [p["x"], p["y"], p["z"]]
    return m

def decompose(m):
    t = m[:3, 3]
    sx, sy, sz = (np.linalg.norm(m[:3, i]) for i in range(3))
    r = m[:3, :3] / np.array([sx or 1, sy or 1, sz or 1])
    if np.linalg.det(r) < 0:
        sx, r = -sx, r * np.array([-1, 1, 1])
    w = np.sqrt(max(0, 1 + r[0, 0] + r[1, 1] + r[2, 2])) / 2
    if w > 1e-6:
        q = [(r[2, 1] - r[1, 2]) / (4 * w), (r[0, 2] - r[2, 0]) / (4 * w), (r[1, 0] - r[0, 1]) / (4 * w), w]
    else:
        i = int(np.argmax([r[0, 0], r[1, 1], r[2, 2]]))
        j, k = (i + 1) % 3, (i + 2) % 3
        v = np.zeros(3)
        v[i] = np.sqrt(max(0, 1 + r[i, i] - r[j, j] - r[k, k])) / 2
        v[j] = (r[j, i] + r[i, j]) / (4 * v[i])
        v[k] = (r[k, i] + r[i, k]) / (4 * v[i])
        q = [*v, (r[k, j] - r[j, k]) / (4 * v[i])]
    rnd = lambda a: [round(float(x), 4) for x in a]
    return rnd(t), rnd(q), rnd([sx, sy, sz])

_mats = {}
def material(guid):
    if not guid or guid not in g2p:
        return None
    if guid in _mats:
        return _mats[guid]
    path = g2p[guid]
    out = {"name": os.path.basename(path).rsplit(".", 1)[0]}
    try:
        txt = open(os.path.join(root, path), errors="ignore").read()
        c = re.search(r"- _Color: \{r: ([\d.e-]+), g: ([\d.e-]+), b: ([\d.e-]+), a: ([\d.e-]+)\}", txt)
        if c:
            out["color"] = [round(float(v), 4) for v in c.groups()]
        t = re.search(r"- _MainTex:\n\s+m_Texture: \{fileID: \d+, guid: ([0-9a-f]+)", txt)
        if t and t.group(1) in g2p:
            out["texture"] = g2p[t.group(1)]
            sc = re.search(r"- _MainTex:\n\s+m_Texture:[^\n]*\n\s+m_Scale: \{x: ([\d.e-]+), y: ([\d.e-]+)\}", txt)
            if sc:
                out["tiling"] = [float(sc.group(1)), float(sc.group(2))]
        g = re.search(r"- _Glossiness: ([\d.e-]+)", txt)
        mt = re.search(r"- _Metallic: ([\d.e-]+)", txt)
        if g: out["smoothness"] = float(g.group(1))
        if mt: out["metallic"] = float(mt.group(1))
        if re.search(r"_Mode: 3|TRANSPARENT|_ALPHABLEND_ON", txt): out["transparent"] = True
    except OSError:
        pass
    _mats[guid] = out
    return out

primitives, meshes, prefabs_seen = [], [], []

def walk(path, parent_matrix, overrides=None):
    """Emit every visible mesh in a scene or prefab file, composed under parent_matrix."""
    d = docs(path)
    transforms = {fid: v for fid, (cls, kind, v) in d.items() if cls == 4 and "m_GameObject" in v and "m_LocalPosition" in v}  # skips stripped prefab stubs
    go_comp = {}
    for fid, (cls, kind, v) in d.items():
        if cls in (33, 23) and "m_GameObject" in v:
            go_comp.setdefault(v["m_GameObject"]["fileID"], {})[cls] = v
    active = {fid: v.get("m_IsActive", 1) for fid, (cls, kind, v) in d.items() if cls == 1}
    names = {fid: v.get("m_Name", "") for fid, (cls, kind, v) in d.items() if cls == 1}
    world_m = {}

    def matrix(fid):
        if fid in world_m:
            return world_m[fid]
        t = transforms[fid]
        p, q, s = dict(t["m_LocalPosition"]), dict(t["m_LocalRotation"]), dict(t["m_LocalScale"])
        if overrides and t.get("m_Father", {}).get("fileID", 0) == 0:
            p.update(overrides.get("p", {})); q.update(overrides.get("q", {})); s.update(overrides.get("s", {}))
        father = t.get("m_Father", {}).get("fileID", 0)
        m = (matrix(father) if father in transforms else parent_matrix) @ trs(p, q, s)
        world_m[fid] = m
        return m

    def enabled(fid):
        while fid in transforms:
            go = transforms[fid]["m_GameObject"]["fileID"]
            if not active.get(go, 1):
                return False
            fid = transforms[fid].get("m_Father", {}).get("fileID", 0)
        return True

    for fid, t in transforms.items():
        go = t["m_GameObject"]["fileID"]
        comps = go_comp.get(go, {})
        if 33 not in comps or not enabled(fid):
            continue
        ref = comps[33].get("m_Mesh", {})
        rend = comps.get(23, {})
        if rend.get("m_Enabled", 1) == 0:
            continue
        mats = [material(m.get("guid")) for m in rend.get("m_Materials", []) or []]
        mats = [m for m in mats if m]
        pos, rot, scl = decompose(matrix(fid))
        entry = {"name": names.get(go, ""), "position": pos, "rotation": rot, "scale": scl}
        if mats:
            entry["material"] = mats[0]
        guid = ref.get("guid")
        if guid == "0000000000000000e000000000000000" or (not guid and ref.get("fileID") in BUILTIN):
            shape = BUILTIN.get(ref.get("fileID"))
            if shape:
                primitives.append({"shape": shape, **entry})
        elif guid in g2p:
            asset = g2p[guid]
            mesh_name = recycle.get(asset, {}).get(ref.get("fileID"))
            meshes.append({"file": asset, "mesh": mesh_name, **entry})

    # Prefab instances inside this file.
    for fid, (cls, kind, v) in d.items():
        if cls != 1001:
            continue
        pguid = (v.get("m_ParentPrefab") or {}).get("guid")
        ppath = g2p.get(pguid)
        if not ppath or any(k in ppath for k in SKIP_PREFABS):
            continue
        ov = {"p": {}, "q": {}, "s": {}}
        mods = (v.get("m_Modification") or {}).get("m_Modifications") or []
        # Root-transform overrides: the target that carries m_RootOrder is the prefab root.
        roots = {m["target"]["fileID"] for m in mods if m.get("propertyPath") == "m_RootOrder"}
        for m in mods:
            if m["target"]["fileID"] not in roots:
                continue
            pp = m.get("propertyPath", "")
            for key, short in (("m_LocalPosition.", "p"), ("m_LocalRotation.", "q"), ("m_LocalScale.", "s")):
                if pp.startswith(key):
                    ov[short][pp[len(key):]] = num(m["value"])
        if ppath.lower().endswith(".fbx"):
            # An FBX dropped straight into the scene: place the whole model.
            p = {"x": 0, "y": 0, "z": 0, **ov["p"]}; q = {"x": 0, "y": 0, "z": 0, "w": 1, **ov["q"]}; s = {"x": 1, "y": 1, "z": 1, **ov["s"]}
            pos, rot, scl = decompose(parent_matrix @ trs(p, q, s))
            meshes.append({"file": ppath, "mesh": None, "name": os.path.basename(ppath), "position": pos, "rotation": rot, "scale": scl})
        else:
            prefabs_seen.append(ppath)
            walk(ppath, parent_matrix, ov)

walk(SCENES[world], np.eye(4))

# --- Terrain ----------------------------------------------------------------------------------
terrain = None
try:
    import UnityPy
    from PIL import Image
    env = UnityPy.load(os.path.join(root, TERRAINS[world]))
    for obj in env.objects:
        if obj.type.name != "TerrainData":
            continue
        t = obj.read_typetree()
        hm = t["m_Heightmap"]
        w, h, sc = hm["m_Width"], hm["m_Height"], hm["m_Scale"]
        arr = np.array(hm["m_Heights"], dtype=np.int32).clip(0, 32766).reshape(h, w)
        png = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "..", "data", f"{world}.heightmap.png")
        # Unity stores rows by z; PNG row 0 is the far (max z) edge, so flip for a north-up image.
        Image.fromarray((arr[::-1] * 2).astype(np.uint16)).save(png)
        trees = t["m_DetailDatabase"]["m_TreeInstances"]
        size = [sc["x"] * (w - 1), sc["y"], sc["z"] * (h - 1)]
        terrain = {
            "heightmap": f"{world}.heightmap.png", "resolution": w,
            "size": [round(size[0], 3), round(size[2], 3)], "height": size[1],
            "trees": [[round(tr["position"]["x"] * size[0], 2), round(tr["position"]["y"] * size[1], 2),
                       round(tr["position"]["z"] * size[2], 2), round(tr.get("heightScale", 1), 2), tr.get("index", 0)]
                      for tr in trees],
        }
except Exception as e:  # terrain is optional
    print(f"terrain skipped: {e}", file=sys.stderr)

# The terrain GameObject's position (Terrain.prefab or a Terrain component in the scene).
tpos = [0, 0, 0]
for path in [SCENES[world]] + prefabs_seen:
    for fid, (cls, kind, v) in docs(path).items():
        if cls == 218:  # Terrain component
            go = v["m_GameObject"]["fileID"]
            for f2, (c2, k2, v2) in docs(path).items():
                if c2 == 4 and v2.get("m_GameObject", {}).get("fileID") == go:
                    p = v2["m_LocalPosition"]; tpos = [p["x"], p["y"], p["z"]]
if terrain:
    terrain["position"] = [round(float(x), 3) for x in tpos]

json.dump({"source": f"hub/VR-HubCulture Assets/{SCENES[world]}", "world": world, "terrain": terrain,
           "primitives": primitives, "meshes": meshes, "prefabs": sorted(set(prefabs_seen))}, sys.stdout, indent=1)
print(f"{world}: {len(primitives)} primitives, {len(meshes)} meshes, prefabs {sorted(set(prefabs_seen))}, "
      f"terrain {'yes' if terrain else 'no'} at {tpos}", file=sys.stderr)
