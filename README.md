# TerraEnergy — world energy flows

An interactive map of who produces, consumes and trades the world's **oil, natural gas and coal**, plus **rare earth metals and compounds**, built on the
latest complete year of official data (**2025**). It is paired with live shipping data for the
**2026 Strait of Hormuz closure**.

- **Trade flows** — about 2,500 bilateral flows of crude, oil products, LNG, pipeline gas and coal, routed along real
  sea lanes and pipelines. Each flow shows the chokepoints it passes through and its voyage time.
- **Rare earth flows** — 337 country-to-country trade links in tonnes, with country partners, rankings and CSV export.
  Choose **Rare earths** in Trade flows, or open `/#lens=flows&c=rare_earths`. Routes are modelled as container shipping
  between main ports, or rail and road between neighbours with open borders.
- **Country trade** — choose two countries to see energy and rare earth products in both directions, with HS product
  codes, tonnes, dollar values and downloadable original records. The seller's export declaration and buyer's import
  declaration are shown separately, with publication dates and estimated weights. Switch between latest annual and
  monthly reports. Open **Country trade** in the header, a country profile, or a flow's product details.
- **Country data** — 24 map layers (production, demand, import dependence, Hormuz exposure, low-carbon power,
  CO₂ per person, …). A year slider covers 2000–2025, and every number is labelled with its source and year.
- **Chokepoints** — daily tanker transits from IMF PortWatch (to 20 Sep 2026) for Hormuz, Malacca, Suez,
  Bab el-Mandeb, the Cape and others. Each has EIA volume history, the importers that depend on it, and bypass options.
- **Country profiles** — balances, trade partners with market shares, supplier concentration, energy and power
  mix, 2000–2025 trends and monthly 2026 production.

Everything is linkable (the URL encodes the view), searchable (<kbd>⌘K</kbd>), keyboard-driven, themeable
(light/dark) and works on a phone.

**Live site:** <https://priyank1205.github.io/terraenergy/>. The data refreshes itself weekly (see
[Automatic refresh](#automatic-refresh-and-deployment)).

## Quick start

```bash
npm start                # serves on http://localhost:3000 (Python 3, no npm install needed)
```

The app is plain ES modules plus a vendored copy of d3 and topojson-client. There is no build step and nothing to
install for the saved map. Any static web server serves the map and saved trade records (use HTTP, not a `file://` URL).
Live country-trade checks require `npm start` and Python `requests`; that server provides the `/api/trade` endpoint.
The hosted site has no server, so its trade explorer shows the saved records from the latest data refresh.

## Where the numbers come from

| Layer | Source | Vintage |
|---|---|---|
| Country balances (oil, gas, coal, energy, power, CO₂) | [Energy Institute — Statistical Review of World Energy 2026](https://www.energyinst.org/statistical-review) | 2025 data, published 30 Jun 2026 |
| Countries EI groups together, population, GDP | [U.S. EIA International Energy Statistics](https://www.eia.gov/international/data/world) | mostly 2024 (oil 2025); monthly production to May 2026 |
| Electricity mix | [Ember via Our World in Data](https://ourworldindata.org/energy) | to 2025 (2024 for most smaller countries) |
| Crude, product and coal trade | [UN Comtrade](https://comtradeplus.un.org/) (HS 2709, 2710, 2701) | 2025, or 2024 where 2025 isn't reported yet |
| Rare earth metals and compounds | [UN Comtrade](https://comtradeplus.un.org/) (HS 280530, 284610, 284690) | 2025, with 2024 fallback; each flow shows its year |
| Country-to-country product details | UN Comtrade, six-digit HS customs records | Latest published annual or monthly dataset checked separately for each reporter; release/retrieval dates shown |
| LNG and pipeline-gas trade | EI 2025 trade matrices (578.5 bcm LNG, 567.6 bcm pipeline) | 2025 |
| Chokepoint traffic | [IMF PortWatch](https://portwatch.imf.org/) daily transits | to 20 Sep 2026 |
| Chokepoint volumes | [EIA World Oil Transit Chokepoints](https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints) | 2020–1H25 (updated Mar 2026) |
| 2025–26 events, market snapshot | EIA, IEA, Reuters, Al Jazeera, CNBC and others (cited in the app) | as of 23 Sep 2026 |
| Boundaries | Natural Earth via [world-atlas](https://github.com/topojson/world-atlas) | 1:50m / 1:110m |

## How it works

`pipeline/` turns the raw sources into the compact JSON files the app reads (`public/data/`):

1. **Balances.** Uses EI physical units (kb/d, bcm, Mt, EJ, TWh) for the ~80 countries EI lists, and EIA for the rest.
   Derived metrics include net balances, import dependence and per-capita values.
2. **Trade.**
   - Customs weights from importers' declarations are converted to barrels using each exporter's typical crude
     density (API gravity), so heavy Canadian and light Kazakh barrels are not treated alike.
   - Non-reporting importers (Taiwan, Vietnam, UAE, Bangladesh, …) come from partners' export declarations, after
     dropping physically implausible rows.
   - Gas uses EI's matrices, and EI's regional aggregates are split with Comtrade shares or physical pipeline
     landing points.
   - Rare earths use product weights from 45 queried importers, supplemented by export reports from 14 suppliers
     when an importer has no report for that product group. Import and mirror declarations are never added for
     the same importer/product. Missing weights are omitted; weights estimated by Comtrade are flagged.
     The bundled sample covers 42 exporters and 69 importers after omitting flows below one tonne.
3. **Routing.**
   - `pipeline/lib/sealanes.py` is a hand-built graph of about 450 sea-lane waypoints. An automated test checks that
     no lane crosses land.
   - Each seaborne flow takes the cheapest path between the exporter's and importer's terminals. The costs reflect
     2024–25 behaviour: Western-linked shipping avoided the Red Sea, VLCCs and most LNG avoided Panama, and cargoes
     split across Saudi, Emirati and Russian terminals by destination.
   - Routed 2025 volumes reproduce EIA's Suez (4.9 mb/d) and Bab el-Mandeb (4.2 mb/d) figures, and cover about 80%
     of Hormuz and Malacca. The remainder is trade that customs data cannot see.
4. **Context.** PortWatch series, EIA monthly production and a curated, sourced timeline
   (`pipeline/curated/context.py`).

`public/data/build_report.txt` records every reconciliation check from the last build.

### Known limitations

- **Freshness is source-specific.** Countries publish at different times. The explorer checks the publication catalogue
  before retrieving a pair, caches successful checks for six hours, and offers **Check for updates** to bypass the cache.
  Annual searches cover the last five completed years; monthly searches cover the last 36 completed months. The latest
  published period is retained even if it contains no declarations for the selected pair. Annual and monthly figures
  are not interchangeable. See [UN Comtrade data availability](https://uncomtrade.org/docs/data-availability/).
- The 27 September 2026 bulk refresh updated EIA, OWID, PortWatch and part of Comtrade before the public API quota
  stopped it. Remaining cached files were retained. The Sources panel distinguishes timestamped downloads from older
  files without retrieval timestamps; rebuilding does not certify all sources as newly checked. Failed live checks
  retain dated saved records and explicitly identify gaps, never substituting zero trade.
- **Product details are customs categories**, not shipment manifests or individual elemental contents. The explorer
  preserves both reporters' declarations, including value-only and small trades. It never averages mirror reports or
  imputes missing weights from prices. Import/export differences can reflect CIF/FOB valuation, timing and reporting;
  compare matching periods. CSV files retain original numerical precision and provenance.
- Rare earth quantities are **tonnes of traded metals and compounds**, not contained rare earth oxide or mine
  production. HS 280530 includes scandium and yttrium; HS 284610 includes cerium compounds. Ores and finished
  magnets are excluded. Coverage is incomplete, reporting years may differ, and re-exports can count material
  more than once. Customs records do not state the transport mode, so routes are modelled the same way as energy
  trade (some high-value lots actually travel by air). Rare earths are excluded from **All energy**, whose scale is
  energy content. The product scope follows the
  [IMF's metals-and-compounds grouping](https://www.imf.org/-/media/files/publications/weo/2026/april/english/ch1onlineannex.pdf).
- LPG (HS 2711) isn't in the oil-product flows, so US and Gulf product exports are understated.
- China declares much Iranian crude as Malaysian. That flow is kept as reported, flagged, and routed from Kharg Island.
- Taiwan's crude import sources are incomplete, because Saudi Arabia books large volumes to "Other Asia, nes".
- Crude declared from economies that produce none (Switzerland, Panama, Togo, Liberia, …) is left off the map. The
  declared partner is a trader's home country, a ship registry or a storage hub, so the true origin is unknown. This
  is about 0.15 mb/d worldwide; the build report lists each pair and each importer's profile states the excluded volume.
- Russian exports are seen only through importers' declarations.
- Transport modes are modelled, because customs records do not state them (see `pipeline/lib/overland.py`).
  Neighbours trade overland only across borders that carry freight; closed or impassable borders such as
  China–India and India–Pakistan are routed by sea, landlocked countries use their usual gateway port, and crude is
  a pipeline only where a cross-border pipeline exists. The build fails if a trade has no plausible route.
- Pipeline, border-crossing and terminal routes are schematic.
- The 2026 situation layer is a dated snapshot. Refresh it as described below.

## Updating the data

```bash
npm run data:refresh     # refresh EIA, OWID, Comtrade, PortWatch and rebuild on success
npm run data             # fetch anything missing, then rebuild (≈10 s once cached)
npm run data:build       # rebuild from the cache only
python3 pipeline/fetch_sources.py --only rare-earths  # fetch just rare earth trade
python3 pipeline/sources/bilateral.py --pair CHN USA --refresh  # save latest annual product reports
python3 pipeline/sources/bilateral.py --pair CHN USA --frequency M --refresh  # latest monthly reports
```

Needs Python 3.10+ with `requests` and `openpyxl`. Raw downloads are cached in `pipeline/cache/` (≈80 MB). Only the
UN Comtrade responses (`pipeline/cache/comtrade/`, ≈14 MB) are committed: the public API's quota makes them slow to
re-fetch. Everything else is re-downloaded when missing.

When Comtrade's quota is reached, the fetch stops cleanly and keeps the files it didn't reach. Every file is written only
after a successful call, and an empty answer never replaces one that had rows, so `npm run data:build` publishes that
mixed cache with its actual retrieval dates.
`--max-age DAYS` limits a refresh to Comtrade files retrieved more than DAYS ago, and `--budget CALLS` caps the calls:

```bash
python3 pipeline/fetch_sources.py --refresh --max-age 28 --budget 120   # what the weekly job runs
python3 pipeline/check_data.py   # compare a rebuild with the last commit; fails on a suspicious drop
```

- **New Statistical Review:** update the EI snapshot URL and md5 in `pipeline/fetch_sources.py`.
- **2026 situation layer:** edit the chokepoint statuses, timeline and market snapshot in
  `pipeline/curated/context.py`, and bump `AS_OF`. This is editorial and is not refreshed automatically.

## Automatic refresh and deployment

Two GitHub Actions workflows keep the live site current:

- **`refresh-data.yml`** runs every Wednesday at 05:30 UTC, after PortWatch's Tuesday update, and can be started by
  hand from the Actions tab.
  - It re-downloads EIA, OWID and PortWatch, and refreshes up to 120 UN Comtrade responses older than 28 days. The
    whole Comtrade cache rotates in about a month.
  - It rebuilds, runs the tests and runs `pipeline/check_data.py`.
  - It commits changed data to `main` and redeploys.
  - The check stops the run if flows, volumes, metric coverage or the PortWatch series shrink by more than it allows,
    which is what a broken download looks like. GitHub emails the repository owner about the failed run, and the site
    stays as it was.
- **`deploy.yml`** publishes `index.html`, `src/`, `vendor/` and `public/data/` to GitHub Pages. It runs after
  each refresh and on every push to `main`, but only once the tests pass.

The scheduled job commits to `main`, so pull before starting local work on the data.

## Tests

```bash
npm test                 # node --test (formatting, URL state, selectors) + Python unittest (routing, conversions, reconciliation)
```

## Project structure

```
index.html               app shell (no build step)
src/
  main.js                controller: state → map, panels, legend; keyboard; export
  map.js                 canvas renderer on d3-geo (Equal Earth + globe), flows, particles, picking
  data.js                data loading, indexes and pure selectors
  store.js               observable state, synced to the URL hash
  format.js              units and number formatting
  colors.js              theme-aware palettes and choropleth scales
  charts.js              small SVG charts
  trade.js               original customs record selectors, CSV and live/saved loaders
  ui/trade.js            country-to-country product explorer
  ui/panel.js            overview, country, flow, chokepoint and compare views
  ui/controls.js         rail, legend, banner, tooltip, command palette, sources modal
  styles/app.css         design tokens (light/dark) and components
vendor/                  d3 7.9 and topojson-client 3.1 (UMD)
pipeline/
  fetch_sources.py       downloads + checksums; quota-aware rolling Comtrade refresh
  build.py               joins sources, allocates, routes, validates, writes public/data/
  check_data.py          guards an unattended refresh against broken downloads
  flow_ids.json          permanent flow IDs (commodity, partners, route → ID) so shared flow links survive updates
  sources/               EI, EIA, OWID, Comtrade parsers
  lib/                   countries, sea-lane graph and router, TopoJSON helpers
  curated/context.py     chokepoints, timeline, market snapshot, infrastructure (all sourced)
  tests/                 pipeline tests
public/data/             generated data the app loads
tests/                   JavaScript unit tests
scripts/serve.py         local server with gzip and bounded UN Comtrade lookup endpoint
.github/workflows/       weekly data refresh and GitHub Pages deployment
```

## License and attribution

Code: MIT. The data remains subject to its providers' terms. Statistical Review data © Energy Institute 2026. UN
Comtrade, U.S. EIA, Ember (CC BY 4.0), IMF PortWatch and Natural Earth (public domain) are credited in the app.
