/**
 * src/map-engine.js (100x Upgrade)
 * High-performance Cartographic Engine with Realistic Multi-Waypoint Maritime Sea Lanes,
 * Pipeline Infrastructure, Animated Tanker Ships, and Clean Focused Interaction.
 */

import { STRATEGIC_CHOKEPOINTS } from "./chokepoints.js";

export class MapEngine {
  constructor(options) {
    this.container = options.container;
    this.mapCanvas = options.mapCanvas;
    this.flowCanvas = options.flowCanvas;
    this.tooltip = options.tooltip;
    this.onCountrySelect = options.onCountrySelect || (() => {});
    this.onCountryHover = options.onCountryHover || (() => {});
    this.onRouteHover = options.onRouteHover || (() => {});

    this.mapCtx = this.mapCanvas.getContext("2d");
    this.flowCtx = this.flowCanvas.getContext("2d");

    // Display & State
    this.mode = "2d"; // '2d' or '3d'
    this.geoData = null;
    this.energyDb = null;
    this.selectedIso = null;
    this.hoveredIso = null;
    this.hoveredFlow = null;

    // Filters
    this.activeCommodity = "all"; // 'all', 'oil', 'gas', 'coal'
    this.flowFilterDirection = "all"; // 'all', 'inflows', 'outflows'
    this.activeChoropleth = "none";
    this.activeChokepointId = null;
    this.showGlobalArteries = false; // Non-overwhelming default: false!

    // Camera & Projection
    this.width = 0;
    this.height = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    // 3D Globe angles (degrees)
    this.rotLambda = 0;
    this.rotPhi = 20;
    this.autoRotate = false;
    this.lastTime = 0;

    // Particles (Vessels / Pipeline pulses)
    this.particles = [];
    this.activeFlows = [];

    // Interaction handling
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragStartPanX = 0;
    this.dragStartPanY = 0;
    this.dragStartRotL = 0;
    this.dragStartRotP = 0;

    this.initEvents();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setData(geoJson, energyDb) {
    this.geoData = geoJson;
    this.energyDb = energyDb;
    this.updateActiveFlows();
    this.renderMap();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = window.devicePixelRatio || 1;

    this.mapCanvas.width = this.width * this.dpr;
    this.mapCanvas.height = this.height * this.dpr;
    this.flowCanvas.width = this.width * this.dpr;
    this.flowCanvas.height = this.height * this.dpr;

    this.mapCtx.scale(this.dpr, this.dpr);
    this.flowCtx.scale(this.dpr, this.dpr);

    if (this.mode === "2d") {
      this.scale = Math.min(this.width / 5.5, this.height / 3.0);
      this.panX = this.width / 2;
      this.panY = this.height / 1.8;
    } else {
      this.scale = Math.min(this.width, this.height) * 0.42;
      this.panX = this.width / 2;
      this.panY = this.height / 2;
    }

    this.renderMap();
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "3d") {
      this.scale = Math.min(this.width, this.height) * 0.42;
      this.panX = this.width / 2;
      this.panY = this.height / 2;
    } else {
      this.scale = Math.min(this.width / 5.5, this.height / 3.0);
      this.panX = this.width / 2;
      this.panY = this.height / 1.8;
    }
    this.updateActiveFlows();
    this.renderMap();
  }

  setCommodityFilter(commodity) {
    this.activeCommodity = commodity;
    this.updateActiveFlows();
    this.renderMap();
  }

  setFlowDirection(dir) {
    this.flowFilterDirection = dir; // 'all', 'inflows', 'outflows'
    this.updateActiveFlows();
  }

  setShowGlobalArteries(show) {
    this.showGlobalArteries = show;
    this.updateActiveFlows();
    this.renderMap();
  }

  setChoropleth(metric) {
    this.activeChoropleth = metric;
    this.renderMap();
  }

  setChokepointFilter(chokepoint) {
    this.activeChokepointId = chokepoint ? chokepoint.id : null;
    if (chokepoint) {
      if (this.mode === "3d") {
        this.rotLambda = -chokepoint.coords[0];
        this.rotPhi = -chokepoint.coords[1];
      } else {
        const p = this.project(chokepoint.coords[0], chokepoint.coords[1]);
        if (p) {
          this.panX += (this.width / 2 - p[0]);
          this.panY += (this.height / 2 - p[1]);
        }
      }
    }
    this.updateActiveFlows();
    this.renderMap();
  }

  selectCountry(iso) {
    this.selectedIso = iso;
    if (iso && this.energyDb && this.energyDb.countries[iso]) {
      const c = this.energyDb.countries[iso];
      const coords = c.centroid || [0, 0];
      if (this.mode === "3d") {
        this.rotLambda = -coords[0];
        this.rotPhi = -coords[1];
      }
    }
    this.updateActiveFlows();
    this.renderMap();
  }

  resetView() {
    this.selectedIso = null;
    this.activeChokepointId = null;
    this.showGlobalArteries = false;
    if (this.mode === "2d") {
      this.scale = Math.min(this.width / 5.5, this.height / 3.0);
      this.panX = this.width / 2;
      this.panY = this.height / 1.8;
    } else {
      this.scale = Math.min(this.width, this.height) * 0.42;
      this.panX = this.width / 2;
      this.panY = this.height / 2;
      this.rotLambda = 0;
      this.rotPhi = 20;
    }
    this.updateActiveFlows();
    this.renderMap();
  }

  zoom(factor) {
    this.scale *= factor;
    this.renderMap();
  }

  /* ========================================================================
     Projection Mathematics
     ======================================================================== */
  project(lon, lat) {
    if (this.mode === "2d") {
      const rad = Math.PI / 180;
      const phi = lat * rad;
      const lam = lon * rad;
      const x = lam * (0.8707 - 0.131979 * phi * phi);
      const y = -phi * (1.0072 - 0.01526 * phi * phi);
      return [this.panX + x * this.scale, this.panY + y * this.scale];
    } else {
      const rad = Math.PI / 180;
      const phi = lat * rad;
      const lam = lon * rad;
      const phi0 = -this.rotPhi * rad;
      const lam0 = -this.rotLambda * rad;

      const cosC = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0);
      if (cosC < -0.05) return null;

      const x = Math.cos(phi) * Math.sin(lam - lam0);
      const y = Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0);

      return [this.panX + x * this.scale, this.panY - y * this.scale, cosC];
    }
  }

  invert(x, y) {
    if (this.mode === "2d") {
      const rx = (x - this.panX) / this.scale;
      const ry = -(y - this.panY) / this.scale;
      const lat = (ry / 1.0072) * (180 / Math.PI);
      const lon = (rx / 0.8707) * (180 / Math.PI);
      return [lon, lat];
    } else {
      const dx = (x - this.panX) / this.scale;
      const dy = -(y - this.panY) / this.scale;
      const rho = Math.sqrt(dx * dx + dy * dy);
      if (rho > 1.0) return null;

      const c = Math.asin(rho);
      const rad = Math.PI / 180;
      const phi0 = -this.rotPhi * rad;
      const lam0 = -this.rotLambda * rad;

      const phi = Math.asin(Math.cos(c) * Math.sin(phi0) + (dy * Math.sin(c) * Math.cos(phi0)) / rho);
      const lam = lam0 + Math.atan2(dx * Math.sin(c), rho * Math.cos(phi0) * Math.cos(c) - dy * Math.sin(phi0) * Math.sin(c));

      return [(lam * 180) / Math.PI, (phi * 180) / Math.PI];
    }
  }

  /* ========================================================================
     Base Map & Energy Hubs Rendering
     ======================================================================== */
  renderMap() {
    const ctx = this.mapCtx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.mode === "3d") {
      // 3D Globe Base with Lighting Gradient
      const grad = ctx.createRadialGradient(
        this.panX - this.scale * 0.35,
        this.panY - this.scale * 0.35,
        this.scale * 0.1,
        this.panX,
        this.panY,
        this.scale
      );
      grad.addColorStop(0, "#122040");
      grad.addColorStop(0.7, "#080e1e");
      grad.addColorStop(1, "#03060d");

      ctx.save();
      ctx.beginPath();
      ctx.arc(this.panX, this.panY, this.scale, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Glowing Atmosphere
      ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
      ctx.lineWidth = 2.0;
      ctx.shadowColor = "rgba(56, 189, 248, 0.4)";
      ctx.shadowBlur = 24;
      ctx.stroke();
      ctx.restore();

      this.drawGraticule(ctx);
    } else {
      this.drawGraticule(ctx);
    }

    if (!this.geoData) return;

    // Render Country Polygons
    for (const feat of this.geoData.features) {
      const iso = feat.id;
      const isSelected = this.selectedIso === iso;
      const isHovered = this.hoveredIso === iso;

      ctx.beginPath();
      let pathValid = this.drawFeatureGeometry(ctx, feat.geometry);
      if (!pathValid) continue;

      let fillColor = "#131d31";
      let strokeColor = "rgba(255, 255, 255, 0.11)";
      let strokeWidth = 0.7;

      if (this.activeChoropleth !== "none" && this.energyDb) {
        fillColor = this.getChoroplethColor(iso);
      }

      if (isSelected) {
        fillColor = "#3730a3";
        strokeColor = "#fbbf24";
        strokeWidth = 2.5;
      } else if (isHovered) {
        fillColor = "#1e293b";
        strokeColor = "#38bdf8";
        strokeWidth = 1.6;
      }

      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }

    // Highlight active trading partners if a country is selected
    if (this.selectedIso && this.energyDb && this.energyDb.countries[this.selectedIso]) {
      const c = this.energyDb.countries[this.selectedIso];
      const supplierIsos = new Set(c.imports.map(i => i.from));
      const clientIsos = new Set(c.exports.map(e => e.to));

      for (const feat of this.geoData.features) {
        const iso = feat.id;
        if (iso === this.selectedIso) continue;

        if (supplierIsos.has(iso) || clientIsos.has(iso)) {
          ctx.beginPath();
          if (this.drawFeatureGeometry(ctx, feat.geometry)) {
            if (supplierIsos.has(iso)) {
              ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
              ctx.lineWidth = 1.8;
              ctx.stroke();
            } else if (clientIsos.has(iso)) {
              ctx.strokeStyle = "rgba(249, 115, 22, 0.85)";
              ctx.lineWidth = 1.8;
              ctx.stroke();
            }
          }
        }
      }
    }

    // Draw Subtle Pulsing Rings on Top 5 Global Energy Hubs when no country is selected
    if (!this.selectedIso && this.energyDb) {
      this.drawTopHubPulses(ctx);
    }
  }

  drawTopHubPulses(ctx) {
    const topHubs = ["USA", "SAU", "RUS", "CHN", "QAT", "AUS"];
    const now = Date.now() / 1000;

    ctx.save();
    for (const iso of topHubs) {
      const c = this.energyDb.countries[iso];
      if (!c || !c.centroid) continue;
      const p = this.project(c.centroid[0], c.centroid[1]);
      if (!p) continue;

      const pulsePhase = (now + (iso.charCodeAt(0) % 5)) % 2;
      const radius = 6 + pulsePhase * 12;
      const alpha = Math.max(0, 1 - pulsePhase * 0.5);

      ctx.beginPath();
      ctx.arc(p[0], p[1], radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245, 158, 11, ${alpha * 0.5})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 8;
      ctx.fill();
    }
    ctx.restore();
  }

  drawGraticule(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
    ctx.lineWidth = 0.5;

    for (let lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      let started = false;
      for (let lon = -180; lon <= 180; lon += 5) {
        const p = this.project(lon, lat);
        if (p) {
          if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
          else { ctx.lineTo(p[0], p[1]); }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    for (let lon = -180; lon < 180; lon += 45) {
      ctx.beginPath();
      let started = false;
      for (let lat = -80; lat <= 80; lat += 5) {
        const p = this.project(lon, lat);
        if (p) {
          if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
          else { ctx.lineTo(p[0], p[1]); }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFeatureGeometry(ctx, geom) {
    if (!geom) return false;
    let anyDrawn = false;

    const drawRing = (ring) => {
      let started = false;
      for (let i = 0; i < ring.length; i++) {
        const p = this.project(ring[i][0], ring[i][1]);
        if (p) {
          if (!started) {
            ctx.moveTo(p[0], p[1]);
            started = true;
            anyDrawn = true;
          } else {
            ctx.lineTo(p[0], p[1]);
          }
        } else {
          started = false;
        }
      }
    };

    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) {
        drawRing(ring);
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        for (const ring of poly) {
          drawRing(ring);
        }
      }
    }
    return anyDrawn;
  }

  /* ========================================================================
     Choropleth Color Scale
     ======================================================================== */
  getChoroplethColor(iso) {
    if (!this.energyDb.countries[iso]) return "#131d31";
    const m = this.energyDb.countries[iso].metrics;

    let val = 0, max = 1;
    switch (this.activeChoropleth) {
      case "oil_cons":
        val = m.oil.cons_kbd; max = 19000;
        return this.interpolateColor("#0f172a", "#f59e0b", val / max);
      case "oil_prod":
        val = m.oil.prod_kbd; max = 13500;
        return this.interpolateColor("#0f172a", "#ef4444", val / max);
      case "gas_cons":
        val = m.gas.cons_bcm; max = 820;
        return this.interpolateColor("#0f172a", "#06b6d4", val / max);
      case "gas_prod":
        val = m.gas.prod_bcm; max = 940;
        return this.interpolateColor("#0f172a", "#3b82f6", val / max);
      case "coal_cons":
        val = m.coal.cons_mt; max = 3000;
        return this.interpolateColor("#0f172a", "#a855f7", val / max);
      case "clean_share":
        val = m.clean.clean_share_pct; max = 100;
        return this.interpolateColor("#0f172a", "#10b981", val / max);
      case "net_balance":
        val = m.oil.net_kbd;
        return val > 0
          ? this.interpolateColor("#131d31", "#10b981", Math.min(val / 5000, 1))
          : this.interpolateColor("#131d31", "#f97316", Math.min(Math.abs(val) / 10000, 1));
      default:
        return "#131d31";
    }
  }

  interpolateColor(c1, c2, t) {
    const clampT = Math.max(0, Math.min(1, t));
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    return `rgb(${Math.round(r1 + (r2 - r1) * clampT)}, ${Math.round(g1 + (g2 - g1) * clampT)}, ${Math.round(b1 + (b2 - b1) * clampT)})`;
  }

  /* ========================================================================
     Realistic Maritime & Pipeline Flow Engine
     ======================================================================== */
  updateActiveFlows() {
    this.particles = [];
    if (!this.energyDb) return;

    let flows = this.energyDb.flows;

    // Filter by commodity
    if (this.activeCommodity !== "all") {
      flows = flows.filter(f => f.commodity.startsWith(this.activeCommodity));
    }

    // Filter by chokepoint
    if (this.activeChokepointId) {
      const cp = this.getChokepoint(this.activeChokepointId);
      const allowed = cp && cp.affected_routes ? new Set(cp.affected_routes) : new Set();
      flows = flows.filter(f => (f.chokepoints && f.chokepoints.includes(this.activeChokepointId)) || allowed.has(f.id));
    }

    // Crucial: Only show flows if country is selected, OR if user toggled "showGlobalArteries"!
    if (this.selectedIso) {
      if (this.flowFilterDirection === "inflows") {
        flows = flows.filter(f => f.to === this.selectedIso);
      } else if (this.flowFilterDirection === "outflows") {
        flows = flows.filter(f => f.from === this.selectedIso);
      } else {
        flows = flows.filter(f => f.from === this.selectedIso || f.to === this.selectedIso);
      }
    } else if (!this.showGlobalArteries && !this.activeChokepointId) {
      // Non-overwhelming default: No crisscrossing lines initially!
      flows = [];
    } else if (this.showGlobalArteries) {
      // Top 20 mega-arteries only
      flows = flows.slice(0, 20);
    }

    this.activeFlows = flows;

    // Spawn realistic vessels (tankers) and pipeline pulses
    for (const flow of flows) {
      const isImport = this.selectedIso && flow.to === this.selectedIso;
      const isExport = this.selectedIso && flow.from === this.selectedIso;

      let vol = flow.volume_kbd || flow.volume_bcm * 15 || flow.volume_mt * 10;
      let count = Math.max(2, Math.min(6, Math.round(Math.log10(vol + 1) * 2)));

      for (let i = 0; i < count; i++) {
        this.particles.push({
          flow: flow,
          progress: Math.random(),
          speed: 0.002 + Math.random() * 0.0025,
          isImport: isImport,
          isExport: isExport
        });
      }
    }
  }

  startAnimationLoop() {
    const loop = (timestamp) => {
      this.lastTime = timestamp;

      if (this.autoRotate && this.mode === "3d" && !this.isDragging) {
        this.rotLambda = (this.rotLambda + 0.18) % 360;
        this.renderMap();
      }

      this.renderFlows();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  renderFlows() {
    const ctx = this.flowCtx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (!this.activeFlows.length) return;

    // 1. Render Maritime Shipping Lanes & Pipeline Infrastructure Paths
    for (const flow of this.activeFlows) {
      const isHovered = this.hoveredFlow && this.hoveredFlow.id === flow.id;
      const isPipeline = flow.transport === "pipeline";

      let strokeColor = "rgba(245, 158, 11, 0.35)"; // Oil Amber
      if (flow.commodity.startsWith("gas")) strokeColor = "rgba(6, 182, 212, 0.35)"; // Gas Cyan
      else if (flow.commodity === "coal") strokeColor = "rgba(148, 163, 184, 0.35)"; // Coal Slate

      if (this.selectedIso) {
        if (flow.to === this.selectedIso) strokeColor = "rgba(56, 189, 248, 0.75)"; // Inflow Cyan
        else if (flow.from === this.selectedIso) strokeColor = "rgba(249, 115, 22, 0.75)"; // Outflow Orange
      }

      if (isHovered) {
        strokeColor = "#ffffff";
      }

      this.drawMultiWaypointPath(ctx, flow.waypoints, strokeColor, isPipeline ? 2.0 : 1.4, isPipeline);
    }

    // 2. Render Moving Vessel Tankers (🚢) and Pipeline Pulses
    for (const p of this.particles) {
      p.progress += p.speed;
      if (p.progress >= 1) p.progress = 0;

      const pt = this.getSplinePoint(p.flow.waypoints, p.progress);
      if (!pt) continue;

      const isPipeline = p.flow.transport === "pipeline";

      let vesselColor = "#fbbf24";
      let glowColor = "rgba(245, 158, 11, 0.85)";

      if (p.flow.commodity.startsWith("gas")) {
        vesselColor = "#38bdf8";
        glowColor = "rgba(6, 182, 212, 0.85)";
      } else if (p.flow.commodity === "coal") {
        vesselColor = "#cbd5e1";
        glowColor = "rgba(148, 163, 184, 0.85)";
      }

      if (this.selectedIso) {
        if (p.isImport) {
          vesselColor = "#38bdf8";
          glowColor = "rgba(56, 189, 248, 0.95)";
        } else if (p.isExport) {
          vesselColor = "#f97316";
          glowColor = "rgba(249, 115, 22, 0.95)";
        }
      }

      ctx.save();
      if (isPipeline) {
        // Pipeline: Directional Chevron Pulse
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = vesselColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 10;
        ctx.fill();
      } else {
        // Maritime Sea Lane: Sleek Tanker Vessel Triangle
        const angle = pt.heading || 0;
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);

        // Vessel Hull
        ctx.beginPath();
        ctx.moveTo(6, 0);       // Bow
        ctx.lineTo(-4, -3.2);   // Port stern
        ctx.lineTo(-2, 0);      // Center keel
        ctx.lineTo(-4, 3.2);    // Starboard stern
        ctx.closePath();

        ctx.fillStyle = vesselColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 12;
        ctx.fill();

        // Wake trail
        ctx.beginPath();
        ctx.moveTo(-4, 0);
        ctx.lineTo(-12, 0);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawMultiWaypointPath(ctx, waypoints, color, width, isPipeline) {
    if (!waypoints || waypoints.length < 2) return;

    ctx.save();
    ctx.beginPath();

    if (isPipeline) {
      ctx.setLineDash([6, 4]); // Segmented pipeline appearance
    } else {
      ctx.setLineDash([]);
    }

    let started = false;
    for (let i = 0; i < waypoints.length; i++) {
      const p = this.project(waypoints[i][0], waypoints[i][1]);
      if (!p) {
        started = false;
        continue;
      }

      if (!started) {
        ctx.moveTo(p[0], p[1]);
        started = true;
      } else {
        ctx.lineTo(p[0], p[1]);
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  getSplinePoint(waypoints, t) {
    if (!waypoints || waypoints.length < 2) return null;

    // Convert waypoints to projected screen coordinates
    const projectedPts = [];
    for (const wp of waypoints) {
      const p = this.project(wp[0], wp[1]);
      if (p) projectedPts.push(p);
    }

    if (projectedPts.length < 2) return null;

    // Calculate total path distance
    let totalDist = 0;
    const segDists = [];
    for (let i = 0; i < projectedPts.length - 1; i++) {
      const dx = projectedPts[i + 1][0] - projectedPts[i][0];
      const dy = projectedPts[i + 1][1] - projectedPts[i][1];
      const d = Math.hypot(dx, dy);
      segDists.push(d);
      totalDist += d;
    }

    if (totalDist === 0) return null;

    // Target distance along polyline
    const targetDist = t * totalDist;
    let accumulated = 0;

    for (let i = 0; i < segDists.length; i++) {
      const segD = segDists[i];
      if (accumulated + segD >= targetDist || i === segDists.length - 1) {
        const segT = segD > 0 ? (targetDist - accumulated) / segD : 0;
        const p1 = projectedPts[i];
        const p2 = projectedPts[i + 1];

        const x = p1[0] + (p2[0] - p1[0]) * segT;
        const y = p1[1] + (p2[1] - p1[1]) * segT;
        const heading = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);

        return { x, y, heading };
      }
      accumulated += segD;
    }

    return null;
  }

  getChokepoint(id) {
    return STRATEGIC_CHOKEPOINTS.find(c => c.id === id);
  }

  /* ========================================================================
     User Interactions (Drag, Zoom, Route Inspector Hit Testing)
     ======================================================================== */
  initEvents() {
    const container = this.container;

    container.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.dragStartPanX = this.panX;
      this.dragStartPanY = this.panY;
      this.dragStartRotL = this.rotLambda;
      this.dragStartRotP = this.rotPhi;
    });

    window.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isDragging) {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;

        if (this.mode === "2d") {
          this.panX = this.dragStartPanX + dx;
          this.panY = this.dragStartPanY + dy;
        } else {
          this.rotLambda = this.dragStartRotL + dx * 0.35;
          this.rotPhi = Math.max(-80, Math.min(80, this.dragStartRotP - dy * 0.35));
        }
        this.renderMap();
      } else {
        // 1. Route Inspector Hit-Testing on active corridors
        const hoveredRoute = this.hitTestRoute(mouseX, mouseY);
        if (hoveredRoute !== this.hoveredFlow) {
          this.hoveredFlow = hoveredRoute;
          this.onRouteHover(hoveredRoute, e.clientX, e.clientY);
        }

        // 2. Country Hit-Testing on hover
        const inv = this.invert(mouseX, mouseY);
        if (inv) {
          const iso = this.hitTest(inv[0], inv[1]);
          if (iso !== this.hoveredIso) {
            this.hoveredIso = iso;
            this.renderMap();
            this.onCountryHover(iso, e.clientX, e.clientY);
          }
        } else if (this.hoveredIso) {
          this.hoveredIso = null;
          this.renderMap();
          this.onCountryHover(null);
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      const moved = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
      if (moved < 6) {
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Check route click first
        const clickedRoute = this.hitTestRoute(mouseX, mouseY);
        if (clickedRoute) {
          this.onRouteHover(clickedRoute, e.clientX, e.clientY, true);
          return;
        }

        // Check country click
        const inv = this.invert(mouseX, mouseY);
        if (inv) {
          const iso = this.hitTest(inv[0], inv[1]);
          if (iso) {
            this.selectCountry(iso);
            this.onCountrySelect(iso);
          }
        }
      }
    });

    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      this.zoom(zoomFactor);
    }, { passive: false });
  }

  hitTestRoute(mouseX, mouseY) {
    if (!this.activeFlows.length) return null;

    const threshold = 9; // pixels
    for (const flow of this.activeFlows) {
      if (!flow.waypoints || flow.waypoints.length < 2) continue;

      for (let i = 0; i < flow.waypoints.length - 1; i++) {
        const p1 = this.project(flow.waypoints[i][0], flow.waypoints[i][1]);
        const p2 = this.project(flow.waypoints[i + 1][0], flow.waypoints[i + 1][1]);
        if (!p1 || !p2) continue;

        const dist = this.distToSegment([mouseX, mouseY], p1, p2);
        if (dist <= threshold) {
          return flow;
        }
      }
    }
    return null;
  }

  distToSegment(p, v, w) {
    const l2 = Math.hypot(v[0] - w[0], v[1] - w[1]) ** 2;
    if (l2 === 0) return Math.hypot(p[0] - v[0], p[1] - v[1]);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (v[0] + t * (w[0] - v[0])), p[1] - (v[1] + t * (w[1] - v[1])));
  }

  hitTest(lon, lat) {
    if (!this.geoData) return null;

    for (const feat of this.geoData.features) {
      const geom = feat.geometry;
      if (geom.type === "Polygon") {
        if (this.pointInPolygon([lon, lat], geom.coordinates[0])) {
          return feat.id;
        }
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          if (this.pointInPolygon([lon, lat], poly[0])) {
            return feat.id;
          }
        }
      }
    }
    return null;
  }

  pointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
