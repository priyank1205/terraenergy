"""
When trade crosses a land border, and when it goes by sea.

Customs declarations say who traded with whom, not how the goods moved (UN Comtrade's public
API only publishes all-modes totals). Transport is therefore modelled with explicit rules:

1. Neighbours trade overland only across a border that carries freight: both countries sit in
   the same land-freight network (LAND_REGIONS), or the crossing is named in LAND_LINKS, or one
   of them is landlocked. Pairs known to trade by sea (SEA_OVERRIDE) and borders that are closed
   or impassable to freight (CLOSED_BORDERS) never do. Borders that exist only through an
   overseas territory (France–Brazil via French Guiana) do not count.
2. Crude oil between neighbours is a pipeline only where a cross-border crude pipeline exists
   (CRUDE_PIPELINES); rail or truck only where documented (CRUDE_BY_LAND) or for a landlocked
   partner; otherwise it goes by tanker.
3. A landlocked country trades overland with countries it can reach through one transit
   country, or two when every country on the way is in the same freight network; otherwise it
   ships through its gateway port. Microstates are never transit countries.
4. Pipeline gas without a named corridor follows the shortest chain of land borders.
5. Everything else, including LNG, moves by sea between the two countries' ports.

Overland lines run from a hub in each country (a major city or producing region near the
border in question) through a point on the shared border, not straight between country centres.
"""

from __future__ import annotations

import heapq

from pipeline.lib.sealanes import haversine_nm


def _pairs(text: str) -> set[frozenset]:
    return {frozenset(p.split("-")) for p in text.split()}


LANDLOCKED = set("""
AFG AND ARM AUT AZE BDI BFA BLR BOL BTN BWA CAF CHE CZE ETH HUN KAZ KGZ LAO LIE LSO LUX MDA MKD
MLI MNG MWI NER NPL PRY RWA SMR SRB SSD SVK SWZ TCD TJK TKM UGA UZB VAT XKX ZMB ZWE
""".split())

# Connected rail/road/pipeline/barge networks in which cross-border energy trade by land is routine.
LAND_REGIONS = {name: set(isos.split()) for name, isos in {
    "europe": "ALB AND AUT BEL BGR BIH BLR CHE CZE DEU DNK ESP EST FIN FRA GRC HRV HUN ITA LIE LTU LUX LVA "
              "MCO MDA MKD MNE NLD NOR POL PRT ROU SMR SRB SVK SVN SWE UKR VAT XKX",
    "former_ussr": "RUS BLR UKR MDA KAZ UZB KGZ TJK TKM AZE GEO ARM EST LVA LTU MNG",
    "middle_east": "TUR GEO AZE ARM IRN IRQ SYR LBN JOR SAU KWT ARE OMN QAT BHR YEM ISR PSE",
    "south_central_asia": "AFG PAK IRN TKM UZB TJK",
    "south_asia": "IND NPL BTN BGD",
    "mainland_southeast_asia": "THA LAO KHM MMR VNM MYS",
    "north_america": "USA CAN MEX",
    "central_america": "MEX GTM BLZ SLV HND NIC CRI PAN",
    "sub_saharan_africa": "AGO BDI BEN BFA BWA CAF CIV CMR COD COG DJI ERI ETH GAB GHA GIN GMB GNB GNQ KEN LBR "
                          "LSO MLI MOZ MRT MWI NAM NER NGA RWA SDN SEN SLE SOM SSD SWZ TCD TGO TZA UGA ZAF ZMB ZWE",
}.items()}

# Individual crossings between those networks that carry energy or mineral freight.
LAND_LINKS = _pairs("""
CHN-MNG CHN-KAZ CHN-RUS CHN-KGZ CHN-TJK CHN-LAO CHN-MMR CHN-PRK CHN-HKG CHN-MAC RUS-PRK
TUN-LBY EGY-SDN DZA-MLI DZA-NER LBY-TCD LBY-NER
""")

# Land borders that are closed, militarised or impassable to freight for these goods.
CLOSED_BORDERS = _pairs("""
CHN-IND CHN-BTN CHN-NPL CHN-PAK CHN-AFG IND-PAK IND-MMR ARM-AZE ARM-TUR ISR-LBN ISR-SYR KOR-PRK
MAR-DZA RUS-UKR BLR-UKR ETH-ERI VEN-GUY
""")

# Borders created only by overseas territories in the map geometry.
OVERSEAS_BORDERS = _pairs("FRA-BRA FRA-SUR")
# Russia's only borders with Poland and Lithuania are around the Kaliningrad exclave.
EXCLAVE_BORDERS = _pairs("RUS-POL RUS-LTU")
NO_TRANSIT = {"AND", "LIE", "MCO", "SMR", "VAT"}

# Neighbours that trade mostly by sea.
SEA_OVERRIDE = {("USA", "MEX"), ("MEX", "USA"), ("GBR", "IRL"), ("IRL", "GBR"), ("SAU", "ARE"), ("ARE", "SAU"),
                ("OMN", "ARE"), ("ARE", "OMN"), ("SAU", "KWT"), ("KWT", "SAU"), ("QAT", "SAU"), ("SAU", "QAT"),
                ("CHN", "VNM"), ("VNM", "CHN"), ("MYS", "THA"), ("THA", "MYS"), ("IDN", "MYS"), ("MYS", "IDN"),
                ("ESP", "PRT"), ("PRT", "ESP"), ("FRA", "ESP"), ("ESP", "FRA"), ("NOR", "SWE"), ("SWE", "NOR"),
                ("NOR", "FIN"), ("FIN", "NOR"), ("SWE", "FIN"), ("FIN", "SWE"), ("DNK", "DEU"), ("DEU", "DNK"),
                ("IRQ", "KWT"), ("KWT", "IRQ"), ("EGY", "LBY"), ("LBY", "EGY"), ("DZA", "TUN"), ("TUN", "DZA"),
                ("DZA", "MAR"), ("MAR", "DZA"), ("PER", "CHL"), ("CHL", "PER"), ("COL", "PAN"), ("PAN", "COL"),
                ("NGA", "CMR"), ("CMR", "NGA"), ("AGO", "COG"), ("COG", "AGO"), ("CHN", "KOR"), ("RUS", "FIN"),
                ("ISR", "EGY"), ("EGY", "ISR"), ("RUS", "CHN"), ("RUS", "JPN"), ("RUS", "KOR"), ("TUR", "GRC"),
                ("GRC", "TUR"), ("TUR", "BGR"), ("BGR", "TUR"), ("BRA", "URY"), ("URY", "BRA"), ("ARG", "URY"),
                ("URY", "ARG"), ("ARG", "CHL"), ("CHL", "ARG")}

# Cross-border crude pipelines (exporter, importer).
CRUDE_PIPELINES = {
    ("NLD", "BEL"),  # Rotterdam–Antwerp Pipeline (RAPL)
    ("NLD", "DEU"),  # Rotterdam–Rhine Pipeline
    ("FRA", "DEU"),  # South European Pipeline (Lavera–Karlsruhe)
    ("POL", "DEU"),  # Gdańsk–Schwedt via Druzhba
    ("DEU", "CZE"),  # IKL (Ingolstadt–Kralupy)
    ("ITA", "AUT"), ("ITA", "DEU"),  # Transalpine Pipeline
    ("HRV", "HUN"), ("HRV", "SRB"),  # JANAF / Adria
    ("HUN", "SVK"), ("SVK", "CZE"), ("UKR", "SVK"), ("UKR", "HUN"),  # Druzhba southern leg
    ("RUS", "BLR"), ("RUS", "HUN"), ("RUS", "SVK"), ("RUS", "KAZ"), ("KAZ", "RUS"), ("RUS", "AZE"),
    ("RUS", "CHN"), ("KAZ", "CHN"), ("MMR", "CHN"), ("CHN", "PRK"),
    ("IRQ", "TUR"),  # Kirkuk–Ceyhan
    ("CAN", "USA"), ("USA", "CAN"),
    ("ARG", "CHL"),  # Oleoducto Trasandino (Neuquén–Concepción)
}
# Documented crude movements by rail or truck between coastal neighbours.
CRUDE_BY_LAND = {("IRQ", "JOR")}

# Main freight crossings for borders where the nearest point on the border is not a real crossing.
CROSSINGS = {frozenset(k.split("-")): v for k, v in {
    "CHN-RUS": [(117.4, 49.6), (131.15, 44.4), (127.5, 50.25), (132.5, 47.9)],  # Manzhouli, Suifenhe, Heihe, Tongjiang
    "CHN-KAZ": [(82.8, 45.2), (80.3, 44.2)],  # Dostyk–Alashankou, Khorgos
    "CHN-KGZ": [(75.4, 40.52), (73.9, 39.7)],  # Torugart, Irkeshtam
    "CHN-MNG": [(111.97, 43.65), (106.6, 42.9)],  # Erenhot, Gashuunsukhait
    "CHN-LAO": [(101.68, 21.2)],  # Boten (Laos–China railway)
    "CHN-MMR": [(97.9, 24.0)],  # Muse–Ruili
    "CHN-PRK": [(124.4, 40.1)],  # Dandong–Sinuiju
    "RUS-GEO": [(44.63, 42.74)],  # Upper Lars
    "RUS-AZE": [(48.5, 41.85)],  # Samur
    "GEO-TUR": [(41.55, 41.52)],  # Sarpi
    "GEO-AZE": [(45.2, 41.33)],  # Red Bridge
    "GEO-ARM": [(44.6, 41.2)],  # Sadakhlo
    "IRN-TUR": [(44.4, 39.4)],  # Gürbulak–Bazargan
    "IRN-AZE": [(48.87, 38.43)],  # Astara
    "IRN-TKM": [(61.2, 36.5), (57.2, 38.0)],  # Sarakhs, Bajgiran
    "AFG-UZB": [(67.4, 37.23)],  # Hairatan
    "AFG-TKM": [(62.3, 35.2)],  # Torghundi
    "AFG-TJK": [(68.6, 37.1)],  # Panji Poyon
    "AFG-PAK": [(71.1, 34.1), (66.45, 30.9)],  # Torkham, Chaman
    "AFG-IRN": [(61.0, 34.5)],  # Islam Qala
    "IND-NPL": [(84.88, 27.0)],  # Raxaul–Birgunj
    "IND-BGD": [(88.9, 23.0), (88.9, 25.2)],  # Petrapole–Benapole, Hili
    "IND-BTN": [(89.4, 26.85)],  # Jaigaon–Phuentsholing
    "TZA-ZMB": [(32.77, -9.3)],  # Tunduma–Nakonde (TAZARA)
    "USA-CAN": [(-83.0, 42.3), (-79.0, 43.1), (-82.4, 42.97), (-122.75, 49.0), (-97.2, 49.0)],  # Detroit, Niagara, Sarnia, Blaine, Emerson
}.items()}

# Cities or producing regions from which overland trade leaves or enters large countries;
# the one nearest the border crossing is used. Other countries use their label point.
LAND_HUBS = {
    "RUS": [(37.6, 55.75), (30.3, 59.9), (39.7, 47.2), (49.1, 55.8), (61.4, 55.2), (86.1, 54.0), (104.3, 52.3), (135.1, 48.5)],
    "CHN": [(116.4, 39.9), (87.6, 43.8), (102.7, 25.0), (126.6, 45.8), (113.3, 23.1), (109.8, 40.65), (123.4, 41.8), (103.8, 36.06)],
    "USA": [(-87.6, 41.9), (-95.4, 29.8), (-122.3, 47.6), (-83.0, 42.3), (-105.0, 39.7), (-74.0, 40.7), (-118.2, 34.05), (-106.5, 31.8)],
    "CAN": [(-113.5, 53.5), (-79.4, 43.7), (-73.6, 45.5), (-123.1, 49.3), (-97.1, 49.9)],
    "MEX": [(-100.3, 25.7), (-99.1, 19.4), (-117.0, 32.5), (-106.1, 28.6), (-92.1, 16.7)],
    "KAZ": [(76.9, 43.25), (71.4, 51.2), (51.9, 47.1), (73.1, 49.8), (75.3, 51.7), (69.6, 42.3)],
    "IND": [(77.2, 28.6), (88.4, 22.6), (72.9, 19.1), (91.7, 26.1), (85.1, 25.6)],
    "BRA": [(-46.6, -23.5), (-51.2, -30.0), (-54.6, -20.4), (-60.0, -3.1)],
    "ARG": [(-58.4, -34.6), (-68.1, -38.95), (-65.4, -24.8)],
    "ZAF": [(28.0, -26.2), (31.0, -29.9)],
    "IRN": [(51.4, 35.7), (46.3, 38.1), (59.6, 36.3), (48.7, 31.3), (60.9, 29.5)],
    "SAU": [(46.7, 24.7), (50.1, 26.4), (39.2, 21.5), (36.6, 28.4)],
    "TUR": [(29.0, 41.0), (32.9, 39.9), (36.2, 36.6), (41.3, 39.9)],
    "IRQ": [(44.4, 33.3), (47.8, 30.5), (44.4, 35.5)],
    "EGY": [(31.2, 30.0)],
    "DZA": [(3.05, 36.75), (6.1, 31.7), (5.5, 22.8)],
    "LBY": [(13.2, 32.9), (20.1, 32.1)],
    "SDN": [(32.5, 15.6)],
    "COD": [(15.3, -4.3), (27.5, -11.7), (29.2, -1.7)],
    "MOZ": [(32.6, -25.95), (34.85, -19.8), (33.6, -16.2)],
    "NGA": [(3.4, 6.5), (8.5, 12.0)],
    "UKR": [(30.5, 50.45), (24.0, 49.8)],
    "POL": [(21.0, 52.2), (19.0, 50.3), (16.9, 52.4)],
    "DEU": [(13.4, 52.5), (8.7, 50.1), (11.6, 48.1), (7.0, 51.45)],
    "FRA": [(2.35, 48.85), (4.8, 45.75), (7.75, 48.6)],
    "ESP": [(-3.7, 40.4), (2.2, 41.4)],
    "ITA": [(9.2, 45.5), (12.5, 41.9)],
    "SWE": [(18.1, 59.3), (22.1, 65.6)],
    "FIN": [(24.9, 60.2), (25.5, 65.0)],
    "NOR": [(10.75, 59.9), (18.9, 69.65)],
    "PER": [(-77.0, -12.05)],
    "COL": [(-74.1, 4.7)],
    "VEN": [(-66.9, 10.5)],
    "BOL": [(-68.15, -16.5), (-63.2, -17.8)],
    "AUS": [(151.2, -33.9)],
    "MNG": [(106.9, 47.9), (105.9, 43.6), (114.5, 48.1)],
    "CHL": [(-70.65, -33.45), (-70.4, -23.65), (-70.3, -18.5)],
    "PAK": [(67.0, 24.9), (74.35, 31.55), (71.6, 34.0), (67.0, 30.2)],
    "AFG": [(69.2, 34.5), (67.1, 36.7), (62.2, 34.35), (65.7, 31.6)],
    "UZB": [(69.3, 41.3), (66.96, 39.65), (64.4, 39.77)],
    "TKM": [(58.4, 37.95), (63.6, 39.1), (53.0, 40.0)],
    "TJK": [(68.8, 38.55), (69.6, 40.3)],
    "KGZ": [(74.6, 42.9), (72.8, 40.5)],
    "AZE": [(49.9, 40.4)],
    "GEO": [(44.8, 41.7), (41.65, 41.65)],
    "SYR": [(36.3, 33.5), (37.15, 36.2)],
    "JOR": [(35.9, 31.95)],
    "OMN": [(58.4, 23.6), (56.7, 24.35)],
    "LAO": [(102.6, 17.97)],
    "KHM": [(104.9, 11.55)],
    "NPL": [(85.3, 27.7)],
    "PRY": [(-57.6, -25.3)],
    "MLI": [(-8.0, 12.65)],
    "NER": [(2.1, 13.5)],
    "TCD": [(15.05, 12.1)],
    "MRT": [(-15.98, 18.08)],
    "ETH": [(38.7, 9.0)],
    "SSD": [(31.6, 4.85)],
    "CAF": [(18.55, 4.4)],
    "AGO": [(13.23, -8.84)],
    "NAM": [(17.08, -22.56)],
    "BWA": [(25.9, -24.65)],
    "ZMB": [(28.3, -15.4), (28.2, -12.8)],
    "ZWE": [(31.05, -17.8), (28.6, -20.15)],
    "TZA": [(39.3, -6.8), (36.7, -3.37)],
    "KEN": [(36.8, -1.3), (39.67, -4.05)],
    "UGA": [(32.6, 0.3)],
    "BFA": [(-1.5, 12.35)],
    "GHA": [(-0.2, 5.6), (-1.6, 6.7)],
    "CIV": [(-4.0, 5.35)],
    "BEN": [(2.4, 6.4)],
    "TGO": [(1.2, 6.13)],
    "SEN": [(-17.45, 14.7)],
    "THA": [(100.5, 13.75), (102.8, 17.4)],
    "MMR": [(96.1, 21.9), (96.2, 16.8)],
    "VNM": [(105.85, 21.0), (106.7, 10.8)],
}

# Named overland corridors: (exporter, importer, commodity or None) → (name, line lon/lat).
LAND_ROUTES = {
    ("RUS", "CHN", "coal"): ("Trans-Siberian rail via Zabaikalsk–Manzhouli",
                             [(86.1, 54.0), (92.9, 56.0), (104.3, 52.3), (113.5, 52.0), (117.4, 49.6), (123.9, 47.3), (126.6, 45.8)]),
    ("MNG", "CHN", "coal"): ("Tavan Tolgoi road & rail via Gashuunsukhait–Ganqimaodu",
                             [(105.6, 43.6), (106.6, 42.9), (107.5, 41.3), (109.8, 40.65)]),
    ("MNG", "CHN", "crude"): ("Tamsag basin by truck via Bichigt–Zuunkhatavch",
                              [(116.9, 47.1), (116.1, 45.4), (116.0, 43.9)]),
    ("KAZ", "CHN", None): ("Rail via Dostyk–Alashankou",
                           [(75.3, 51.7), (80.2, 50.4), (82.8, 45.2), (84.9, 44.3), (87.6, 43.8)]),
    ("USA", "CAN", None): ("Great Lakes crossings (Detroit–Windsor, Sarnia, Niagara)",
                           [(-87.6, 41.9), (-83.0, 42.3), (-82.4, 42.97), (-79.4, 43.7)]),
    ("CAN", "USA", None): ("Great Lakes crossings (Sarnia, Detroit–Windsor)",
                           [(-79.4, 43.7), (-82.4, 42.97), (-83.0, 42.3), (-87.6, 41.9)]),
}
# Named routes across the Caspian Sea, which is not part of the ocean network.
CASPIAN_ROUTES = {
    ("KAZ", "AZE"): ("Caspian tanker, Aktau–Baku", [(51.9, 47.1), (51.2, 43.65), (49.9, 40.4)]),
    ("TKM", "AZE"): ("Caspian tanker, Turkmenbashi–Baku", [(58.4, 37.95), (53.0, 40.0), (49.9, 40.4)]),
    ("AZE", "KAZ"): ("Caspian tanker, Baku–Aktau", [(49.9, 40.4), (51.2, 43.65), (51.9, 47.1)]),
    ("AZE", "TKM"): ("Caspian tanker, Baku–Turkmenbashi", [(49.9, 40.4), (53.0, 40.0), (58.4, 37.95)]),
    ("KAZ", "IRN"): ("Caspian tanker, Aktau–Anzali", [(51.9, 47.1), (51.2, 43.65), (49.45, 37.5), (51.4, 35.7)]),
    ("RUS", "IRN"): ("Caspian shipping, Astrakhan–Anzali", [(48.0, 46.35), (49.45, 37.5), (51.4, 35.7)]),
}


def neighbours_open(a: str, b: str, nb: dict) -> bool:
    pair = frozenset((a, b))
    return b in nb.get(a, ()) and pair not in CLOSED_BORDERS and pair not in OVERSEAS_BORDERS


def freight_edge(a: str, b: str, nb: dict) -> bool:
    """True when goods routinely cross from a to b by rail, road, pipeline or barge."""
    if not neighbours_open(a, b, nb) or (a, b) in SEA_OVERRIDE or frozenset((a, b)) in EXCLAVE_BORDERS:
        return False
    if a in LANDLOCKED or b in LANDLOCKED or frozenset((a, b)) in LAND_LINKS:
        return True
    return any(a in members and b in members for members in LAND_REGIONS.values())


def country_path(a: str, b: str, lp: dict, edge, max_transits: int) -> list[str] | None:
    """Shortest chain of countries from a to b over allowed land borders (by distance between label points)."""
    best = {a: 0.0}
    heap = [(0.0, 0, a, [a])]
    while heap:
        cost, hops, iso, path = heapq.heappop(heap)
        if iso == b:
            return path
        if cost > best.get(iso, float("inf")) or hops > max_transits:
            continue
        for nxt in edge.candidates(iso):
            if nxt in path or not edge(iso, nxt) or nxt not in lp or (nxt in NO_TRANSIT and nxt != b):
                continue
            c = cost + haversine_nm(tuple(lp[iso]), tuple(lp[nxt]))
            if c < best.get(nxt, float("inf")):
                best[nxt] = c
                heapq.heappush(heap, (c, hops + 1, nxt, path + [nxt]))
    return None


class _Edges:
    def __init__(self, nb, test, within=None):
        self.nb = nb
        self.test = test
        self.within = within

    def candidates(self, iso):
        return [n for n in self.nb.get(iso, ()) if self.within is None or n in self.within]

    def __call__(self, a, b):
        return self.test(a, b, self.nb)


def transit_path(exp: str, imp: str, nb: dict, lp: dict) -> list[str] | None:
    """Overland chain for a landlocked trade: one transit country, or two inside one freight network."""
    paths = [country_path(exp, imp, lp, _Edges(nb, freight_edge), max_transits=1)]
    for members in LAND_REGIONS.values():
        if exp in members and imp in members:
            paths.append(country_path(exp, imp, lp, _Edges(nb, freight_edge, members), max_transits=2))
    paths = [p for p in paths if p]
    return min(paths, key=lambda p: sum(haversine_nm(tuple(lp[a]), tuple(lp[b])) for a, b in zip(p, p[1:]))) if paths else None


def land_plan(exp: str, imp: str, commodity: str, nb: dict, lp: dict) -> tuple[str, list[str]] | None:
    """(mode, chain of countries) when this trade moves over land, or None when it goes by sea."""
    if commodity == "lng":
        return None
    if commodity != "pipeline_gas" and (exp, imp) in CASPIAN_ROUTES:
        return "caspian", [exp, imp]
    if commodity == "pipeline_gas":
        path = country_path(exp, imp, lp, _Edges(nb, neighbours_open), max_transits=4)
        return ("pipeline", path) if path else None
    if commodity == "crude" and neighbours_open(exp, imp, nb):
        if (exp, imp) in CRUDE_PIPELINES:
            return "pipeline", [exp, imp]
        if (exp, imp) in CRUDE_BY_LAND or exp in LANDLOCKED or imp in LANDLOCKED:
            return "overland", [exp, imp]
        return None
    if freight_edge(exp, imp, nb):
        return "overland", [exp, imp]
    if exp in LANDLOCKED or imp in LANDLOCKED:
        path = transit_path(exp, imp, nb, lp)
        if path:
            return "overland", path
    return None


def _hubs(iso: str, lp: dict) -> list[tuple[float, float]]:
    return LAND_HUBS.get(iso) or [tuple(lp[iso])]


def land_line(path: list[str], lp: dict, borders: dict) -> list[list[float]]:
    """Polyline from a hub in the first country, through each shared border, to a hub in the last."""
    d = haversine_nm
    start_hubs, end_hubs = _hubs(path[0], lp), _hubs(path[-1], lp)
    # Pick the start hub and first crossing together, so trade leaves from the hub nearest that border.
    pts: list[tuple[float, float]] = []
    prev_candidates = start_hubs
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        target = end_hubs if i == len(path) - 2 else [tuple(lp[b])]
        verts = (CROSSINGS.get(frozenset((a, b))) or borders.get(frozenset((a, b)))
                 or [((lp[a][0] + lp[b][0]) / 2, (lp[a][1] + lp[b][1]) / 2)])
        best = None
        for h in prev_candidates:
            for v in verts:
                cost = d(h, v) + min(d(v, t) for t in target)
                if best is None or cost < best[0]:
                    best = (cost, h, v)
        _, h, v = best
        if not pts:
            pts.append(h)
        pts.append(v)
        prev_candidates = [v]
    last = pts[-1]
    pts.append(min(end_hubs, key=lambda t: d(last, t)))
    return [[round(x, 2), round(y, 2)] for x, y in pts]
