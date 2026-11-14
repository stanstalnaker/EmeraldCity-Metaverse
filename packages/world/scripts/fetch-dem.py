#!/usr/bin/env python3
"""
Real terrain for a world from open elevation data (AWS Terrain Tiles, Terrarium encoding;
sources include SRTM, EU-DEM and swisstopo-derived data, see
https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

  python3 fetch-dem.py <name> <lat> <lon> <size_km> [zoom]
Writes ../data/<name>.dem.png (16-bit, metres above `base`) and ../data/<name>.dem.json.
"""
import io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image

name, lat, lon, size_km = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
z = int(sys.argv[5]) if len(sys.argv) > 5 else 13
out_res = 1025

def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

n = 2 ** z
m_per_px = 40075016.686 * math.cos(math.radians(lat)) / (n * 256)
half_px = size_km * 1000 / 2 / m_per_px
cx, cy = tile_xy(lat, lon, z)
px0, py0 = cx * 256 - half_px, cy * 256 - half_px
px1, py1 = cx * 256 + half_px, cy * 256 + half_px
tx0, ty0, tx1, ty1 = int(px0 // 256), int(py0 // 256), int(px1 // 256), int(py1 // 256)
mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
        img = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=60).read())).convert("RGB"), dtype=np.float32)
        elev = img[..., 0] * 256 + img[..., 1] + img[..., 2] / 256 - 32768
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = elev
ox, oy = px0 - tx0 * 256, py0 - ty0 * 256
crop = mosaic[int(oy):int(oy + 2 * half_px), int(ox):int(ox + 2 * half_px)]
crop = np.asarray(Image.fromarray(crop).resize((out_res, out_res), Image.BICUBIC))
base, top = float(crop.min()), float(crop.max())
norm = ((crop - base) / (top - base) * 65535).clip(0, 65535).astype(np.uint16)  # row 0 = north
here = os.path.dirname(os.path.abspath(__file__))
Image.fromarray(norm).save(os.path.join(here, "..", "data", f"{name}.dem.png"))
meta = {"heightmap": f"{name}.dem.png", "resolution": out_res, "size": [size_km * 1000, size_km * 1000],
        "base": round(base, 1), "height": round(top - base, 1), "center": [lat, lon], "zoom": z,
        "metersPerSourcePixel": round(m_per_px, 2),
        "attribution": "Elevation: AWS Terrain Tiles (Mapzen/Tilezen; SRTM, EU-DEM and others)"}
json.dump(meta, open(os.path.join(here, "..", "data", f"{name}.dem.json"), "w"), indent=1)
print(meta)
