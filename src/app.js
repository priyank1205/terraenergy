/**
 * src/app.js (100x Upgrade)
 * Master Coordinator for TerraEnergy Global Intelligence Platform.
 */

import { MapEngine } from "./map-engine.js";
import { UIPanel } from "./ui-panel.js";
import { STRATEGIC_CHOKEPOINTS } from "./chokepoints.js";

class TerraEnergyApp {
  constructor() {
    this.mapEngine = null;
    this.uiPanel = null;
    this.geoData = null;
    this.energyDb = null;

    this.init();
  }

  async init() {
    console.log("Initializing TerraEnergy 100x Upgraded Intelligence Platform...");

    // Setup UI Panel
    this.uiPanel = new UIPanel({
      onSelectCountry: (iso) => {
        if (iso) {
          window.location.hash = iso;
          this.mapEngine.selectCountry(iso);
          this.uiPanel.openCountry(iso);
        } else {
          history.pushState("", document.title, window.location.pathname + window.location.search);
          this.mapEngine.selectCountry(null);
          this.uiPanel.updateActiveChip(null);
        }
      },
      onChokepointClick: (chokepoint) => {
        this.mapEngine.setChokepointFilter(chokepoint);
      },
      onFlowDirectionChange: (direction) => {
        this.mapEngine.setFlowDirection(direction);
      },
      onYearChange: (year) => {
        // Timeline change
        this.mapEngine.renderMap();
      }
    });

    // Setup Map Engine
    const container = document.getElementById("map-viewport");
    const mapCanvas = document.getElementById("map-canvas");
    const flowCanvas = document.getElementById("flow-canvas");
    const tooltip = document.getElementById("map-tooltip");

    this.mapEngine = new MapEngine({
      container,
      mapCanvas,
      flowCanvas,
      tooltip,
      onCountrySelect: (iso) => {
        if (iso) {
          window.location.hash = iso;
          this.uiPanel.openCountry(iso);
        } else {
          this.uiPanel.closeDrawer();
        }
      },
      onCountryHover: (iso, clientX, clientY) => {
        this.updateTooltip(iso, clientX, clientY);
      },
      onRouteHover: (flow, clientX, clientY, pinned) => {
        this.uiPanel.showRouteInspector(flow, clientX, clientY, pinned);
      }
    });

    // Wire up header controls
    this.initControls();

    // Fetch datasets in parallel
    try {
      const [geoRes, dbRes] = await Promise.all([
        fetch("public/data/world-110m.json"),
        fetch("public/data/energy_db.json")
      ]);

      this.geoData = await geoRes.json();
      this.energyDb = await dbRes.json();

      console.log("Loaded datasets:", {
        countriesInGeo: this.geoData.features.length,
        countriesInDb: Object.keys(this.energyDb.countries).length,
        tradeFlows: this.energyDb.flows.length
      });

      this.uiPanel.setDatabase(this.energyDb);
      this.mapEngine.setData(this.geoData, this.energyDb);
      this.mapEngine.startAnimationLoop();

      // Check URL hash for initial country selection
      if (window.location.hash) {
        const hashIso = window.location.hash.replace("#", "").toUpperCase();
        if (this.energyDb.countries[hashIso]) {
          setTimeout(() => {
            this.mapEngine.selectCountry(hashIso);
            this.uiPanel.openCountry(hashIso);
          }, 300);
        }
      }
    } catch (err) {
      console.error("Failed to load energy datasets:", err);
    }
  }

  initControls() {
    // 1. Commodity Filter Buttons
    document.querySelectorAll(".pill-btn[data-commodity]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".pill-btn[data-commodity]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const comm = btn.getAttribute("data-commodity");
        this.mapEngine.setCommodityFilter(comm);
      });
    });

    // 2. Global Mega-Arteries Toggle Button
    const arteriesBtn = document.getElementById("global-arteries-btn");
    if (arteriesBtn) {
      arteriesBtn.addEventListener("click", () => {
        const isCurrentlyActive = this.mapEngine.showGlobalArteries;
        const nextState = !isCurrentlyActive;
        this.mapEngine.setShowGlobalArteries(nextState);
        arteriesBtn.innerText = nextState ? "🌐 Global Arteries: On" : "🌐 Global Arteries: Off";
        arteriesBtn.classList.toggle("active", nextState);
      });
    }

    // 3. Projection Toggle (2D Flat Map vs 3D Globe)
    const projBtn = document.getElementById("projection-toggle-btn");
    if (projBtn) {
      projBtn.addEventListener("click", () => {
        const is2d = this.mapEngine.mode === "2d";
        const nextMode = is2d ? "3d" : "2d";
        this.mapEngine.setMode(nextMode);
        projBtn.innerHTML = nextMode === "3d" ? "🌍 3D Globe" : "🗺️ Flat Map";
        projBtn.classList.toggle("active", nextMode === "3d");

        const autoRotBtn = document.getElementById("auto-rotate-btn");
        if (autoRotBtn) {
          autoRotBtn.style.display = nextMode === "3d" ? "flex" : "none";
        }
      });
    }

    // 4. Auto-Rotate Toggle (for 3D Globe)
    const autoRotBtn = document.getElementById("auto-rotate-btn");
    if (autoRotBtn) {
      autoRotBtn.addEventListener("click", () => {
        this.mapEngine.autoRotate = !this.mapEngine.autoRotate;
        autoRotBtn.classList.toggle("active", this.mapEngine.autoRotate);
      });
    }

    // 5. Choropleth Metric Selector
    const choroSelect = document.getElementById("choropleth-select");
    if (choroSelect) {
      choroSelect.addEventListener("change", (e) => {
        const metric = e.target.value;
        this.mapEngine.setChoropleth(metric);
        this.updateChoroplethLegend(metric);
      });
    }

    // 6. Map Zoom & Reset Controls
    document.getElementById("zoom-in-btn")?.addEventListener("click", () => this.mapEngine.zoom(1.25));
    document.getElementById("zoom-out-btn")?.addEventListener("click", () => this.mapEngine.zoom(0.8));
    document.getElementById("reset-view-btn")?.addEventListener("click", () => {
      this.mapEngine.resetView();
      this.uiPanel.closeDrawer();
      document.querySelectorAll(".chokepoint-pill").forEach(p => p.classList.remove("active"));
      if (arteriesBtn) {
        arteriesBtn.innerText = "🌐 Global Arteries: Off";
        arteriesBtn.classList.remove("active");
      }
    });
  }

  updateTooltip(iso, clientX, clientY) {
    const tooltip = document.getElementById("map-tooltip");
    if (!tooltip) return;

    if (!iso || !this.energyDb || !this.energyDb.countries[iso]) {
      tooltip.style.display = "none";
      return;
    }

    const c = this.energyDb.countries[iso];
    const m = c.metrics;

    let extraStat = "";
    if (this.mapEngine.activeChoropleth === "oil_prod") {
      extraStat = `<div>Oil Prod: <strong>${m.oil.prod_kbd.toLocaleString()} kb/d</strong></div>`;
    } else if (this.mapEngine.activeChoropleth === "gas_cons") {
      extraStat = `<div>Gas Cons: <strong>${m.gas.cons_bcfd} Bcf/d</strong></div>`;
    } else if (this.mapEngine.activeChoropleth === "coal_cons") {
      extraStat = `<div>Coal Cons: <strong>${m.coal.cons_mt} Mt/y</strong></div>`;
    } else if (this.mapEngine.activeChoropleth === "clean_share") {
      extraStat = `<div>Clean Share: <strong>${m.clean.clean_share_pct.toFixed(1)}%</strong></div>`;
    } else {
      extraStat = `
        <div>Oil Cons: <strong style="color: var(--color-oil);">${m.oil.cons_kbd.toLocaleString()} kb/d</strong></div>
        <div>Gas Cons: <strong style="color: var(--color-gas);">${m.gas.cons_bcfd} Bcf/d</strong></div>
      `;
    }

    tooltip.innerHTML = `
      <div class="tooltip-title">
        <span>${c.flag || "🌐"}</span>
        <span>${c.name}</span>
        <span class="country-code-pill">${c.iso}</span>
      </div>
      <div style="font-size: 11px; display: flex; flex-direction: column; gap: 2px;">
        ${extraStat}
        <div style="font-size: 10px; color: var(--text-dim); margin-top: 4px;">Click to view supply flows</div>
      </div>
    `;

    tooltip.style.left = `${clientX}px`;
    tooltip.style.top = `${clientY}px`;
    tooltip.style.display = "block";
  }

  updateChoroplethLegend(metric) {
    const legend = document.getElementById("choropleth-legend-box");
    const title = document.getElementById("legend-metric-title");
    const minLbl = document.getElementById("legend-min-lbl");
    const maxLbl = document.getElementById("legend-max-lbl");

    if (!legend) return;

    if (metric === "none") {
      legend.style.display = "none";
      return;
    }

    legend.style.display = "block";
    switch (metric) {
      case "oil_cons":
        title.innerText = "Oil Daily Consumption (kb/d)";
        minLbl.innerText = "0";
        maxLbl.innerText = "19,000";
        break;
      case "oil_prod":
        title.innerText = "Oil Daily Production (kb/d)";
        minLbl.innerText = "0";
        maxLbl.innerText = "13,500";
        break;
      case "gas_cons":
        title.innerText = "Natural Gas Consumption (bcm/y)";
        minLbl.innerText = "0";
        maxLbl.innerText = "820";
        break;
      case "gas_prod":
        title.innerText = "Natural Gas Production (bcm/y)";
        minLbl.innerText = "0";
        maxLbl.innerText = "940";
        break;
      case "coal_cons":
        title.innerText = "Coal Consumption (Mt/y)";
        minLbl.innerText = "0";
        maxLbl.innerText = "3,000";
        break;
      case "clean_share":
        title.innerText = "Clean & Low-Carbon Share (%)";
        minLbl.innerText = "0%";
        maxLbl.innerText = "100%";
        break;
      case "net_balance":
        title.innerText = "Net Oil Balance (Orange: Importer | Green: Exporter)";
        minLbl.innerText = "-10,000 kb/d";
        maxLbl.innerText = "+5,000 kb/d";
        break;
    }
  }
}

// Instantiate on DOM load
window.addEventListener("DOMContentLoaded", () => {
  window.terraEnergyApp = new TerraEnergyApp();
});
