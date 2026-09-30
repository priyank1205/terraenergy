"""
Maritime routing network.

A compact, hand-built graph of open-water waypoints, straits and canals. Every
seaborne trade flow is routed along the cheapest path between an exporter's
terminal and an importer's terminal, so chokepoint exposure is *derived* from
geography instead of being hard-coded per route.

Coordinates are (lon, lat). Edge kinds:
  sea    – open water; validated against land polygons by tests
  strait – narrow passage below the resolution of the land mask (exempt)
  canal  – artificial waterway crossing land (exempt)
"""

from __future__ import annotations

import heapq
import math
from functools import lru_cache

# --------------------------------------------------------------------------------------
# Waypoints
# --------------------------------------------------------------------------------------
NODES: dict[str, tuple[float, float]] = {
    # Persian Gulf / Gulf of Oman / Arabian Sea
    "PG_BASRA": (48.95, 29.55), "PG_KUWAIT": (48.45, 28.95), "PG_KHARG": (50.05, 29.1),
    "PG_NW": (49.9, 28.2), "PG_RAS_TANURA": (50.45, 26.9), "PG_BAHRAIN": (50.85, 26.45),
    "PG_C": (51.9, 26.7), "PG_RAS_LAFFAN": (51.75, 26.05), "PG_DAS": (52.8, 25.05),
    "PG_E": (54.3, 25.9), "HORMUZ": (56.45, 26.55), "GULF_OMAN": (57.8, 25.0),
    "FUJAIRAH": (56.65, 25.15), "JASK": (57.9, 25.45), "RAS_AL_HADD": (60.3, 22.9),
    "OMAN_QALHAT": (59.6, 22.75), "ARABIAN_N": (63.0, 20.0), "KARACHI": (66.8, 24.6),
    "KUTCH": (68.5, 22.35), "MUMBAI": (72.4, 18.9), "IND_SW": (74.3, 13.0), "KOCHI": (75.9, 9.9),
    "COMORIN": (77.5, 7.3), "SRI_LANKA_S": (80.6, 5.4), "COLOMBO": (79.65, 6.95),
    # Bay of Bengal / Andaman / Malacca
    "BENGAL_S": (86.0, 8.0), "CHENNAI": (80.7, 13.1), "PARADIP": (86.95, 20.05),
    "HALDIA": (88.2, 21.2), "CHITTAGONG": (91.55, 21.9), "MYANMAR_OFF": (95.0, 15.0),
    "SIX_DEGREE": (94.5, 6.1), "MALACCA_N": (97.6, 5.8), "MALACCA_C": (100.5, 3.0),
    "MALACCA_S": (102.85, 1.45), "SINGAPORE": (104.0, 1.25), "SGP_PORT": (103.75, 1.18),
    # South China Sea / Gulf of Thailand
    "SCS_SW": (105.0, 2.5), "SCS_S": (107.5, 6.5), "VUNG_TAU": (107.4, 10.1),
    "THAI_GULF_C": (102.0, 9.0), "THAI_GULF_N": (100.6, 12.3), "SCS_C": (112.0, 12.0),
    "SCS_N": (116.0, 19.5), "PRD": (114.2, 22.0), "HAINAN_E": (111.5, 18.5),
    "VN_NORTH": (106.5, 19.0), "SCS_BRUNEI": (114.3, 5.2), "SCS_BINTULU": (113.0, 3.5),
    "LUZON_STRAIT": (121.2, 21.3), "BATANGAS": (120.7, 13.5), "MANILA_W": (119.8, 14.5),
    # East China Sea / Yellow Sea / Japan / Korea / Russian Far East
    "TAIWAN_STRAIT": (119.6, 24.4), "KAOHSIUNG": (120.15, 22.55), "TAIWAN_E": (122.0, 23.5),
    "TAICHUNG": (120.25, 24.3), "ECS_S": (122.5, 27.5), "NINGBO": (123.0, 30.0),
    "SHANGHAI": (122.5, 31.0), "YELLOW_S": (123.5, 33.5), "QINGDAO": (120.8, 35.7),
    "YELLOW_N": (123.2, 37.6), "BOHAI_STRAIT": (121.1, 38.35), "DALIAN": (122.1, 38.8),
    "TIANJIN": (118.6, 38.8), "KOREA_STRAIT": (128.95, 34.55), "KOREA_SW": (125.8, 34.0),
    "INCHEON": (125.9, 36.8), "ULSAN": (129.55, 35.45), "YEOSU": (127.8, 34.4),
    "KYUSHU_S": (131.5, 30.0), "SHIKOKU_S": (133.5, 32.5), "KII": (135.0, 33.6),
    "OSAKA": (135.2, 34.35), "TOKYO_APP": (139.9, 34.6), "TOKYO": (139.8, 35.15),
    "JAPAN_E": (142.0, 36.5), "TSUGARU": (140.9, 41.65),
    "SEA_JAPAN_S": (131.0, 37.0), "SEA_JAPAN_C": (135.5, 40.0), "KOZMINO": (132.9, 42.55),
    "LA_PEROUSE": (141.9, 45.7), "SAKHALIN": (143.2, 46.3), # Pacific
    "PHIL_SEA_C": (130.0, 15.0), "PHIL_SEA_N": (133.0, 26.0), "PAC_W_JP": (145.0, 33.0),
    "PAC_NW": (165.0, 44.0), "PAC_N": (-165.0, 48.0), "PAC_NE": (-135.0, 40.0),
    "PAC_WC": (170.0, 30.0), "PAC_CENTRAL": (-150.0, 25.0), "PAC_EQ_W": (158.0, 2.0),
    "SPAC_1": (-95.0, -8.0), "SPAC_2": (-150.0, 5.0), "PAC_W_EQ": (160.0, 12.0),
    "EPAC_1": (-110.0, 20.0),
    # Indonesia / Philippines / Australia / Oceania
    "CELEBES": (122.5, 3.5), "MINDANAO_SE": (127.8, 5.5), "SIBUTU": (119.5, 4.7),
    "SULU": (120.0, 8.5), "BALABAC": (117.0, 7.55), "MINDORO": (120.5, 12.5),
    "MAKASSAR_N": (119.2, 0.2), "MAKASSAR_S": (118.0, -4.5), "BONTANG": (117.8, 0.15),
    "BALIKPAPAN": (117.2, -1.5), "JAVA_SEA": (111.0, -5.0), "JAKARTA": (106.9, -5.8),
    "KARIMATA": (108.8, -1.8), "BANJARMASIN": (114.8, -4.4), "SUNDA": (105.8, -6.0),
    "LOMBOK": (115.85, -8.7), "BALI_S": (115.5, -9.8), "TIMOR_SEA": (127.0, -11.0),
    "OMBAI": (125.3, -8.45), "BANDA_SEA": (127.0, -6.0), "MOLUCCA": (126.3, 0.3),
    "TANGGUH": (131.5, -2.5), "SERAM_SEA": (129.0, -2.5), "DAMPIER": (116.5, -20.1),
    "OFF_NW": (114.0, -18.0), "FREMANTLE": (115.4, -32.1), "AUS_SW": (114.0, -35.5),
    "AUS_S": (130.0, -36.0), "MELBOURNE": (144.8, -38.6), "BASS_STRAIT": (146.8, -39.3),
    "SYDNEY": (151.5, -34.0), "NEWCASTLE_AU": (152.2, -33.0), "BRISBANE": (153.6, -27.3),
    "GLADSTONE": (151.6, -23.7), "HAY_POINT": (149.6, -21.2), "QLD_OFF": (154.0, -22.0),
    "CORAL_E": (156.5, -14.0), "SOLOMON_EAST": (163.8, -10.5), "TORRES": (142.2, -10.5),
    "ARAFURA": (137.0, -9.5), "DARWIN": (130.4, -12.1), "PNG_PORT": (147.0, -9.9),
    "CORAL_N": (149.0, -12.5), "JOMARD": (152.3, -11.25), "SOLOMON_SEA": (152.0, -7.8),
    "ST_GEORGE": (152.6, -4.4), "BISMARCK_N": (151.0, -1.0), "TASMAN": (160.0, -35.0),
    "NZ_N": (174.8, -35.7), "NOUMEA": (166.2, -22.6), # Indian Ocean (west/south) & East Africa
    "IO_W": (57.0, 6.0), "IO_SW1": (54.0, -10.0), "IO_SW2": (54.0, -24.0),
    "IO_SW3": (40.0, -34.5), "IO_SE": (100.0, -10.0), "IO_CE": (88.0, 0.0),
    "SOCOTRA_E": (55.5, 13.0), "GULF_ADEN": (48.0, 12.5), "ADEN": (45.3, 12.4),
    "DJIBOUTI": (43.3, 11.75), "BAB_EL_MANDEB": (43.35, 12.6), "SOMALIA_OFF": (52.0, 5.0),
    "MOMBASA": (39.9, -4.1), "DAR": (39.6, -6.9), "MOZ_CHANNEL_N": (42.0, -12.0),
    "CABO_DELGADO": (41.0, -10.6), "MOZ_CHANNEL_C": (40.5, -17.0), "BEIRA": (35.2, -19.9),
    "MOZ_CHANNEL_S": (38.0, -24.0), "MAPUTO": (33.2, -26.0), "RICHARDS_BAY": (32.4, -28.85),
    "DURBAN": (31.4, -29.95), "AGULHAS": (22.0, -36.0), "MAURITIUS": (57.2, -20.4),
    "TOAMASINA": (49.8, -18.2),
    # Red Sea / Suez / Mediterranean
    "RED_SEA_S": (42.0, 14.5), "RED_SEA_C": (38.5, 20.0), "PORT_SUDAN": (37.45, 19.65),
    "JEDDAH": (38.9, 21.5), "YANBU": (37.8, 23.9), "RED_SEA_N": (35.0, 26.8),
    "GULF_SUEZ_S": (34.0, 27.3), "AQABA": (34.72, 28.75), "SUEZ_S": (32.5, 29.6),
    "PORT_SAID": (32.35, 31.45), "EMED_SE": (32.0, 32.5), "ISRAEL_OFF": (34.3, 32.4),
    "LEVANT_N": (34.8, 34.0), "CYPRUS_S": (33.0, 34.3), "CEYHAN": (35.7, 36.55),
    "EMED_C": (28.5, 33.8), "IDKU": (30.3, 31.65), "CRETE_S": (24.5, 34.3),
    "AEGEAN_C": (25.3, 38.3), "PIRAEUS": (23.4, 37.75),
    "AEGEAN_N": (25.9, 39.9), "DARDANELLES": (26.4, 40.2), "MARMARA": (28.0, 40.75),
    "BOSPHORUS": (29.05, 41.1), "BLACK_SEA_SW": (29.8, 42.0), "BLACK_SEA_C": (33.0, 43.0),
    "NOVOROSSIYSK": (37.6, 44.55), "ODESA": (30.9, 46.2), "CONSTANTA": (29.0, 44.1),
    "BURGAS": (27.9, 42.45), "SUPSA": (41.5, 42.0), "IONIAN": (19.0, 37.5), "OTRANTO": (18.9, 40.3), "ADRIATIC_C": (15.8, 42.8),
    "TRIESTE": (13.5, 45.55), "KRK": (14.15, 44.95), "AUGUSTA": (15.45, 37.2),
    "MALTA": (14.6, 35.6), "SICILY_CH": (12.3, 37.1), "LIBYA_ES_SIDER": (18.4, 30.85),
    "MELLITAH": (12.3, 33.05), "TYRRHENIAN": (12.5, 39.5), "GENOA": (8.9, 44.2),
    "FOS": (4.9, 43.2), "BALEARIC": (4.5, 39.0), "BARCELONA": (2.3, 41.25),
    "SKIKDA": (6.9, 37.1), "ALGERIA_OFF": (3.0, 37.2), "CARTAGENA_ES": (-0.9, 37.45),
    "ARZEW": (-0.25, 36.0), "ALBORAN": (-3.5, 36.0), "GIBRALTAR": (-5.6, 35.96),
    "ALGECIRAS": (-5.35, 36.05), "HUELVA": (-7.0, 36.95),
    # Atlantic Europe / North Sea / Baltic / Arctic
    "ST_VINCENT": (-9.3, 36.7), "SINES": (-9.1, 37.9), "LISBON_OFF": (-9.8, 38.6),
    "FINISTERRE": (-9.9, 43.2), "BILBAO": (-3.1, 43.6), "BISCAY": (-6.5, 46.0),
    "USHANT": (-5.5, 48.6), "CHANNEL_W": (-3.5, 49.8), "CHANNEL_C": (-0.5, 50.1),
    "LE_HAVRE": (0.0, 49.55), "DOVER": (1.45, 51.0), "DUNKIRK": (2.25, 51.1),
    "THAMES": (1.3, 51.55), "ZEEBRUGGE": (3.1, 51.4), "NSEA_S": (2.8, 51.9),
    "ROTTERDAM": (3.9, 52.0), "MILFORD": (-5.2, 51.6), "CELTIC": (-7.0, 50.5),
    "CORK": (-8.2, 51.7), "IRISH_SEA_N": (-5.0, 54.0), "NSEA_C": (3.5, 55.5),
    "TEES": (-0.9, 54.8), "ELBE": (8.0, 54.0), "WILHELMSHAVEN": (7.95, 53.85),
    "NSEA_N": (2.5, 59.5), "MONGSTAD": (4.6, 60.8), "KARSTO": (4.6, 59.0),
    "SKAGEN": (10.8, 58.0), "BROFJORDEN": (11.2, 58.3), "KATTEGAT": (11.6, 56.9),
    "GREAT_BELT": (10.95, 55.4), "BALTIC_SW": (13.0, 54.9), "SWINOUJSCIE": (14.3, 54.1),
    "BORNHOLM": (15.5, 55.5), "GDANSK": (18.95, 54.5), "BALTIC_C": (19.5, 56.5),
    "KLAIPEDA": (20.9, 55.7), "GOTLAND_N": (19.5, 58.5), "GULF_FINLAND_W": (22.5, 59.4),
    "PORVOO": (25.6, 60.1), "PALDISKI": (24.0, 59.5), "PRIMORSK": (28.4, 60.15),
    "UST_LUGA": (28.2, 59.75), "NORWAY_W": (4.0, 62.5), "NORWAY_N": (13.0, 69.0),
    "NORTH_CAPE": (25.5, 71.6), "HAMMERFEST": (23.0, 71.25), "MURMANSK": (34.0, 69.5),
    "BARENTS_E": (48.0, 71.5), "KARA_GATES": (58.8, 70.45), "KARA_SEA": (66.0, 72.0),
    "SABETTA": (72.3, 71.4), "ICELAND_S": (-20.0, 62.5), "REYKJAVIK": (-22.3, 64.1),
    # North Atlantic / North America
    "NATL_E": (-15.0, 47.0), "NATL_C": (-35.0, 45.0), "NATL_W": (-55.0, 42.0),
    "NOVA_SCOTIA": (-63.5, 43.8), "SAINT_JOHN": (-66.1, 45.1), "NY_APP": (-73.3, 40.2),
    "DELAWARE": (-74.7, 38.7), "CHESAPEAKE": (-75.6, 36.9), "HATTERAS": (-74.8, 35.0),
    "FLORIDA_E": (-79.7, 26.5), "FLORIDA_STRAIT": (-80.8, 24.0), "GULF_MEX_E": (-85.0, 25.5),
    "USG_HOUSTON": (-94.6, 28.8), "USG_CORPUS": (-96.9, 27.6), "SABINE": (-93.8, 29.4),
    "LOOP": (-90.0, 28.8), "MOBILE": (-88.1, 29.9), "YUCATAN": (-85.9, 21.8),
    "GULF_MEX_S": (-92.0, 21.0), "VERACRUZ": (-95.9, 19.3), "DOS_BOCAS": (-93.2, 18.6),
    "CAMPECHE": (-92.3, 19.8), "TAMPICO": (-97.5, 22.3),
    # Caribbean / South America
    "CARIB_NW": (-80.0, 17.5), "CARIB_C": (-74.0, 14.5), "CARIB_E": (-66.0, 14.0),
    "WINDWARD": (-73.8, 20.0), "MONA": (-67.7, 18.25), "ANEGADA": (-64.0, 18.4),
    "CARIB_SE": (-62.5, 11.6), "DRAGON": (-61.8, 10.75), "TTO_PORT": (-61.95, 10.35),
    "CURACAO": (-69.2, 12.55), "VEN_JOSE": (-65.2, 10.4), "COVENAS": (-75.9, 9.7),
    "PUERTO_BOLIVAR": (-72.0, 12.4), "PANAMA_ATL": (-79.9, 9.5), "PANAMA_PAC": (-79.5, 8.7),
    "JAMAICA": (-76.8, 17.6), "DOM_REP": (-69.6, 18.2), "PUERTO_RICO": (-66.5, 17.8),
    "CUBA_N": (-81.5, 23.25), "CENTAM_ATL": (-87.0, 16.8),
    "GUYANA_OFF": (-57.0, 7.8), "AMAZON_OFF": (-47.0, 2.5), "BRAZIL_NE": (-34.5, -5.5),
    "BRAZIL_E": (-37.5, -14.0), "CAMPOS": (-40.0, -22.5), "SANTOS": (-45.0, -25.0),
    "RIO_PLATA": (-54.6, -35.2), "BAHIA_BLANCA": (-61.5, -39.3), "ARG_PATAGONIA": (-62.0, -46.0),
    "DRAKE": (-66.0, -57.5), "CHILE_S": (-77.0, -50.0), "CHILE_C": (-74.0, -38.0),
    "QUINTERO": (-71.7, -32.8), "CHILE_N": (-71.0, -23.1), "CALLAO": (-77.4, -12.1),
    "PERU_LNG": (-76.5, -13.25), "TALARA": (-81.5, -4.6), "ESMERALDAS": (-79.9, 1.2),
    "PANAMA_PAC_OFF": (-79.5, 7.0), "GUAT_PAC": (-91.0, 13.5), "MEX_PAC": (-104.5, 18.0),
    "LA": (-118.8, 33.45), "SF": (-123.2, 37.6), "JUAN_DE_FUCA": (-124.9, 48.4),
    "VANCOUVER": (-123.35, 49.15), "ALASKA_S": (-150.0, 58.5),
    # Mid-ocean Atlantic connectors
    "ATL_MID_N": (-40.0, 30.0), "ATL_MID": (-40.0, 18.0), "ATL_EQ": (-25.0, 0.0),
    "CANARIES": (-19.5, 29.5), "CAPE_VERDE": (-20.5, 13.5), "DAKAR": (-17.6, 14.5),
    "WAF_1": (-15.0, 8.0), "WAF_CIV": (-4.0, 4.5), "TEMA": (0.0, 5.3), "LAGOS": (3.4, 6.1),
    "FORCADOS": (5.1, 5.1), "BONNY": (7.1, 4.0), "BIOKO": (8.7, 3.95), "KRIBI": (9.7, 2.8),
    "GULF_GUINEA": (3.0, 1.0), "GABON_OFF": (8.5, -0.8), "DJENO": (11.55, -5.0),
    "SOYO": (11.8, -6.5), "LUANDA": (12.9, -8.8), "ANGOLA_S": (11.5, -12.0),
    "WALVIS": (14.2, -22.9), "SE_ATL": (12.0, -30.0), "CAPE_TOWN": (18.2, -33.9),
    # Coastal detours added after land-mask validation
    "WA_W": (112.0, -25.0),
    "NAMIBIA_N": (11.5, -18.5),
    "AZUERO_S": (-80.5, 6.6),
    "CENTAM_PAC": (-86.5, 9.0),
    "LIBERIA_OFF": (-11.5, 5.2),
    "CAPE_PALMAS": (-7.7, 3.9),
    "EASTERN_CAPE_OFF": (29.3, -32.8),
    "ALGOA_OFF": (25.5, -35.0),
    "CAPE_MENDOCINO_OFF": (-125.2, 40.4),
    "PT_CONCEPTION_OFF": (-121.2, 34.1),
    "NSW_N_OFF": (154.2, -29.5),
    "GUARDAFUI": (52.5, 11.8),
    "ARG_E_OFF": (-56.0, -38.5),
    "EIGHT_DEG": (73.3, 7.7),
    "CAPE_HOWE_OFF": (150.5, -38.0),
    "RECIFE_OFF": (-34.0, -9.0),
    "ESTACA_OFF": (-7.8, 44.2),
    "HORN_W": (-72.5, -56.0),
    "SANRIKU_OFF": (142.8, 39.5),
    "TSUGARU_E": (141.8, 41.5),
    "ECU_OFF": (-81.5, -1.0),
    "OTWAY_OFF": (143.5, -39.3),
    "LIGURIAN": (7.5, 43.4),
    "CYRENAICA_OFF": (21.0, 33.6),
    "LINDESNES_OFF": (6.8, 57.6),
    "LUZON_W": (119.3, 16.5),
    "FLORES_SEA": (120.0, -7.3),
    "CHILE_NC_OFF": (-72.2, -28.0),
    "HAINAN_S": (109.5, 17.6),
    "ECS_JP": (127.8, 31.3),
    "NIGER_DELTA_OFF": (6.2, 3.9),
    "TUNISIA_N_OFF": (10.0, 37.6),
    "CAPE_SABLE_OFF": (-66.2, 42.9),
    "FUNDY": (-66.6, 44.3),
    "SARDINIA_S": (9.0, 38.5),
    "NZ_NORTH_CAPE": (172.8, -33.9),
    "YUCATAN_N": (-88.5, 22.6),
    "PERU_N_OFF": (-81.8, -7.0),
    "MANIPA": (127.55, -3.3),
    "OBI_W": (126.8, -1.6),
    "TIMOR_E": (127.6, -9.0),
    "ADRIATIC_N": (13.2, 44.7),
    "SHIONO_OFF": (135.8, 33.1),
    "CAPE_3PTS_OFF": (-2.0, 4.3),
    "ARAKAN_OFF": (92.5, 19.0),
    "NEGRAIS_OFF": (93.6, 15.9),
    "PEMBA_E": (40.2, -5.2),
    "SOUNION_OFF": (24.0, 37.55),
    "CRETE_W": (23.0, 35.6),
    "KAFIREAS": (24.7, 37.95),
    "SAN_BLAS_OFF": (-78.5, 10.0),
    "BAJA_OFF": (-116.5, 27.0),
    "GALLE_OFF": (80.0, 5.8),
    "SOLOMON_NE": (162.0, -5.0),
    "CREUS_OFF": (3.8, 42.2),
    "HORSBURGH": (104.45, 1.3),
    "RED_SEA_NE": (36.3, 25.3),
    "HEL_OFF": (19.0, 54.9),
    "MISS_DELTA_OFF": (-89.0, 28.9),
    "MORANT_OFF": (-75.9, 17.7),
    "BIJAGOS_OFF": (-17.3, 11.0),
    "COMOROS_N": (44.0, -10.8),
    "SPARTEL_OFF": (-6.3, 35.9),
    "RISHIRI_W": (140.5, 45.4),
    "GATA_OFF": (-2.0, 36.5),
    "VANISL_OFF": (-128.5, 49.5),
    "BIOKO_E": (9.2, 3.6),
    "GABON_S_OFF": (9.2, -3.0),
    "PECHORA_SEA": (53.0, 70.1),
    "NORDKINN_OFF": (28.5, 71.5),
    "VARDO_OFF": (32.0, 70.6),
    "PROVENCE_OFF": (6.3, 42.8),
    "BALI_SEA": (116.0, -7.8),
    "CABO_ROJO_OFF": (-67.4, 17.75),
    "OSUMI": (130.8, 30.8),
    "PARACAS_OFF": (-77.0, -14.5),
    "CAPE_BRETT_OFF": (174.6, -34.9),
    "CAPE_GOOD_HOPE": (18.3, -35.3), "SOUTH_ATL": (-15.0, -25.0), "MAURITANIA": (-17.5, 19.8),
    # Smaller ports added so every trading country has a seaport or gateway
    "DURRES_OFF": (19.2, 41.3), "VENTSPILS": (21.1, 57.5), "BARBADOS": (-59.8, 12.9),
    "ST_VINCENT_PASSAGE": (-61.1, 13.55), "PARAMARIBO_OFF": (-55.2, 6.3), "SUVA": (178.4, -18.4),
    "MAJURO": (171.2, 7.3), "KUANTAN": (103.6, 3.9),
}

# Chokepoint tags: node or canal edge -> chokepoint id (matches data/chokepoints).
NODE_CHOKEPOINT = {
    "HORMUZ": "hormuz", "MALACCA_C": "malacca", "BAB_EL_MANDEB": "bab_el_mandeb",
    "GIBRALTAR": "gibraltar", "BOSPHORUS": "bosporus", "DARDANELLES": "dardanelles",
    "GREAT_BELT": "danish_straits", "CAPE_GOOD_HOPE": "cape_good_hope", "DOVER": "dover",
    "TAIWAN_STRAIT": "taiwan_strait", "LUZON_STRAIT": "luzon_strait", "LOMBOK": "lombok",
    "SUNDA": "sunda", "MAKASSAR_S": "makassar", "KOREA_STRAIT": "korea_strait",
    "TSUGARU": "tsugaru", "YUCATAN": "yucatan", "WINDWARD": "windward", "MONA": "mona",
    "TORRES": "torres", "OMBAI": "ombai", "BALABAC": "balabac", "MINDORO": "mindoro",
}
CANAL_CHOKEPOINT = {("SUEZ_S", "PORT_SAID"): "suez", ("PANAMA_ATL", "PANAMA_PAC"): "panama"}

# Undirected edges: (a, b, kind). Canal/strait edges may carry intermediate points.
_SEA = """
PG_BASRA-PG_NW PG_KUWAIT-PG_NW PG_KHARG-PG_NW PG_NW-PG_RAS_TANURA PG_NW-PG_C
PG_RAS_TANURA-PG_BAHRAIN PG_RAS_TANURA-PG_C PG_BAHRAIN-PG_RAS_LAFFAN PG_C-PG_RAS_LAFFAN
PG_C-PG_E PG_RAS_LAFFAN-PG_DAS PG_DAS-PG_E PG_E-HORMUZ HORMUZ-GULF_OMAN GULF_OMAN-FUJAIRAH
GULF_OMAN-JASK GULF_OMAN-RAS_AL_HADD JASK-ARABIAN_N GULF_OMAN-OMAN_QALHAT
OMAN_QALHAT-RAS_AL_HADD RAS_AL_HADD-ARABIAN_N RAS_AL_HADD-SOCOTRA_E RAS_AL_HADD-IO_W
ARABIAN_N-KARACHI ARABIAN_N-KUTCH ARABIAN_N-MUMBAI ARABIAN_N-IND_SW ARABIAN_N-SOCOTRA_E
KARACHI-KUTCH KUTCH-MUMBAI MUMBAI-IND_SW IND_SW-KOCHI KOCHI-COMORIN COMORIN-SRI_LANKA_S
COLOMBO-COMORIN SRI_LANKA_S-BENGAL_S SRI_LANKA_S-SIX_DEGREE SRI_LANKA_S-IO_CE BENGAL_S-CHENNAI
BENGAL_S-PARADIP PARADIP-HALDIA PARADIP-CHITTAGONG MYANMAR_OFF-SIX_DEGREE BENGAL_S-SIX_DEGREE
SIX_DEGREE-MALACCA_N MALACCA_N-MALACCA_C MALACCA_C-MALACCA_S MALACCA_S-SGP_PORT
SGP_PORT-SINGAPORE SCS_SW-SCS_S SCS_SW-THAI_GULF_C SCS_S-THAI_GULF_C THAI_GULF_C-THAI_GULF_N
SCS_S-VUNG_TAU VUNG_TAU-SCS_C SCS_S-SCS_C SCS_C-SCS_N SCS_C-HAINAN_E HAINAN_E-SCS_N HAINAN_E-PRD
SCS_N-PRD SCS_N-TAIWAN_STRAIT SCS_N-LUZON_STRAIT SCS_N-KAOHSIUNG SCS_S-SCS_BINTULU
SCS_BINTULU-SCS_BRUNEI SCS_BRUNEI-BALABAC SCS_BRUNEI-SCS_C SCS_SW-SCS_BINTULU SCS_C-MANILA_W
MANILA_W-BATANGAS MANILA_W-MINDORO BALABAC-SULU SULU-MINDORO SULU-SIBUTU SIBUTU-CELEBES
SIBUTU-MAKASSAR_N LUZON_STRAIT-TAIWAN_E LUZON_STRAIT-PHIL_SEA_C LUZON_STRAIT-PHIL_SEA_N
LUZON_STRAIT-KAOHSIUNG TAIWAN_STRAIT-KAOHSIUNG TAIWAN_STRAIT-TAICHUNG TAIWAN_STRAIT-ECS_S
TAIWAN_E-ECS_S TAIWAN_E-PHIL_SEA_N ECS_S-NINGBO NINGBO-SHANGHAI NINGBO-YELLOW_S
SHANGHAI-YELLOW_S YELLOW_S-QINGDAO YELLOW_S-YELLOW_N YELLOW_N-BOHAI_STRAIT YELLOW_N-DALIAN
BOHAI_STRAIT-TIANJIN YELLOW_S-KOREA_SW KOREA_SW-INCHEON KOREA_SW-YEOSU YEOSU-KOREA_STRAIT
YELLOW_N-INCHEON ECS_S-KYUSHU_S YELLOW_S-KOREA_STRAIT KOREA_STRAIT-ULSAN
KOREA_STRAIT-SEA_JAPAN_S KYUSHU_S-SHIKOKU_S KYUSHU_S-PHIL_SEA_N SHIKOKU_S-KII TOKYO_APP-PAC_W_JP
TOKYO_APP-JAPAN_E JAPAN_E-PAC_NW PAC_W_JP-JAPAN_E SEA_JAPAN_S-SEA_JAPAN_C SEA_JAPAN_C-KOZMINO
SEA_JAPAN_S-KOZMINO LA_PEROUSE-SAKHALIN ULSAN-SEA_JAPAN_S PHIL_SEA_N-PAC_W_JP
PHIL_SEA_N-SHIKOKU_S PHIL_SEA_C-PHIL_SEA_N PHIL_SEA_C-MINDANAO_SE PHIL_SEA_C-PAC_W_EQ
PAC_W_JP-PAC_WC PAC_W_JP-PAC_NW PAC_NW-PAC_N PAC_N-PAC_NE PAC_N-ALASKA_S PAC_NE-SF
PAC_NE-JUAN_DE_FUCA PAC_WC-PAC_CENTRAL PAC_CENTRAL-EPAC_1 PAC_CENTRAL-LA PAC_CENTRAL-PAC_NE
PAC_WC-PAC_NW PAC_W_EQ-PAC_WC PAC_W_EQ-SPAC_2 SPAC_2-PAC_CENTRAL SPAC_2-SPAC_1 SPAC_1-CALLAO
SPAC_1-TALARA SPAC_1-PANAMA_PAC_OFF PAC_EQ_W-PAC_W_EQ PAC_EQ_W-BISMARCK_N PAC_EQ_W-PHIL_SEA_C
BISMARCK_N-PHIL_SEA_C CELEBES-MINDANAO_SE CELEBES-MAKASSAR_N MOLUCCA-MINDANAO_SE
SERAM_SEA-TANGGUH MAKASSAR_N-BONTANG MAKASSAR_N-MAKASSAR_S MAKASSAR_S-BALIKPAPAN
MAKASSAR_S-LOMBOK MAKASSAR_S-JAVA_SEA MAKASSAR_S-BANJARMASIN BANJARMASIN-JAVA_SEA
JAVA_SEA-KARIMATA JAVA_SEA-JAKARTA KARIMATA-SCS_SW SUNDA-IO_SE LOMBOK-BALI_S BALI_S-OFF_NW
BALI_S-IO_SE TIMOR_SEA-DARWIN TIMOR_SEA-OFF_NW TIMOR_SEA-ARAFURA ARAFURA-TORRES TORRES-CORAL_N
CORAL_N-PNG_PORT CORAL_N-GLADSTONE CORAL_N-HAY_POINT OFF_NW-DAMPIER OFF_NW-IO_SE
FREMANTLE-AUS_SW AUS_SW-AUS_S MELBOURNE-BASS_STRAIT SYDNEY-NEWCASTLE_AU BRISBANE-QLD_OFF
QLD_OFF-GLADSTONE QLD_OFF-HAY_POINT QLD_OFF-CORAL_E CORAL_E-JOMARD SYDNEY-TASMAN
NEWCASTLE_AU-TASMAN BRISBANE-NOUMEA NOUMEA-QLD_OFF AUS_SW-IO_SW3 IO_SE-IO_CE IO_SE-AUS_SW
IO_CE-SIX_DEGREE IO_CE-IO_W IO_CE-IO_SW1 IO_W-SOCOTRA_E IO_W-SOMALIA_OFF IO_W-IO_SW1
IO_SW1-IO_SW2 IO_SW2-IO_SW3 IO_SW2-MAURITIUS IO_SW2-TOAMASINA IO_SW3-AGULHAS IO_SW3-DURBAN
SOCOTRA_E-GULF_ADEN SOMALIA_OFF-MOMBASA GULF_ADEN-ADEN ADEN-DJIBOUTI ADEN-BAB_EL_MANDEB
DAR-MOZ_CHANNEL_N MOZ_CHANNEL_N-CABO_DELGADO MOZ_CHANNEL_N-MOZ_CHANNEL_C MOZ_CHANNEL_C-BEIRA
MOZ_CHANNEL_C-MOZ_CHANNEL_S MOZ_CHANNEL_S-MAPUTO MOZ_CHANNEL_S-RICHARDS_BAY RICHARDS_BAY-DURBAN
AGULHAS-CAPE_GOOD_HOPE MOZ_CHANNEL_S-IO_SW3 TOAMASINA-MAURITIUS BAB_EL_MANDEB-RED_SEA_S
RED_SEA_S-RED_SEA_C RED_SEA_C-PORT_SUDAN RED_SEA_C-JEDDAH RED_SEA_C-YANBU RED_SEA_C-RED_SEA_N
RED_SEA_N-GULF_SUEZ_S GULF_SUEZ_S-SUEZ_S PORT_SAID-EMED_SE EMED_SE-ISRAEL_OFF EMED_SE-IDKU
EMED_SE-CYPRUS_S EMED_SE-EMED_C ISRAEL_OFF-LEVANT_N LEVANT_N-CYPRUS_S LEVANT_N-CEYHAN
CYPRUS_S-EMED_C IDKU-EMED_C EMED_C-CRETE_S CRETE_S-IONIAN CRETE_S-MALTA AEGEAN_C-AEGEAN_N
BLACK_SEA_SW-BURGAS BLACK_SEA_SW-CONSTANTA BLACK_SEA_SW-BLACK_SEA_C CONSTANTA-ODESA
BLACK_SEA_C-ODESA BLACK_SEA_C-NOVOROSSIYSK BLACK_SEA_C-SUPSA NOVOROSSIYSK-SUPSA IONIAN-OTRANTO
OTRANTO-ADRIATIC_C IONIAN-AUGUSTA IONIAN-MALTA AUGUSTA-MALTA MALTA-SICILY_CH
MALTA-LIBYA_ES_SIDER MALTA-MELLITAH SICILY_CH-MELLITAH SICILY_CH-TYRRHENIAN TYRRHENIAN-GENOA
FOS-BALEARIC BARCELONA-BALEARIC BALEARIC-ALGERIA_OFF BALEARIC-CARTAGENA_ES SKIKDA-ALGERIA_OFF
ALGERIA_OFF-CARTAGENA_ES ALGERIA_OFF-ARZEW ARZEW-ALBORAN ALBORAN-GIBRALTAR GIBRALTAR-ALGECIRAS
GIBRALTAR-ST_VINCENT ST_VINCENT-HUELVA ST_VINCENT-SINES ST_VINCENT-LISBON_OFF SINES-LISBON_OFF
LISBON_OFF-FINISTERRE FINISTERRE-BISCAY BILBAO-BISCAY BISCAY-USHANT USHANT-CHANNEL_W
USHANT-CELTIC CHANNEL_W-CHANNEL_C CHANNEL_C-LE_HAVRE CHANNEL_C-DOVER DOVER-DUNKIRK DOVER-NSEA_S
DUNKIRK-ZEEBRUGGE ZEEBRUGGE-NSEA_S NSEA_S-ROTTERDAM NSEA_S-THAMES NSEA_S-NSEA_C ROTTERDAM-NSEA_C
NSEA_C-TEES NSEA_C-ELBE ELBE-WILHELMSHAVEN NSEA_C-SKAGEN NSEA_C-NSEA_N NSEA_N-MONGSTAD
NSEA_N-KARSTO NSEA_N-NORWAY_W SKAGEN-BROFJORDEN SKAGEN-KATTEGAT BALTIC_SW-BORNHOLM
BORNHOLM-BALTIC_C BALTIC_C-KLAIPEDA BALTIC_C-GOTLAND_N GOTLAND_N-GULF_FINLAND_W
GULF_FINLAND_W-PALDISKI GULF_FINLAND_W-PORVOO PORVOO-PRIMORSK PORVOO-UST_LUGA PALDISKI-PORVOO
NORWAY_W-NORWAY_N NORWAY_N-HAMMERFEST HAMMERFEST-NORTH_CAPE MURMANSK-BARENTS_E
NORTH_CAPE-BARENTS_E NORWAY_W-ICELAND_S ICELAND_S-NATL_C CELTIC-MILFORD CELTIC-CORK
CELTIC-NATL_E USHANT-NATL_E BISCAY-NATL_E FINISTERRE-NATL_E NATL_E-NATL_C NATL_C-NATL_W
NATL_W-NOVA_SCOTIA NATL_W-NY_APP NOVA_SCOTIA-NY_APP NY_APP-DELAWARE DELAWARE-CHESAPEAKE
CHESAPEAKE-HATTERAS HATTERAS-FLORIDA_E HATTERAS-NATL_W HATTERAS-ATL_MID_N
FLORIDA_E-FLORIDA_STRAIT FLORIDA_STRAIT-GULF_MEX_E FLORIDA_STRAIT-CUBA_N GULF_MEX_E-LOOP
GULF_MEX_E-MOBILE GULF_MEX_E-YUCATAN LOOP-SABINE SABINE-USG_HOUSTON USG_HOUSTON-USG_CORPUS
USG_CORPUS-TAMPICO TAMPICO-VERACRUZ USG_HOUSTON-GULF_MEX_S LOOP-GULF_MEX_S GULF_MEX_S-CAMPECHE
GULF_MEX_S-VERACRUZ CAMPECHE-DOS_BOCAS DOS_BOCAS-VERACRUZ YUCATAN-CARIB_NW YUCATAN-CENTAM_ATL
CENTAM_ATL-CARIB_NW CARIB_NW-JAMAICA CARIB_NW-PANAMA_ATL CARIB_NW-CARIB_C JAMAICA-CARIB_C
WINDWARD-ATL_MID_N CARIB_C-PANAMA_ATL CARIB_C-COVENAS CARIB_C-PUERTO_BOLIVAR CARIB_C-CURACAO
CARIB_C-CARIB_E CARIB_C-DOM_REP DOM_REP-MONA MONA-ATL_MID_N CARIB_E-PUERTO_RICO CARIB_E-ANEGADA
ANEGADA-ATL_MID_N ANEGADA-ATL_MID CARIB_E-CARIB_SE CARIB_SE-DRAGON CARIB_SE-ATL_MID
CURACAO-VEN_JOSE GUYANA_OFF-AMAZON_OFF GUYANA_OFF-ATL_MID AMAZON_OFF-BRAZIL_NE AMAZON_OFF-ATL_EQ
BRAZIL_NE-ATL_EQ BRAZIL_E-CAMPOS BRAZIL_E-SOUTH_ATL CAMPOS-SANTOS SANTOS-RIO_PLATA
SANTOS-SOUTH_ATL BAHIA_BLANCA-ARG_PATAGONIA ARG_PATAGONIA-DRAKE CHILE_S-CHILE_C CHILE_C-QUINTERO
CALLAO-PERU_LNG ESMERALDAS-PANAMA_PAC_OFF PANAMA_PAC-PANAMA_PAC_OFF GUAT_PAC-MEX_PAC
MEX_PAC-EPAC_1 CHILE_N-SPAC_1 QUINTERO-SPAC_1 ATL_MID_N-ATL_MID ATL_MID_N-NATL_C
ATL_MID_N-CANARIES ATL_MID-CAPE_VERDE ATL_MID-ATL_EQ ATL_MID_N-NATL_W CANARIES-CAPE_VERDE
CANARIES-MAURITANIA MAURITANIA-DAKAR CAPE_VERDE-DAKAR CAPE_VERDE-WAF_1 WAF_1-ATL_EQ TEMA-LAGOS
LAGOS-FORCADOS BONNY-BIOKO KRIBI-GABON_OFF WAF_CIV-GULF_GUINEA TEMA-GULF_GUINEA
LAGOS-GULF_GUINEA BONNY-GULF_GUINEA GULF_GUINEA-GABON_OFF GULF_GUINEA-ATL_EQ DJENO-SOYO
SOYO-LUANDA LUANDA-ANGOLA_S ANGOLA_S-SOUTH_ATL WALVIS-SE_ATL SE_ATL-CAPE_TOWN
CAPE_TOWN-CAPE_GOOD_HOPE SE_ATL-CAPE_GOOD_HOPE SE_ATL-SOUTH_ATL ATL_EQ-SOUTH_ATL
GULF_GUINEA-SOUTH_ATL CANARIES-ST_VINCENT CANARIES-LISBON_OFF KATTEGAT-BROFJORDEN OFF_NW-WA_W
WA_W-FREMANTLE ANGOLA_S-NAMIBIA_N NAMIBIA_N-WALVIS PANAMA_PAC_OFF-AZUERO_S AZUERO_S-CENTAM_PAC
CENTAM_PAC-GUAT_PAC WAF_1-LIBERIA_OFF LIBERIA_OFF-CAPE_PALMAS CAPE_PALMAS-WAF_CIV
DURBAN-EASTERN_CAPE_OFF EASTERN_CAPE_OFF-ALGOA_OFF ALGOA_OFF-AGULHAS LA-PT_CONCEPTION_OFF
PT_CONCEPTION_OFF-SF SF-CAPE_MENDOCINO_OFF CAPE_MENDOCINO_OFF-JUAN_DE_FUCA
NEWCASTLE_AU-NSW_N_OFF NSW_N_OFF-BRISBANE SOMALIA_OFF-GUARDAFUI GUARDAFUI-GULF_ADEN
RIO_PLATA-ARG_E_OFF ARG_E_OFF-BAHIA_BLANCA ARABIAN_N-EIGHT_DEG IND_SW-EIGHT_DEG IO_W-EIGHT_DEG
EIGHT_DEG-SRI_LANKA_S BASS_STRAIT-CAPE_HOWE_OFF CAPE_HOWE_OFF-SYDNEY BRAZIL_NE-RECIFE_OFF
RECIFE_OFF-BRAZIL_E FINISTERRE-ESTACA_OFF ESTACA_OFF-BILBAO DRAKE-HORN_W HORN_W-CHILE_S
JAPAN_E-SANRIKU_OFF SANRIKU_OFF-TSUGARU_E TSUGARU_E-PAC_NW TALARA-ECU_OFF ECU_OFF-ESMERALDAS
AUS_S-OTWAY_OFF OTWAY_OFF-MELBOURNE GENOA-LIGURIAN CRETE_S-CYRENAICA_OFF
CYRENAICA_OFF-LIBYA_ES_SIDER KARSTO-LINDESNES_OFF LINDESNES_OFF-SKAGEN MANILA_W-LUZON_W
LUZON_W-LUZON_STRAIT BANDA_SEA-FLORES_SEA FLORES_SEA-MAKASSAR_S QUINTERO-CHILE_NC_OFF
CHILE_NC_OFF-CHILE_N HAINAN_E-HAINAN_S HAINAN_S-VN_NORTH KOREA_STRAIT-ECS_JP ECS_JP-ECS_S
FORCADOS-NIGER_DELTA_OFF NIGER_DELTA_OFF-BONNY SICILY_CH-TUNISIA_N_OFF TUNISIA_N_OFF-SKIKDA
TUNISIA_N_OFF-ALGERIA_OFF NOVA_SCOTIA-CAPE_SABLE_OFF TYRRHENIAN-SARDINIA_S SARDINIA_S-BALEARIC
SARDINIA_S-TUNISIA_N_OFF TASMAN-NZ_NORTH_CAPE GULF_MEX_S-YUCATAN_N YUCATAN_N-YUCATAN
CALLAO-PERU_N_OFF PERU_N_OFF-TALARA MOLUCCA-OBI_W OBI_W-SERAM_SEA BANDA_SEA-TIMOR_E
TIMOR_E-TIMOR_SEA ADRIATIC_C-ADRIATIC_N ADRIATIC_N-TRIESTE KII-SHIONO_OFF SHIONO_OFF-TOKYO_APP
SHIKOKU_S-SHIONO_OFF WAF_CIV-CAPE_3PTS_OFF CAPE_3PTS_OFF-TEMA CHITTAGONG-ARAKAN_OFF
ARAKAN_OFF-NEGRAIS_OFF NEGRAIS_OFF-MYANMAR_OFF MOMBASA-PEMBA_E PEMBA_E-DAR CRETE_S-CRETE_W
CRETE_W-SOUNION_OFF COVENAS-SAN_BLAS_OFF SAN_BLAS_OFF-PANAMA_ATL EPAC_1-BAJA_OFF BAJA_OFF-LA
COLOMBO-GALLE_OFF GALLE_OFF-SRI_LANKA_S CORAL_E-SOLOMON_EAST SOLOMON_EAST-SOLOMON_NE
SOLOMON_NE-PAC_EQ_W FOS-CREUS_OFF CREUS_OFF-BARCELONA SINGAPORE-HORSBURGH HORSBURGH-SCS_SW
YANBU-RED_SEA_NE RED_SEA_NE-RED_SEA_N BORNHOLM-HEL_OFF HEL_OFF-GDANSK HEL_OFF-BALTIC_C
LOOP-MISS_DELTA_OFF MISS_DELTA_OFF-MOBILE JAMAICA-MORANT_OFF MORANT_OFF-WINDWARD
DAKAR-BIJAGOS_OFF BIJAGOS_OFF-WAF_1 IO_SW1-COMOROS_N COMOROS_N-MOZ_CHANNEL_N
SPARTEL_OFF-CANARIES SPARTEL_OFF-ST_VINCENT SEA_JAPAN_C-RISHIRI_W RISHIRI_W-LA_PEROUSE
CARTAGENA_ES-GATA_OFF GATA_OFF-ALBORAN JUAN_DE_FUCA-VANISL_OFF VANISL_OFF-ALASKA_S BIOKO-BIOKO_E
BIOKO_E-KRIBI GABON_OFF-GABON_S_OFF GABON_S_OFF-DJENO BARENTS_E-PECHORA_SEA
NORTH_CAPE-NORDKINN_OFF NORDKINN_OFF-VARDO_OFF VARDO_OFF-MURMANSK LIGURIAN-PROVENCE_OFF
PROVENCE_OFF-FOS FLORES_SEA-BALI_SEA BALI_SEA-LOMBOK CAPE_SABLE_OFF-FUNDY MONA-CABO_ROJO_OFF
CABO_ROJO_OFF-PUERTO_RICO ECS_JP-OSUMI CHILE_N-PARACAS_OFF PARACAS_OFF-CALLAO
NZ_NORTH_CAPE-CAPE_BRETT_OFF CAPE_BRETT_OFF-NZ_N VANISL_OFF-PAC_N
DURRES_OFF-OTRANTO DURRES_OFF-ADRIATIC_C VENTSPILS-GOTLAND_N VENTSPILS-BALTIC_C BARBADOS-ST_VINCENT_PASSAGE
BARBADOS-ATL_MID ST_VINCENT_PASSAGE-CARIB_E PARAMARIBO_OFF-GUYANA_OFF
SUVA-NOUMEA MAJURO-PAC_W_EQ MAJURO-PAC_EQ_W KUANTAN-SCS_SW KUANTAN-SCS_S
"""

# Narrow straits (exempt from land-mask validation). Optional via-points.
_STRAITS = [
    ("BOSPHORUS", "BLACK_SEA_SW", [(29.1, 41.25)]),
    ("MARMARA", "BOSPHORUS", []),
    ("AEGEAN_N", "DARDANELLES", []),
    ("RED_SEA_N", "AQABA", []),
    ("ADRIATIC_N", "KRK", []),
    ("TSUGARU_E", "TSUGARU", []),
    ("KARA_SEA", "SABETTA", []),
    ("FUNDY", "SAINT_JOHN", []),
    ("OBI_W", "MANIPA", []),
    ("MANIPA", "BANDA_SEA", []),
    ("OMBAI", "BANDA_SEA", []),
    ("KAFIREAS", "SOUNION_OFF", []),
    ("AEGEAN_C", "KAFIREAS", []),
    ("SOUNION_OFF", "PIRAEUS", []),
    ("DJIBOUTI", "BAB_EL_MANDEB", []),
    ("GIBRALTAR", "SPARTEL_OFF", []),
    ("KII", "OSAKA", []),
    ("JAKARTA", "SUNDA", []),
    ("DOVER", "THAMES", []),
    ("BALTIC_SW", "SWINOUJSCIE", []),
    ("ICELAND_S", "REYKJAVIK", []),
    ("TOKYO_APP", "TOKYO", []),
    ("KATTEGAT", "GREAT_BELT", []),
    ("MILFORD", "IRISH_SEA_N", []),
    ("GREAT_BELT", "BALTIC_SW", []),
    ("DARDANELLES", "MARMARA", [(26.7, 40.4)]),
    ("KARA_GATES", "KARA_SEA", []),
    ("PECHORA_SEA", "KARA_GATES", []),
    ("OSUMI", "KYUSHU_S", []),
    ("BATANGAS", "MINDORO", []),
    ("TTO_PORT", "DRAGON", []),
    ("JUAN_DE_FUCA", "VANCOUVER", [(-123.8, 48.3), (-123.2, 48.6)]),
    ("JOMARD", "SOLOMON_SEA", []),
    ("SOLOMON_SEA", "ST_GEORGE", []),
    ("ST_GEORGE", "BISMARCK_N", []),
    ("CORAL_N", "JOMARD", []),
    ("TSUGARU", "SEA_JAPAN_C", []),
    ("SAKHALIN", "LA_PEROUSE", []),
    ("GIBRALTAR", "ALGECIRAS", []),
]
_CANALS = [
    ("SUEZ_S", "PORT_SAID", [(32.55, 29.93), (32.35, 30.6), (32.32, 31.0)]),
    ("PANAMA_ATL", "PANAMA_PAC", [(-79.75, 9.1)]),
]

EDGES: list[tuple[str, str, str, list[tuple[float, float]]]] = []
for tok in _SEA.split():
    a, b = tok.split("-")
    EDGES.append((a, b, "sea", []))
for a, b, via in _STRAITS:
    EDGES.append((a, b, "strait", via))
for a, b, via in _CANALS:
    EDGES.append((a, b, "canal", via))


# --------------------------------------------------------------------------------------
# Terminals: where a country's seaborne trade enters/leaves the network.
# Each: (node, label, commodities or None for all, overland leg from country interior)
# The overland leg is drawn as a pipeline/rail segment for gateways outside the country.
# --------------------------------------------------------------------------------------
EXPORT_TERMINALS: dict[str, list[dict]] = {
    "SAU": [{"node": "PG_RAS_TANURA", "label": "Ras Tanura / Ju'aymah"},
            {"node": "YANBU", "label": "Yanbu (East–West pipeline)", "only": ["crude", "products"]}],
    "IRQ": [{"node": "PG_BASRA", "label": "Basrah Oil Terminal"},
            {"node": "CEYHAN", "label": "Ceyhan (Kirkuk–Ceyhan pipeline)", "only": ["crude"],
             "overland": [(44.4, 35.5), (42.0, 37.0), (37.5, 37.0), (35.9, 36.9)]}],
    "KWT": [{"node": "PG_KUWAIT", "label": "Mina al-Ahmadi"}],
    "ARE": [{"node": "PG_DAS", "label": "Das Island / Ruwais"},
            {"node": "FUJAIRAH", "label": "Fujairah (ADCOP pipeline)", "only": ["crude", "products"]}],
    "QAT": [{"node": "PG_RAS_LAFFAN", "label": "Ras Laffan"}],
    "BHR": [{"node": "PG_BAHRAIN", "label": "Sitra"}],
    "IRN": [{"node": "PG_KHARG", "label": "Kharg Island"}, {"node": "JASK", "label": "Jask", "only": ["crude"]}],
    "OMN": [{"node": "OMAN_QALHAT", "label": "Mina al Fahal / Qalhat"}],
    "YEM": [{"node": "ADEN", "label": "Aden"}],
    "RUS": [{"node": "PRIMORSK", "label": "Primorsk / Ust-Luga"},
            {"node": "NOVOROSSIYSK", "label": "Novorossiysk"},
            {"node": "KOZMINO", "label": "Kozmino (ESPO)"},
            {"node": "MURMANSK", "label": "Murmansk"},
            {"node": "SABETTA", "label": "Sabetta (Yamal LNG)", "only": ["lng"]},
            {"node": "SAKHALIN", "label": "Prigorodnoye (Sakhalin)", "only": ["lng", "crude"]}],
    "KAZ": [{"node": "NOVOROSSIYSK", "label": "CPC terminal, Novorossiysk", "only": ["crude"],
             "overland": [(53.4, 46.1), (47.9, 46.4), (41.0, 45.3), (37.8, 44.7)]},
            {"node": "UST_LUGA", "label": "Ust-Luga (rail via Russia)", "only": ["coal", "products", "rare_earths"],
             "overland": [(75.3, 51.7), (61.4, 55.2), (49.1, 55.8), (37.6, 55.75), (28.3, 59.7)]},
            {"node": "NOVOROSSIYSK", "label": "Novorossiysk / Taman (rail via Russia)", "only": ["coal", "products", "rare_earths"],
             "overland": [(75.3, 51.7), (61.4, 55.2), (50.1, 53.2), (44.5, 48.7), (39.7, 47.2), (37.8, 44.7)]}],
    "AZE": [{"node": "CEYHAN", "label": "Ceyhan (BTC pipeline)",
             "overland": [(49.9, 40.4), (44.8, 41.7), (41.0, 39.9), (35.9, 36.9)]},
            {"node": "SUPSA", "label": "Supsa", "only": ["products"]}],
    "TKM": [{"node": "SUPSA", "label": "Batumi (Caspian ferry & rail)",
             "overland": [(53.0, 40.0), (49.9, 40.4), (44.8, 41.7), (41.65, 41.65)]},
            {"node": "HORMUZ", "label": "Bandar Abbas (rail via Iran)",
             "overland": [(58.4, 37.95), (59.6, 36.3), (56.3, 27.2)]},
            {"node": "CEYHAN", "label": "via BTC", "only": ["crude"],
             "overland": [(53.0, 39.5), (49.9, 40.4), (44.8, 41.7), (35.9, 36.9)]}],
    "NOR": [{"node": "MONGSTAD", "label": "Mongstad / Sture"}, {"node": "HAMMERFEST", "label": "Hammerfest LNG", "only": ["lng"]},
            {"node": "KARSTO", "label": "Kårstø", "only": ["products"]}],
    "GBR": [{"node": "TEES", "label": "Teesside"}, {"node": "THAMES", "label": "Thames", "only": ["products"]}],
    "NLD": [{"node": "ROTTERDAM", "label": "Rotterdam"}],
    "BEL": [{"node": "ZEEBRUGGE", "label": "Antwerp"}],
    "DEU": [{"node": "ELBE", "label": "Hamburg"}],
    "FRA": [{"node": "LE_HAVRE", "label": "Le Havre"}],
    "ESP": [{"node": "CARTAGENA_ES", "label": "Cartagena"}],
    "ITA": [{"node": "AUGUSTA", "label": "Augusta"}],
    "GRC": [{"node": "PIRAEUS", "label": "Aspropyrgos"}],
    "TUR": [{"node": "CEYHAN", "label": "Ceyhan"}],
    "DNK": [{"node": "KATTEGAT", "label": "Fredericia"}],
    "SWE": [{"node": "BROFJORDEN", "label": "Brofjorden"}],
    "FIN": [{"node": "PORVOO", "label": "Porvoo"}],
    "POL": [{"node": "GDANSK", "label": "Gdańsk"}],
    "LTU": [{"node": "KLAIPEDA", "label": "Klaipėda"}],
    "EST": [{"node": "PALDISKI", "label": "Tallinn"}],
    "PRT": [{"node": "SINES", "label": "Sines"}],
    "ROU": [{"node": "CONSTANTA", "label": "Constanța"}],
    "BGR": [{"node": "BURGAS", "label": "Burgas"}],
    "UKR": [{"node": "ODESA", "label": "Odesa"}],
    "GEO": [{"node": "SUPSA", "label": "Batumi / Supsa"}],
    "USA": [{"node": "USG_HOUSTON", "label": "Houston"}, {"node": "USG_CORPUS", "label": "Corpus Christi"},
            {"node": "SABINE", "label": "Sabine Pass / Cameron", "only": ["lng"]},
            {"node": "LOOP", "label": "Plaquemines / LOOP", "only": ["lng", "crude"]},
            {"node": "CHESAPEAKE", "label": "Hampton Roads / Baltimore", "only": ["coal"]},
            {"node": "LA", "label": "Los Angeles / Long Beach", "only": ["products", "rare_earths"]},
            {"node": "MOBILE", "label": "Mobile", "only": ["coal"]}],
    "CAN": [{"node": "VANCOUVER", "label": "Westshore / Westridge (TMX)"}, {"node": "SAINT_JOHN", "label": "Saint John", "only": ["products", "crude"]},
            {"node": "JUAN_DE_FUCA", "label": "LNG Canada, Kitimat", "only": ["lng"]}],
    "MEX": [{"node": "DOS_BOCAS", "label": "Dos Bocas / Cayo Arcas"}, {"node": "TAMPICO", "label": "Altamira", "only": ["lng", "products"]}],
    "BRA": [{"node": "SANTOS", "label": "Santos / Campos basin"}],
    "GUY": [{"node": "GUYANA_OFF", "label": "Stabroek FPSOs"}],
    "SUR": [{"node": "PARAMARIBO_OFF", "label": "Paramaribo"}],
    "COL": [{"node": "COVENAS", "label": "Coveñas"}, {"node": "PUERTO_BOLIVAR", "label": "Puerto Bolívar", "only": ["coal"]}],
    "ECU": [{"node": "ESMERALDAS", "label": "Esmeraldas / Balao"}],
    "VEN": [{"node": "VEN_JOSE", "label": "Jose terminal"}],
    "TTO": [{"node": "TTO_PORT", "label": "Point Fortin"}],
    "ARG": [{"node": "BAHIA_BLANCA", "label": "Puerto Rosales"}],
    "PER": [{"node": "PERU_LNG", "label": "Pampa Melchorita"}, {"node": "CALLAO", "label": "Callao", "only": ["products", "crude"]}],
    "CHL": [{"node": "QUINTERO", "label": "Quintero"}],
    "NGA": [{"node": "BONNY", "label": "Bonny"}, {"node": "FORCADOS", "label": "Forcados", "only": ["crude"]}],
    "AGO": [{"node": "SOYO", "label": "Soyo / Cabinda"}],
    "GAB": [{"node": "GABON_OFF", "label": "Cap Lopez"}],
    "COG": [{"node": "DJENO", "label": "Djeno"}],
    "GNQ": [{"node": "BIOKO", "label": "Punta Europa"}],
    "CMR": [{"node": "KRIBI", "label": "Kribi"}],
    "TCD": [{"node": "KRIBI", "label": "Kribi (Chad–Cameroon pipeline)", "overland": [(16.5, 8.6), (13.6, 6.5), (9.95, 2.95)]}],
    "NER": [{"node": "LAGOS", "label": "Sèmè (Niger–Benin pipeline)", "overland": [(12.5, 16.0), (4.0, 11.0), (2.6, 6.4)]}],
    "GHA": [{"node": "TEMA", "label": "Jubilee FPSO"}],
    "CIV": [{"node": "WAF_CIV", "label": "Abidjan"}],
    "SEN": [{"node": "DAKAR", "label": "Sangomar FPSO"}],
    "MRT": [{"node": "MAURITANIA", "label": "GTA FLNG"}],
    "LBY": [{"node": "LIBYA_ES_SIDER", "label": "Es Sider / Ras Lanuf"}, {"node": "MELLITAH", "label": "Mellitah / Zawiya"}],
    "DZA": [{"node": "ARZEW", "label": "Arzew"}, {"node": "SKIKDA", "label": "Skikda"}],
    "TUN": [{"node": "SICILY_CH", "label": "La Skhira"}],
    "EGY": [{"node": "IDKU", "label": "Idku / Sidi Kerir"}, {"node": "GULF_SUEZ_S", "label": "Ras Shukeir", "only": ["crude"]}],
    "SDN": [{"node": "PORT_SUDAN", "label": "Port Sudan"}],
    "SSD": [{"node": "PORT_SUDAN", "label": "Port Sudan (via pipeline)", "overland": [(29.6, 9.5), (31.5, 13.0), (34.5, 17.5), (37.2, 19.6)]}],
    "ZAF": [{"node": "RICHARDS_BAY", "label": "Richards Bay"}, {"node": "DURBAN", "label": "Durban", "only": ["products"]}],
    "MOZ": [{"node": "MAPUTO", "label": "Maputo / Matola"}, {"node": "CABO_DELGADO", "label": "Coral Sul FLNG", "only": ["lng"]},
            {"node": "BEIRA", "label": "Nacala / Beira", "only": ["coal"]}],
    "TZA": [{"node": "DAR", "label": "Dar es Salaam"}],
    "KEN": [{"node": "MOMBASA", "label": "Mombasa"}],
    "IND": [{"node": "KUTCH", "label": "Jamnagar / Sikka"}, {"node": "MUMBAI", "label": "Mumbai"}, {"node": "PARADIP", "label": "Paradip"}],
    "PAK": [{"node": "KARACHI", "label": "Karachi"}],
    "LKA": [{"node": "COLOMBO", "label": "Colombo"}],
    "BGD": [{"node": "CHITTAGONG", "label": "Chattogram"}],
    "MMR": [{"node": "MYANMAR_OFF", "label": "Yangon"}],
    "THA": [{"node": "THAI_GULF_N", "label": "Map Ta Phut / Sriracha"}],
    "MYS": [{"node": "SCS_BINTULU", "label": "Bintulu", "only": ["crude", "products", "lng", "coal"]},
            {"node": "MALACCA_S", "label": "Pengerang / Melaka", "only": ["crude", "products"]},
            {"node": "KUANTAN", "label": "Kuantan (Lynas)", "only": ["rare_earths"]},
            {"node": "MALACCA_C", "label": "Port Klang", "only": ["rare_earths"]}],
    "BRN": [{"node": "SCS_BRUNEI", "label": "Lumut / Seria"}],
    "SGP": [{"node": "SGP_PORT", "label": "Jurong Island"}],
    "IDN": [{"node": "BALIKPAPAN", "label": "East Kalimantan"}, {"node": "BANJARMASIN", "label": "South Kalimantan", "only": ["coal"]},
            {"node": "BONTANG", "label": "Bontang", "only": ["lng"]}, {"node": "TANGGUH", "label": "Tangguh", "only": ["lng"]},
            {"node": "SUNDA", "label": "Sumatra", "only": ["coal", "crude"]}],
    "PHL": [{"node": "BATANGAS", "label": "Batangas"}],
    "VNM": [{"node": "VUNG_TAU", "label": "Vũng Tàu"}],
    "CHN": [{"node": "NINGBO", "label": "Ningbo-Zhoushan"}, {"node": "QINGDAO", "label": "Qingdao", "only": ["products"]},
            {"node": "PRD", "label": "Guangdong", "only": ["products", "rare_earths"]},
            {"node": "TIANJIN", "label": "Tianjin (Baotou output)", "only": ["rare_earths"]},
            {"node": "SHANGHAI", "label": "Shanghai", "only": ["rare_earths"]}],
    "HKG": [{"node": "PRD", "label": "Hong Kong"}],
    "TWN": [{"node": "KAOHSIUNG", "label": "Kaohsiung / Mailiao"}],
    "KOR": [{"node": "ULSAN", "label": "Ulsan / Onsan"}, {"node": "YEOSU", "label": "Yeosu", "only": ["products"]}],
    "JPN": [{"node": "TOKYO", "label": "Tokyo Bay"}],
    "PRK": [{"node": "YELLOW_N", "label": "Nampo"}],
    "AUS": [{"node": "DAMPIER", "label": "North West Shelf / Gorgon"}, {"node": "DARWIN", "label": "Darwin / Ichthys", "only": ["lng"]},
            {"node": "GLADSTONE", "label": "Gladstone (QCLNG)", "only": ["lng", "coal"]}, {"node": "HAY_POINT", "label": "Hay Point / Dalrymple Bay", "only": ["coal"]},
            {"node": "NEWCASTLE_AU", "label": "Newcastle", "only": ["coal"]}, {"node": "FREMANTLE", "label": "Kwinana / Fremantle", "only": ["products", "rare_earths"]}],
    "PNG": [{"node": "PNG_PORT", "label": "PNG LNG, Port Moresby"}],
    "NZL": [{"node": "NZ_N", "label": "Marsden Point"}],
    "MNG": [],  # overland only
    "CUB": [{"node": "CUBA_N", "label": "Matanzas"}],
    "DOM": [{"node": "DOM_REP", "label": "Andrés"}],
    "JAM": [{"node": "JAMAICA", "label": "Kingston"}],
    "PAN": [{"node": "PANAMA_ATL", "label": "Colón"}],
    "PRI": [{"node": "PUERTO_RICO", "label": "Peñuelas"}],
    "BHS": [{"node": "FLORIDA_E", "label": "Freeport"}],
    "CUW": [{"node": "CURACAO", "label": "Willemstad"}],
    "ISL": [{"node": "REYKJAVIK", "label": "Reykjavík"}],
    "IRL": [{"node": "CORK", "label": "Whitegate"}],
    "MLT": [{"node": "MALTA", "label": "Delimara"}],
    "ALB": [{"node": "DURRES_OFF", "label": "Durrës / Vlorë"}],
    "MNE": [{"node": "DURRES_OFF", "label": "Bar"}],
    "HRV": [{"node": "KRK", "label": "Rijeka / Omišalj"}],
    "SVN": [{"node": "TRIESTE", "label": "Koper"}],
    "LVA": [{"node": "VENTSPILS", "label": "Ventspils / Riga"}],
    "COD": [{"node": "SOYO", "label": "Muanda / Matadi"}],
    "BRB": [{"node": "BARBADOS", "label": "Bridgetown"}],
    "LCA": [{"node": "ST_VINCENT_PASSAGE", "label": "Castries"}],
    "VCT": [{"node": "ST_VINCENT_PASSAGE", "label": "Kingstown"}],
    "FJI": [{"node": "SUVA", "label": "Suva"}],
    "MHL": [{"node": "MAJURO", "label": "Majuro"}],
    "CYP": [{"node": "CYPRUS_S", "label": "Vasilikos"}],
    "ISR": [{"node": "ISRAEL_OFF", "label": "Ashkelon / Haifa"}],
    "LBN": [{"node": "LEVANT_N", "label": "Beirut"}],
    "SYR": [{"node": "LEVANT_N", "label": "Baniyas"}],
    "JOR": [{"node": "AQABA", "label": "Aqaba"}],
    "DJI": [{"node": "DJIBOUTI", "label": "Djibouti"}],
    "ERI": [{"node": "RED_SEA_S", "label": "Massawa"}],
    "SOM": [{"node": "GULF_ADEN", "label": "Berbera"}],
    "MDG": [{"node": "TOAMASINA", "label": "Toamasina"}],
    "MUS": [{"node": "MAURITIUS", "label": "Port Louis"}],
    "NAM": [{"node": "WALVIS", "label": "Walvis Bay"}],
    "TGO": [{"node": "TEMA", "label": "Lomé"}],
    "BEN": [{"node": "LAGOS", "label": "Cotonou"}],
    "LBR": [{"node": "WAF_CIV", "label": "Monrovia"}],
    "SLE": [{"node": "WAF_1", "label": "Freetown"}],
    "GIN": [{"node": "WAF_1", "label": "Conakry"}],
    "GMB": [{"node": "DAKAR", "label": "Banjul"}],
    "GNB": [{"node": "DAKAR", "label": "Bissau"}],
    "MAR": [{"node": "ALBORAN", "label": "Tanger Med / Mohammedia"}],
    "URY": [{"node": "RIO_PLATA", "label": "José Ignacio"}],
    "CRI": [{"node": "CENTAM_ATL", "label": "Moín"}],
    "GTM": [{"node": "CENTAM_ATL", "label": "Puerto Barrios"}],
    "HND": [{"node": "CENTAM_ATL", "label": "Puerto Cortés"}],
    "SLV": [{"node": "GUAT_PAC", "label": "Acajutla"}],
    "NIC": [{"node": "GUAT_PAC", "label": "Corinto"}],
    "BLZ": [{"node": "CENTAM_ATL", "label": "Belize City"}],
    "HTI": [{"node": "WINDWARD", "label": "Port-au-Prince"}],
    "KHM": [{"node": "THAI_GULF_C", "label": "Sihanoukville"}],
    "NCL": [{"node": "NOUMEA", "label": "Nouméa"}],
    "TLS": [{"node": "OMBAI", "label": "Dili"}],
    "MDV": [{"node": "SRI_LANKA_S", "label": "Malé"}],
}

# Import terminals default to export terminals; overrides for landlocked or dual-coast importers.
IMPORT_TERMINALS: dict[str, list[dict]] = {
    "USA": [{"node": "USG_HOUSTON", "label": "US Gulf Coast"}, {"node": "LA", "label": "US West Coast"},
            {"node": "DELAWARE", "label": "US East Coast"}],
    "CAN": [{"node": "SAINT_JOHN", "label": "Saint John / Québec"}, {"node": "VANCOUVER", "label": "Vancouver"}],
    "MEX": [{"node": "VERACRUZ", "label": "Tuxpan / Veracruz"}, {"node": "MEX_PAC", "label": "Manzanillo"}],
    "IND": [{"node": "KUTCH", "label": "Jamnagar / Vadinar"}, {"node": "PARADIP", "label": "Paradip"},
            {"node": "MUMBAI", "label": "Mumbai"}, {"node": "KOCHI", "label": "Kochi"}, {"node": "CHENNAI", "label": "Chennai / Ennore"}],
    "CHN": [{"node": "NINGBO", "label": "Ningbo-Zhoushan"}, {"node": "QINGDAO", "label": "Qingdao / Rizhao"},
            {"node": "DALIAN", "label": "Dalian"}, {"node": "PRD", "label": "Guangdong"}, {"node": "TIANJIN", "label": "Tianjin"}],
    "JPN": [{"node": "TOKYO", "label": "Tokyo Bay"}, {"node": "OSAKA", "label": "Osaka / Ise Bay"}],
    "KOR": [{"node": "ULSAN", "label": "Ulsan / Onsan"}, {"node": "YEOSU", "label": "Yeosu / Gwangyang"}, {"node": "INCHEON", "label": "Incheon / Daesan"}],
    "TWN": [{"node": "KAOHSIUNG", "label": "Kaohsiung"}, {"node": "TAICHUNG", "label": "Taichung / Mailiao"}],
    "DEU": [{"node": "WILHELMSHAVEN", "label": "Wilhelmshaven"}, {"node": "ROTTERDAM", "label": "via Rotterdam (Rhine)"},
            {"node": "TRIESTE", "label": "Trieste (TAL pipeline)", "only": ["crude"], "overland": [(13.8, 45.65), (12.4, 47.9), (11.43, 48.76)]}],
    "FRA": [{"node": "LE_HAVRE", "label": "Le Havre"}, {"node": "FOS", "label": "Fos-sur-Mer"}, {"node": "DUNKIRK", "label": "Dunkirk"}],
    "ESP": [{"node": "CARTAGENA_ES", "label": "Cartagena"}, {"node": "ALGECIRAS", "label": "Algeciras / Huelva"}, {"node": "BILBAO", "label": "Bilbao"}, {"node": "BARCELONA", "label": "Tarragona / Barcelona"}],
    "ITA": [{"node": "AUGUSTA", "label": "Augusta / Priolo"}, {"node": "TRIESTE", "label": "Trieste (TAL)"}, {"node": "GENOA", "label": "Genoa / Sarroch"}],
    "GBR": [{"node": "MILFORD", "label": "Milford Haven"}, {"node": "THAMES", "label": "Isle of Grain"}, {"node": "TEES", "label": "Teesside"}],
    "TUR": [{"node": "AEGEAN_N", "label": "Aliağa"}, {"node": "MARMARA", "label": "İzmit"}, {"node": "CEYHAN", "label": "Dörtyol / Ceyhan"}],
    "EGY": [{"node": "IDKU", "label": "Damietta / Alexandria"}, {"node": "GULF_SUEZ_S", "label": "Ain Sokhna"}],
    "SAU": [{"node": "YANBU", "label": "Yanbu / Jeddah"}, {"node": "PG_RAS_TANURA", "label": "Ras Tanura"}],
    "ARE": [{"node": "FUJAIRAH", "label": "Fujairah"}, {"node": "PG_DAS", "label": "Ruwais"}],
    # Landlocked Europe: crude arrives by pipeline from Adriatic/Mediterranean terminals; other goods
    # by rail from the North Sea and Adriatic ports, or by Rhine barge to Basel.
    "AUT": [{"node": "TRIESTE", "label": "Trieste (TAL pipeline)", "only": ["crude"], "import_only": True, "overland": [(13.8, 45.65), (14.1, 46.6), (16.4, 48.2)]},
            {"node": "TRIESTE", "label": "via Koper (rail)", "overland": [(13.73, 45.55), (15.4, 47.07), (16.37, 48.2)]},
            {"node": "ELBE", "label": "via Hamburg (rail)", "overland": [(9.95, 53.55), (13.7, 51.05), (14.4, 50.08), (16.37, 48.2)]}],
    "CZE": [{"node": "TRIESTE", "label": "Trieste (TAL + IKL pipelines)", "only": ["crude"], "import_only": True, "overland": [(13.8, 45.65), (12.4, 47.9), (13.9, 50.1)]},
            {"node": "ELBE", "label": "via Hamburg (Elbe rail)", "overland": [(9.95, 53.55), (13.7, 51.05), (14.4, 50.08)]}],
    "CHE": [{"node": "FOS", "label": "Fos (SPSE pipeline)", "only": ["crude"], "import_only": True, "overland": [(4.9, 43.4), (5.7, 45.2), (6.9, 46.8)]},
            {"node": "ROTTERDAM", "label": "via Rotterdam (Rhine barge to Basel)", "overland": [(4.48, 51.9), (6.95, 50.94), (7.59, 47.56), (8.55, 47.37)]},
            {"node": "GENOA", "label": "via Genoa (rail)", "overland": [(8.93, 44.41), (9.2, 45.5), (8.55, 47.37)]}],
    "HUN": [{"node": "KRK", "label": "Omišalj (JANAF pipeline)", "only": ["crude"], "import_only": True, "overland": [(14.55, 45.2), (16.0, 45.8), (19.0, 47.5)]},
            {"node": "TRIESTE", "label": "via Koper (rail)", "overland": [(13.73, 45.55), (15.65, 46.55), (19.04, 47.5)]},
            {"node": "KRK", "label": "via Rijeka (rail)", "overland": [(14.44, 45.33), (16.0, 45.8), (19.04, 47.5)]}],
    "SVK": [{"node": "KRK", "label": "Omišalj (JANAF + Adria)", "only": ["crude"], "import_only": True, "overland": [(14.55, 45.2), (16.0, 45.8), (19.0, 47.5), (17.5, 48.4)]},
            {"node": "TRIESTE", "label": "via Koper (rail)", "overland": [(13.73, 45.55), (15.4, 47.07), (16.37, 48.2), (17.1, 48.15)]}],
    "SRB": [{"node": "KRK", "label": "Omišalj (JANAF pipeline)", "only": ["crude"], "import_only": True, "overland": [(14.55, 45.2), (16.0, 45.8), (20.5, 45.2)]},
            {"node": "KRK", "label": "via Rijeka (rail)", "overland": [(14.44, 45.33), (16.0, 45.8), (20.46, 44.8)]},
            {"node": "DURRES_OFF", "label": "via Bar (Bar–Belgrade railway)", "overland": [(19.1, 42.1), (19.26, 42.44), (20.46, 44.8)]}],
    "HRV": [{"node": "KRK", "label": "Omišalj"}],
    "SVN": [{"node": "TRIESTE", "label": "Koper"}],
    "BIH": [{"node": "KRK", "label": "via Croatia", "overland": [(14.55, 45.2), (17.9, 44.2)]}],
    "MKD": [{"node": "PIRAEUS", "label": "via Thessaloniki", "overland": [(22.9, 40.6), (21.4, 41.9)]}],
    "LUX": [{"node": "ROTTERDAM", "label": "via Antwerp/Rotterdam", "overland": [(4.4, 51.2), (6.1, 49.6)]}],
    "BLR": [{"node": "UST_LUGA", "label": "via Ust-Luga", "overland": [(28.3, 59.7), (29.9, 57.8), (27.6, 53.9)]}],
    "MDA": [{"node": "CONSTANTA", "label": "via Giurgiulești", "overland": [(28.2, 45.45), (28.85, 47.0)]}],
    "ETH": [{"node": "DJIBOUTI", "label": "via Djibouti", "overland": [(42.7, 11.5), (41.8, 9.6), (38.7, 9.0)]}],
    "SSD": [{"node": "MOMBASA", "label": "via Mombasa", "overland": [(39.7, -4.0), (36.8, -1.3), (32.6, 0.3), (31.6, 4.9)]}],
    "UGA": [{"node": "MOMBASA", "label": "via Mombasa", "overland": [(39.7, -4.0), (36.8, -1.3), (32.6, 0.3)]}],
    "RWA": [{"node": "DAR", "label": "via Dar es Salaam", "overland": [(39.3, -6.8), (35.7, -6.2), (30.1, -1.95)]}],
    "BDI": [{"node": "DAR", "label": "via Dar es Salaam", "overland": [(39.3, -6.8), (35.7, -6.2), (29.4, -3.4)]}],
    "ZMB": [{"node": "DAR", "label": "via Dar es Salaam (TAZAMA)", "overland": [(39.3, -6.8), (33.5, -9.0), (28.6, -13.0)]}],
    "MWI": [{"node": "BEIRA", "label": "via Beira / Nacala", "overland": [(34.85, -19.8), (34.3, -15.8)]}],
    "ZWE": [{"node": "BEIRA", "label": "via Beira (Feruka pipeline)", "overland": [(34.85, -19.8), (32.7, -18.95), (31.05, -17.8)]}],
    "BWA": [{"node": "DURBAN", "label": "via Durban", "overland": [(31.05, -29.85), (28.0, -26.2), (25.9, -24.65)]}],
    "LSO": [{"node": "DURBAN", "label": "via Durban", "overland": [(31.05, -29.85), (27.5, -29.3)]}],
    "SWZ": [{"node": "MAPUTO", "label": "via Maputo", "overland": [(32.6, -25.95), (31.1, -26.3)]}],
    "MLI": [{"node": "DAKAR", "label": "via Dakar", "overland": [(-17.4, 14.7), (-11.4, 14.4), (-8.0, 12.65)]}],
    "BFA": [{"node": "WAF_CIV", "label": "via Abidjan", "overland": [(-4.0, 5.3), (-4.3, 11.2), (-1.5, 12.35)]}],
    "NER": [{"node": "LAGOS", "label": "via Cotonou", "overland": [(2.4, 6.4), (2.5, 12.0), (2.1, 13.5)]}],
    "TCD": [{"node": "KRIBI", "label": "via Douala", "overland": [(9.7, 4.05), (15.0, 12.1)]}],
    "CAF": [{"node": "KRIBI", "label": "via Douala", "overland": [(9.7, 4.05), (18.55, 4.4)]}],
    "PRY": [{"node": "RIO_PLATA", "label": "via Paraná river", "overland": [(-58.4, -34.6), (-57.6, -25.3)]}],
    "BOL": [{"node": "CHILE_N", "label": "via Arica", "overland": [(-70.3, -18.5), (-68.15, -16.5)]}],
    "AFG": [{"node": "KARACHI", "label": "via Karachi", "overland": [(67.0, 24.9), (66.0, 30.2), (69.2, 34.5)]}],
    "NPL": [{"node": "HALDIA", "label": "via Haldia", "overland": [(88.1, 22.0), (85.3, 27.7)]}],
    "BTN": [{"node": "HALDIA", "label": "via Kolkata", "overland": [(88.1, 22.0), (89.6, 27.5)]}],
    "LAO": [{"node": "THAI_GULF_N", "label": "via Thailand", "overland": [(100.9, 13.1), (102.6, 17.97)]}],
    "MNG": [{"node": "TIANJIN", "label": "via Tianjin", "overland": [(117.7, 39.0), (111.9, 43.6), (106.9, 47.9)]}],
    # Central Asia: the Middle Corridor (Caspian ferry, Baku, rail to Poti) or rail through Iran to Bandar Abbas.
    "UZB": [{"node": "SUPSA", "label": "via Caspian ferry & Poti", "overland": [(41.67, 42.15), (44.8, 41.7), (49.9, 40.4), (53.0, 40.0), (63.6, 39.1), (66.96, 39.65), (69.3, 41.3)]},
            {"node": "HORMUZ", "label": "via Bandar Abbas", "overland": [(56.3, 27.2), (59.6, 36.3), (61.2, 36.5), (63.6, 39.1), (66.96, 39.65), (69.3, 41.3)]}],
    "TJK": [{"node": "SUPSA", "label": "via Caspian ferry & Poti", "overland": [(41.67, 42.15), (44.8, 41.7), (49.9, 40.4), (53.0, 40.0), (63.6, 39.1), (66.96, 39.65), (68.8, 38.55)]},
            {"node": "HORMUZ", "label": "via Bandar Abbas", "overland": [(56.3, 27.2), (59.6, 36.3), (61.2, 36.5), (63.6, 39.1), (66.96, 39.65), (68.8, 38.55)]}],
    "KGZ": [{"node": "SUPSA", "label": "via Caspian ferry & Poti", "overland": [(41.67, 42.15), (44.8, 41.7), (49.9, 40.4), (53.0, 40.0), (63.6, 39.1), (66.96, 39.65), (69.3, 41.3), (74.6, 42.9)]},
            {"node": "HORMUZ", "label": "via Bandar Abbas", "overland": [(56.3, 27.2), (59.6, 36.3), (61.2, 36.5), (63.6, 39.1), (66.96, 39.65), (69.3, 41.3), (74.6, 42.9)]}],
    "ARM": [{"node": "SUPSA", "label": "via Poti", "overland": [(41.67, 42.15), (44.8, 41.7), (44.5, 40.2)]}],
}

# Exporters whose tankers kept using the Red Sea during the 2024–25 Houthi campaign
# (EIA: Bab el-Mandeb flows fell ~55% but not to zero — mostly Russian, Saudi and Iranian cargoes).
RED_SEA_TOLERANT = {"RUS", "SAU", "IRN", "EGY", "SDN", "JOR", "ISR", "ERI", "DJI", "YEM", "IRQ", "KAZ", "AZE"}
RED_SEA_PENALTY_NM = 9000   # effectively forces Cape of Good Hope routing for everyone else
PANAMA_LNG_PENALTY_NM = 12000  # US LNG largely avoided Panama in 2024–25 (EIA: <0.3 Bcf/d FY25)
PANAMA_CRUDE_PENALTY_NM = 12000  # VLCCs cannot transit; EIA: only ~0.1 mb/d of crude uses the canal
PANAMA_OUTSIDE_AMERICAS_PENALTY_NM = 12000  # Asia–Europe services never use the canal; in 2024–25 they went round the Cape
CANAL_FEE_NM = 250          # time/fees equivalent so canals are used only when clearly shorter


def haversine_nm(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 3440.065 * math.asin(min(1.0, math.sqrt(h)))


def polyline_nm(points: list[tuple[float, float]]) -> float:
    return sum(haversine_nm(points[i], points[i + 1]) for i in range(len(points) - 1))


def _edge_points(a: str, b: str, via: list[tuple[float, float]]) -> list[tuple[float, float]]:
    return [NODES[a], *via, NODES[b]]


@lru_cache(maxsize=None)
def _adjacency() -> dict[str, list[tuple[str, float, str, tuple]]]:
    adj: dict[str, list] = {n: [] for n in NODES}
    for a, b, kind, via in EDGES:
        if a not in NODES or b not in NODES:
            raise KeyError(f"edge {a}-{b} references unknown node")
        pts = _edge_points(a, b, via)
        dist = polyline_nm(pts)
        adj[a].append((b, dist, kind, tuple(pts)))
        adj[b].append((a, dist, kind, tuple(reversed(pts))))
    return adj


def _edge_cost(a: str, b: str, dist: float, kind: str, profile: dict) -> float:
    cost = dist
    if kind == "canal":
        cost += CANAL_FEE_NM
        if {a, b} == {"PANAMA_ATL", "PANAMA_PAC"} and profile.get("commodity") == "lng":
            cost += PANAMA_LNG_PENALTY_NM
        if {a, b} == {"PANAMA_ATL", "PANAMA_PAC"} and profile.get("commodity") == "crude":
            cost += PANAMA_CRUDE_PENALTY_NM
        if {a, b} == {"PANAMA_ATL", "PANAMA_PAC"} and profile.get("avoid_panama"):
            cost += PANAMA_OUTSIDE_AMERICAS_PENALTY_NM
    if profile.get("avoid_red_sea") and "BAB_EL_MANDEB" in (a, b):
        cost += RED_SEA_PENALTY_NM
    for node in profile.get("closed", ()):
        if node in (a, b):
            cost += 1e7
    return cost


def shortest_path(src: str, dst: str, profile: dict | None = None) -> tuple[float, list[str]]:
    """Dijkstra over the sea graph. Returns (distance_nm, node list)."""
    profile = profile or {}
    adj = _adjacency()
    dist = {src: 0.0}
    real = {src: 0.0}
    prev: dict[str, str] = {}
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == dst:
            break
        if d > dist.get(u, math.inf):
            continue
        for v, w, kind, _ in adj[u]:
            nd = d + _edge_cost(u, v, w, kind, profile)
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                real[v] = real[u] + w
                prev[v] = u
                heapq.heappush(heap, (nd, v))
    if dst not in dist:
        return math.inf, []
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    path.reverse()
    return real[dst], path


def path_geometry(path: list[str]) -> list[tuple[float, float]]:
    """Expand a node path into coordinates, including canal/strait via-points."""
    if not path:
        return []
    adj = _adjacency()
    coords = [NODES[path[0]]]
    for u, v in zip(path, path[1:]):
        for w, _, _, pts in adj[u]:
            if w == v:
                coords.extend(pts[1:])
                break
    return coords


def path_chokepoints(path: list[str]) -> list[str]:
    found: list[str] = []
    for node in path:
        cp = NODE_CHOKEPOINT.get(node)
        if cp and cp not in found:
            found.append(cp)
    for u, v in zip(path, path[1:]):
        cp = CANAL_CHOKEPOINT.get((u, v)) or CANAL_CHOKEPOINT.get((v, u))
        if cp and cp not in found:
            found.append(cp)
    return found
