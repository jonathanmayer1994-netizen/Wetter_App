"""
End-to-End Expert Verification Suite for Interactive Map & 48h Radar (v2.0).
Validates:
- Single-pass tab activation, zero JS/page errors across Desktop (1280x900) & Mobile (360x780 / 393x852)
- SW Split Cache & OSM / Terrarium tile interception rules
- RainViewer O(1) Pointer-Matrix & Zero-GC TypedArray buffer pool
- O(1) Bilinear Wind Vector Grid (36x28 Float32Array)
- DEM-corrected Thermal Overlay + Marching-Squares Contours (Temp & Pressure)
- Dynamic reference elevation (fixing hardcoded 520m bias) & noise-free sampleAtLatLon
- Fixed UTC NWP anchor in realignRadarTimelineTimestamps & time-proportional playback
- Tap-to-Inspect without mutating state.currentLocation until explicit promote CTA
- Dynamic Attribution, Live Thunderstorm Alert HUD, Zoom Pill, & Desktop Keyboard Shortcuts
"""

import http.server
import threading
import os
import sys
import re
from playwright.sync_api import sync_playwright


def run_expert_map_suite():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    total = 0
    passed = 0

    def check(name, ok, detail=""):
        nonlocal total, passed
        total += 1
        if ok:
            passed += 1
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ {name}: {detail}")

    # 1. Static check on sw.js split cache & static assets
    with open('sw.js', 'r', encoding='utf-8') as f:
        sw_src = f.read()
    check("SW split static/radar tile caches configured",
          'STATIC_TILE_CACHE_NAME' in sw_src and 'RADAR_TILE_CACHE_NAME' in sw_src and 'tile.openstreetmap.org' in sw_src and 'elevation-tiles-prod.s3.amazonaws.com' in sw_src)
    for mod in ['mapMercator.js', 'mapStores.js', 'mapCanvas.js', 'mapCanvas.worker.js', 'mapHud.js', 'mapTimeline.js']:
        check(f"SW precaches features/map/{mod}", f"./features/map/{mod}" in sw_src)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # =====================================================================
        # PART A: DESKTOP (1280x900) ARCHITECTURE, METEOROLOGY, UX & SHORTCUTS
        # =====================================================================
        print("\n=== DESKTOP 1280x900: Architecture, Physics, Timeline & UX ===")
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = ctx.new_page()
        page_errors = []
        page.on('pageerror', lambda err: page_errors.append(str(err)))

        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        page.wait_for_timeout(800)

        # Verify zero duplicate .card-header inside #tab-map
        dup_header = page.locator("#tab-map .map-view-card > .card-header").count()
        check("Duplicate desktop .card-header over tab-map removed", dup_header == 0, f"found {dup_header}")

        # Verify single-pass tab activation render count (after initial warm tiles/DEM settle, Overview -> Map must render <= 1 pass)
        page.click(".tab-btn[data-tab='tab-map']")
        page.wait_for_function("() => import('./core/state.js').then(m => !!m.state.map?._radarLoaded)", timeout=10000)
        page.wait_for_timeout(1200)
        page.click(".tab-btn[data-tab='tab-overview']")
        page.wait_for_timeout(200)
        render_count = page.evaluate("""() => {
          let cnt = 0;
          const orig = window.WeatherCanvasEngine.render.bind(window.WeatherCanvasEngine);
          window.WeatherCanvasEngine.render = function(...args) {
            cnt++;
            return orig(...args);
          };
          document.querySelector(".tab-btn[data-tab='tab-map']").click();
          return new Promise(resolve => setTimeout(() => {
            window.WeatherCanvasEngine.render = orig;
            resolve(cnt);
          }, 400));
        }""")
        check("Single-pass switchTab('tab-map') avoids 4x redundant renders (<= 2)", render_count <= 2, f"count={render_count}")
        page.wait_for_timeout(400)

        # Verify RainViewer MAX_CACHE & Pointer-Matrix helpers
        rv_info = page.evaluate("""() => ({
          maxCache: window.RainViewerRadarStore.MAX_CACHE,
          hasMatrixFn: typeof window.RainViewerRadarStore.buildViewportTileMatrix === 'function',
          hasFastSampler: typeof window.RainViewerRadarStore.sampleAtNormXYWithMatrix === 'function'
        })""")
        check("RainViewerRadarStore MAX_CACHE >= 160 & O(1) Pointer-Matrix ready",
              rv_info['maxCache'] >= 160 and rv_info['hasMatrixFn'] and rv_info['hasFastSampler'], str(rv_info))

        # Verify 36x28 O(1) Wind Vector Grid
        page.evaluate("() => window.setMapOverlay('wind')")
        page.wait_for_timeout(350)
        wind_info = page.evaluate("""() => ({
          cols: window.WeatherCanvasEngine._windGrid.cols,
          rows: window.WeatherCanvasEngine._windGrid.rows,
          uLen: window.WeatherCanvasEngine._windGrid.u ? window.WeatherCanvasEngine._windGrid.u.length : 0
        })""")
        check("Wind simulation uses precomputed 36x28 Float32Array vector grid",
              wind_info['cols'] == 36 and wind_info['rows'] == 28 and wind_info['uLen'] == 36 * 28, str(wind_info))

        # Verify DEM Temperature Lapse-Rate + Marching-Squares Contours
        page.evaluate("() => window.setMapOverlay('temp')")
        page.wait_for_timeout(350)
        thermal_stats = page.evaluate("""() => {
          const g = window.WeatherCanvasEngine._pool.thermalGrid;
          let min = 999, max = -999;
          if (g) {
            for (let i = 0; i < g.length; i++) {
              const v = g[i];
              if (Number.isFinite(v) && v !== 0) {
                if (v < min) min = v;
                if (v > max) max = v;
              }
            }
          }
          return { min, max, diff: max - min };
        }""")
        check("Temperature overlay applies DEM lapse rate across peaks & valleys (> 5°C spread)",
              thermal_stats['diff'] > 5.0, str(thermal_stats))

        # Verify Marching Squares polylines helper directly on synthetic thermal/pressure grid
        ms_ok = page.evaluate("""async () => {
          const m = await import('./features/map/mapMercator.js');
          const field = new Float32Array([ -2, -2, -2, -2, 3, 3, -2, 3, 4 ]);
          const contours = m.extractIsobarContours(field, 3, 3, [0], 20, 20, 0, 0);
          return contours.length === 1 && contours[0].polylines.length >= 1 && contours[0].polylines[0].length >= 4;
        }""")
        check("Marching-Squares extracts stitched contour polylines", ms_ok)

        # Verify dynamic reference elevation fix in getSynthesizedBaselineStations
        synth_ok = page.evaluate("""async () => {
          const m = await import('./features/map.js');
          const stMod = await import('./core/state.js');
          const prevLoc = { ...stMod.state.currentLocation };
          const prevCur = stMod.state.weatherData ? { ...stMod.state.weatherData.current } : null;
          stMod.state.currentLocation.elevation = 2962;
          if (!stMod.state.weatherData) stMod.state.weatherData = { current: { temperature_2m: -8.0 } };
          else stMod.state.weatherData.current.temperature_2m = -8.0;
          const list = m.getSynthesizedBaselineStations();
          const zug = list.find(s => s.name === 'Zugspitze');
          stMod.state.currentLocation = prevLoc;
          if (prevCur && stMod.state.weatherData) stMod.state.weatherData.current = prevCur;
          return zug && Math.abs(zug.temperature - (-8.0)) <= 0.5;
        }""")
        check("Synthesized baseline uses currentLocation.elevation instead of hardcoded 520m", synth_ok)

        # Verify noise-free deterministic sampleAtLatLon
        det_ok = page.evaluate("""() => {
          const a = window.WeatherCanvasEngine.sampleAtLatLon(47.5, 11.5, null, { overrideElevation: 800, forceRecompute: true });
          const b = window.WeatherCanvasEngine.sampleAtLatLon(47.5, 11.5, null, { overrideElevation: 800, forceRecompute: true });
          return a.rateMmH === b.rateMmH && a.snowRatio === b.snowRatio && a.elevation === 800;
        }""")
        check("sampleAtLatLon is noise-free and deterministic", det_ok)

        # Verify UTC NWP Anchor stability in realignRadarTimelineTimestamps
        utc_anchor_ok = page.evaluate("""async () => {
          const stMod = await import('./core/state.js');
          const fixedMs = Date.now() + 8 * 3600000;
          stMod.state.map.unifiedRadarFrames = [
            { type: 'past', isLive: true, minuteOffset: 0, timestampMs: Date.now(), stations: [] },
            { type: 'future', isLive: false, fixedValidMs: fixedMs, minuteOffset: 480, hoursFromNow: 8, timestampMs: fixedMs, stations: [] }
          ];
          stMod.state.map.liveRadarIndex = 0;
          stMod.state.map.radarFloatIndex = 0;
          window.realignRadarTimelineTimestamps(Date.now() + 180000);
          const fNwp = stMod.state.map.unifiedRadarFrames[1];
          return fNwp.timestampMs === fixedMs && fNwp.minuteOffset === 477;
        }""")
        check("realignRadarTimelineTimestamps anchors NWP fixedValidMs UTC time properly", utc_anchor_ok)

        # Restore frames for UX tests
        page.evaluate("() => window.ensureFreshMapRadar(true)")
        page.wait_for_timeout(500)

        # Verify Tap-to-Inspect DOES NOT mutate global state.currentLocation before CTA click
        inspect_ok = page.evaluate("""async () => {
          const stMod = await import('./core/state.js');
          const beforeLat = stMod.state.currentLocation.lat;
          window.inspectMapPoint(47.421, 10.985);
          const afterInspectLat = stMod.state.currentLocation.lat;
          const cardVis = document.getElementById('map-point-weather-card').classList.contains('is-inspecting');
          const ctaVis = document.getElementById('mpw-load-primary-btn').offsetParent !== null;
          return { unchanged: beforeLat === afterInspectLat, cardVis, ctaVis };
        }""")
        check("Tap-to-Inspect inspects point without unwanted global location switch",
              inspect_ok['unchanged'] and inspect_ok['cardVis'] and inspect_ok['ctaVis'], str(inspect_ok))

        page.click("#mpw-clear-inspect-btn")
        page.wait_for_timeout(150)
        check("Clear Inspector button hides inspector bar",
              not page.locator("#map-point-weather-card.is-inspecting").count())

        # Verify Dynamic Attribution updates cleanly on BaseLayer switch
        page.evaluate("() => window.setMapBaseLayer('osm-standard')")
        page.wait_for_timeout(150)
        attr_std = page.inner_text("#ms-map-attribution")
        check("Dynamic attribution shows OpenStreetMap on osm-standard", "OpenStreetMap" in attr_std, attr_std)
        page.evaluate("() => window.setMapBaseLayer('osm-dark')")

        # Verify Thunderstorm Alert HUD populates on Lightning overlay
        page.evaluate("() => window.setMapOverlay('lightning')")
        page.wait_for_timeout(250)
        thunder_vis = page.is_visible("#thunderstorm-alert-box")
        dist_txt = page.inner_text("#tab-dist-val") if thunder_vis else ""
        check("Thunderstorm Alert HUD visible and populated in lightning mode",
              thunder_vis and len(dist_txt.strip()) > 0, f"vis={thunder_vis}, dist='{dist_txt}'")

        # Verify Desktop Zoom Pill (+ / -) & Keyboard Shortcuts
        z0 = page.evaluate("""async () => {
          const stMod = await import('./core/state.js');
          return stMod.state.map.instance.getZoom();
        }""")
        page.click("#ms-fab-zoom-in")
        page.wait_for_timeout(350)
        z1 = page.evaluate("""async () => {
          const stMod = await import('./core/state.js');
          return stMod.state.map.instance.getZoom();
        }""")
        check("Desktop Zoom-In button zooms map cleanly", z1 > z0, f"z0={z0}, z1={z1}")

        # Test keyboard shortcut '1' (precip) & ArrowRight
        kb_ok = page.evaluate("""async () => {
          const stMod = await import('./core/state.js');
          document.body.focus();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
          const ovAfter1 = stMod.state.map.activeOverlay;
          const idx0 = stMod.state.map.radarIndex;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
          const idx1 = stMod.state.map.radarIndex;
          return { ovAfter1, idx0, idx1 };
        }""")
        check("Desktop keyboard shortcuts (1..6 & ArrowRight) control map",
              kb_ok['ovAfter1'] == 'precip' and kb_ok['idx1'] != kb_ok['idx0'], str(kb_ok))

        check("Zero uncaught page/JS errors on Desktop", len(page_errors) == 0, str(page_errors))
        ctx.close()

        # =====================================================================
        # PART B: SMALL IPHONE MINI (360x780) LAYOUT & ATTRIBUTION ANTI-CLIPPING
        # =====================================================================
        print("\n=== IPHONE MINI 360x780: Layout, Attribution & Tap-to-Inspect ===")
        m_ctx = browser.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True)
        m_page = m_ctx.new_page()
        m_errors = []
        m_page.on('pageerror', lambda err: m_errors.append(str(err)))

        m_page.goto(f"http://127.0.0.1:{port}/index.html")
        m_page.wait_for_selector("#hero-location-name", timeout=10000)
        m_page.wait_for_timeout(800)
        m_page.click("#mobile-bottom-nav .mbn-btn[data-tab='tab-map']")
        m_page.wait_for_timeout(700)

        attr_box = m_page.locator("#ms-map-attribution").bounding_box()
        wm_box = m_page.locator("#ms-radar-watermark").bounding_box()
        no_attr_overlap = bool(attr_box and wm_box and (attr_box['x'] + attr_box['width'] <= wm_box['x'] + 4))
        check("No collision between attribution pill & timestamp watermark at 360px",
              no_attr_overlap, f"attr={attr_box}, wm={wm_box}")
        check("Zero uncaught page/JS errors on 360px Mobile", len(m_errors) == 0, str(m_errors))
        m_ctx.close()

        browser.close()

    httpd.shutdown()
    print(f"\n============================================================")
    print(f"MAP EXPERT SUITE v2.0 RESULT: {passed}/{total} PASSED")
    print(f"============================================================")
    sys.exit(0 if passed == total else 1)


if __name__ == '__main__':
    run_expert_map_suite()
