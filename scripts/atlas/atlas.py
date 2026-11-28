"""Atlas base map build steps. Run through build.sh, which sets up the venv.

    python atlas.py fetch    BUILD_DIR   download Natural Earth and Terrarium tiles (cached)
    python atlas.py vectors  BUILD_DIR   write GeoJSON layers for tippecanoe
    python atlas.py relief   BUILD_DIR   write relief.mbtiles (shaded relief, palette PNG)
    python atlas.py styles   BUILD_DIR OUT_DIR   write both styles, water labels and ATLAS.md
"""

import json
import math
import os
import sqlite3
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Extent and zooms
# ---------------------------------------------------------------------------
# (west, south, east, north)
AREAS = {
    "world": (-12, 8, 62, 48),  # the biblical world (about -10..60, 10..46) plus a margin
    "regional": (19, 24, 49.5, 42.5),  # Greece, Asia Minor, Levant, Egypt, Mesopotamia
    "holy": (33.5, 29, 37, 34),
    "galilee": (35.0, 32.4, 35.95, 33.35),
    "jerusalem": (34.85, 31.35, 35.55, 32.1),
}
VECTOR_CLIP = AREAS["world"]
VECTOR_MAXZOOM = 9
# Plain land and coast beyond VECTOR_CLIP, overview zooms only, so a zoomed-out phone never shows land
# stopping at a straight line.
CONTEXT_CLIP = (-60, -45, 120, 75)
CONTEXT_MAXZOOM = 5

# Shaded relief zooms per area. A missing deep tile falls back to its parent in MapLibre Native.
RELIEF_PLAN = [("world", range(0, 8)), ("regional", [8]), ("holy", [9, 10]),
               ("galilee", [11, 12]), ("jerusalem", [11, 12])]

# Elevation steps (metres). Holy Land values apply in HILL_COUNTRY and blend to the
# outside values over BLEND_KM, so the hill country of Judea and Galilee reads while the
# Anatolian and Iranian plateaus do not turn into one block.
HILLS_M = {"holy": 400, "outside": 1500}
PEAKS_M = {"holy": 800, "outside": 2500}
HILL_COUNTRY = (34.0, 29.6, 36.0, 33.6)  # where the Holy Land values apply in full
BLEND_KM = 90

# Hills and peaks polygons: (DEM zoom, area, tile minzoom, tile maxzoom, simplify degrees)
CONTOUR_PLAN = [
    (6, "world", 0, 6, 0.02),
    (8, "regional", 7, VECTOR_MAXZOOM, 0.004),
    (7, "world", 7, VECTOR_MAXZOOM, 0.008),  # outside the regional box only
    (10, "holy", 7, VECTOR_MAXZOOM, 0.0012),  # replaces the regional set inside the Holy Land
]

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/10m_physical/"
NE_FILES = ["ne_10m_land", "ne_10m_minor_islands", "ne_10m_coastline",
            "ne_10m_minor_islands_coastline", "ne_10m_lakes", "ne_10m_rivers_lake_centerlines",
            "ne_10m_bathymetry_all/ne_10m_bathymetry_K_200"]
MODERN_LAKES = {"Lake Razazah", "Sarygamysh K\u00f6li"}  # reservoirs Natural Earth files as lakes
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    lat_r = math.radians(lat)
    y = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    return x, y


def tile_range(area, z):
    w, s, e, n = AREAS[area]
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    return int(x0), int(x1), int(y0), int(y1)


def pixel_to_lonlat(px, py, z):
    """Global pixel coords (256 px tiles) to lon/lat; works on numpy arrays."""
    n = 256 * 2 ** z
    lon = px / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py / n))))
    return lon, lat


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------
def download(url, path):
    if os.path.exists(path):
        return
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "atlas-build"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
            return
        except Exception as err:  # retry transient network errors
            if attempt == 3:
                raise RuntimeError(f"{url}: {err}")
            time.sleep(2 * (attempt + 1))


def terrarium_tiles():
    """Every DEM tile the relief and contour steps read, with a one tile margin."""
    need = set()
    plans = [(a, z) for a, zs in RELIEF_PLAN for z in zs] + [(a, z) for z, a, *_ in CONTOUR_PLAN]
    for area, z in plans:
        x0, x1, y0, y1 = tile_range(area, z)
        n = 2 ** z
        for x in range(x0 - 1, x1 + 2):
            for y in range(max(0, y0 - 1), min(n - 1, y1 + 1) + 1):
                need.add((z, x % n, y))
    return sorted(need)


def cmd_fetch(build):
    ne_dir = os.path.join(build, "downloads", "ne")
    os.makedirs(ne_dir, exist_ok=True)
    jobs = []
    for name in NE_FILES:
        for ext in ("shp", "shx", "dbf"):
            jobs.append((NE_BASE + name + "." + ext, os.path.join(ne_dir, os.path.basename(name) + "." + ext)))
    for z, x, y in terrarium_tiles():
        d = os.path.join(build, "downloads", "terrarium", str(z), str(x))
        os.makedirs(d, exist_ok=True)
        jobs.append((TERRARIUM.format(z=z, x=x, y=y), os.path.join(d, f"{y}.png")))
    print(f"fetch: {len(jobs)} files (cached files are skipped)")
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda j: download(*j), jobs))


# ---------------------------------------------------------------------------
# DEM helpers
# ---------------------------------------------------------------------------
def dem_mosaic(build, area, z, pad=1):
    """Elevation (metres, float32) for the area's tiles plus `pad` tiles of margin.
    Returns (dem, origin_x_px, origin_y_px) in global pixel coords."""
    from PIL import Image
    x0, x1, y0, y1 = tile_range(area, z)
    x0, x1, y0, y1 = x0 - pad, x1 + pad, y0 - pad, y1 + pad
    n = 2 ** z
    dem = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.float32)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            yy = min(max(ty, 0), n - 1)
            path = os.path.join(build, "downloads", "terrarium", str(z), str(tx % n), f"{yy}.png")
            rgb = np.asarray(Image.open(path).convert("RGB"), np.float32)
            e = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
            dem[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = e
    return dem, x0 * 256, y0 * 256


def blur(a, sigma):
    if sigma <= 0:
        return a
    r = int(3 * sigma + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    p = np.pad(a, r, mode="edge")
    p = np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 1, p)
    return np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 0, p)


def land_mask(land_geom, shape, ox, oy, z):
    """Rasterise land polygons onto a mosaic grid (True = land)."""
    from PIL import Image, ImageDraw, ImageFilter
    from shapely.geometry import box
    h, w = shape
    lon0, lat0 = pixel_to_lonlat(ox, oy, z)
    lon1, lat1 = pixel_to_lonlat(ox + w, oy + h, z)
    clip = land_geom.intersection(box(lon0 - 0.1, lat1 - 0.1, lon1 + 0.1, lat0 + 0.1))
    img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(img)
    n = 256 * 2 ** z

    def to_px(coords):
        out = []
        for lon, lat in coords:
            x, y = lonlat_to_tile(lon, lat, 0)
            out.append((x * n - ox, y * n - oy))
        return out

    polys = getattr(clip, "geoms", [clip])
    for p in polys:
        if p.is_empty or p.geom_type != "Polygon":
            continue
        draw.polygon(to_px(p.exterior.coords), fill=255)
        for hole in p.interiors:
            draw.polygon(to_px(hole.coords), fill=0)
    # A median pass removes one pixel seams where clipped polygons meet.
    return np.asarray(img.filter(ImageFilter.MedianFilter(3))) > 0


# ---------------------------------------------------------------------------
# vectors
# ---------------------------------------------------------------------------
def read_shp(build, name, clip):
    import shapefile
    from shapely.geometry import shape, box
    r = shapefile.Reader(os.path.join(build, "downloads", "ne", name))
    fields = [f[0] for f in r.fields[1:]]
    b = box(*clip)
    out = []
    for sr in r.iterShapeRecords():
        if not sr.shape.points:
            continue
        bb = sr.shape.bbox
        if bb[2] < clip[0] or bb[0] > clip[2] or bb[3] < clip[1] or bb[1] > clip[3]:
            continue
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = g.buffer(0)
        g = g.intersection(b)
        if not g.is_empty:
            out.append((g, dict(zip(fields, sr.record))))
    return out


def load_land(build, clip=VECTOR_CLIP):
    from shapely.ops import unary_union
    parts = [g for g, _ in read_shp(build, "ne_10m_land", clip)]
    parts += [g for g, _ in read_shp(build, "ne_10m_minor_islands", clip)]
    return unary_union(parts)


def threshold_scale(lon, lat):
    """0 in the hill country box, rising smoothly to 1 at BLEND_KM away from it."""
    w, s, e, n = HILL_COUNTRY
    dx = np.maximum(np.maximum(w - lon, lon - e), 0) * 111 * np.cos(np.radians(lat))
    dy = np.maximum(np.maximum(s - lat, lat - n), 0) * 111
    t = np.clip(np.hypot(dx, dy) / BLEND_KM, 0, 1)
    return t * t * (3 - 2 * t)


def contour_polys(dem, ox, oy, z, level_key, simplify):
    """Filled contour of elevation above the (spatially blended) threshold, as lon/lat polygons."""
    import contourpy
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    h, w = dem.shape
    px = ox + np.arange(w) + 0.5
    py = oy + np.arange(h) + 0.5
    lon, _ = pixel_to_lonlat(px, np.zeros_like(px), z)
    _, lat = pixel_to_lonlat(np.zeros_like(py), py, z)
    LON, LAT = np.meshgrid(lon, lat)
    t = threshold_scale(LON, LAT)
    levels = HILLS_M if level_key == "hills" else PEAKS_M
    thr = levels["holy"] + (levels["outside"] - levels["holy"]) * t
    # Smooth before contouring so the shapes read as soft masses, not pixel noise.
    field = blur(dem, 4.0 if z >= 10 else 2.5) - thr
    gen = contourpy.contour_generator(lon, lat, field, fill_type=contourpy.FillType.OuterOffset)
    polys, offsets = gen.filled(0, 1e9)
    out = []
    for pts, offs in zip(polys, offsets):
        rings = [pts[offs[i]:offs[i + 1]] for i in range(len(offs) - 1)]
        if len(rings[0]) < 4:
            continue
        holes = [r for r in rings[1:] if len(r) >= 4]
        p = Polygon(rings[0], holes)
        if not p.is_valid:
            p = p.buffer(0)
        out.append(p)
    g = unary_union(out).simplify(simplify, preserve_topology=True)
    return unary_union([chaikin(p) for p in explode(g) if p.geom_type == "Polygon"])


def chaikin(poly, rounds=2):
    """Round off the corners left by contouring and simplification."""
    from shapely.geometry import Polygon

    def ring(c):
        c = np.asarray(c)[:-1]
        for _ in range(rounds):
            n = np.roll(c, -1, axis=0)
            c = np.stack([0.75 * c + 0.25 * n, 0.25 * c + 0.75 * n], axis=1).reshape(-1, 2)
        return c

    p = Polygon(ring(poly.exterior.coords), [ring(h.coords) for h in poly.interiors if len(h.coords) > 3])
    return p if p.is_valid else p.buffer(0)


def write_geojson(path, feats):
    with open(path, "w") as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        f.write(",\n".join(json.dumps(x, separators=(",", ":")) for x in feats))
        f.write("\n]}\n")


def feat(geom, props=None, minzoom=None, maxzoom=None):
    from shapely.geometry import mapping
    f = {"type": "Feature", "properties": props or {}, "geometry": mapping(geom)}
    tc = {}
    if minzoom is not None:
        tc["minzoom"] = minzoom
    if maxzoom is not None:
        tc["maxzoom"] = maxzoom
    if tc:
        f["tippecanoe"] = tc
    return f


def explode(g):
    return [p for p in getattr(g, "geoms", [g]) if not p.is_empty]


def cmd_vectors(build):
    from shapely.geometry import box
    from shapely.ops import unary_union
    out = os.path.join(build, "vectors")
    os.makedirs(out, exist_ok=True)
    clip = box(*VECTOR_CLIP)

    land = load_land(build)
    context = load_land(build, CONTEXT_CLIP).difference(clip).simplify(0.01)
    write_geojson(os.path.join(out, "land.geojson"), [feat(p) for p in explode(land)] +
                  [feat(p, maxzoom=CONTEXT_MAXZOOM) for p in explode(context)])

    coast = [g for g, _ in read_shp(build, "ne_10m_coastline", VECTOR_CLIP)]
    coast += [g for g, _ in read_shp(build, "ne_10m_minor_islands_coastline", VECTOR_CLIP)]
    context = [g.difference(clip).simplify(0.01) for g, _ in read_shp(build, "ne_10m_coastline", CONTEXT_CLIP)]
    write_geojson(os.path.join(out, "coast.geojson"), [feat(l) for g in coast for l in explode(g)] +
                  [feat(l, maxzoom=CONTEXT_MAXZOOM) for g in context for l in explode(g)])

    # Shelf: sea shallower than 200 m (Natural Earth bathymetry), clipped to the extent.
    deep = unary_union([g for g, _ in read_shp(build, "ne_10m_bathymetry_K_200", VECTOR_CLIP)])
    shelf = clip.difference(deep).difference(land.buffer(-0.01)).simplify(0.002)
    write_geojson(os.path.join(out, "shelf.geojson"), [feat(p) for p in explode(shelf)])

    # Modern reservoirs and canals are not part of the biblical landscape.
    lakes = [g for g, rec in read_shp(build, "ne_10m_lakes", VECTOR_CLIP)
             if rec["featurecla"] != "Reservoir" and rec["name"] not in MODERN_LAKES]
    write_geojson(os.path.join(out, "lakes.geojson"), [feat(p) for g in lakes for p in explode(g)])

    rivers = []
    for g, rec in read_shp(build, "ne_10m_rivers_lake_centerlines", CONTEXT_CLIP):
        if "Canal" in rec["name"] or "Channel" in rec["name"]:
            continue
        rank = int(rec.get("scalerank") or 10)
        # Minor rivers only appear once there is room for them.
        minzoom = 0 if rank <= 4 else min(rank - 3, 6)
        for l in explode(g.intersection(clip)):
            rivers.append(feat(l, {"rank": rank}, minzoom=minzoom))
        if rank <= 5:  # major rivers carry on beyond the extent on the overview
            for l in explode(g.difference(clip).simplify(0.01)):
                rivers.append(feat(l, {"rank": rank}, maxzoom=CONTEXT_MAXZOOM))
    write_geojson(os.path.join(out, "rivers.geojson"), rivers)

    holy_box = box(*AREAS["holy"])
    regional_box = box(*AREAS["regional"])
    for key in ("hills", "peaks"):
        feats = []
        for z, area, zmin, zmax, simp in CONTOUR_PLAN:
            dem, ox, oy = dem_mosaic(build, area, z)
            g = contour_polys(dem, ox, oy, z, key, simp).intersection(land)
            if (z, area) == (8, "regional"):
                g = g.difference(holy_box)
            elif (z, area) == (7, "world"):
                g = g.difference(regional_box)
            elif area == "holy":
                g = g.intersection(holy_box)
            g = g.intersection(clip)
            # Drop specks that would read as noise at their zoom.
            min_area = (simp * 10) ** 2
            for p in explode(g):
                if p.geom_type == "Polygon" and p.area >= min_area:
                    feats.append(feat(p, minzoom=zmin, maxzoom=zmax))
        write_geojson(os.path.join(out, f"{key}.geojson"), feats)
        print(f"vectors: {key} {len(feats)} polygons")


# ---------------------------------------------------------------------------
# relief
# ---------------------------------------------------------------------------
# Palette: index 0 transparent, then shadow levels (black), then highlight levels (white).
SHADOW_LEVELS = 12
HIGHLIGHT_LEVELS = 6
SHADOW_MAX_ALPHA = 0.80
HIGHLIGHT_MAX_ALPHA = 0.55


def exaggeration(z):
    # Low zooms average slopes away; lift them so ranges still read on the overview.
    return 1.0 + max(0, 10 - z) * 0.55


def hillshade(dem, ox, oy, z):
    h, w = dem.shape
    py = oy + np.arange(h) + 0.5
    _, lat = pixel_to_lonlat(np.zeros_like(py), py, z)
    res = 40075016.686 / (256 * 2 ** z) * np.cos(np.radians(lat))  # metres per pixel by row
    d = blur(dem, 0.8 if z <= 8 else 1.2 if z <= 10 else 1.6)  # calmer texture when zoomed in
    gy, gx = np.gradient(d)
    ex = exaggeration(z)
    gx = gx / res[:, None] * ex
    gy = gy / res[:, None] * ex
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)  # 0 = slope faces north
    az = math.radians(315)
    alt = math.radians(45)
    shade = math.sin(alt) * np.cos(slope) + math.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return shade - math.sin(alt)  # 0 on flat ground, negative in shadow


def encode_tile(v):
    """Signed shade -> palette PNG bytes, or None when the tile is empty."""
    from PIL import Image
    empty = np.isnan(v)
    v = np.nan_to_num(v)
    s = np.clip(-v / 0.55, 0, 1)
    hl = np.clip(v / 0.25, 0, 1)
    idx = np.zeros(v.shape, np.uint8)
    si = np.round(s * SHADOW_LEVELS).astype(np.uint8)
    hi = np.round(hl * HIGHLIGHT_LEVELS).astype(np.uint8)
    idx[si > 0] = si[si > 0]
    m = (si == 0) & (hi > 0)
    idx[m] = SHADOW_LEVELS + hi[m]
    idx[empty] = 0
    if not idx.any():
        return None
    pal, alpha = [0, 0, 0], [0]
    for i in range(1, SHADOW_LEVELS + 1):
        pal += [0, 0, 0]
        alpha.append(round(255 * SHADOW_MAX_ALPHA * i / SHADOW_LEVELS))
    for i in range(1, HIGHLIGHT_LEVELS + 1):
        pal += [255, 255, 255]
        alpha.append(round(255 * HIGHLIGHT_MAX_ALPHA * i / HIGHLIGHT_LEVELS))
    img = Image.fromarray(idx, "P")
    img.putpalette(pal)
    buf = BytesIO()
    img.save(buf, "PNG", optimize=True, transparency=bytes(alpha), bits=8)
    return buf.getvalue()


def cmd_relief(build):
    land = load_land(build)
    path = os.path.join(build, "relief.mbtiles")
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.execute("create table metadata (name text, value text)")
    db.execute("create table tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
    done = set()
    total = 0
    for area, zs in RELIEF_PLAN:
        for z in zs:
            dem, ox, oy = dem_mosaic(build, area, z)
            v = hillshade(dem, ox, oy, z)
            mask = land_mask(land, dem.shape, ox, oy, z)
            v[~mask] = np.nan
            x0, x1, y0, y1 = tile_range(area, z)
            n = 2 ** z
            for ty in range(max(y0, 0), min(y1, n - 1) + 1):
                for tx in range(x0, x1 + 1):
                    key = (z, tx % n, ty)
                    if key in done:
                        continue
                    done.add(key)
                    r0 = (ty - y0 + 1) * 256
                    c0 = (tx - x0 + 1) * 256
                    data = encode_tile(v[r0:r0 + 256, c0:c0 + 256])
                    if data is None:
                        continue
                    db.execute("insert into tiles values (?,?,?,?)", (z, tx % n, n - 1 - ty, data))
                    total += len(data)
            print(f"relief: {area} z{z} done, {total / 1e6:.1f} MB so far")
    w, s, e, n_ = AREAS["world"]
    meta = {"name": "atlas-relief", "format": "png", "type": "overlay", "minzoom": "0",
            "maxzoom": str(max(z for _, zs in RELIEF_PLAN for z in zs)),
            "bounds": f"{w},{s},{e},{n_}", "attribution": ""}
    db.executemany("insert into metadata values (?,?)", meta.items())
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# styles
# ---------------------------------------------------------------------------
# Mirrors the .night and .cream variables in atlas-design-ref/boards/AtlasMap.dc.html.
# hills = --relief, peaks = --relief2. relief_opacity is ours: the shaded relief overlay.
TOKENS = {
    "night": {"sea": "#0A0C0F", "shelfA": "rgba(140,180,205,0.05)", "shelfB": "rgba(140,180,205,0.1)",
              "land": "#26221E", "hills": "#383129", "peaks": "#4A4137", "coast": "#74685A",
              "lake": "#0A0C0F", "river": "#4A7183", "relief_opacity": 0.5},
    "cream": {"sea": "#D2DAD8", "shelfA": "rgba(255,255,255,0.35)", "shelfB": "rgba(255,255,255,0.55)",
              "land": "#F6F1E7", "hills": "#E4D9C4", "peaks": "#D4C7AE", "coast": "#9E917A",
              "lake": "#C4D0D0", "river": "#7C9CA6", "relief_opacity": 0.5},
}

NE_CREDIT = "Made with Natural Earth"
TERRAIN_CREDIT = ("Terrain: SRTM and GMTED2010 courtesy of the U.S. Geological Survey; ETOPO1 NOAA; "
                  "Copernicus EU-DEM (European Union); DGM \u00d6sterreich")


def over(top, bottom):
    """Flatten a translucent rgba() token over an opaque #hex colour. Overlapping translucent
    strokes add up into bright spots where coast lines meet, so the shelf is drawn opaque."""
    r, g, b, a = (float(x) for x in top[5:-1].split(","))
    base = [int(bottom[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(c * a + o * (1 - a)):02X}" for c, o in zip((r, g, b), base))


def zoom(*stops):
    return ["interpolate", ["linear"], ["zoom"], *stops]


def build_style(theme):
    t = TOKENS[theme]
    v = {"source": "atlas"}
    shelf_a = over(t["shelfA"], t["sea"])
    shelf_b = over(t["shelfB"], shelf_a)
    # Major rivers (low rank) stay a little heavier at every zoom.
    river_w = zoom(3, ["step", ["get", "rank"], 1.1, 5, 0.6, 8, 0.4],
                   7, ["step", ["get", "rank"], 1.5, 5, 1.1, 8, 0.8],
                   10, ["step", ["get", "rank"], 1.5, 8, 1.1])
    return {
        "version": 8,
        "name": f"Atlas {theme}",
        "sources": {
            "atlas": {"type": "vector", "url": "pmtiles://{ATLAS_DIR}/atlas.pmtiles", "attribution": NE_CREDIT},
            "relief": {"type": "raster", "url": "pmtiles://{ATLAS_DIR}/atlas-relief.pmtiles",
                       "tileSize": 256, "attribution": TERRAIN_CREDIT},
        },
        "layers": [
            {"id": "sea", "type": "background", "paint": {"background-color": t["sea"]}},
            {"id": "shelf", "type": "fill", **v, "source-layer": "shelf",
             "paint": {"fill-color": shelf_a}},
            # The board draws the shelf as two soft strokes along the coast; land covers their inner half.
            {"id": "shelf-wide", "type": "line", **v, "source-layer": "coast",
             "layout": {"line-join": "round", "line-cap": "round"},
             "paint": {"line-color": shelf_a, "line-width": zoom(2, 3, 4, 8, 6, 22)}},
            {"id": "shelf-near", "type": "line", **v, "source-layer": "coast",
             "layout": {"line-join": "round", "line-cap": "round"},
             "paint": {"line-color": shelf_b, "line-width": zoom(2, 1.5, 4, 4, 6, 9)}},
            {"id": "land", "type": "fill", **v, "source-layer": "land", "paint": {"fill-color": t["land"]}},
            {"id": "hills", "type": "fill", **v, "source-layer": "hills", "paint": {"fill-color": t["hills"]}},
            {"id": "peaks", "type": "fill", **v, "source-layer": "peaks", "paint": {"fill-color": t["peaks"]}},
            {"id": "relief", "type": "raster", "source": "relief",
             "paint": {"raster-opacity": t["relief_opacity"], "raster-fade-duration": 0,
                       "raster-resampling": "linear"}},
            {"id": "rivers", "type": "line", **v, "source-layer": "rivers",
             "layout": {"line-join": "round", "line-cap": "round"},
             "paint": {"line-color": t["river"], "line-width": river_w}},
            {"id": "lakes", "type": "fill", **v, "source-layer": "lakes", "paint": {"fill-color": t["lake"]}},
            {"id": "lake-shore", "type": "line", **v, "source-layer": "lakes",
             "paint": {"line-color": t["coast"], "line-width": 0.8}},
            {"id": "coast", "type": "line", **v, "source-layer": "coast",
             "layout": {"line-join": "round"},
             "paint": {"line-color": t["coast"], "line-width": 1.25}},
        ],
    }


def cmd_styles(build, out):
    import shutil
    for theme in TOKENS:
        with open(os.path.join(out, f"atlas-{theme}.json"), "w") as f:
            json.dump(build_style(theme), f, indent=1)
            f.write("\n")
    shutil.copyfile(os.path.join(HERE, "water-labels.json"), os.path.join(out, "water-labels.json"))
    # ATLAS.md: the template with the real file sizes filled in.
    with open(os.path.join(HERE, "ATLAS.template.md")) as f:
        doc = f.read()
    names = ["atlas.pmtiles", "atlas-relief.pmtiles", "atlas-night.json", "atlas-cream.json", "water-labels.json"]
    sizes = {n: os.path.getsize(os.path.join(out, n)) for n in names}
    rows = "\n".join(f"| `{n}` | " + (f"{sizes[n] / 1e6:.2f} MB" if sizes[n] > 1e5 else f"{sizes[n] / 1e3:.1f} KB")
                     + " |" for n in names)
    doc = doc.replace("{SIZES}", rows).replace("{TOTAL}", f"{sum(sizes.values()) / 1e6:.1f} MB")
    with open(os.path.join(out, "ATLAS.md"), "w") as f:
        f.write(doc)


if __name__ == "__main__":
    cmd, build = sys.argv[1], os.path.abspath(sys.argv[2])
    if cmd == "styles":
        cmd_styles(build, os.path.abspath(sys.argv[3]))
    else:
        {"fetch": cmd_fetch, "vectors": cmd_vectors, "relief": cmd_relief}[cmd](build)
