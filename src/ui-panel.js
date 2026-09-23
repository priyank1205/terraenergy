/**
 * src/ui-panel.js (100x Upgrade)
 * Intelligence Drawer with Inflow/Outflow direction toggles, Route Inspector Cards,
 * Time Machine Playhead (2000-2024), and Quick Jump Chips.
 */

import { STRATEGIC_CHOKEPOINTS } from "./chokepoints.js";

export class UIPanel {
  constructor(options) {
    this.energyDb = null;
    this.currentUnit = "daily"; // 'daily', 'annual', 'energy'
    this.activeDrawerTab = "overview";
    this.selectedIso = null;
    this.currentYear = 2024;
    this.isPlayingTimeline = false;
    this.timelineInterval = null;

    // Callbacks
    this.onSelectCountry = options.onSelectCountry || (() => {});
    this.onChokepointClick = options.onChokepointClick || (() => {});
    this.onFlowDirectionChange = options.onFlowDirectionChange || (() => {});
    this.onYearChange = options.onYearChange || (() => {});

    // DOM Elements
    this.drawer = document.getElementById("country-drawer");
    this.drawerHeader = document.getElementById("drawer-header-content");
    this.drawerTabs = document.querySelectorAll(".drawer-tab");
    this.drawerBody = document.getElementById("drawer-body-content");
    this.drawerCloseBtn = document.getElementById("drawer-close-btn");

    this.searchInput = document.getElementById("search-input");
    this.searchDropdown = document.getElementById("search-dropdown");
    this.unitSelect = document.getElementById("unit-select");
    this.compareModal = document.getElementById("compare-modal");
    this.routeInspector = document.getElementById("route-inspector");

    this.initEvents();
  }

  setDatabase(db) {
    this.energyDb = db;
    this.renderPulseBar();
    this.renderChokepoints();
    this.initSearchIndex();
    this.renderQuickChips();
    this.initTimeMachine();
  }

  setUnit(unit) {
    this.currentUnit = unit;
    if (this.selectedIso) {
      this.renderCountryDetails(this.selectedIso);
    }
  }

  setYear(year) {
    this.currentYear = parseInt(year);
    const yrDisplay = document.getElementById("current-year-display");
    if (yrDisplay) yrDisplay.innerText = this.currentYear;

    const slider = document.getElementById("time-slider");
    if (slider) slider.value = this.currentYear;

    this.renderPulseBar();
    if (this.selectedIso) {
      this.renderCountryDetails(this.selectedIso);
    }
    this.onYearChange(this.currentYear);
  }

  /* ========================================================================
     Time Machine Playhead Controller (2000 - 2024)
     ======================================================================== */
  initTimeMachine() {
    const playBtn = document.getElementById("time-play-btn");
    const slider = document.getElementById("time-slider");
    const years = [2000, 2005, 2010, 2015, 2020, 2022, 2023, 2024];

    if (slider) {
      slider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value);
        // Snap to nearest milestone year
        const closest = years.reduce((prev, curr) => Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
        this.setYear(closest);
      });
    }

    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (this.isPlayingTimeline) {
          this.stopTimeline();
        } else {
          this.startTimeline(years);
        }
      });
    }
  }

  startTimeline(years) {
    this.isPlayingTimeline = true;
    const playBtn = document.getElementById("time-play-btn");
    if (playBtn) {
      playBtn.innerText = "⏸ Pause";
      playBtn.classList.add("active");
    }

    let currentIndex = years.indexOf(this.currentYear);
    if (currentIndex < 0 || currentIndex === years.length - 1) currentIndex = 0;

    this.timelineInterval = setInterval(() => {
      currentIndex = (currentIndex + 1) % years.length;
      this.setYear(years[currentIndex]);
      if (currentIndex === years.length - 1) {
        // finished loop
        setTimeout(() => this.stopTimeline(), 2500);
      }
    }, 1800);
  }

  stopTimeline() {
    this.isPlayingTimeline = false;
    clearInterval(this.timelineInterval);
    const playBtn = document.getElementById("time-play-btn");
    if (playBtn) {
      playBtn.innerText = "▶ Play Timeline";
      playBtn.classList.remove("active");
    }
  }

  /* ========================================================================
     Quick Country Chips Navigation
     ======================================================================== */
  renderQuickChips() {
    const container = document.getElementById("quick-chips-container");
    if (!container || !this.energyDb) return;
    container.innerHTML = "";

    const featured = [
      { iso: "USA", name: "United States", icon: "🇺🇸" },
      { iso: "CHN", name: "China", icon: "🇨🇳" },
      { iso: "SAU", name: "Saudi Arabia", icon: "🇸🇦" },
      { iso: "IND", name: "India", icon: "🇮🇳" },
      { iso: "RUS", name: "Russia", icon: "🇷🇺" },
      { iso: "DEU", name: "Germany", icon: "🇩🇪" },
      { iso: "BRA", name: "Brazil", icon: "🇧🇷" },
      { iso: "NGA", name: "Nigeria", icon: "🇳🇬" },
      { iso: "SGP", name: "Singapore", icon: "🇸🇬" },
      { iso: "ZAF", name: "South Africa", icon: "🇿🇦" },
      { iso: "QAT", name: "Qatar", icon: "🇶🇦" },
      { iso: "AUS", name: "Australia", icon: "🇦🇺" },
      { iso: "NOR", name: "Norway", icon: "🇳🇴" },
      { iso: "JPN", name: "Japan", icon: "🇯🇵" }
    ];

    featured.forEach(c => {
      const chip = document.createElement("button");
      chip.className = "quick-country-chip";
      chip.setAttribute("data-iso", c.iso);
      chip.innerHTML = `<span>${c.icon}</span> <span>${c.name}</span>`;
      chip.addEventListener("click", () => {
        this.onSelectCountry(c.iso);
      });
      container.appendChild(chip);
    });
  }

  updateActiveChip(iso) {
    document.querySelectorAll(".quick-country-chip").forEach(chip => {
      chip.classList.toggle("active", chip.getAttribute("data-iso") === iso);
    });
  }

  /* ========================================================================
     Global Pulse Bar & Chokepoints
     ======================================================================== */
  renderPulseBar() {
    if (!this.energyDb) return;
    const totals = this.energyDb.global_totals;

    const oilVal = document.getElementById("pulse-oil-val");
    const gasVal = document.getElementById("pulse-gas-val");
    const coalVal = document.getElementById("pulse-coal-val");

    if (oilVal) oilVal.innerHTML = `${(totals.oil_consumption_kbd / 1000).toFixed(1)}M <span class="pulse-stat-unit">b/d</span>`;
    if (gasVal) gasVal.innerHTML = `${totals.gas_consumption_bcm.toLocaleString()} <span class="pulse-stat-unit">bcm/y</span>`;
    if (coalVal) coalVal.innerHTML = `${totals.coal_consumption_mt.toLocaleString()} <span class="pulse-stat-unit">Mt/y</span>`;
  }

  renderChokepoints() {
    const container = document.getElementById("chokepoints-list");
    if (!container) return;
    container.innerHTML = "";

    STRATEGIC_CHOKEPOINTS.forEach(cp => {
      const pill = document.createElement("button");
      pill.className = "chokepoint-pill";
      pill.setAttribute("data-cp-id", cp.id);
      pill.innerHTML = `📍 ${cp.name} <span style="opacity: 0.65; font-size: 10px;">(${(cp.oil_kbd / 1000).toFixed(1)}M b/d)</span>`;
      pill.title = cp.description;
      pill.addEventListener("click", () => {
        const isActive = pill.classList.contains("active");
        document.querySelectorAll(".chokepoint-pill").forEach(p => p.classList.remove("active"));
        if (!isActive) {
          pill.classList.add("active");
          this.onChokepointClick(cp);
        } else {
          this.onChokepointClick(null);
        }
      });
      container.appendChild(pill);
    });
  }

  /* ========================================================================
     Search Autocomplete
     ======================================================================== */
  initSearchIndex() {
    if (!this.searchInput || !this.searchDropdown) return;

    this.searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim().toLowerCase();
      if (!query || !this.energyDb) {
        this.searchDropdown.style.display = "none";
        return;
      }

      const matches = Object.values(this.energyDb.countries)
        .filter(c => c.name.toLowerCase().includes(query) || c.iso.toLowerCase().includes(query))
        .slice(0, 8);

      if (matches.length === 0) {
        this.searchDropdown.style.display = "none";
        return;
      }

      this.searchDropdown.innerHTML = "";
      matches.forEach(c => {
        const item = document.createElement("div");
        item.className = "search-item";
        item.innerHTML = `
          <div class="search-item-title">
            <span>${c.flag || "🌐"}</span>
            <span>${c.name}</span>
            <span class="country-code-pill">${c.iso}</span>
          </div>
          <div class="search-item-meta">
            ${c.metrics.oil.cons_kbd > 0 ? (c.metrics.oil.cons_kbd / 1000).toFixed(1) + "M b/d" : ""}
          </div>
        `;
        item.addEventListener("click", () => {
          this.searchInput.value = c.name;
          this.searchDropdown.style.display = "none";
          this.onSelectCountry(c.iso);
        });
        this.searchDropdown.appendChild(item);
      });
      this.searchDropdown.style.display = "block";
    });

    document.addEventListener("click", (e) => {
      if (!this.searchInput.contains(e.target) && !this.searchDropdown.contains(e.target)) {
        this.searchDropdown.style.display = "none";
      }
    });
  }

  /* ========================================================================
     Route Inspector Card (Maritime & Pipeline details)
     ======================================================================== */
  showRouteInspector(flow, clientX, clientY, pinned = false) {
    if (!this.routeInspector) return;

    if (!flow) {
      if (!pinned) this.routeInspector.style.display = "none";
      return;
    }

    const isPipeline = flow.transport === "pipeline";
    const modeIcon = isPipeline ? "⚡ Subsea/Overland Pipeline" : "🚢 Maritime Tanker Sea-Lane";
    const volStr = flow.commodity === "oil" ? `${flow.volume_kbd.toLocaleString()} kb/d (~${(flow.volume_kbd / 1000).toFixed(2)}M bpd)` :
                   flow.commodity.startsWith("gas") ? `${flow.volume_bcfd} Bcf/d (${flow.volume_bcm} bcm/y)` :
                   `${flow.volume_mt} Mt/y`;

    const chokepointsHtml = flow.chokepoints && flow.chokepoints.length > 0
      ? `<div style="margin-top: 5px; font-size: 11px; color: #fbbf24;">📍 Transits: <strong>${flow.chokepoints.map(c => c.toUpperCase()).join(", ")}</strong></div>`
      : "";

    const seaStatsHtml = !isPipeline && flow.distance_nm > 0
      ? `<div style="display: flex; gap: 12px; font-size: 11px; color: var(--text-dim); margin-top: 4px;">
           <span>Nautical Distance: <strong>${flow.distance_nm.toLocaleString()} NM</strong></span>
           <span>Estimated Transit: <strong>~${flow.transit_days} days</strong></span>
         </div>`
      : "";

    this.routeInspector.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-accent); letter-spacing: 0.5px;">
            ${modeIcon}
          </div>
          <div style="font-size: 14px; font-weight: 700; color: #fff; margin-top: 2px;">
            ${flow.label || (flow.from_name + " → " + flow.to_name)}
          </div>
        </div>
        <div class="country-code-pill">${flow.from} ➔ ${flow.to}</div>
      </div>

      <div style="margin-top: 8px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px;">
        <div style="display: flex; justify-content: space-between; font-size: 12px;">
          <span style="color: var(--text-muted);">Throughput Volume:</span>
          <span style="font-weight: 700; color: #38bdf8;">${volStr}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 3px;">
          <span style="color: var(--text-dim);">Primary Carrier / Class:</span>
          <span style="color: #fff;">${flow.vessel_class}</span>
        </div>
      </div>

      ${chokepointsHtml}
      ${seaStatsHtml}
    `;

    // Position near cursor
    const pad = 20;
    let x = clientX + pad;
    let y = clientY + pad;

    if (x + 320 > window.innerWidth) x = clientX - 330;
    if (y + 180 > window.innerHeight) y = clientY - 190;

    this.routeInspector.style.left = `${Math.max(10, x)}px`;
    this.routeInspector.style.top = `${Math.max(10, y)}px`;
    this.routeInspector.style.display = "block";
  }

  /* ========================================================================
     Country Intelligence Drawer Rendering
     ======================================================================== */
  openCountry(iso) {
    this.selectedIso = iso;
    this.updateActiveChip(iso);
    if (!this.energyDb || !this.energyDb.countries[iso]) {
      this.drawer.classList.remove("open");
      return;
    }
    this.drawer.classList.add("open");
    this.renderCountryDetails(iso);
  }

  closeDrawer() {
    this.selectedIso = null;
    this.updateActiveChip(null);
    this.drawer.classList.remove("open");
    this.onSelectCountry(null);
  }

  renderCountryDetails(iso) {
    const country = this.energyDb.countries[iso];
    if (!country) return;

    // Use timeline values if time machine is active for a specific year
    let m = country.metrics;
    const yearMetrics = country.history && country.history.timeline ? country.history.timeline[this.currentYear] : null;

    let displayOilConsKbd = yearMetrics ? yearMetrics.oil_cons_kbd : m.oil.cons_kbd;
    let displayOilProdKbd = yearMetrics ? yearMetrics.oil_prod_kbd : m.oil.prod_kbd;
    let displayGasConsBcm = yearMetrics ? yearMetrics.gas_cons_bcm : m.gas.cons_bcm;
    let displayGasProdBcm = yearMetrics ? yearMetrics.gas_prod_bcm : m.gas.prod_bcm;
    let displayCoalConsMt = yearMetrics ? yearMetrics.coal_cons_mt : m.coal.cons_mt;

    const isNetExporter = displayOilProdKbd > displayOilConsKbd || m.total.self_sufficiency_pct > 100;
    const statusClass = isNetExporter ? "status-exporter" : "status-importer";
    const selfSuff = ((displayOilProdKbd / (displayOilConsKbd || 1)) * 100).toFixed(0);

    const statusText = isNetExporter
      ? `🟢 Net Energy Exporter • Oil Self-Sufficiency: ${selfSuff}%`
      : `🟠 Net Energy Importer • Oil Self-Sufficiency: ${selfSuff}%`;

    this.drawerHeader.innerHTML = `
      <div class="country-meta">
        <span class="country-flag-large">${country.flag || "🌐"}</span>
        <div>
          <div class="country-name">
            ${country.name}
            <span class="country-code-pill">${country.iso}</span>
          </div>
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 3px;">
            Pop: ${(country.population / 1e6).toFixed(1)}M • Selected Year: <strong>${this.currentYear}</strong>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="compare-btn" class="tool-btn" style="padding: 5px 9px;" title="Compare with another country">⇄ Compare</button>
      </div>
    `;

    const banner = document.getElementById("drawer-net-banner");
    if (banner) {
      banner.className = `net-status-banner ${statusClass}`;
      banner.innerHTML = `<span class="status-badge">${statusText}</span>`;
    }

    const compareBtn = document.getElementById("compare-btn");
    if (compareBtn) {
      compareBtn.addEventListener("click", () => this.openComparison(iso));
    }

    this.renderActiveTab(country, {
      oilConsKbd: displayOilConsKbd,
      oilProdKbd: displayOilProdKbd,
      gasConsBcm: displayGasConsBcm,
      gasProdBcm: displayGasProdBcm,
      coalConsMt: displayCoalConsMt
    });
  }

  renderActiveTab(country, overrides = {}) {
    const container = this.drawerBody;
    container.innerHTML = "";

    switch (this.activeDrawerTab) {
      case "overview":
        this.renderOverviewTab(container, country, overrides);
        break;
      case "inflows":
        this.renderInflowsTab(container, country);
        break;
      case "outflows":
        this.renderOutflowsTab(container, country);
        break;
      case "mix":
        this.renderEnergyMixTab(container, country);
        break;
      case "trends":
        this.renderTrendsTab(container, country);
        break;
    }
  }

  /* --- TAB 1: DAILY CONSUMPTION & PRODUCTION --- */
  renderOverviewTab(container, country, ov = {}) {
    const m = country.metrics;
    const u = this.currentUnit;

    const oilConsKbd = ov.oilConsKbd !== undefined ? ov.oilConsKbd : m.oil.cons_kbd;
    const oilProdKbd = ov.oilProdKbd !== undefined ? ov.oilProdKbd : m.oil.prod_kbd;
    const gasConsBcm = ov.gasConsBcm !== undefined ? ov.gasConsBcm : m.gas.cons_bcm;
    const gasProdBcm = ov.gasProdBcm !== undefined ? ov.gasProdBcm : m.gas.prod_bcm;
    const coalConsMt = ov.coalConsMt !== undefined ? ov.coalConsMt : m.coal.cons_mt;

    const oilConsStr = u === "energy" ? `${(oilConsKbd * 0.52).toFixed(0)} TWh` :
                       u === "annual" ? `${(oilConsKbd * 0.05).toFixed(1)} Mt/y` :
                       `${oilConsKbd.toLocaleString()} kb/d`;

    const oilProdStr = u === "energy" ? `${(oilProdKbd * 0.74).toFixed(0)} TWh` :
                       u === "annual" ? `${(oilProdKbd * 0.05).toFixed(1)} Mt/y` :
                       `${oilProdKbd.toLocaleString()} kb/d`;

    const gasConsStr = u === "energy" ? `${(gasConsBcm * 11.1).toFixed(0)} TWh` :
                       u === "annual" ? `${gasConsBcm} bcm/y` :
                       `${(gasConsBcm * 0.0967).toFixed(2)} Bcf/d`;

    const gasProdStr = u === "energy" ? `${(gasProdBcm * 11.1).toFixed(0)} TWh` :
                       u === "annual" ? `${gasProdBcm} bcm/y` :
                       `${(gasProdBcm * 0.0967).toFixed(2)} Bcf/d`;

    const oilRatio = Math.min(100, (oilProdKbd / (oilConsKbd || 1)) * 100);
    const gasRatio = Math.min(100, (gasProdBcm / (gasConsBcm || 1)) * 100);

    container.innerHTML = `
      <!-- Quick Flow Focus Controller -->
      <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-dim);">Map Flow Focus:</span>
        <div style="display: flex; gap: 4px;">
          <button class="flow-dir-btn active" data-dir="all">All Corridors</button>
          <button class="flow-dir-btn" data-dir="inflows">📥 Inflows Only</button>
          <button class="flow-dir-btn" data-dir="outflows">📤 Outflows Only</button>
        </div>
      </div>

      <!-- Quick Summary Cards -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
        <div class="pulse-stat-card">
          <div class="pulse-stat-label">Total Primary Energy</div>
          <div class="pulse-stat-val">${m.total.primary_cons_twh.toLocaleString()} <span class="pulse-stat-unit">TWh</span></div>
        </div>
        <div class="pulse-stat-card">
          <div class="pulse-stat-label">Energy Per Capita</div>
          <div class="pulse-stat-val">${(m.total.energy_per_capita_kwh / 1000).toFixed(1)} <span class="pulse-stat-unit">MWh</span></div>
        </div>
        <div class="pulse-stat-card">
          <div class="pulse-stat-label">Clean / Low-Carbon</div>
          <div class="pulse-stat-val">${m.clean.clean_share_pct.toFixed(1)}%</div>
        </div>
      </div>

      <!-- Non-Renewable Fuel Cards -->
      <div class="commodity-cards-grid">
        <!-- OIL CARD -->
        <div class="commodity-card" style="border-left: 3px solid var(--color-oil);">
          <div class="card-top">
            <div class="card-label-group">
              <div class="commodity-icon icon-oil">🛢️</div>
              <div>
                <div class="card-title">Oil & Liquids (${this.currentYear})</div>
                <div class="card-self-suff">Balance: ${(oilProdKbd - oilConsKbd) >= 0 ? '+' : ''}${(oilProdKbd - oilConsKbd).toLocaleString()} kb/d</div>
              </div>
            </div>
            <div class="flow-badge ${oilProdKbd >= oilConsKbd ? 'badge-tanker' : 'badge-lng'}">
              ${oilProdKbd >= oilConsKbd ? 'Net Exporter' : 'Net Importer'}
            </div>
          </div>

          <div class="card-metrics-row">
            <div class="metric-column">
              <span class="metric-title">Daily Consumption</span>
              <div class="metric-number" style="color: var(--color-oil);">${oilConsStr}</div>
            </div>
            <div class="metric-column">
              <span class="metric-title">Daily Production</span>
              <div class="metric-number">${oilProdStr}</div>
            </div>
          </div>

          <div class="balance-meter">
            <div class="balance-fill" style="width: ${oilRatio}%; background: var(--color-oil);"></div>
          </div>
        </div>

        <!-- NATURAL GAS CARD -->
        <div class="commodity-card" style="border-left: 3px solid var(--color-gas);">
          <div class="card-top">
            <div class="card-label-group">
              <div class="commodity-icon icon-gas">🔥</div>
              <div>
                <div class="card-title">Natural Gas & LNG (${this.currentYear})</div>
                <div class="card-self-suff">Balance: ${(gasProdBcm - gasConsBcm) >= 0 ? '+' : ''}${(gasProdBcm - gasConsBcm).toFixed(1)} bcm</div>
              </div>
            </div>
            <div class="flow-badge badge-pipeline">
              ${gasProdBcm >= gasConsBcm ? 'Net Exporter' : 'Net Importer'}
            </div>
          </div>

          <div class="card-metrics-row">
            <div class="metric-column">
              <span class="metric-title">Consumption</span>
              <div class="metric-number" style="color: var(--color-gas);">${gasConsStr}</div>
            </div>
            <div class="metric-column">
              <span class="metric-title">Production</span>
              <div class="metric-number">${gasProdStr}</div>
            </div>
          </div>

          <div class="balance-meter">
            <div class="balance-fill" style="width: ${gasRatio}%; background: var(--color-gas);"></div>
          </div>
        </div>

        <!-- COAL CARD -->
        <div class="commodity-card" style="border-left: 3px solid var(--color-coal);">
          <div class="card-top">
            <div class="card-label-group">
              <div class="commodity-icon icon-coal">⛏️</div>
              <div>
                <div class="card-title">Coal & Solid Fuels</div>
                <div class="card-self-suff">Consumption: ${coalConsMt} Mt/y</div>
              </div>
            </div>
            <div class="flow-badge badge-bulk">${m.coal.prod_mt >= coalConsMt ? 'Net Exporter' : 'Net Importer'}</div>
          </div>

          <div class="card-metrics-row">
            <div class="metric-column">
              <span class="metric-title">Consumption</span>
              <div class="metric-number" style="color: #cbd5e1;">${coalConsMt} Mt/y</div>
            </div>
            <div class="metric-column">
              <span class="metric-title">Production</span>
              <div class="metric-number">${m.coal.prod_mt} Mt/y</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Supply Links -->
      <div style="display: flex; gap: 12px; margin-top: 6px;">
        <button class="tool-btn" id="view-inflows-btn" style="flex: 1; justify-content: center; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">
          📥 Supply Inflows (${country.imports.length})
        </button>
        <button class="tool-btn" id="view-outflows-btn" style="flex: 1; justify-content: center; background: rgba(249, 115, 22, 0.15); color: #f97316; border-color: rgba(249, 115, 22, 0.3);">
          📤 Supply Outflows (${country.exports.length})
        </button>
      </div>
    `;

    // Direction buttons
    container.querySelectorAll(".flow-dir-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".flow-dir-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.onFlowDirectionChange(btn.getAttribute("data-dir"));
      });
    });

    document.getElementById("view-inflows-btn")?.addEventListener("click", () => this.switchTab("inflows"));
    document.getElementById("view-outflows-btn")?.addEventListener("click", () => this.switchTab("outflows"));
  }

  /* --- TAB 2: INFLOWS (SUPPLY ORIGINS) --- */
  renderInflowsTab(container, country) {
    if (!country.imports || country.imports.length === 0) {
      container.innerHTML = `
        <div class="empty-flows">
          <p style="font-size: 24px; margin-bottom: 8px;">🌐</p>
          <p>No primary international pipeline or maritime import shipments recorded for <strong>${country.name}</strong>.</p>
          <p style="font-size: 11px; margin-top: 6px; color: var(--text-dim);">Domestic production meets demand or imports arrive via regional power exchanges.</p>
        </div>
      `;
      return;
    }

    let listHtml = `
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: flex; justify-content: space-between;">
        <span><strong>${country.imports.length}</strong> active supply corridors streaming into ${country.name}:</span>
        <span style="color: var(--color-import); font-weight: 600;">🔵 Inflows</span>
      </div>
      <div class="flow-list">
    `;

    country.imports.forEach(f => {
      let volStr = "";
      let badgeClass = "badge-tanker";
      let commIcon = "🛢️";

      if (f.commodity === "oil") {
        volStr = `${f.volume_kbd.toLocaleString()} kb/d`;
        commIcon = "🛢️";
      } else if (f.commodity.startsWith("gas")) {
        volStr = `${f.volume_bcfd} Bcf/d (${f.volume_bcm} bcm/y)`;
        badgeClass = f.transport === "pipeline" ? "badge-pipeline" : "badge-lng";
        commIcon = "🔥";
      } else if (f.commodity === "coal") {
        volStr = `${f.volume_mt} Mt/y`;
        badgeClass = "badge-bulk";
        commIcon = "⛏️";
      }

      listHtml += `
        <div class="flow-item" data-flow-id="${f.id}" data-partner-iso="${f.from}">
          <div class="flow-partner">
            <span class="flow-flag">${f.from_flag || "🌐"}</span>
            <div>
              <div class="flow-partner-name">${f.from_name} <span class="country-code-pill">${f.from}</span></div>
              <div class="flow-route-label">${commIcon} ${f.label || f.transport}</div>
            </div>
          </div>
          <div class="flow-vol">
            <div class="flow-vol-val">${volStr}</div>
            <span class="flow-badge ${badgeClass}">${f.transport.replace('_', ' ')}</span>
          </div>
        </div>
      `;
    });

    listHtml += `</div>`;
    container.innerHTML = listHtml;

    container.querySelectorAll(".flow-item").forEach(item => {
      item.addEventListener("click", () => {
        const iso = item.getAttribute("data-partner-iso");
        if (iso) this.onSelectCountry(iso);
      });
      item.addEventListener("mouseenter", (e) => {
        const flowId = item.getAttribute("data-flow-id");
        const flow = country.imports.find(i => i.id === flowId);
        if (flow) this.showRouteInspector(flow, e.clientX, e.clientY);
      });
      item.addEventListener("mouseleave", () => {
        this.showRouteInspector(null);
      });
    });
  }

  /* --- TAB 3: OUTFLOWS (SUPPLY DESTINATIONS) --- */
  renderOutflowsTab(container, country) {
    if (!country.exports || country.exports.length === 0) {
      container.innerHTML = `
        <div class="empty-flows">
          <p style="font-size: 24px; margin-bottom: 8px;">🚢</p>
          <p><strong>${country.name}</strong> does not export substantial quantities of crude oil, pipeline gas, LNG, or coal.</p>
          <p style="font-size: 11px; margin-top: 6px; color: var(--text-dim);">Energy production is consumed internally.</p>
        </div>
      `;
      return;
    }

    let listHtml = `
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: flex; justify-content: space-between;">
        <span>Supplying energy to <strong>${country.exports.length}</strong> destination nations:</span>
        <span style="color: var(--color-export); font-weight: 600;">🟠 Outflows</span>
      </div>
      <div class="flow-list">
    `;

    country.exports.forEach(f => {
      let volStr = "";
      let badgeClass = "badge-tanker";
      let commIcon = "🛢️";

      if (f.commodity === "oil") {
        volStr = `${f.volume_kbd.toLocaleString()} kb/d`;
        commIcon = "🛢️";
      } else if (f.commodity.startsWith("gas")) {
        volStr = `${f.volume_bcfd} Bcf/d (${f.volume_bcm} bcm/y)`;
        badgeClass = f.transport === "pipeline" ? "badge-pipeline" : "badge-lng";
        commIcon = "🔥";
      } else if (f.commodity === "coal") {
        volStr = `${f.volume_mt} Mt/y`;
        badgeClass = "badge-bulk";
        commIcon = "⛏️";
      }

      listHtml += `
        <div class="flow-item" data-flow-id="${f.id}" data-partner-iso="${f.to}">
          <div class="flow-partner">
            <span class="flow-flag">${f.to_flag || "🌐"}</span>
            <div>
              <div class="flow-partner-name">${f.to_name} <span class="country-code-pill">${f.to}</span></div>
              <div class="flow-route-label">${commIcon} ${f.label || f.transport}</div>
            </div>
          </div>
          <div class="flow-vol">
            <div class="flow-vol-val">${volStr}</div>
            <span class="flow-badge ${badgeClass}">${f.transport.replace('_', ' ')}</span>
          </div>
        </div>
      `;
    });

    listHtml += `</div>`;
    container.innerHTML = listHtml;

    container.querySelectorAll(".flow-item").forEach(item => {
      item.addEventListener("click", () => {
        const iso = item.getAttribute("data-partner-iso");
        if (iso) this.onSelectCountry(iso);
      });
      item.addEventListener("mouseenter", (e) => {
        const flowId = item.getAttribute("data-flow-id");
        const flow = country.exports.find(x => x.id === flowId);
        if (flow) this.showRouteInspector(flow, e.clientX, e.clientY);
      });
      item.addEventListener("mouseleave", () => {
        this.showRouteInspector(null);
      });
    });
  }

  /* --- TAB 4: ENERGY MIX (DONUT) --- */
  renderEnergyMixTab(container, country) {
    const m = country.metrics;
    const total = m.total.primary_cons_twh || 1;

    const sources = [
      { name: "Oil", val: m.oil.cons_twh, color: "#f59e0b" },
      { name: "Natural Gas", val: m.gas.cons_twh, color: "#06b6d4" },
      { name: "Coal", val: m.coal.cons_twh, color: "#94a3b8" },
      { name: "Nuclear", val: m.clean.nuclear_twh, color: "#a855f7" },
      { name: "Hydro", val: m.clean.hydro_twh, color: "#3b82f6" },
      { name: "Solar & Wind", val: m.clean.solar_twh + m.clean.wind_twh, color: "#10b981" },
      { name: "Biofuel & Others", val: m.clean.biofuel_twh, color: "#84cc16" },
    ].filter(s => s.val > 0);

    let currentAngle = 0;
    let pathsSvg = "";
    const cx = 70, cy = 70, r = 52, innerR = 36;

    sources.forEach(s => {
      const sliceAngle = (s.val / total) * Math.PI * 2;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;
      currentAngle = endAngle;

      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);

      const ix1 = cx + innerR * Math.cos(endAngle);
      const iy1 = cy + innerR * Math.sin(endAngle);
      const ix2 = cx + innerR * Math.cos(startAngle);
      const iy2 = cy + innerR * Math.sin(startAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const pathD = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
      pathsSvg += `<path d="${pathD}" fill="${s.color}" opacity="0.9" />`;
    });

    let legendHtml = sources.map(s => `
      <div class="mix-legend-item">
        <div>
          <span class="mix-color-dot" style="background: ${s.color};"></span>
          <span>${s.name}</span>
        </div>
        <div style="font-weight: 600; color: #fff;">
          ${((s.val / total) * 100).toFixed(1)}% <span style="font-size: 10px; color: var(--text-dim);">(${s.val.toLocaleString()} TWh)</span>
        </div>
      </div>
    `).join("");

    container.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 8px;">Primary Energy Consumption Mix</div>
      <div class="energy-mix-container">
        <div class="mix-chart-box">
          <svg width="140" height="140" viewBox="0 0 140 140">
            ${pathsSvg}
            <circle cx="70" cy="70" r="30" fill="var(--bg-card)" />
            <text x="70" y="68" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${m.clean.clean_share_pct.toFixed(0)}%</text>
            <text x="70" y="80" text-anchor="middle" font-size="9" fill="var(--text-dim)">Clean</text>
          </svg>
        </div>
        <div class="mix-legend">
          ${legendHtml}
        </div>
      </div>
      <div style="background: rgba(0, 0, 0, 0.25); padding: 12px; border-radius: var(--radius-sm); border: 1px solid rgba(255, 255, 255, 0.05); font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-top: 10px;">
        💡 <strong>Energy Transition Status:</strong> ${country.name} produces ${m.clean.total_clean_twh.toLocaleString()} TWh from zero-carbon and low-carbon energy sources (${m.clean.clean_share_pct.toFixed(1)}% of total energy consumed).
      </div>
    `;
  }

  /* --- TAB 5: TRENDS (SPARKLINES) --- */
  renderTrendsTab(container, country) {
    const h = country.history;
    if (!h || !h.years) return;

    const renderSparkline = (data, color, label, unit) => {
      const max = Math.max(...data, 1);
      const points = data.map((val, i) => {
        const x = (i / (data.length - 1)) * 320;
        const y = 60 - (val / max) * 50;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");

      return `
        <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 6px;">
            <span>${label}</span>
            <span style="color: ${color};">${data[data.length - 1]} ${unit}</span>
          </div>
          <svg width="100%" height="70" viewBox="0 0 320 70" style="overflow: visible;">
            <polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${points}" />
          </svg>
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-dim); margin-top: 4px;">
            <span>${h.years[0]}</span>
            <span>${h.years[Math.floor(h.years.length / 2)]}</span>
            <span>${h.years[h.years.length - 1]}</span>
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 10px;">Multi-Decade Evolution (2000–2024)</div>
      ${renderSparkline(h.oil_cons_kbd, "var(--color-oil)", "Oil Consumption Trajectory", "kb/d")}
      ${renderSparkline(h.oil_prod_kbd, "#ef4444", "Oil Production Trajectory", "kb/d")}
      ${renderSparkline(h.gas_cons_bcm, "var(--color-gas)", "Natural Gas Consumption", "bcm/y")}
    `;
  }

  switchTab(tabKey) {
    this.activeDrawerTab = tabKey;
    this.drawerTabs.forEach(t => {
      t.classList.toggle("active", t.getAttribute("data-tab") === tabKey);
    });
    if (this.selectedIso && this.energyDb) {
      this.renderActiveTab(this.energyDb.countries[this.selectedIso]);
    }
  }

  /* ========================================================================
     Country Comparison Modal
     ======================================================================== */
  openComparison(baseIso) {
    if (!this.compareModal || !this.energyDb) return;
    const countries = Object.values(this.energyDb.countries);
    const c1 = this.energyDb.countries[baseIso] || countries[0];
    const c2 = baseIso === "USA" ? this.energyDb.countries["CHN"] : this.energyDb.countries["USA"];

    this.renderComparisonModal(c1, c2);
    this.compareModal.style.display = "flex";
  }

  renderComparisonModal(c1, c2) {
    const countries = Object.values(this.energyDb.countries);
    const body = document.getElementById("compare-modal-body");
    if (!body) return;

    const optList1 = countries.map(c => `<option value="${c.iso}" ${c.iso === c1.iso ? 'selected' : ''}>${c.flag || ''} ${c.name}</option>`).join("");
    const optList2 = countries.map(c => `<option value="${c.iso}" ${c.iso === c2.iso ? 'selected' : ''}>${c.flag || ''} ${c.name}</option>`).join("");

    body.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <div>
          <select id="compare-select-1" class="select-dropdown" style="width: 100%; margin-bottom: 14px; font-size: 14px;">
            ${optList1}
          </select>
          ${this.getComparisonCardHtml(c1)}
        </div>
        <div>
          <select id="compare-select-2" class="select-dropdown" style="width: 100%; margin-bottom: 14px; font-size: 14px;">
            ${optList2}
          </select>
          ${this.getComparisonCardHtml(c2)}
        </div>
      </div>
    `;

    document.getElementById("compare-select-1")?.addEventListener("change", (e) => {
      this.renderComparisonModal(this.energyDb.countries[e.target.value], c2);
    });
    document.getElementById("compare-select-2")?.addEventListener("change", (e) => {
      this.renderComparisonModal(c1, this.energyDb.countries[e.target.value]);
    });
  }

  getComparisonCardHtml(c) {
    const m = c.metrics;
    return `
      <div class="commodity-card">
        <div style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 8px;">
          ${c.flag || '🌐'} ${c.name} (${c.iso})
        </div>
        <div class="mix-legend-item">
          <span style="color: var(--text-dim);">Oil Consumption</span>
          <span style="color: var(--color-oil); font-weight: 700;">${m.oil.cons_kbd.toLocaleString()} kb/d</span>
        </div>
        <div class="mix-legend-item">
          <span style="color: var(--text-dim);">Oil Production</span>
          <span style="font-weight: 700;">${m.oil.prod_kbd.toLocaleString()} kb/d</span>
        </div>
        <div class="mix-legend-item">
          <span style="color: var(--text-dim);">Gas Consumption</span>
          <span style="color: var(--color-gas); font-weight: 700;">${m.gas.cons_bcfd} Bcf/d</span>
        </div>
        <div class="mix-legend-item">
          <span style="color: var(--text-dim);">Gas Production</span>
          <span style="font-weight: 700;">${m.gas.prod_bcfd} Bcf/d</span>
        </div>
        <div class="mix-legend-item">
          <span style="color: var(--text-dim);">Coal Consumption</span>
          <span style="color: #cbd5e1; font-weight: 700;">${m.coal.cons_mt} Mt/y</span>
        </div>
        <div class="mix-legend-item">
          <span style="color: var(--text-dim);">Clean Energy Share</span>
          <span style="color: var(--color-clean); font-weight: 700;">${m.clean.clean_share_pct.toFixed(1)}%</span>
        </div>
        <div class="mix-legend-item" style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px; margin-top: 6px;">
          <span style="color: var(--text-dim);">Self-Sufficiency</span>
          <span style="font-weight: 700; color: ${m.total.self_sufficiency_pct >= 100 ? '#10b981' : '#f97316'};">${m.total.self_sufficiency_pct.toFixed(0)}%</span>
        </div>
      </div>
    `;
  }

  initEvents() {
    this.drawerCloseBtn?.addEventListener("click", () => this.closeDrawer());

    this.drawerTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const key = tab.getAttribute("data-tab");
        if (key) this.switchTab(key);
      });
    });

    this.unitSelect?.addEventListener("change", (e) => {
      this.setUnit(e.target.value);
    });

    document.getElementById("modal-close-btn")?.addEventListener("click", () => {
      if (this.compareModal) this.compareModal.style.display = "none";
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.compareModal && this.compareModal.style.display === "flex") {
          this.compareModal.style.display = "none";
        } else if (this.drawer.classList.contains("open")) {
          this.closeDrawer();
        }
      }
    });
  }
}
