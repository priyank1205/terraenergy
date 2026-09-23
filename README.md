# ⚡ TerraEnergy: Global Energy Supply, Demand & Flow Map

**TerraEnergy** is a lightweight, high-performance interactive web application that acts as the definitive one-stop product for visualizing global energy supply, demand, and bilateral trade flows across **Crude Oil & Refined Products**, **Natural Gas & LNG**, **Coal**, and **Clean Energy**.

Built with an ultra-responsive dark cyber-cartography interface inspired by Bloomberg Terminal and modern geospatial tools, it delivers sub-second load times with zero external database dependencies.

---

## 🚀 Quick Start

### 1. Launch the Application
Simply start the lightweight local server using Python or npm:

```bash
# Using npm
npm start

# Or using Python directly
python3 scripts/test_server.py 3000

# Or standard HTTP server
python3 -m http.server 3000
```

Open your browser and navigate to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🌟 Key Features

### 1. Interactive 2D Flat Map & 3D Spinning Globe
- **2D Cartographic View**: Natural Earth / Equal-area projection showing all global trade corridors without distortion or clipping.
- **3D Interactive Globe**: Orthographic projection with spherical rotation, mouse-drag inertial rotation, and an auto-rotate toggle.
- **High-DPI Canvas Rendering**: Silky-smooth 60 FPS performance on Retina / 4K displays.

### 2. Animated Geodesic Trade Flow Engine
- Real-time particle animation streaming along geodesic curves from exporting nations to importing nations.
- Speed and particle density proportional to trade volume.
- Color-coded commodity arteries:
  - 🛢️ **Oil & Petroleum Liquids**: Golden Amber (`#f59e0b`)
  - 🔥 **Natural Gas & LNG**: Electric Cyan (`#06b6d4`)
  - ⛏️ **Coal & Solid Fuels**: Steel Charcoal (`#94a3b8`)
- **Global Arteries Mode**: Visualizes the world's most critical energy trade corridors simultaneously.

### 3. Country Intelligence Profiles (Inflows & Outflows)
Click any country on the map or search via the autocomplete search bar to inspect:
- **Daily Non-Renewable Balance Cards**:
  - **Oil**: Daily Consumption (b/d & kb/d) vs Daily Production (b/d & kb/d) with self-sufficiency ratio and net surplus/deficit status.
  - **Natural Gas**: Daily Consumption (Bcf/d or bcm/y) vs Production.
  - **Coal**: Consumption vs Production (Mt/y).
  - **Total Primary Energy**: Annual TWh, per capita ranking, electricity generation, and GHG emissions.
- **Supply Origins (Where it gets its supply from - Imports)**:
  - Visual breakdown of top supplier nations, exact shipment volumes, transport type (Pipeline vs Tanker), and % share of total imports.
  - Interactive click to jump directly to any supplier!
- **Supply Destinations (Where it supplies energy to - Exports)**:
  - Active for producing/exporting nations, highlighting destination customers and volumes.
- **Interactive Energy Mix Donut Chart**:
  - Complete primary energy breakdown: Oil, Natural Gas, Coal, Nuclear, Hydro, Solar & Wind, Biofuels.
- **Historical Trajectory (2000–2024)**:
  - Multi-decade sparkline trends for oil and gas supply and demand.

### 4. Strategic Maritime Chokepoints
Click any of the world's critical maritime bottlenecks to filter and highlight transiting energy routes:
- **Strait of Hormuz** (~20.5M b/d oil + >20% global LNG)
- **Strait of Malacca** (~16M b/d)
- **Suez Canal & SUMED Pipeline** (~8.8M b/d)
- **Bab-el-Mandeb** (~7.1M b/d)
- **Turkish Straits (Bosphorus/Dardanelles)** (~3.5M b/d)
- **Panama Canal** (~1.5M b/d & major US-Asia LNG artery)
- **Danish Straits** (~3.2M b/d Baltic outlet)

### 5. Choropleth Heatmap Overlays
Color countries worldwide by:
- Oil Daily Consumption
- Oil Daily Production
- Natural Gas Consumption
- Natural Gas Production
- Coal Consumption
- Clean & Low-Carbon Share (%)
- Net Balance (Green = Net Exporter, Orange = Net Importer)

### 6. Country Side-by-Side Comparison Tool
Compare any two countries side-by-side (e.g., United States vs. China, Saudi Arabia vs. Russia, Germany vs. France) with comparative energy balances and bilateral trade relations.

### 7. Unit Converter
Toggle instantly across the whole UI between:
- **Daily Units**: Barrels per Day (`b/d`, `kb/d`) and Billion Cubic Feet per Day (`Bcf/d`)
- **Annual Physical Units**: Million Tonnes (`Mt/y`) and Billion Cubic Metres (`bcm/y`)
- **Energy Units**: Terawatt-hours (`TWh`)

---

## 📊 Data Sources & Compilation Pipeline

The data is compiled from the latest, authoritative global energy reports:
1. **Energy Institute (EI) Statistical Review of World Energy (2024/2025 Edition)** (the global industry standard, formerly BP Statistical Review).
2. **OPEC Annual Statistical Bulletin 2024** (Table 5.1 & 5.2 Crude Oil Exports by Destination).
3. **Ember Global Electricity Review 2024**.
4. **U.S. Energy Information Administration (EIA) International Energy Statistics**.

### To Recompile or Update the Data:
Run the automated Python pipeline:
```bash
python3 scripts/build_energy_db.py
```
This processes `owid-energy-data.csv` and compiles the complete `public/data/energy_db.json` in under 2 seconds.

---

## 📁 Project Structure

```
world energy map/
├── index.html                   # Modern responsive entry point
├── package.json                 # Project scripts and metadata
├── README.md                    # Documentation
├── scripts/
│   ├── build_energy_db.py       # Python pipeline compiling raw OWID & trade data
│   └── test_server.py           # HTTP server with auto MIME-types
├── public/
│   └── data/
│       ├── world-110m.json      # Optimized World GeoJSON geometry (177 countries)
│       └── energy_db.json       # Consolidated 2024 energy database (220 countries, 186 flows)
└── src/
    ├── app.js                   # Master coordinator & state management
    ├── map-engine.js            # Dual 2D/3D projection, canvas flow particles, choropleth
    ├── ui-panel.js              # Country drawer, inflows/outflows, charts, comparisons
    ├── chokepoints.js           # Strategic maritime bottlenecks dataset & filters
    └── styles.css               # Bloomberg-style dark glassmorphism theme
```

---

## 🛡️ License
MIT License. Data subject to terms of the Energy Institute and original source providers.
