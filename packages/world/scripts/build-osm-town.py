#!/usr/bin/env python3
"""
Real Davos from OpenStreetMap: building footprints (with height and roof), streets, the railway and
the river, in the Davos world's metric frame, plus the world changes that go with them.

  python3 build-osm-town.py fetch <cache-dir>     # download the town in 0.01° tiles (OSM API)
  python3 build-osm-town.py build <cache-dir>     # write data/davos.osm.json and update davos.world.json

Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).

The frame matches fetch-dem.py: x east and z north in metres from the terrain centre
(46.8027 N, 9.8360 E). Heights are not in OSM for most Davos buildings, so they are estimated from
the building type, levels when tagged, and footprint size; see estimate_height().
"""
import glob
import json
import math
import os
import random
import struct
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CENTER = (46.8027, 9.8360)
BBOX = (46.783, 9.800, 46.826, 9.878)  # south, west, north, east: Davos Dorf to Davos Platz/Frauenkirch edge
STEP = 0.01
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(CENTER[0]))

# The two Hub Culture pavilions (Davos), found by address.
PAVILIONS = [
    {"id": "hub-symondsstrasse-7", "label": "Hub Culture Pavilion · Symondsstrasse 7", "street": "Symondsstrasse", "number": "7"},
    {"id": "hub-promenade-95", "label": "Hub Culture Pavilion · Promenade 95", "street": "Promenade", "number": "95"},
]
# Landmarks for the teleport list: (id, label, OSM way id).
LANDMARKS = [
    ("kongress", "Congress Centre", "219442526"),
    ("platz-station", "Davos Platz station", None),
    ("kirchner", "Kirchner Museum", "110590703"),
    ("eisstadion", "Eisstadion", "37221744"),
    ("rathaus", "Rathaus", "218974499"),
]
ROADS = {  # class -> (width m, keep)
    "motorway": 10, "trunk": 9, "primary": 8.5, "secondary": 7.5, "tertiary": 6.5, "unclassified": 5,
    "residential": 5.5, "living_street": 5, "pedestrian": 6, "service": 3.5, "track": 3,
    "footway": 2, "path": 1.6, "cycleway": 2, "steps": 2,
}


def fetch(cache):
    os.makedirs(cache, exist_ok=True)
    s, w, n, e = BBOX
    la = s
    while la < n - 1e-9:
        lo = w
        while lo < e - 1e-9:
            fn = os.path.join(cache, f"t_{la:.3f}_{lo:.3f}.osm")
            if not os.path.exists(fn) or os.path.getsize(fn) < 200:
                url = f"https://api.openstreetmap.org/api/0.6/map?bbox={lo:.4f},{la:.4f},{min(lo + STEP, e):.4f},{min(la + STEP, n):.4f}"
                for attempt in range(4):
                    try:
                        req = urllib.request.Request(url, headers={"User-Agent": "emerald-city-worldbuilder/1.0"})
                        open(fn, "wb").write(urllib.request.urlopen(req, timeout=90).read())
                        break
                    except Exception:
                        time.sleep(3 * (attempt + 1))
                time.sleep(1)  # be gentle with the OSM API
            lo += STEP
        la += STEP


def xz(lat, lon):
    return ((lon - CENTER[1]) * M_LON, (lat - CENTER[0]) * M_LAT)


def area(ring):
    """Signed area (shoelace): positive when counter-clockwise seen from above (x east, z north)."""
    return 0.5 * sum(ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1] for i in range(len(ring)))


def estimate_height(tags, a, rnd):
    if "height" in tags:
        try:
            return float(tags["height"].replace("m", "").strip())
        except ValueError:
            pass
    if "building:levels" in tags:
        try:
            return float(tags["building:levels"]) * 3.0 + 1.5
        except ValueError:
            pass
    kind = tags.get("building", "yes")
    # Davos is mostly three to five storeys; hotels and the clinics go higher.
    fixed = {"garage": 3, "garages": 3, "roof": 4, "carport": 3, "shed": 3, "hut": 3.5, "kiosk": 3.5,
             "church": 16, "apartments": 13, "hotel": 16, "school": 11, "retail": 9, "commercial": 12,
             "train_station": 8, "warehouse": 8, "industrial": 8, "transportation": 7}
    if kind in fixed:
        h = fixed[kind]
    elif a < 60:
        h = 3.5
    elif a < 150:
        h = 7
    elif a < 400:
        h = 9.5
    elif a < 900:
        h = 12
    else:
        h = 14
    return round(h * (0.88 + 0.24 * rnd.random()), 1)


def roof_of(tags, ring, a):
    shape = tags.get("roof:shape") or tags.get("building:roof:shape")
    if shape:
        return "flat" if shape == "flat" else "pitched"
    if tags.get("building:roof") == "flat" or tags.get("building") in ("roof", "carport", "garages", "garage", "retail", "commercial", "warehouse", "industrial", "train_station"):
        return "flat"
    return "flat" if a > 1100 else "pitched"


def simplify(pts, tol=0.35):
    """Drop nearly collinear points (keeps rings small)."""
    out = []
    for p in pts:
        if out and math.dist(out[-1], p) < 0.3:
            continue
        out.append(p)
    changed = True
    while changed and len(out) > 4:
        changed = False
        for i in range(1, len(out) - 1):
            a, b, c = out[i - 1], out[i], out[i + 1]
            ab, ac = (b[0] - a[0], b[1] - a[1]), (c[0] - a[0], c[1] - a[1])
            l = math.hypot(*ac) or 1
            if abs(ab[0] * ac[1] - ab[1] * ac[0]) / l < tol:
                del out[i]
                changed = True
                break
    return out


def load(cache):
    nodes, ways = {}, {}
    rels = {}
    for f in sorted(glob.glob(os.path.join(cache, "t_*.osm"))):
        for e in ET.parse(f).getroot():
            if e.tag == "node":
                nodes[e.get("id")] = (float(e.get("lat")), float(e.get("lon")), {t.get("k"): t.get("v") for t in e.findall("tag")})
            elif e.tag == "way":
                ways[e.get("id")] = ([n.get("ref") for n in e.findall("nd")], {t.get("k"): t.get("v") for t in e.findall("tag")})
            elif e.tag == "relation":
                rels[e.get("id")] = ([(m.get("type"), m.get("ref"), m.get("role")) for m in e.findall("member")], {t.get("k"): t.get("v") for t in e.findall("tag")})
    return nodes, ways, rels


def line(nodes, refs):
    pts = [xz(nodes[r][0], nodes[r][1]) for r in refs if r in nodes]
    return [(round(x, 1), round(z, 1)) for x, z in pts]


def build(cache):
    nodes, ways, rels = load(cache)
    rnd = random.Random(7)
    buildings, by_way = [], {}

    def add_building(wid, refs, tags):
        if len(refs) < 4 or refs[0] != refs[-1]:
            return
        ring = simplify(line(nodes, refs[:-1]))
        if len(ring) < 3:
            return
        a = area(ring)
        if a < 0:  # make it counter-clockwise seen from above (x east, z north)
            ring.reverse()
        a = abs(a)
        if a < 12:
            return
        b = {"id": int(wid), "ring": [[x, z] for x, z in ring], "h": estimate_height(tags, a, rnd), "roof": roof_of(tags, ring, a)}
        if tags.get("building") in ("church",):
            b["kind"] = "church"
        if tags.get("name"):
            b["name"] = tags["name"]
        if tags.get("addr:street") and tags.get("addr:housenumber"):
            b["addr"] = f"{tags['addr:street']} {tags['addr:housenumber']}"
        buildings.append(b)
        by_way[wid] = b

    for wid, (refs, tags) in ways.items():
        if "building" in tags and tags.get("building") not in ("construction",):
            add_building(wid, refs, tags)
    # Multipolygon buildings: their outer ways.
    for rid, (members, tags) in rels.items():
        if tags.get("type") == "multipolygon" and "building" in tags:
            for t, ref, role in members:
                if t == "way" and role == "outer" and ref in ways and ref not in by_way:
                    add_building(ref, ways[ref][0], {**ways[ref][1], **tags})

    roads, rail, rivers = [], [], []
    for wid, (refs, tags) in ways.items():
        hw = tags.get("highway")
        if hw in ROADS and tags.get("area") != "yes" and tags.get("tunnel") not in ("yes", "building_passage"):
            pts = line(nodes, refs)
            if len(pts) >= 2:
                roads.append({"c": hw, "w": ROADS[hw], "p": [[x, z] for x, z in pts], **({"bridge": 1} if tags.get("bridge") == "yes" else {})})
        rw = tags.get("railway")
        if rw in ("rail", "narrow_gauge") and tags.get("tunnel") != "yes" and tags.get("service") not in ("yard",):
            pts = line(nodes, refs)
            if len(pts) >= 2:
                rail.append([[x, z] for x, z in pts])
        ww = tags.get("waterway")
        if ww in ("river", "stream") and tags.get("tunnel") not in ("yes", "culvert"):
            pts = line(nodes, refs)
            if len(pts) >= 2:
                rivers.append({"w": 9 if ww == "river" else 1.6, "p": [[x, z] for x, z in pts]})

    # Davos Platz station: the platform area near the station node.
    station = next(((n[0], n[1]) for n in nodes.values() if n[2].get("name") == "Davos Platz" and n[2].get("railway") == "station"), None)

    pavilions = []
    for p in PAVILIONS:
        b = next((b for b in buildings if b.get("addr") == f"{p['street']} {p['number']}"), None)
        if not b:
            print("pavilion not found:", p["street"], p["number"])
            continue
        b["hub"] = p["id"]
        pavilions.append({**p, "building": b["id"]})

    out = {
        "attribution": "Map data © OpenStreetMap contributors, ODbL 1.0",
        "center": list(CENTER),
        "buildings": buildings,
        "roads": roads,
        "rail": rail,
        "rivers": rivers,
    }
    path = os.path.join(DATA, "davos.osm.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(buildings)} buildings, {len(roads)} roads, {len(rail)} rail, {len(rivers)} rivers -> {path} ({os.path.getsize(path) // 1024} KB)")
    update_world(buildings, roads, rail, rivers, pavilions, station)


def update_world(buildings, roads, rail, rivers, pavilions, station):
    wpath = os.path.join(DATA, "davos.world.json")
    w = json.load(open(wpath))
    t = w["terrain"]
    res = t["resolution"]
    raw = open(os.path.join(DATA, t["heightmap"]), "rb").read()
    hm = struct.unpack(f"<{res * res}H", raw[: res * res * 2])

    def ground(x, z):
        u = (x - t["origin"][0]) / t["size"][0] * (res - 1)
        v = (1 - (z - t["origin"][2]) / t["size"][1]) * (res - 1)
        u = min(max(u, 0), res - 1.001)
        v = min(max(v, 0), res - 1.001)
        i, j = int(v), int(u)
        fu, fv = u - j, v - i
        h = lambda r, c: hm[r * res + c]
        val = h(i, j) * (1 - fu) * (1 - fv) + h(i, j + 1) * fu * (1 - fv) + h(i + 1, j) * (1 - fu) * fv + h(i + 1, j + 1) * fu * fv
        return val / 65535 * t["height"] + t["origin"][1]

    # Spatial grid of "built" cells (buildings and paved ways) to clear the forest from them.
    cell = 6.0
    blocked = set()

    def mark(x, z, r):
        for gx in range(int((x - r) // cell), int((x + r) // cell) + 1):
            for gz in range(int((z - r) // cell), int((z + r) // cell) + 1):
                blocked.add((gx, gz))

    for b in buildings:
        xs = [p[0] for p in b["ring"]]
        zs = [p[1] for p in b["ring"]]
        for gx in range(int((min(xs) - 3) // cell), int((max(xs) + 3) // cell) + 1):
            for gz in range(int((min(zs) - 3) // cell), int((max(zs) + 3) // cell) + 1):
                blocked.add((gx, gz))
    for wy in [r["p"] for r in roads] + rail + [r["p"] for r in rivers]:
        for (x0, z0), (x1, z1) in zip(wy, wy[1:]):
            n = max(1, int(math.dist((x0, z0), (x1, z1)) // 3))
            for k in range(n + 1):
                mark(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n, 4)
    before = len(w["trees"]["instances"])
    w["trees"]["instances"] = [tr for tr in w["trees"]["instances"] if (int(tr[0] // cell), int(tr[2] // cell)) not in blocked]
    print(f"cleared {before - len(w['trees']['instances'])} trees from buildings, streets, rail and river")

    # The 2017 Hub Culture chalet (Unity objects at the arrival point) stands where OSM has houses: keep the chalet.
    chalet = [(o["position"][0], o["position"][2]) for o in w.get("meshes", []) + w.get("primitives", [])]
    if chalet:
        cx0 = sum(p[0] for p in chalet) / len(chalet)
        cz0 = sum(p[1] for p in chalet) / len(chalet)
        reach = max(math.dist((cx0, cz0), p) for p in chalet) + 8
        keep = []
        for b in buildings:
            bx = sum(p[0] for p in b["ring"]) / len(b["ring"])
            bz = sum(p[1] for p in b["ring"]) / len(b["ring"])
            if math.dist((bx, bz), (cx0, cz0)) > reach or b.get("hub"):
                keep.append(b)
        print(f"removed {len(buildings) - len(keep)} OSM buildings under the Hub Culture chalet (within {reach:.0f} m)")
        buildings[:] = keep
        with open(os.path.join(DATA, "davos.osm.json")) as f:
            town = json.load(f)
        town["buildings"] = buildings
        with open(os.path.join(DATA, "davos.osm.json"), "w") as f:
            json.dump(town, f, separators=(",", ":"))

    # The generated "agents city" stood on the real town: real Davos replaces it (its spec stays in worldgen).
    w["generated"] = []
    w["osm"] = "davos.osm.json"
    w["attribution"] = w.get("attribution", "").split(" · Map data")[0] + " · Map data © OpenStreetMap contributors (ODbL)"

    def centroid(b):
        xs = [p[0] for p in b["ring"]]
        zs = [p[1] for p in b["ring"]]
        return sum(xs) / len(xs), sum(zs) / len(zs)

    def front_of(b, back=12):
        """A standing spot just outside the building, on the side facing the nearest street."""
        cx, cz = centroid(b)
        best = None
        for r in roads:
            if r["c"] in ("footway", "path", "steps", "track"):
                continue
            for x, z in r["p"]:
                d = math.dist((x, z), (cx, cz))
                if best is None or d < best[0]:
                    best = (d, x, z)
        if not best:
            return cx, cz + back, 0.0
        _, rx, rz = best
        d = math.dist((rx, rz), (cx, cz)) or 1
        ux, uz = (rx - cx) / d, (rz - cz) / d
        reach = max(math.dist((cx, cz), p) for p in b["ring"]) + 3
        x, z = cx + ux * min(reach, d), cz + uz * min(reach, d)
        return x, z, math.atan2(cx - x, cz - z)  # facing the building

    tps = [tp for tp in w["teleports"] if not tp["id"].startswith(("gen:", "osm:", "hub-"))]
    for p in pavilions:
        b = next(b for b in buildings if b["id"] == p["building"])
        x, z, yaw = front_of(b)
        tps.append({"id": p["id"], "label": p["label"], "position": {"x": round(x, 1), "y": round(ground(x, z) + 0.3, 1), "z": round(z, 1)}, "rotationY": round(yaw, 3), "group": "kiosk"})
    for lid, label, way in LANDMARKS:
        if way:
            b = next((b for b in buildings if str(b["id"]) == way), None)
            if not b:
                continue
            x, z, yaw = front_of(b)
        elif station:
            x, z = xz(*station)
            yaw = 0.0
        else:
            continue
        tps.append({"id": f"osm:{lid}", "label": label, "position": {"x": round(x, 1), "y": round(ground(x, z) + 0.3, 1), "z": round(z, 1)}, "rotationY": round(yaw, 3), "group": "kiosk"})
    w["teleports"] = tps
    w["pavilions"] = [{"id": p["id"], "label": p["label"], "address": f"{p['street']} {p['number']}, 7270 Davos Platz", "osmWay": p["building"]} for p in pavilions]

    raw_old = open(wpath).read()
    indent = 1 if raw_old.startswith("{\n ") and not raw_old.startswith("{\n  ") else None
    with open(wpath, "w") as f:
        json.dump(w, f, indent=indent, separators=None if indent else (",", ":"))
        if raw_old.endswith("\n"):
            f.write("\n")
    print("teleports:", ", ".join(tp["label"] for tp in tps))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("fetch", "build"):
        sys.exit(__doc__)
    (fetch if sys.argv[1] == "fetch" else build)(sys.argv[2])
