#!/usr/bin/env python3
"""
Store inventory of open-licensed 3D components (trees, plants, rocks, furniture, lights, structures)
that members and agents can buy in Ven and place on their properties.

  python3 component-catalog.py            # writes ../data/components.catalog.json

Source: Poly Haven (polyhaven.com), every model CC0 (public domain): the public API lists models
with categories, authors, polygon counts, sizes and glTF downloads. Only models light enough to
render in a browser (`webReady`, under WEB_MAX_POLYS polygons) are offered for placement; heavier
ones are listed for later decimation. Vehicles and kits from other CC0 sources (Kenney, Quaternius)
are added by hand in MANUAL below, each with its source and licence, after a check at import.
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "components.catalog.json")
API = "https://api.polyhaven.com"
WEB_MAX_POLYS = 150_000

# Poly Haven category -> our store group, and a suggested price in Ven.
GROUPS = [
    ("trees", "Trees", 25),
    ("plants", "Plants and bushes", 10),
    ("ground cover", "Ground cover", 5),
    ("rocks", "Rocks", 5),
    ("seating", "Seating", 15),
    ("table", "Tables", 15),
    ("furniture", "Furniture", 15),
    ("lighting", "Lighting", 10),
    ("structures", "Structures", 40),
    ("buildings", "Buildings", 80),
    ("decorative", "Decor", 8),
    ("containers", "Containers", 5),
    ("electronics", "Electronics", 8),
    ("appliances", "Appliances", 8),
    ("food", "Food and drink", 3),
]

# Hand-added kits (CC0), imported one by one after checking the licence at the source.
MANUAL = [
    {"id": "kenney-car-kit", "name": "Car Kit (cars, vans, taxis, police, trucks)", "group": "Vehicles", "priceVen": 30,
     "license": "CC0-1.0", "author": "Kenney", "source": "https://kenney.nl/assets/car-kit", "status": "to-import"},
    {"id": "kenney-watercraft-kit", "name": "Watercraft Kit (boats, yachts, jet skis)", "group": "Vehicles", "priceVen": 30,
     "license": "CC0-1.0", "author": "Kenney", "source": "https://kenney.nl/assets/watercraft-kit", "status": "to-import"},
    {"id": "kenney-nature-kit", "name": "Nature Kit (low-poly trees, bushes, flowers, rocks, fences)", "group": "Plants and bushes", "priceVen": 5,
     "license": "CC0-1.0", "author": "Kenney", "source": "https://kenney.nl/assets/nature-kit", "status": "to-import"},
    {"id": "kenney-furniture-kit", "name": "Furniture Kit (indoor furniture)", "group": "Furniture", "priceVen": 10,
     "license": "CC0-1.0", "author": "Kenney", "source": "https://kenney.nl/assets/furniture-kit", "status": "to-import"},
    {"id": "quaternius-cars", "name": "Cars and vehicles packs", "group": "Vehicles", "priceVen": 30,
     "license": "CC0-1.0", "author": "Quaternius", "source": "https://quaternius.com", "status": "to-import"},
    {"id": "quaternius-nature", "name": "Stylized nature packs (trees, plants, rocks)", "group": "Plants and bushes", "priceVen": 5,
     "license": "CC0-1.0", "author": "Quaternius", "source": "https://quaternius.com", "status": "to-import"},
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "emerald-city-store-inventory/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def main():
    assets = get(f"{API}/assets?type=models")
    items = []
    for aid, a in sorted(assets.items()):
        cats = a.get("categories", [])
        group = next(((g, price) for key, g, price in GROUPS if key in cats), None)
        if not group:
            continue
        name, price = group
        polys = int(a.get("polycount") or 0)
        dims = a.get("dimensions") or [0, 0, 0]  # millimetres
        items.append({
            "id": f"polyhaven:{aid}",
            "name": a.get("name", aid),
            "group": name,
            "priceVen": price,
            "license": "CC0-1.0",
            "author": ", ".join(a.get("authors", {}).keys()),
            "source": f"https://polyhaven.com/a/{aid}",
            "thumbnail": f"https://cdn.polyhaven.com/asset_img/thumbs/{aid}.png?width=256&height=256",
            "gltf1k": f"https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/{aid}/{aid}_1k.gltf",
            "polygons": polys,
            "sizeM": [round(d / 1000, 2) for d in dims],
            "lods": bool(a.get("lods")),
            "webReady": 0 < polys <= WEB_MAX_POLYS,
            "tags": a.get("tags", [])[:8],
            "status": "listed",
        })
    for m in MANUAL:
        items.append({**m, "webReady": None})
    by_group = {}
    for it in items:
        g = by_group.setdefault(it["group"], {"items": 0, "webReady": 0})
        g["items"] += 1
        g["webReady"] += 1 if it.get("webReady") else 0
    out = {
        "sources": {
            "polyhaven": {"license": "CC0-1.0", "url": "https://polyhaven.com/license"},
            "kenney": {"license": "CC0-1.0", "url": "https://kenney.nl/support"},
            "quaternius": {"license": "CC0-1.0", "url": "https://quaternius.com"},
        },
        "webMaxPolygons": WEB_MAX_POLYS,
        "summary": by_group,
        "items": items,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(json.dumps(by_group, indent=1))
    print(f"{len(items)} items -> {OUT}")


if __name__ == "__main__":
    main()
