"""Minimal TopoJSON decoding + geometry helpers (pure Python, no dependencies)."""

from __future__ import annotations

import math


def decode_arcs(topology: dict) -> list[list[tuple[float, float]]]:
    tr = topology.get("transform")
    arcs = []
    for arc in topology["arcs"]:
        if tr:
            (sx, sy), (tx, ty) = tr["scale"], tr["translate"]
            x = y = 0
            pts = []
            for dx, dy in arc:
                x += dx
                y += dy
                pts.append((x * sx + tx, y * sy + ty))
        else:
            pts = [tuple(p) for p in arc]
        arcs.append(pts)
    return arcs


def _ring(arc_ids: list[int], arcs: list) -> list[tuple[float, float]]:
    ring: list[tuple[float, float]] = []
    for i in arc_ids:
        pts = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        ring.extend(pts if not ring else pts[1:])
    return ring


def geometry_polygons(geom: dict, arcs: list) -> list[list[list[tuple[float, float]]]]:
    """Return a list of polygons, each a list of rings (outer first)."""
    t = geom.get("type")
    if t == "Polygon":
        return [[_ring(r, arcs) for r in geom["arcs"]]]
    if t == "MultiPolygon":
        return [[_ring(r, arcs) for r in poly] for poly in geom["arcs"]]
    return []


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def point_in_polygon(x: float, y: float, rings: list[list[tuple[float, float]]]) -> bool:
    if not rings or not point_in_ring(x, y, rings[0]):
        return False
    return not any(point_in_ring(x, y, hole) for hole in rings[1:])


def ring_area_centroid(ring: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Planar signed area and centroid of a lon/lat ring (fine for label placement)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    a *= 0.5
    if abs(a) < 1e-12:
        xs, ys = zip(*ring)
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return a, cx / (6 * a), cy / (6 * a)


def great_circle_points(a: tuple[float, float], b: tuple[float, float], step_deg: float = 0.2):
    """Interpolate along the great circle from a to b (lon/lat degrees)."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    d = 2 * math.asin(math.sqrt(math.sin((lat2 - lat1) / 2) ** 2
                                + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2))
    if d == 0:
        return [a]
    n = max(1, int(math.degrees(d) / step_deg))
    out = []
    for i in range(n + 1):
        f = i / n
        A = math.sin((1 - f) * d) / math.sin(d)
        B = math.sin(f * d) / math.sin(d)
        x = A * math.cos(lat1) * math.cos(lon1) + B * math.cos(lat2) * math.cos(lon2)
        y = A * math.cos(lat1) * math.sin(lon1) + B * math.cos(lat2) * math.sin(lon2)
        z = A * math.sin(lat1) + B * math.sin(lat2)
        out.append((math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))))
    return out


class LandMask:
    """Fast point-on-land test over Natural Earth country polygons."""

    def __init__(self, topology: dict, object_name: str = "countries"):
        arcs = decode_arcs(topology)
        self.polys = []
        for geom in topology["objects"][object_name]["geometries"]:
            for rings in geometry_polygons(geom, arcs):
                xs = [p[0] for p in rings[0]]
                if max(xs) - min(xs) > 180:
                    # Ring straddles the antimeridian: unwrap to 0..360 so it stays a
                    # small polygon instead of a band around the planet.
                    rings = [[(x + 360 if x < 0 else x, y) for x, y in r] for r in rings]
                    xs = [p[0] for p in rings[0]]
                ys = [p[1] for p in rings[0]]
                self.polys.append(((min(xs), min(ys), max(xs), max(ys)), rings))

    def on_land(self, lon: float, lat: float) -> bool:
        for candidate in (lon, lon + 360):
            for (x0, y0, x1, y1), rings in self.polys:
                if x0 <= candidate <= x1 and y0 <= lat <= y1 and point_in_polygon(candidate, lat, rings):
                    return True
        return False
