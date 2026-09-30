// Canvas map renderer on d3-geo: flat (Equal Earth) and globe (orthographic) projections,
// choropleth fills, routed trade flows with particles, chokepoints and infrastructure.
/* global d3, topojson */

import { palette, withAlpha } from "./colors.js";

const TAU = Math.PI * 2;
const MAX_ZOOM = 14;
// Portrait screens start zoomed in on this point (lon, lat): the Gulf-to-Asia trade at the centre of the story.
const PORTRAIT_FOCUS = [62, 20];
const STATUS_RANK = { closed: 0, high_risk: 1, restricted: 2, open: 3 };

export class MapView {
  constructor(el, { onHover, onClick, onResize } = {}) {
    this.el = el;
    this.onHover = onHover || (() => {});
    this.onClick = onClick || (() => {});
    this.onResize = onResize || (() => {});
    this.base = document.createElement("canvas");
    this.top = document.createElement("canvas");
    el.append(this.base, this.top);
    this.bctx = this.base.getContext("2d");
    this.tctx = this.top.getContext("2d");
    this.mode = "flat";
    this.rotate = [-20, -20, 0];
    this.globeK = 1;
    this.t = d3.zoomIdentity;
    this.features = [];
    this.fills = new Map(); // iso -> color
    this.flows = []; // visible flows (route segments)
    this.flowStyle = new Map(); // id -> { alpha, emphasis, disrupted }
    this.geomCache = new Map(); // flow id -> [[lon,lat],...]
    this.chokepoints = [];
    this.pipelines = [];
    this.terminals = [];
    this.hover = null;
    this.selectedIso = null;
    this.highlightIsos = new Set();
    this.dimOthers = false;
    this.layers = { particles: true, labels: true, pipelines: false, terminals: false };
    this.interacting = false;
    this.dirtyBase = true;
    this.lastFrame = 0;
    this.time = 0;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.fontFamily = getComputedStyle(document.body).fontFamily;
    this.minK = 1;
    this.sizeK = 1;
    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(el);
    this._resize();
    this._initZoom();
    this._initPointer();
    requestAnimationFrame((ts) => this._frame(ts));
  }

  // ------------------------------------------------------------------ data
  setWorld(topo, resolution) {
    const obj = topo.objects.countries;
    const fc = topojson.feature(topo, obj);
    const features = fc.features.map((f) => ({ id: f.id, name: f.properties.name, geo: f, bounds: d3.geoBounds(f) }));
    const mesh = topojson.mesh(topo, obj, (a, b) => a !== b);
    const land = topojson.merge(topo, obj.geometries);
    if (resolution === "50m") {
      this.hi = { features, mesh, land };
    } else {
      this.lo = { features, mesh, land };
    }
    this.features = (this.hi || this.lo).features;
    this._paths = null;
    this.dirtyBase = true;
  }

  setNodes(nodes) {
    this.nodes = nodes;
  }

  setFills(fills) {
    this.fills = fills;
    this.dirtyBase = true;
  }

  setHighlight({ selectedIso = null, highlight = [], dimOthers = false } = {}) {
    this.selectedIso = selectedIso;
    this.highlightIsos = new Set(highlight);
    this.dimOthers = dimOthers;
    this.dirtyBase = true;
  }

  setFlows(flows, { valueOf, styleOf, maxWidth = 9 } = {}) {
    this.flows = flows;
    this.valueOf = valueOf || ((f) => f.v);
    this.styleOf = styleOf || (() => ({}));
    this.maxWidth = maxWidth;
    const vmax = d3.max(flows, (f) => this.valueOf(f)) || 1;
    this.vmax = vmax;
    this._flowProj = null;
    this._seedParticles();
  }

  setChokepoints(list, { visible = true, selected = null, labels = false } = {}) {
    this.chokepoints = visible ? list : [];
    this.cpSelected = selected;
    this.cpLabels = labels;
  }

  setInfrastructure({ pipelines = [], terminals = [] } = {}) {
    this.pipelines = pipelines;
    this.terminals = terminals;
    this._pipeProj = null;
  }

  setLayers(layers) {
    this.layers = { ...this.layers, ...layers };
    this._seedParticles();
    this.dirtyBase = true;
  }

  setTheme() {
    palette();
    this.dirtyBase = true;
  }

  // ------------------------------------------------------------------ projection & view
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.t = d3.zoomIdentity;
    this.globeK = 1;
    d3.select(this.top).call(this.zoom.transform, d3.zoomIdentity);
    this._fit();
    this._paths = null;
    this._flowProj = null;
    this._pipeProj = null;
    this.dirtyBase = true;
    this._seedParticles();
  }

  /** Screen area not covered by floating panels: { left, right, top, bottom } in px. */
  setInsets(insets) {
    this.insets = insets;
    this._fit();
    this._paths = null;
    this._flowProj = null;
    this._pipeProj = null;
    this.dirtyBase = true;
    this._seedParticles();
  }

  _fit() {
    const { w, h } = this;
    let ins = this.insets || { left: 0, right: 0, top: 0, bottom: 0 };
    // Insets computed for a different layout (e.g. mid-resize) must never invert the extent.
    if (w - ins.left - ins.right < 160 || h - ins.top - ins.bottom < 120) ins = { left: 0, right: 0, top: ins.top, bottom: 0 };
    const x0 = ins.left + 8;
    const x1 = w - ins.right - 8;
    const y0 = ins.top + 6;
    const y1 = h - ins.bottom - 6;
    this.minK = 1;
    let visibleW;
    if (this.mode === "flat") {
      this.proj = d3.geoEqualEarth().rotate([-10, 0]).precision(0.3);
      this.proj.fitExtent([[x0, y0], [x1, y1]], { type: "Sphere" });
      // On a portrait screen the whole world is a thin strip. Enlarge it around PORTRAIT_FOCUS instead;
      // panning reaches the rest and pinching out (down to minK) shows the whole world.
      const [[sx0, sy0], [sx1, sy1]] = d3.geoPath(this.proj).bounds({ type: "Sphere" });
      const grow = Math.min(2.2, (0.62 * (y1 - y0)) / (sy1 - sy0));
      if (y1 - y0 > 1.1 * (x1 - x0) && grow > 1.1) {
        this.proj.scale(this.proj.scale() * grow);
        const [fx] = this.proj(PORTRAIT_FOCUS);
        const [tx, ty] = this.proj.translate();
        this.proj.translate([tx + (x0 + x1) / 2 - fx, ty]);
        this.minK = 1 / grow;
      }
      visibleW = Math.min(x1 - x0, (sx1 - sx0) / this.minK);
    } else {
      const r = Math.min(x1 - x0, y1 - y0) * 0.46 * this.globeK;
      this.proj = d3.geoOrthographic().rotate(this.rotate).translate([(x0 + x1) / 2, (y0 + y1) / 2]).scale(r).clipAngle(90).precision(0.4);
      visibleW = Math.min(x1 - x0, (2 * r) / this.globeK);
    }
    // Flow widths are in pixels: scale them with the map so a phone doesn't get the lines of a desktop.
    this.sizeK = Math.max(0.5, Math.min(1, visibleW / 900));
    this.baseScale = this.proj.scale();
    this.zoom?.scaleExtent([this.minK, MAX_ZOOM]);
  }

  /** Centre of the visible map area. */
  viewCenter() {
    const ins = this.insets || { left: 0, right: 0, top: 0, bottom: 0 };
    return [(ins.left + this.w - ins.right) / 2, (ins.top + this.h - ins.bottom) / 2];
  }

  _resize() {
    const r = this.el.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.base, this.top]) {
      c.width = Math.round(this.w * this.dpr);
      c.height = Math.round(this.h * this.dpr);
    }
    this._fit();
    this._paths = null;
    this._flowProj = null;
    this._pipeProj = null;
    this.dirtyBase = true;
    this._seedParticles();
    this.onResize();
  }

  _initZoom() {
    let last = d3.zoomIdentity;
    this.zoom = d3.zoom()
      .scaleExtent([this.minK, MAX_ZOOM])
      .clickDistance(4)
      .on("start", () => {
        this.interacting = true;
        this.el.classList.add("dragging");
      })
      .on("zoom", (ev) => {
        const t = ev.transform;
        if (this.mode === "flat") {
          this.t = t;
        } else {
          const dk = t.k / last.k;
          if (Math.abs(dk - 1) > 1e-6) {
            this.globeK = t.k;
          } else {
            const dx = t.x - last.x;
            const dy = t.y - last.y;
            const s = 0.25 / this.globeK;
            this.rotate = [this.rotate[0] + dx * s, Math.max(-80, Math.min(80, this.rotate[1] - dy * s)), 0];
          }
          this._fit();
          this._flowProj = null;
          this._pipeProj = null;
        }
        last = t;
        this.dirtyBase = true;
        this._hideHover();
      })
      .on("end", () => {
        this.interacting = false;
        this.el.classList.remove("dragging");
        this.dirtyBase = true;
        this._flowProj = null;
        this._seedParticles();
      });
    d3.select(this.top).call(this.zoom).on("dblclick.zoom", null);
  }

  zoomBy(factor) {
    d3.select(this.top).transition().duration(300).call(this.zoom.scaleBy, factor);
  }

  reset() {
    if (this.mode === "globe") {
      this.rotate = [-20, -20, 0];
      this.globeK = 1;
      this._fit();
    }
    d3.select(this.top).transition().duration(600).call(this.zoom.transform, d3.zoomIdentity);
    this.dirtyBase = true;
  }

  /** Centre on a lon/lat (and optional zoom) with a smooth transition. */
  flyTo([lon, lat], k = null) {
    if (this.mode === "globe") {
      const from = this.rotate.slice();
      const to = [-lon, -Math.max(-60, Math.min(60, lat)), 0];
      const i = d3.interpolate(from, to);
      this.interacting = true; // coarse geometry while animating keeps the tween smooth
      d3.transition().duration(900).tween("rotate", () => (tt) => {
        this.rotate = i(tt);
        this._fit();
        this._flowProj = null;
        this._pipeProj = null;
        this.dirtyBase = true;
      }).on("end interrupt", () => {
        this.interacting = false;
        this.dirtyBase = true;
        this._flowProj = null;
        this._seedParticles();
      });
      return;
    }
    const p = this.proj([lon, lat]);
    if (!p) return;
    const kk = k ?? Math.max(this.t.k, 1.6);
    const [cx, cy] = this.viewCenter();
    const t = d3.zoomIdentity.translate(cx - p[0] * kk, cy - p[1] * kk).scale(kk);
    d3.select(this.top).transition().duration(900).call(this.zoom.transform, t);
  }

  /** Fit a set of lon/lat points in view (flat mode). */
  fitPoints(points) {
    if (this.mode === "globe" || !points.length) {
      if (points.length) this.flyTo(points[0]);
      return;
    }
    const xy = points.map((p) => this.proj(p)).filter(Boolean);
    const [x0, x1] = d3.extent(xy, (d) => d[0]);
    const [y0, y1] = d3.extent(xy, (d) => d[1]);
    const ins = this.insets || { left: 0, right: 0, top: 0, bottom: 0 };
    const availW = this.w - ins.left - ins.right - 60;
    const availH = this.h - ins.top - ins.bottom - 40;
    const k = Math.max(this.minK, Math.min(6, 0.85 / Math.max((x1 - x0) / availW, (y1 - y0) / availH, 1e-3)));
    const [cx, cy] = this.viewCenter();
    const t = d3.zoomIdentity.translate(cx - ((x0 + x1) / 2) * k, cy - ((y0 + y1) / 2) * k).scale(k);
    d3.select(this.top).transition().duration(900).call(this.zoom.transform, t);
  }

  // ------------------------------------------------------------------ geometry helpers
  _world() {
    // Use coarse geometry while dragging the globe, detailed when idle.
    if (this.mode === "globe" && this.interacting && this.lo) return this.lo;
    return this.hi || this.lo;
  }

  _flatPaths() {
    const world = this._world();
    if (this._paths && this._paths.world === world) return this._paths;
    const path = d3.geoPath(this.proj);
    const byId = new Map();
    for (const f of world.features) byId.set(f, new Path2D(path(f.geo) || ""));
    this._paths = {
      world, byId, mesh: new Path2D(path(world.mesh) || ""), sphere: new Path2D(path({ type: "Sphere" })),
      graticule: new Path2D(path(d3.geoGraticule10())),
    };
    return this._paths;
  }

  flowCoords(f) {
    let c = this.geomCache.get(f.id);
    if (c) return c;
    const pts = [];
    const push = (p) => pts.push(p);
    if (f.mode === "sea" && f.path) {
      (f.legA || []).forEach(push);
      f.path.forEach((i) => push(this.nodes[i]));
      (f.legB || []).forEach(push);
    } else if (f.line) {
      f.line.forEach(push);
    }
    c = densify(pts, 1.5);
    this.geomCache.set(f.id, c);
    return c;
  }

  _projectLine(coords) {
    // Returns array of screen points (with nulls splitting hidden/clipped runs).
    const out = [];
    if (this.mode === "flat") {
      const { k, x, y } = this.t;
      for (const p of coords) {
        const q = this.proj(p);
        out.push(q ? [q[0] * k + x, q[1] * k + y] : null);
      }
      // Break segments that jump across the antimeridian.
      for (let i = 1; i < out.length; i++) {
        if (out[i] && out[i - 1] && Math.abs(out[i][0] - out[i - 1][0]) > this.w * 0.5 * k) out.splice(i, 0, null), i++;
      }
      return out;
    }
    const center = [-this.rotate[0], -this.rotate[1]];
    for (const p of coords) {
      if (d3.geoDistance(p, center) > Math.PI / 2 - 0.02) out.push(null);
      else out.push(this.proj(p));
    }
    return out;
  }

  _projectedFlows() {
    if (this._flowProj) return this._flowProj;
    this._flowProj = new Map();
    for (const f of this.flows) {
      const pts = this._projectLine(this.flowCoords(f));
      // Split into visible runs and measure them for particles.
      const runs = [];
      let run = [];
      for (const p of pts) {
        if (p) run.push(p);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
      const measured = runs.filter((r) => r.length > 1).map((r) => {
        const cum = [0];
        for (let i = 1; i < r.length; i++) cum.push(cum[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]));
        return { pts: r, cum, len: cum[cum.length - 1] };
      });
      this._flowProj.set(f.id, measured);
    }
    return this._flowProj;
  }

  _seedParticles() {
    this.particles = [];
    if (!this.layers.particles || this.reduceMotion) return;
    const proj = this._projectedFlows();
    let budget = 2200;
    const flows = [...this.flows].sort((a, b) => this.valueOf(b) - this.valueOf(a));
    for (const f of flows) {
      const runs = proj.get(f.id) || [];
      const st = this.styleOf(f);
      if (st.hidden) continue;
      const frac = Math.sqrt(this.valueOf(f) / this.vmax);
      for (const run of runs) {
        if (run.len < 8) continue;
        const n = Math.max(1, Math.min(40, Math.round((run.len / 55) * (0.35 + frac))));
        for (let i = 0; i < n && budget > 0; i++, budget--) {
          this.particles.push({ f, run, off: Math.random() });
        }
      }
    }
  }

  // ------------------------------------------------------------------ rendering
  _frame(ts) {
    const dt = Math.min(64, ts - (this.lastFrame || ts));
    this.lastFrame = ts;
    this.time += dt;
    if (this.dirtyBase) {
      this._drawBase();
      this.dirtyBase = false;
      this._flowProj = this.interacting ? null : this._flowProj;
    }
    this._drawTop(dt);
    requestAnimationFrame((t) => this._frame(t));
  }

  _drawBase() {
    const ctx = this.bctx;
    const P = palette();
    const { dpr, w, h } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    if (!this.lo && !this.hi) return;
    const fillFor = (iso) => {
      let c = this.fills.get(iso) ?? P.land;
      if (this.dimOthers && !this.highlightIsos.has(iso) && iso !== this.selectedIso) c = mix(c, P.landMuted, 0.55);
      if (this.hover?.type === "country" && this.hover.id === iso) c = brighten(c, P.theme);
      return c;
    };
    if (this.mode === "flat") {
      const paths = this._flatPaths();
      const { k, x, y } = this.t;
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
      ctx.fillStyle = P.ocean;
      ctx.fill(paths.sphere);
      ctx.strokeStyle = P.graticule;
      ctx.lineWidth = 1 / k;
      ctx.stroke(paths.graticule);
      for (const f of paths.world.features) {
        ctx.fillStyle = fillFor(f.id);
        ctx.fill(paths.byId.get(f));
      }
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 0.6 / k;
      ctx.stroke(paths.mesh);
      this._outlineSelected(ctx, (f) => paths.byId.get(f), k);
      ctx.strokeStyle = withAlpha(P.text3, 0.35);
      ctx.lineWidth = 1 / k;
      ctx.stroke(paths.sphere);
    } else {
      const world = this._world();
      const path = d3.geoPath(this.proj, ctx);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // atmosphere
      const [cx, cy] = this.proj.translate();
      const r = this.proj.scale();
      const g = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.12);
      g.addColorStop(0, withAlpha(P.accent, P.theme === "light" ? 0.18 : 0.22));
      g.addColorStop(1, withAlpha(P.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.12, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fillStyle = P.ocean;
      ctx.fill();
      ctx.beginPath();
      path(d3.geoGraticule10());
      ctx.strokeStyle = P.graticule;
      ctx.lineWidth = 1;
      ctx.stroke();
      for (const f of world.features) {
        ctx.beginPath();
        path(f.geo);
        ctx.fillStyle = fillFor(f.id);
        ctx.fill();
      }
      ctx.beginPath();
      path(world.mesh);
      ctx.strokeStyle = P.border;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      this._outlineSelected(ctx, (f) => {
        const p = new Path2D();
        d3.geoPath(this.proj, p)(f.geo);
        return p;
      }, 1);
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.strokeStyle = withAlpha(P.text3, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  _outlineSelected(ctx, pathOf, k) {
    const P = palette();
    const world = this._world();
    const outline = (iso, color, width) => {
      for (const f of world.features) {
        if (f.id !== iso) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = width / k;
        ctx.stroke(pathOf(f));
      }
    };
    if (this.hover?.type === "country") outline(this.hover.id, withAlpha(P.text, 0.55), 1.2);
    if (this.selectedIso) outline(this.selectedIso, P.text, 1.8);
  }

  /** Stroke width in px for a flow value at the starting zoom (the legend uses it too). */
  flowWidth(v) {
    const max = this.maxWidth * this.sizeK;
    return 0.7 + (max - 0.7) * Math.sqrt(Math.max(0, v) / this.vmax);
  }

  _widthOf(f) {
    const zoomBoost = this.mode === "flat" ? Math.max(0.6, Math.min(1.8, 1 + Math.log2(this.t.k) * 0.25)) : Math.min(1.6, this.globeK ** 0.4);
    return this.flowWidth(this.valueOf(f)) * zoomBoost;
  }

  _drawTop(dt) {
    const ctx = this.tctx;
    const P = palette();
    const { dpr, w, h } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.nodes) return;

    // Infrastructure (under flows)
    if (this.layers.pipelines && this.pipelines.length) this._drawPipelines(ctx, P);

    const proj = this._projectedFlows();
    const hoverId = this.hover?.type === "flow" ? this.hover.id : null;
    const ordered = [...this.flows].sort((a, b) => this.valueOf(a) - this.valueOf(b));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const emphasized = [];
    for (const f of ordered) {
      const st = this.styleOf(f);
      if (st.hidden) continue;
      if (f.id === hoverId || st.emphasis) {
        emphasized.push([f, st]);
        continue;
      }
      this._strokeFlow(ctx, f, st, proj, P, false);
    }
    for (const [f, st] of emphasized) this._strokeFlow(ctx, f, st, proj, P, f.id === hoverId);

    // Particles
    if (this.particles?.length && !this.interacting) {
      const speed = 38; // px per second
      for (const p of this.particles) {
        const st = this.styleOf(p.f);
        if (st.hidden || st.disrupted) continue;
        p.off = (p.off + (speed * dt) / 1000 / p.run.len) % 1;
        const pt = pointAt(p.run, p.off);
        if (!pt) continue;
        const col = P.commodity[p.f.c];
        const a = (st.alpha ?? 0.8) * (st.dim ? 0.35 : 1);
        ctx.fillStyle = withAlpha(P.theme === "light" ? d3.color(col).darker(0.6) : d3.color(col).brighter(0.8), Math.min(1, a + 0.15));
        const r = Math.max(1.1, Math.min(2.6, this._widthOf(p.f) * 0.32));
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], r, 0, TAU);
        ctx.fill();
      }
    }

    if (this.layers.terminals && this.terminals.length) this._drawTerminals(ctx, P);
    // Labels share one list of occupied boxes so they never overprint each other or a chokepoint marker.
    // The selected country's name is reserved first; chokepoint names come next, then other countries.
    const placed = [];
    const selLabel = this.layers.labels ? this._countryLabel(ctx, this.selectedIso, 650) : null;
    if (selLabel) placed.push(selLabel.box);
    this._drawChokepoints(ctx, P, placed);
    if (this.layers.labels) this._drawLabels(ctx, P, placed, selLabel);
  }

  _strokeFlow(ctx, f, st, proj, P, hovered) {
    const runs = proj.get(f.id);
    if (!runs) return;
    const col = P.commodity[f.c] || P.accent;
    let alpha = st.alpha ?? (P.theme === "light" ? 0.62 : 0.55);
    if (st.dim) alpha *= 0.22;
    if (hovered) alpha = 0.95;
    const width = this._widthOf(f) * (hovered ? 1.35 : 1);
    ctx.setLineDash(st.disrupted ? [4, 4] : ["sea", "schematic"].includes(f.mode) ? [] : f.mode === "pipeline" ? [7, 3] : [2, 4]);
    if (hovered || st.emphasis) {
      ctx.strokeStyle = withAlpha(P.bg, 0.7);
      ctx.lineWidth = width + 3;
      for (const r of runs) strokeRun(ctx, r.pts);
    }
    ctx.strokeStyle = withAlpha(st.disrupted ? P.status.closed : col, alpha);
    ctx.lineWidth = width;
    for (const r of runs) strokeRun(ctx, r.pts);
    ctx.setLineDash([]);
  }

  _drawPipelines(ctx, P) {
    if (!this._pipeProj) {
      this._pipeProj = this.pipelines.map((p) => ({ p, pts: this._projectLine(densify(p.path, 1.5)) }));
    }
    for (const { p, pts } of this._pipeProj) {
      const col = p.commodity === "oil" ? P.commodity.oil : P.commodity.gas;
      const halted = p.status === "halted";
      const planned = p.status === "planned" || p.status === "construction";
      ctx.setLineDash(halted ? [2, 5] : planned ? [1, 4] : []);
      ctx.strokeStyle = withAlpha(halted ? P.text3 : col, halted ? 0.6 : 0.5);
      ctx.lineWidth = 1.6;
      let run = [];
      for (const q of pts) {
        if (q) run.push(q);
        else { strokeRun(ctx, run); run = []; }
      }
      strokeRun(ctx, run);
      ctx.setLineDash([]);
      if (p.status === "disrupted") {
        const mid = pts.filter(Boolean)[Math.floor(pts.filter(Boolean).length / 2)];
        if (mid) {
          ctx.fillStyle = P.status.high_risk;
          ctx.beginPath();
          ctx.arc(mid[0], mid[1], 2.6, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  _drawTerminals(ctx, P) {
    for (const t of this.terminals) {
      const q = this._projectPoint(t.coords);
      if (!q) continue;
      const s = 3.2;
      ctx.fillStyle = t.status === "disrupted" ? P.status.closed : P.commodity.lng;
      ctx.strokeStyle = P.bg;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(q[0], q[1] - s);
      ctx.lineTo(q[0] + s, q[1]);
      ctx.lineTo(q[0], q[1] + s);
      ctx.lineTo(q[0] - s, q[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  _projectPoint(p) {
    if (this.mode === "globe") {
      const center = [-this.rotate[0], -this.rotate[1]];
      if (d3.geoDistance(p, center) > Math.PI / 2 - 0.02) return null;
      return this.proj(p);
    }
    const q = this.proj(p);
    if (!q) return null;
    return [q[0] * this.t.k + this.t.x, q[1] * this.t.k + this.t.y];
  }

  _drawChokepoints(ctx, P, placed) {
    const pulse = (this.time % 2000) / 2000;
    this._cpScreen = [];
    const labels = [];
    for (const cp of this.chokepoints) {
      const q = this._projectPoint(cp.coords);
      if (!q) continue;
      this._cpScreen.push({ cp, q });
      const col = P.status[cp.status] || P.status.open;
      const selected = this.cpSelected === cp.id;
      const hovered = this.hover?.type === "chokepoint" && this.hover.id === cp.id;
      const r = selected || hovered ? 7 : 5.2;
      if ((cp.status === "closed" || cp.status === "high_risk") && !this.reduceMotion) {
        ctx.strokeStyle = withAlpha(col, 0.8 * (1 - pulse));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(q[0], q[1], r + 3 + pulse * 14, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.strokeStyle = P.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (cp.status === "closed") {
        ctx.strokeStyle = P.bg;
        ctx.lineWidth = 1.6;
        const s = r * 0.45;
        ctx.beginPath();
        ctx.moveTo(q[0] - s, q[1] - s);
        ctx.lineTo(q[0] + s, q[1] + s);
        ctx.moveTo(q[0] + s, q[1] - s);
        ctx.lineTo(q[0] - s, q[1] + s);
        ctx.stroke();
      }
      placed.push([q[0] - r - 2, q[1] - r - 2, 2 * r + 4, 2 * r + 4]);
      if (this.cpLabels || selected || hovered) {
        labels.push({ text: cp.name, q, r, force: selected || hovered, rank: STATUS_RANK[cp.status] ?? 9, weight: selected || hovered ? 600 : 550 });
      }
    }
    // Selected or hovered first, then by severity. Try right, left, above, below; skip a name with no free spot.
    labels.sort((a, b) => b.force - a.force || a.rank - b.rank);
    for (const l of labels) {
      ctx.font = this._font(l.weight);
      const tw = ctx.measureText(l.text).width;
      const [x, y] = l.q;
      const d = l.r + 5;
      const spots = [[x + d, y - 8], [x - d - tw, y - 8], [x - tw / 2, y - d - 16], [x - tw / 2, y + d]];
      const boxes = spots.map(([bx, by]) => [bx - 2, by, tw + 4, 16]);
      const box = boxes.find((b) => !placed.some((p) => overlap(p, b))) || (l.force ? boxes[0] : null);
      if (!box) continue;
      placed.push(box);
      label(ctx, l.text, box[0] + 2, box[1] + 12, P, this._font(l.weight));
    }
  }

  _font(weight) {
    return `${weight} 11.5px ${this.fontFamily}`;
  }

  /** Where a country's name goes (centred on its label point), or null when off-screen. */
  _countryLabel(ctx, iso, weight) {
    const lp = iso && this.labelPoints?.get(iso);
    const q = lp && this._projectPoint(lp.lp);
    if (!q) return null;
    ctx.font = this._font(weight);
    const tw = ctx.measureText(lp.name).width;
    return { iso, text: lp.name, x: q[0] - tw / 2, y: q[1] + 4, weight, box: [q[0] - tw / 2 - 4, q[1] - 9, tw + 8, 16] };
  }

  _drawLabels(ctx, P, placed, selLabel) {
    if (selLabel) label(ctx, selLabel.text, selLabel.x, selLabel.y, P, this._font(selLabel.weight));
    const list = [...this.highlightIsos].filter((iso) => iso !== this.selectedIso).slice(0, 40);
    for (const iso of list) {
      const l = this._countryLabel(ctx, iso, 550);
      if (!l || placed.some((b) => overlap(b, l.box))) continue;
      placed.push(l.box);
      label(ctx, l.text, l.x, l.y, P, this._font(l.weight));
    }
  }

  setLabelPoints(countries) {
    this.labelPoints = new Map(countries.filter((c) => c.lp).map((c) => [c.iso, c]));
  }

  // ------------------------------------------------------------------ interaction
  _initPointer() {
    const el = this.top;
    let raf = 0;
    el.addEventListener("pointermove", (ev) => {
      if (this.interacting) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this._handleHover(ev));
    });
    el.addEventListener("pointerleave", () => this._hideHover());
    el.addEventListener("click", (ev) => {
      const target = this.pick(ev.offsetX, ev.offsetY);
      this.onClick(target, ev);
    });
  }

  _hideHover() {
    if (this.hover) {
      this.hover = null;
      this.dirtyBase = true;
      this.el.classList.remove("pointer");
      this.onHover(null);
    }
  }

  _handleHover(ev) {
    const target = this.pick(ev.offsetX, ev.offsetY);
    const same = (a, b) => (a && b ? a.type === b.type && a.id === b.id : a === b);
    if (!same(target, this.hover)) {
      this.hover = target;
      this.dirtyBase = true;
    }
    this.el.classList.toggle("pointer", !!target);
    this.onHover(target, ev);
  }

  pick(x, y) {
    // 1. chokepoints
    for (const { cp, q } of this._cpScreen || []) {
      if (Math.hypot(q[0] - x, q[1] - y) < 11) return { type: "chokepoint", id: cp.id };
    }
    // 2. flows (closest within tolerance)
    const proj = this._projectedFlows();
    let best = null;
    for (const f of this.flows) {
      const st = this.styleOf(f);
      if (st.hidden || st.dim) continue;
      const tol = Math.max(5, this._widthOf(f) / 2 + 3);
      for (const run of proj.get(f.id) || []) {
        const d = distToRun(run.pts, x, y, tol);
        if (d < tol && (!best || d < best.d)) best = { d, id: f.id };
      }
    }
    if (best) return { type: "flow", id: best.id };
    // 3. countries
    const lonlat = this.invert(x, y);
    if (!lonlat) return null;
    const iso = this.countryAt(lonlat);
    return iso ? { type: "country", id: iso } : null;
  }

  invert(x, y) {
    if (this.mode === "flat") {
      const { k, x: tx, y: ty } = this.t;
      const p = this.proj.invert([(x - tx) / k, (y - ty) / k]);
      if (!p || !Number.isFinite(p[0])) return null;
      // Outside the Equal Earth sphere outline?
      const back = this.proj(p);
      if (!back || Math.hypot(back[0] - (x - tx) / k, back[1] - (y - ty) / k) > 2) return null;
      return p;
    }
    const [cx, cy] = this.proj.translate();
    if (Math.hypot(x - cx, y - cy) > this.proj.scale()) return null;
    const p = this.proj.invert([x, y]);
    return p && Number.isFinite(p[0]) ? p : null;
  }

  countryAt([lon, lat]) {
    const world = this.hi || this.lo;
    for (const f of world.features) {
      const [[x0, y0], [x1, y1]] = f.bounds;
      if (lat < y0 - 0.5 || lat > y1 + 0.5) continue;
      if (x0 <= x1 ? lon < x0 - 0.5 || lon > x1 + 0.5 : lon < x0 && lon > x1) continue;
      if (d3.geoContains(f.geo, [lon, lat])) return f.id?.startsWith("_") ? null : f.id;
    }
    return null;
  }

  /** Render the current view to a PNG data URL (both layers). */
  snapshot() {
    const c = document.createElement("canvas");
    c.width = this.base.width;
    c.height = this.base.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = palette().bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.drawImage(this.top, 0, 0);
    return c.toDataURL("image/png");
  }
}

// ------------------------------------------------------------------ helpers
export function densify(points, stepDeg = 2) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    if (i === 0) {
      out.push(a);
      continue;
    }
    const b = points[i - 1];
    const d = d3.geoDistance(b, a) * (180 / Math.PI);
    if (d > stepDeg) {
      const interp = d3.geoInterpolate(b, a);
      const n = Math.ceil(d / stepDeg);
      for (let j = 1; j < n; j++) out.push(interp(j / n));
    }
    out.push(a);
  }
  return out;
}

function strokeRun(ctx, pts) {
  if (!pts || pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function pointAt(run, t) {
  const target = t * run.len;
  const { cum, pts } = run;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const u = (target - cum[lo]) / seg;
  const a = pts[lo];
  const b = pts[hi];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

function distToRun(pts, x, y, tol) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    if (Math.min(x1, x2) - tol > x || Math.max(x1, x2) + tol < x || Math.min(y1, y2) - tol > y || Math.max(y1, y2) + tol < y) continue;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2));
    const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
    if (d < best) best = d;
  }
  return best;
}

function label(ctx, text, x, y, P, font) {
  ctx.font = font;
  ctx.lineJoin = "round";
  ctx.strokeStyle = withAlpha(P.bg, 0.85);
  ctx.lineWidth = 3.5;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = P.text;
  ctx.fillText(text, x, y);
}

function overlap(a, b) {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

function mix(a, b, t) {
  return d3.interpolateRgb(a, b)(t);
}

function brighten(c, theme) {
  const col = d3.color(c);
  if (!col) return c;
  return (theme === "light" ? col.darker(0.25) : col.brighter(0.35)).formatRgb();
}
