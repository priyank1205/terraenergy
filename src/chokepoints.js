/**
 * src/chokepoints.js
 * Strategic maritime energy transit bottlenecks and chokepoints.
 */

export const STRATEGIC_CHOKEPOINTS = [
  {
    id: "hormuz",
    name: "Strait of Hormuz",
    coords: [56.25, 26.56],
    oil_kbd: 20500,
    gas_bcm: 105,
    share_global_oil: "21%",
    description: "The world's most critical oil transit chokepoint. Carries ~20.5M b/d of crude and petroleum liquids from Saudi Arabia, UAE, Iraq, Kuwait, and Qatar, plus >20% of global LNG trade.",
    affected_countries: ["SAU", "ARE", "IRQ", "KWT", "QAT", "IRN", "BHR", "OMN"],
    affected_routes: [
      "SAU_CHN_oil", "SAU_IND_oil", "SAU_JPN_oil", "SAU_KOR_oil", "SAU_TWN_oil", "SAU_SGP_oil",
      "IRQ_CHN_oil", "IRQ_IND_oil", "IRQ_KOR_oil", "IRQ_USA_oil",
      "ARE_JPN_oil", "ARE_IND_oil", "ARE_CHN_oil", "ARE_KOR_oil", "ARE_THA_oil", "ARE_SGP_oil",
      "KWT_CHN_oil", "KWT_JPN_oil", "KWT_KOR_oil", "KWT_IND_oil", "KWT_VNM_oil",
      "QAT_CHN_gas_lng", "QAT_IND_gas_lng", "QAT_KOR_gas_lng", "QAT_JPN_gas_lng", "QAT_TWN_gas_lng",
      "QAT_PAK_gas_lng", "QAT_ITA_gas_lng", "QAT_GBR_gas_lng", "QAT_BEL_gas_lng", "QAT_KWT_gas_lng"
    ]
  },
  {
    id: "malacca",
    name: "Strait of Malacca",
    coords: [102.89, 1.43],
    oil_kbd: 16000,
    gas_bcm: 55,
    share_global_oil: "16%",
    description: "Primary maritime route between the Indian Ocean and East Asia. Crucial corridor for Middle Eastern and African crude destined for China, Japan, South Korea, and Taiwan.",
    affected_countries: ["MYS", "SGP", "IDN", "CHN", "JPN", "KOR", "TWN"],
    affected_routes: [
      "SAU_CHN_oil", "SAU_JPN_oil", "SAU_KOR_oil", "SAU_TWN_oil",
      "IRQ_CHN_oil", "IRQ_KOR_oil",
      "ARE_JPN_oil", "ARE_CHN_oil", "ARE_KOR_oil",
      "KWT_CHN_oil", "KWT_JPN_oil", "KWT_KOR_oil", "KWT_VNM_oil",
      "AGO_CHN_oil", "NGA_IDN_oil",
      "QAT_CHN_gas_lng", "QAT_JPN_gas_lng", "QAT_KOR_gas_lng", "QAT_TWN_gas_lng"
    ]
  },
  {
    id: "suez",
    name: "Suez Canal & SUMED",
    coords: [32.57, 30.58],
    oil_kbd: 8800,
    gas_bcm: 32,
    share_global_oil: "9%",
    description: "Key transit link between Red Sea and Mediterranean for Persian Gulf oil heading to Europe, and Russian / US flows heading east.",
    affected_countries: ["EGY", "SAU", "RUS", "IND", "CHN", "ITA", "NLD"],
    affected_routes: [
      "SAU_EGY_oil", "SAU_NLD_oil", "SAU_ESP_oil", "SAU_POL_oil",
      "QAT_ITA_gas_lng", "QAT_GBR_gas_lng", "QAT_BEL_gas_lng",
      "RUS_IND_oil", "RUS_CHN_oil"
    ]
  },
  {
    id: "bab_el_mandeb",
    name: "Bab-el-Mandeb",
    coords: [43.33, 12.58],
    oil_kbd: 7100,
    gas_bcm: 28,
    share_global_oil: "7%",
    description: "Strategic chokepoint between Horn of Africa and the Arabian Peninsula connecting the Gulf of Aden to the Red Sea.",
    affected_countries: ["YEM", "DJI", "SAU", "EGY"],
    affected_routes: [
      "SAU_EGY_oil", "SAU_NLD_oil", "SAU_ESP_oil",
      "QAT_ITA_gas_lng", "QAT_GBR_gas_lng", "QAT_BEL_gas_lng"
    ]
  },
  {
    id: "bosphorus",
    name: "Turkish Straits (Bosphorus)",
    coords: [29.08, 41.12],
    oil_kbd: 3500,
    gas_bcm: 15,
    share_global_oil: "4%",
    description: "Connects the Black Sea to the Mediterranean. Critical outlet for Kazakh CPC crude and Russian oil and coal shipments.",
    affected_countries: ["TUR", "RUS", "KAZ", "AZE", "ROU", "BGR"],
    affected_routes: [
      "KAZ_ITA_oil", "KAZ_FRA_oil", "KAZ_TUR_oil",
      "RUS_TUR_oil", "RUS_IND_oil",
      "RUS_TUR_coal", "COL_TUR_coal"
    ]
  },
  {
    id: "panama",
    name: "Panama Canal",
    coords: [-79.68, 9.08],
    oil_kbd: 1500,
    gas_bcm: 30,
    share_global_oil: "2%",
    description: "Crucial for US Gulf Coast LNG, LPG, and refined product exports transiting to Asian and Pacific Latin American markets.",
    affected_countries: ["PAN", "USA", "CHL", "JPN", "KOR"],
    affected_routes: [
      "USA_JPN_gas_lng", "USA_KOR_gas_lng",
      "COL_PAN_oil", "GUY_PAN_oil",
      "TTO_CHL_gas_lng"
    ]
  },
  {
    id: "danish",
    name: "Danish Straits",
    coords: [11.10, 55.67],
    oil_kbd: 3200,
    gas_bcm: 8,
    share_global_oil: "3%",
    description: "Baltic Sea outlet connecting Russian Primorsk and Ust-Luga crude shipments and Scandinavian energy routes to the North Sea.",
    affected_countries: ["DNK", "SWE", "RUS", "NOR", "POL"],
    affected_routes: [
      "RUS_IND_oil", "RUS_TUR_oil", "RUS_BRA_oil",
      "NOR_POL_gas_pipe"
    ]
  }
];
