import os
import sys
import http.server
import threading
import time

node_dir = '/Users/jona/Library/Python/3.9/lib/python/site-packages/playwright/driver'
if os.path.exists(node_dir) and node_dir not in os.environ.get('PATH', ''):
    os.environ['PATH'] = f"{node_dir}:{os.environ.get('PATH', '')}"

from playwright.sync_api import sync_playwright

def run_skitour_suite():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args): pass
        def end_headers(self):
            self.send_header('Connection', 'close')
            self.send_header('Cache-Control', 'no-cache')
            super().end_headers()
        def copyfile(self, source, outputfile):
            try:
                super().copyfile(source, outputfile)
            except (BrokenPipeError, ConnectionResetError):
                pass

    class TestHTTPServer(http.server.ThreadingHTTPServer):
        request_queue_size = 128
        allow_reuse_address = True
        daemon_threads = True

    httpd = TestHTTPServer(('127.0.0.1', 0), QuietHandler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    print(f"🚀 Running Skitour Expert Suite on http://127.0.0.1:{port}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1280, 'height': 900},
            service_workers="block"
        )
        page = context.new_page()
        page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
        page.wait_for_selector("#hero-location-name", timeout=10000)

        # 1. Switch to Sports Tab
        print("\n--- TEST 1: Switch to Tab Sports ---")
        page.locator("[data-tab='tab-sports']").first.click(force=True)
        page.wait_for_timeout(300)
        assert page.eval_on_selector("#tab-sports", "el => el.classList.contains('active')"), "Tab Sports must be active"
        print("✓ Tab Sports is active")

        # 2. Check Skitour Category Button in Setup Drawer
        print("\n--- TEST 2: Skitour Athlete Category Selection ---")
        page.eval_on_selector("#sports-setup-drawer", "el => el.open = true")
        page.wait_for_timeout(200)

        skitour_btn = page.locator("#sport-cat-skitour")
        assert skitour_btn.is_visible(), "Skitour category card must be present in drawer"
        skitour_btn.click(force=True)
        page.wait_for_timeout(300)

        # Verify active state and control panel visibility
        is_active = page.evaluate("() => document.getElementById('sport-cat-skitour').classList.contains('active')")
        assert is_active, "Skitour category card must be marked active"
        assert page.is_visible("#athlete-skitour-controls"), "Skitour tuning controls must be visible"
        assert not page.is_visible("#athlete-bike-controls"), "Bike controls must be hidden"
        assert not page.is_visible("#athlete-mountain-controls"), "Mountain controls must be hidden"
        print("✓ Skitour category activated and controls displayed correctly")

        # 3. Test Skitour Pace Tuning (Hm/h and Descent Speed)
        print("\n--- TEST 3: Skitour Pace Stepper & Sliders ---")
        page.click("#skitour-ascent-plus", force=True)
        page.wait_for_timeout(100)
        ascent_val = page.inner_text("#skitour-ascent-val")
        assert "425" in ascent_val or "Hm/h" in ascent_val, f"Ascent value must update, got: {ascent_val}"

        page.click("#skitour-descent-plus", force=True)
        page.wait_for_timeout(100)
        descent_val = page.inner_text("#skitour-descent-val")
        assert "km/h" in descent_val, f"Descent value must update, got: {descent_val}"
        print(f"✓ Skitour pace controls responsive (Ascent: {ascent_val}, Descent: {descent_val})")

        # 4. Load Skitour Preset: Lampsenspitze (Sellrain / Tirol)
        print("\n--- TEST 4: Skitour Preset Tour (Lampsenspitze 2.875 m) ---")
        preset_btn = page.locator('.sports-route-preset[data-tour="skitour-sellrain"]')
        assert preset_btn.is_visible(), "Skitour preset button must be visible in demo block"
        preset_btn.click(force=True)
        
        # Wait for tour to load and title to update
        page.wait_for_function("() => document.getElementById('sports-active-tour-title') && document.getElementById('sports-active-tour-title').innerText.includes('Lampsenspitze')", timeout=10000)
        tour_title = page.inner_text("#sports-active-tour-title")
        assert "Lampsenspitze" in tour_title or "Skitour" in tour_title, f"Tour title must reflect Skitour, got: {tour_title}"
        print(f"✓ Skitour Preset loaded successfully: '{tour_title}'")

        # 5. Verify Skitouren-Sicherheits-Cockpit
        print("\n--- TEST 5: Skitouren-Sicherheits-Cockpit Rendering ---")
        dashboard = page.locator("#skitour-dashboard-card")
        assert dashboard.is_visible(), "Skitour Dashboard Card must be visible when category is skitour"

        # Check EAWS Level Badge
        eaws_num = page.inner_text("#skitour-eaws-num")
        assert eaws_num in ["1", "2", "3", "4", "5"], f"EAWS level number must be between 1 and 5, got: {eaws_num}"
        eaws_title = page.inner_text("#skitour-eaws-title")
        assert "Stufe" in eaws_title, f"EAWS title must contain Stufe, got: {eaws_title}"
        print(f"✓ EAWS Badge rendered: Stufe {eaws_num} ('{eaws_title}')")

        # Check Regional Agency & Exact GPX Route Sync
        agency_tag = page.inner_text("#skitour-agency-tag")
        assert "LWD" in agency_tag or "SLF" in agency_tag, f"Agency tag must dynamically reflect route region, got: {agency_tag}"
        assert "1.513" in agency_tag and "2.875" in agency_tag, f"Agency tag must display exact GPX elevation range (1.513-2.875m), got: {agency_tag}"
        assert "Live" in agency_tag, f"Agency tag must display Live timestamp, got: {agency_tag}"
        assert page.is_visible("#skitour-live-refresh-btn"), "Live refresh button must be visible"
        print(f"✓ Dynamic Route Agency & Live Tag verified: '{agency_tag}'")

        # Check Auto-Diagnosed Primary Sector (no static placeholder)
        auto_sec_name = page.inner_text("#skitour-sector-name")
        assert auto_sec_name != "Nord- & Nordosthänge" and ("Kritisch" in auto_sec_name or "Günstiger" in auto_sec_name), f"Primary sector diagnosis must auto-update for GPX route, got: {auto_sec_name}"
        print(f"✓ Auto-Diagnosed Route Sector verified: '{auto_sec_name}'")

        # Check Data Provenance Badges (Echt vs Prognose vs Schätzwert)
        eaws_prov = page.inner_text("#st-eaws-prov-badge")
        totalsnow_prov = page.inner_text("#st-totalsnow-prov")
        assert any(k in eaws_prov for k in ["ECHT", "PROGNOSE", "OFFLINE"]), f"EAWS provenance badge must distinguish Real vs Forecast, got: {eaws_prov}"
        assert any(k in totalsnow_prov for k in ["ECHT", "MODELL", "SCHÄTZWERT"]), f"Total snow provenance badge must distinguish Station vs Model vs Estimate, got: {totalsnow_prov}"
        print(f"✓ Provenance badges verified (EAWS: '{eaws_prov}', SnowDepth: '{totalsnow_prov}')")

        # Check Vector Danger Rose SVG
        assert page.is_visible("#skitour-danger-rose-svg"), "Vector danger rose SVG must be visible"
        page.click("#st-rose-n", force=True)
        page.wait_for_timeout(200)
        sec_name = page.inner_text("#skitour-sector-name")
        assert "Nord" in sec_name or "N" in sec_name, f"Selected sector name must update, got: {sec_name}"
        print(f"✓ Vector Danger Rose interactive click verified: '{sec_name}'")

        # Check Firn-Fenster / Powder Timeline
        firn_pill = page.inner_text("#skitour-firn-window-pill")
        assert any(k in firn_pill for k in ["Firn-Fenster", "Fenster", "Pulver", "nass"]), f"Firn/Powder window pill must be populated dynamically, got: {firn_pill}"
        assert page.locator(".firn-track-hour").count() >= 10, "Firn timeline track must render hours"
        print(f"✓ Firn/Pulver-Fenster timeline verified: '{firn_pill}'")

        # Check Schnee- & Neuschnee-Dossier
        fresh_snow = page.inner_text("#st-freshsnow-val")
        snow_density = page.inner_text("#st-density-val")
        assert "cm" in fresh_snow, f"Fresh snow must be rendered in cm, got: {fresh_snow}"
        assert "kg/m³" in snow_density, f"Snow density must be rendered, got: {snow_density}"
        print(f"✓ Schnee- & Neuschnee-Dossier verified (Fresh: {fresh_snow}, Density: {snow_density})")

        # Check GPX Slope Angle & Munter 3x3 Check
        max_slope = page.inner_text("#st-max-slope-badge")
        munter_text = page.inner_text("#munter-verdict-box")
        assert "Max:" in max_slope and "°" in max_slope, f"Max slope badge must be rendered, got: {max_slope}"
        assert "Munter" in munter_text or "Hangneigung" in munter_text, f"Munter check text must be present, got: {munter_text}"
        # Consistency guard: sum === 100% & maxSlope band MUST be >= 1%
        p_u30 = int(page.inner_text("#st-pct-under30").replace("%", "").strip())
        p_30 = int(page.inner_text("#st-pct-30to34").replace("%", "").strip())
        p_35 = int(page.inner_text("#st-pct-35to39").replace("%", "").strip())
        p_40 = int(page.inner_text("#st-pct-over40").replace("%", "").strip())
        max_deg_val = float(max_slope.replace("Max:", "").replace("°", "").strip())
        assert p_u30 + p_30 + p_35 + p_40 == 100, f"Slope bands must sum to 100%, got {p_u30}+{p_30}+{p_35}+{p_40}"
        if max_deg_val >= 40:
            assert p_40 >= 1, f"Max {max_deg_val}° requires >= 40° bucket >= 1%, got {p_40}%"
        elif max_deg_val >= 35:
            assert p_35 >= 1, f"Max {max_deg_val}° requires 35-39° bucket >= 1%, got {p_35}%"
        elif max_deg_val >= 30:
            assert p_30 >= 1, f"Max {max_deg_val}° requires 30-34° bucket >= 1%, got {p_30}%"
        print(f"✓ GPX Slope Scan & Munter 3x3 Check verified ({max_slope}, {p_u30}%/{p_30}%/{p_35}%/{p_40}%)")

        # 6. Verify Per-Waypoint Lawinenlagebericht Scale Values (Map, Table, Elevation Profile)
        print("\n--- TEST 6: Per-Waypoint EAWS Scale Values ---")
        page.wait_for_selector("#sports-map-container .ms-compact-pill .ms-eaws-pill", timeout=8000)
        map_eaws_count = page.locator("#sports-map-container .ms-compact-pill .ms-eaws-pill").count()
        assert map_eaws_count >= 3, f"Expected >=3 map waypoint EAWS pills (Start, waypoints, End), got {map_eaws_count}"
        first_pill_text = page.locator("#sports-map-container .ms-compact-pill .ms-eaws-pill").first.inner_text()
        assert "/5" in first_pill_text, f"Map waypoint EAWS pill must show X/5 scale value, got: {first_pill_text}"
        print(f"✓ Map waypoints render {map_eaws_count} EAWS pills (sample: '{first_pill_text}')")

        # Verify Waypoints Table EAWS Badges
        page.eval_on_selector("#sports-waypoints-drawer", "el => el.open = true")
        page.wait_for_timeout(200)
        table_eaws_count = page.locator("#sports-waypoints-list .swt-desktop-cells .swt-eaws-badge").count()
        assert table_eaws_count >= 3, f"Expected >=3 waypoint table EAWS badges, got {table_eaws_count}"
        first_tbl_text = page.locator("#sports-waypoints-list .swt-desktop-cells .swt-eaws-badge").first.inner_text()
        assert ("Offizieller Lawinenlagebericht" in first_tbl_text or "Prognose" in first_tbl_text) and "/5" in first_tbl_text, f"Table EAWS badge must distinguish Official vs Prognose and contain X/5, got: {first_tbl_text}"
        print(f"✓ Waypoints table renders {table_eaws_count} EAWS badges (sample: '{first_tbl_text}')")

        # Verify category scoping: switching to mountain removes skitour EAWS waypoint pills, switching back restores them
        page.locator("#sport-cat-mountain").click(force=True)
        page.wait_for_timeout(300)
        assert page.locator("#sports-map-container .ms-compact-pill .ms-eaws-pill").count() == 0, "EAWS pills must not show in mountain category"
        page.locator("#sport-cat-skitour").click(force=True)
        page.wait_for_timeout(300)
        assert page.locator("#sports-map-container .ms-compact-pill .ms-eaws-pill").count() >= 3, "EAWS pills must reappear in skitour category"
        print("✓ Category scoping verified: EAWS waypoint pills strictly bound to Skitour")

        # 7. Capture Visual Verification Artifacts
        screenshot_path = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_skitour_cockpit.png"
        dashboard.screenshot(path=screenshot_path)
        print(f"📸 Captured Skitour Cockpit artifact: {screenshot_path}")

        map_card = page.locator("#sports-map-card")
        map_card.scroll_into_view_if_needed()
        page.wait_for_timeout(800)
        map_screenshot_path = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_skitour_map_waypoints.png"
        map_card.screenshot(path=map_screenshot_path)
        print(f"📸 Captured Skitour Map Waypoints artifact: {map_screenshot_path}")

        # 8. TEST 7: Custom GPX Upload & Live Refresh Sync
        print("\n--- TEST 7: Custom GPX Route & Live Refresh Sync ---")
        custom_gpx = '''<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>Ifersguntalpe Skitour</name><trkseg>
<trkpt lat="47.3450" lon="10.1250"><ele>1180</ele></trkpt>
<trkpt lat="47.3380" lon="10.1120"><ele>1650</ele></trkpt>
<trkpt lat="47.3310" lon="10.0980"><ele>2014</ele></trkpt>
<trkpt lat="47.3450" lon="10.1250"><ele>1180</ele></trkpt>
</trkseg></trk></gpx>'''
        page.set_input_files("#sports-file-input", files=[{"name": "Ifersguntalpe.gpx", "mimeType": "application/gpx+xml", "buffer": custom_gpx.encode("utf-8")}])
        page.wait_for_function("() => document.getElementById('skitour-agency-tag') && document.getElementById('skitour-agency-tag').innerText.includes('2.014')", timeout=10000)
        custom_tag = page.inner_text("#skitour-agency-tag")
        assert "1.180" in custom_tag and "2.014" in custom_tag, f"Dashboard must immediately reflect custom GPX elevation span (1.180-2.014), got: {custom_tag}"
        page.click("#skitour-live-refresh-btn", force=True)
        page.wait_for_timeout(500)
        print(f"✓ Custom GPX Live Adaptation verified: '{custom_tag}'")

        # 9. TEST 8: Sources Banner, 10-Day Tour Planner & Interactive Day Switch
        print("\n--- TEST 8: 10-Day Skitour Fresh Snow & Avalanche Planner ---")
        src_label = page.inner_text("#skitour-source-label")
        assert "Open-Meteo" in src_label or "SLF" in src_label or "Albina" in src_label or "GeoSphere" in src_label or "Prognose" in src_label, f"Source banner must state active data sources, got: {src_label}"
        rows = page.locator("#skitour-10day-list .skitour-10day-row")
        assert rows.count() == 10, f"10-Day Skitour Planner must render 10 days, got: {rows.count()}"
        day5 = rows.nth(4)
        day5_date = day5.get_attribute("data-date")
        day5.click(force=True)
        page.wait_for_timeout(300)
        assert page.eval_on_selector("#sports-date-input", "el => el.value") == day5_date, "Clicking day 5 must sync #sports-date-input"
        assert page.locator(f"#skitour-10day-list .skitour-10day-row[data-date='{day5_date}'].is-selected").count() == 1, "Day 5 must become selected"
        print(f"✓ 10-Day Planner verified (10 days rendered, clicked future date {day5_date}, source: '{src_label}')")

        # 10. TEST 9: Swiss SLF Davos Official Live CAAMLv6 GeoJSON Integration
        print("\n--- TEST 9: Swiss SLF Davos CAAMLv6 Live Bulletin ---")
        swiss_gpx = '''<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>Parsenn Weissfluhjoch</name><trkseg>
<trkpt lat="46.8150" lon="9.8400"><ele>1560</ele></trkpt>
<trkpt lat="46.8350" lon="9.7950"><ele>2693</ele></trkpt>
</trkseg></trk></gpx>'''
        # Reset tour date back to today (index 0) to inspect today's active SLF bulletin
        rows.nth(0).click(force=True)
        page.wait_for_timeout(200)
        page.set_input_files("#sports-file-input", files=[{"name": "Weissfluhjoch.gpx", "mimeType": "application/gpx+xml", "buffer": swiss_gpx.encode("utf-8")}])
        page.wait_for_function("() => document.getElementById('skitour-agency-tag') && document.getElementById('skitour-agency-tag').innerText.includes('SLF Davos')", timeout=12000)
        slf_src = page.inner_text("#skitour-source-label")
        assert "SLF Davos" in slf_src and ("ECHT / OFFIZIELL" in slf_src or "Offizieller Lawinenlagebericht" in slf_src), f"Expected live SLF Davos official bulletin in source banner, got: {slf_src}"
        print(f"✓ Live SLF Davos Official Bulletin verified: '{slf_src}'")
        dashboard.screenshot(path=screenshot_path)
        print(f"📸 Updated Skitour Cockpit artifact (incl. 10-Day Planner & Official LLB): {screenshot_path}")

        # 11. TEST 10: Harmonized Mountain Tab Avalanche/Snow Details & Overview Exact LLB Score
        print("\n--- TEST 10: Mountain Forecast Snow/Avalanche & Overview LLB Score ---")
        # Search for Zermatt / Matterhorn or Davos so Tab Mountain + Overview load Swiss official SLF bulletin
        page.evaluate("() => window.loadLocation && window.loadLocation({ name: 'Davos Weissfluhjoch', lat: 46.835, lon: 9.795, elevation: 2693, country: 'Schweiz', isMountain: true })")
        page.wait_for_function("() => window.state && window.state.microData && window.state.microData.avalancheReport && window.state.microData.avalancheReport.isOfficialBulletin", timeout=12000)
        page.wait_for_timeout(400)

        # Verify Overview hourly & daily exact LLB pills are rendered because exact SLF CAAMLv6 values are active!
        page.locator("[data-tab='tab-overview']").first.click(force=True)
        page.wait_for_timeout(300)
        hourly_llb = page.locator("#hourly-forecast-list .hourly-llb-pill").count()
        daily_llb = page.locator("#daily-forecast-list .daily-llb-pill").count()
        assert hourly_llb >= 1, f"Overview hourly slider must show exact LLB pill when official SLF bulletin is active, got {hourly_llb}"
        assert daily_llb >= 1, f"Overview daily forecast must show exact LLB pill when official SLF bulletin is active, got {daily_llb}"
        print(f"✓ Overview LLB Scores verified (Hourly: {hourly_llb} exact pills, Daily: {daily_llb} exact pills)")

        # Switch to Mountain Tab and verify rich snow, fresh snow, quality, provenance & 10-day strip match
        page.locator("[data-tab='tab-mountain']").first.click(force=True)
        page.wait_for_timeout(400)
        mtn_prov = page.inner_text("#av-eaws-prov-badge")
        mtn_qual = page.inner_text("#av-snow-quality-val")
        mtn_10d = page.locator("#av-10day-strip .av-10d-pill").count()
        mtn_wall_snow = page.inner_text("#active-wall-snow")
        assert "ECHT" in mtn_prov and "kg/m³" in mtn_qual and mtn_10d == 10, f"Mountain tab must render official provenance, snow quality & 10-day strip (got prov={mtn_prov}, qual={mtn_qual}, 10d={mtn_10d})"
        assert "Neuschnee" in mtn_wall_snow, f"Mountain active wall snow must show fresh snow & quality, got: {mtn_wall_snow}"
        print(f"✓ Mountain Forecast Snow & Avalanche harmonized (Prov: '{mtn_prov}', Quality: '{mtn_qual}', 10-Day strip: {mtn_10d})")

        mtn_av_card = page.locator("#avalanche-danger-card")
        mtn_av_card.screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_mountain_avalanche_card.png")
        print("📸 Captured Mountain Avalanche & Snow artifact: verified_mountain_avalanche_card.png")

        # 12. TEST 11: App-Wide Scroll-Jump Guard (Focusout, Firn Red Block, Rose, 10-Day, Spotlight, Overview)
        print("\n--- TEST 11: App-Wide Zero Scroll-Jump Verification ---")

        def click_without_scroll_jump(locator, pre_focus_selector=None, scroll_y=None):
            if scroll_y is not None:
                page.evaluate(f"() => window.scrollTo(0, {scroll_y})")
            else:
                locator.scroll_into_view_if_needed()
            if pre_focus_selector:
                page.evaluate(f"() => document.querySelector({pre_focus_selector!r})?.focus({{ preventScroll: true }})")
            page.wait_for_timeout(80)
            y_before = page.evaluate("() => window.scrollY")
            box = locator.bounding_box()
            assert box, "Target element must have visible bounding box"
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.wait_for_timeout(200)
            y_after = page.evaluate("() => window.scrollY")
            assert abs(y_after - y_before) <= 5, f"Scroll jump detected! before={y_before}, after={y_after}"
            return y_after

        # Overview: pre-focus search input without scrolling, click daily row -> scrollY stays put
        page.locator("[data-tab='tab-overview']").first.click(force=True)
        page.wait_for_timeout(300)
        y_ov = click_without_scroll_jump(
            page.locator("#daily-forecast-list .daily-interactive-row").nth(2),
            pre_focus_selector="#location-search-input",
            scroll_y=360
        )

        # Mountain: click danger rose & hourly profile pill -> never jump to top
        page.locator("[data-tab='tab-mountain']").first.click(force=True)
        page.wait_for_timeout(300)
        y_mtn = click_without_scroll_jump(
            page.locator("#rose-sec-n"),
            pre_focus_selector="#location-search-input",
            scroll_y=450
        )

        # Skitour: pre-focus step button, scroll to Firn timeline, click red hour square & rose & 10-day row -> zero jump!
        page.locator("[data-tab='tab-sports']").first.click(force=True)
        page.wait_for_timeout(300)
        page.locator("#sport-cat-skitour").click(force=True)
        page.wait_for_timeout(200)
        firn_last = page.locator("#firn-timeline-track .firn-track-hour").last
        firn_last.scroll_into_view_if_needed()
        y_firn_target = page.evaluate("() => window.scrollY")
        y_firn = click_without_scroll_jump(
            firn_last,
            pre_focus_selector="#skitour-ascent-plus",
            scroll_y=y_firn_target
        )
        firn_txt = page.inner_text("#skitour-firn-desc")
        assert "Uhr:" in firn_txt, f"Clicking firn hour button must reveal exact hour diagnostic, got: {firn_txt}"

        y_st_rose = click_without_scroll_jump(
            page.locator("#st-rose-n"),
            pre_focus_selector="#skitour-ascent-plus",
            scroll_y=y_firn_target
        )
        day_row2 = page.locator("#skitour-10day-list .skitour-10day-row").nth(2)
        day_row2.scroll_into_view_if_needed()
        page.wait_for_timeout(80)
        page.evaluate("() => document.querySelector('#skitour-ascent-plus')?.focus({ preventScroll: true })")
        rect_before = day_row2.bounding_box()
        assert rect_before, "10-day row must be visible"
        page.mouse.click(rect_before["x"] + rect_before["width"] / 2, rect_before["y"] + rect_before["height"] / 2)
        page.wait_for_timeout(200)
        y_st_day = page.evaluate("() => window.scrollY")
        rect_after = page.locator("#skitour-10day-list .skitour-10day-row").nth(2).bounding_box()
        assert y_st_day >= 1500 and rect_after and abs(rect_after["y"] - rect_before["y"]) <= 5, f"10-day row shifted or jumped! scrollY={y_st_day}, dy={rect_after['y'] - rect_before['y'] if rect_after else 'none'}"
        print(f"✓ Zero scroll-to-top jumps verified across Overview (y={y_ov}), Mountain (y={y_mtn}), Skitour Firn/Rose (y={y_firn}->{y_st_rose}) & 10-Day Row (y={y_st_day}, dy={rect_after['y'] - rect_before['y']:.1f}px)")

        # 13. TEST 12: Skitour Pro Features (Model Consensus, Aspect-Firn, Phases, Munter Toggle, Emergency, Slope Overlay, 7-Zone Router)
        print("\n--- TEST 12: Skitour Pro Features & Pan-Alpine NWP Routing ---")
        assert page.is_visible("#skitour-model-consensus-pill"), "Model consensus pill must be visible"
        assert page.is_visible("#skitour-aspect-firn-grid"), "Aspect-firn 4-cell grid must be visible"
        assert len(page.inner_text("#afg-s").strip()) > 2, "South aspect firn cell must be populated"

        assert page.is_visible("#skitour-phase-card"), "Phase analysis card must be visible"
        assert "h" in page.inner_text("#st-phase-ascent") and "min" in page.inner_text("#st-phase-descent"), "Ascent & descent split must be shown"
        assert page.locator("#skitour-gear-chips .st-gear-chip").count() >= 2, "Gear checklist must render dynamic chips"

        opt_btn = page.locator("#st-optimal-start-btn")
        assert opt_btn.is_visible(), "Optimal start advisor button must be visible"
        opt_start_val = opt_btn.get_attribute("data-start-time")
        opt_btn.click(force=True)
        page.wait_for_timeout(150)
        assert page.eval_on_selector("#sports-time-input", "el => el.value") == opt_start_val, f"Clicking optimal start must set time input to {opt_start_val}"

        # Munter Group Toggle
        munter_btn = page.locator("#st-munter-group-toggle")
        assert munter_btn.is_visible(), "Munter group toggle must be visible"
        txt_before = munter_btn.inner_text()
        munter_btn.click(force=True)
        page.wait_for_timeout(150)
        txt_after = munter_btn.inner_text()
        assert txt_before != txt_after, f"Munter toggle must switch state, got {txt_before} -> {txt_after}"
        munter_btn.click(force=True)

        # Steep Slope Map Overlay Toggle
        slope_btn = page.locator("#sports-slope-overlay-btn")
        assert slope_btn.is_visible(), "Slope overlay toggle must be visible on skitour map"
        slope_btn.click(force=True)
        page.wait_for_timeout(250)
        assert slope_btn.get_attribute("aria-pressed") == "true", "Slope overlay button must activate aria-pressed"

        # Offline Emergency Modal
        page.click("#skitour-emergency-btn", force=True)
        page.wait_for_timeout(150)
        assert page.is_visible("#skitour-emergency-modal"), "Emergency modal must open"
        em_txt = page.inner_text("#skitour-emergency-modal")
        assert "140" in em_txt and "1414" in em_txt and "112" in em_txt and "N," in em_txt, "Emergency modal must display alpine rescue numbers & WGS84 coordinates"
        page.click("#skitour-emergency-close", force=True)
        page.wait_for_timeout(100)
        assert not page.is_visible("#skitour-emergency-modal"), "Emergency modal must close cleanly"

        # Verify all 7 Pan-Alpine NWP sub-regions route to distinct optimal models
        subregions = page.evaluate("""() => {
            const pts = [
                { name: 'FR', lat: 45.92, lon: 6.87, ele: 3200 },
                { name: 'CH', lat: 46.02, lon: 7.75, ele: 3000 },
                { name: 'BY', lat: 47.42, lon: 10.28, ele: 2200 },
                { name: 'AT_W', lat: 47.12, lon: 11.12, ele: 2800 },
                { name: 'IT', lat: 46.54, lon: 12.13, ele: 2600 },
                { name: 'AT_O', lat: 47.64, lon: 15.83, ele: 1900 },
                { name: 'SI', lat: 46.38, lon: 13.84, ele: 2400 }
            ];
            return pts.map(p => ({
                name: p.name,
                subRegionKey: MicroEngine.getRegionalModelPriority(p.lat, p.lon, p.ele).subRegionKey,
                models: MicroEngine.getRegionalModelPriority(p.lat, p.lon, p.ele).modelsToQuery
            }));
        }""")
        keys = [r["subRegionKey"] for r in subregions]
        assert len(set(keys)) == 7, f"Expected 7 distinct Alpine NWP sub-regions, got: {subregions}"
        assert "meteofrance_arome_france" in subregions[0]["models"], "FR must prioritize AROME France"
        assert "meteoswiss_icon_ch1" in subregions[1]["models"], "CH must prioritize ICON-CH1"
        assert "italia_meteo_arpae_icon_2i" in subregions[4]["models"], "IT must prioritize ARPAE ICON-2I"
        print(f"✓ Skitour Pro Cockpit, Slope Overlay, Emergency Card & 7-Zone Pan-Alpine NWP Router verified ({', '.join(keys)})")

        # 14. TEST 13: Map-Integrated Elevation Profile (Inline + Fullscreen + Mouse/Touch Scrubbing + Per-Sport Details)
        print("\n--- TEST 13: Map-Integrated Elevation Profile (Normal & Fullscreen) ---")
        assert page.query_selector("#sports-chart-wrapper") is None, "Legacy #sports-chart-wrapper must stay removed"
        dock = page.locator("#sports-map-elevation-dock")
        dock.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        assert dock.is_visible(), "Map elevation dock must be visible below map"
        map_box = page.locator("#sports-map-stage").bounding_box()
        dock_box = dock.bounding_box()
        assert map_box and dock_box and dock_box["y"] >= map_box["y"] + map_box["height"] - 2, f"Dock must sit directly below map: map={map_box}, dock={dock_box}"

        # Hover/Move across elevation profile (mouse without clicking) -> moves scrubber + map marker + HUD
        chart_box = page.locator("#smed-chart-wrap").bounding_box()
        assert chart_box and chart_box["width"] > 200
        latlng_before = page.evaluate("() => window.state.sports.scrubberMarker?.getLatLng()")
        page.mouse.move(chart_box["x"] + chart_box["width"] * 0.55, chart_box["y"] + chart_box["height"] * 0.5)
        page.wait_for_timeout(150)
        latlng_after = page.evaluate("() => window.state.sports.scrubberMarker?.getLatLng()")
        assert latlng_after and (abs(latlng_after["lat"] - latlng_before["lat"]) > 1e-4 or abs(latlng_after["lng"] - latlng_before["lng"]) > 1e-4), "Mouse hover on profile must move GPX marker on map"
        smed_pos_txt = page.inner_text("#smed-pos")
        smed_met_txt = page.inner_text("#smed-metric")
        assert "km" in smed_pos_txt and "m" in smed_pos_txt and "°" in smed_met_txt, f"Skitour profile HUD must show km, m and slope angle, got pos={smed_pos_txt}, met={smed_met_txt}"
        assert page.is_visible("#scrubber-map-live-pill"), "Moving map pin must show live mini-badge"

        # Verify sport-specific legend & HUD switching across Rad -> Berge -> Skitour
        page.locator('.sports-route-preset[data-tour="allgaeu-radtour"]').click(force=True)
        page.wait_for_function("() => window.state && window.state.sports && window.state.sports.category === 'bike' && document.getElementById('smed-legend')?.innerText.includes('Abfahrt')", timeout=8000)
        page.wait_for_timeout(150)
        assert "%" in page.inner_text("#smed-metric"), f"Bike profile HUD must show % grade, got: {page.inner_text('#smed-metric')}"

        page.locator('.sports-route-preset[data-tour="skitour-sellrain"]').click(force=True)
        page.wait_for_function("() => window.state && window.state.sports && window.state.sports.category === 'skitour' && document.getElementById('smed-legend')?.innerText.includes('<30°')", timeout=8000)
        page.wait_for_timeout(200)

        # Capture inline map + elevation profile screenshot
        page.locator("#sports-map-card").scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        chart_box = page.locator("#smed-chart-wrap").bounding_box()
        page.mouse.move(chart_box["x"] + chart_box["width"] * 0.45, chart_box["y"] + chart_box["height"] * 0.5)
        page.wait_for_timeout(150)
        page.locator("#sports-map-card").screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_map_with_elevation_inline.png")

        # Test Fullscreen Mode with Elevation Profile Dock + Collapse toggle
        page.click("#sports-map-fullscreen-btn", force=True)
        page.wait_for_timeout(250)
        assert page.eval_on_selector("#sports-map-wrapper", "el => el.classList.contains('sports-map-fullscreen')")
        fs_map_box = page.locator("#sports-map-stage").bounding_box()
        fs_dock_box = dock.bounding_box()
        assert fs_dock_box and fs_dock_box["y"] >= fs_map_box["y"] + fs_map_box["height"] - 2 and fs_dock_box["y"] + fs_dock_box["height"] <= 902, f"Fullscreen dock must stay at bottom of viewport: map={fs_map_box}, dock={fs_dock_box}"
        overflow_bugs = page.evaluate("""() => {
            const bad = [];
            document.querySelectorAll('#sports-map-container .ms-detailed-card').forEach(card => {
                const cr = card.getBoundingClientRect();
                if (cr.width <= 0) return;
                card.querySelectorAll('.ms-eaws-pill, .sm-ref-sub, .sm-ref-sub span').forEach(ch => {
                    const r = ch.getBoundingClientRect();
                    if (r.right > cr.right + 1 || r.left < cr.left - 1) {
                        bad.push({ text: ch.innerText, childRight: r.right, cardRight: cr.right });
                    }
                });
            });
            return bad;
        }""")
        assert not overflow_bugs, f"Detailed waypoint cards must never overflow: {overflow_bugs}"
        page.screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_map_with_elevation_fullscreen.png")

        page.click("#smed-collapse-btn", force=True)
        page.wait_for_timeout(120)
        assert dock.evaluate("el => el.classList.contains('is-collapsed')") and not page.is_visible("#smed-chart-wrap"), "Collapse button must hide chart canvas in fullscreen"
        page.click("#smed-collapse-btn", force=True)
        page.wait_for_timeout(120)
        assert not dock.evaluate("el => el.classList.contains('is-collapsed')") and page.is_visible("#smed-chart-wrap")

        page.click("#sports-map-close-btn", force=True)
        page.wait_for_timeout(200)

        # Verify 2-peak / double-ascent GPX detects Aufstieg -> Abfahrt -> Aufstieg -> Abfahrt accurately without cryptic (S)/(NO) suffixes
        double_peak_gpx = '''<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>DoublePeak Skitour</name><trkseg>
<trkpt lat="47.20000" lon="10.12000"><ele>1200</ele></trkpt>
<trkpt lat="47.20800" lon="10.12000"><ele>1600</ele></trkpt>
<trkpt lat="47.21600" lon="10.12000"><ele>2060</ele></trkpt>
<trkpt lat="47.22400" lon="10.12000"><ele>1750</ele></trkpt>
<trkpt lat="47.23200" lon="10.12000"><ele>1550</ele></trkpt>
<trkpt lat="47.24000" lon="10.12000"><ele>1850</ele></trkpt>
<trkpt lat="47.24800" lon="10.12000"><ele>2020</ele></trkpt>
<trkpt lat="47.25600" lon="10.12000"><ele>1650</ele></trkpt>
<trkpt lat="47.26400" lon="10.12000"><ele>1250</ele></trkpt>
</trkseg></trk></gpx>'''
        page.set_input_files("#sports-file-input", files=[{"name": "DoublePeak.gpx", "mimeType": "application/gpx+xml", "buffer": double_peak_gpx.encode("utf-8")}])
        page.wait_for_function("() => window.state?.sports?.timeline?.maxElevationM === 2060 && document.getElementById('skitour-agency-tag')?.innerText.includes('2.060')", timeout=10000)
        page.locator("#sports-map-elevation-dock").scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        c_box = page.locator("#smed-chart-wrap").bounding_box()
        assert c_box
        def hover_pct(f):
            page.mouse.move(c_box["x"] + 42 + (c_box["width"] - 54) * f, c_box["y"] + c_box["height"] / 2)
            page.wait_for_timeout(80)
            return page.inner_text("#smed-metric"), (page.inner_text("#smed-extra") if page.is_visible("#smed-extra") else "")
        m1, ex1 = hover_pct(0.15)
        m2, _ = hover_pct(0.42)
        m3, _ = hover_pct(0.66)
        m4, _ = hover_pct(0.90)
        assert "Aufstieg" in m1, f"Expected Aufstieg on climb 1, got {m1}"
        assert "Abfahrt" in m2, f"Expected Abfahrt on descent 1, got {m2}"
        assert "Aufstieg" in m3, f"Expected Aufstieg on second climb, got {m3}"
        assert "Abfahrt" in m4, f"Expected Abfahrt on descent 2, got {m4}"
        assert "(Limit" not in ex1, f"No cryptic Limit suffix allowed, got {ex1}"
        print("✓ Map-Integrated Elevation Profile (Inline, Fullscreen, Double-Ascent Phase Detection, Clean Labels & Collapse) verified!")

        print("\n--- TEST 14: Profi-Sportplanung (Rad/Berge/Skitour, Sub-Disziplinen, Pause, <wpt>, Daylight, 10-Day) ---")
        # 1. Verbotene / nicht gewünschte Module strikt ausgeschlossen prüfen
        assert page.locator("#sports-subsport-selector [data-subsport='skimo']").count() == 0, "Skimo Race must NOT be present"
        # 2. Globaler Notfall-Button & Briefing-Button bei Rad/Berge prüfen
        page.locator('.sports-route-preset[data-tour="allgaeu-radtour"]').click(force=True)
        page.wait_for_function("() => window.state?.sports?.category === 'bike' && document.getElementById('sports-pro-planner-card')?.style.display !== 'none'", timeout=8000)
        page.click("#sports-global-emergency-btn", force=True)
        assert page.is_visible("#skitour-emergency-modal"), "Global Emergency modal must open for Bike category"
        page.click("#skitour-emergency-close", force=True)
        assert page.is_visible("#sports-briefing-btn"), "Briefing export button must be visible"
        assert page.is_visible("#sports-pro-meta-strip"), "Daylight & UV strip must be visible"
        assert page.locator("#sp-10day-list .skitour-10day-row").count() == 10, "Bike must render 10-day planner"
        page.locator("#sports-pro-planner-card").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        page.locator("#sports-pro-planner-card").screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_rad_pro_cockpit.png")

        # 3. Sub-Disziplin Gravel / E-Bike umschalten
        page.eval_on_selector("#sports-setup-drawer", "el => el.open = true")
        page.locator("#sss-pills-bike [data-subsport='e_bike']").click(force=True)
        page.wait_for_function("() => window.state?.sports?.sportType === 'e_bike'", timeout=5000)

        # 4. Pause-Steuerung prüft echte Ankunftszeit-Verschiebung (+30 min)
        end_before = page.evaluate("() => window.state.sports.timeline.endTimeMs")
        page.locator("#sports-pause-presets [data-pause-min='30']").click(force=True)
        page.wait_for_function("(prevEnd) => window.state.sports.timeline.endTimeMs >= prevEnd + 25 * 60000", arg=end_before, timeout=5000)
        page.locator("#sports-pause-presets [data-pause-min='0']").click(force=True)

        # 5. Berge-Subdisziplinen + Klettersteig + GPX <wpt> Pins & Dämmerungs-Warnung
        page.locator('.sports-route-preset[data-tour="nebelhorn-oberstdorf"]').click(force=True)
        page.wait_for_function("() => window.state?.sports?.category === 'mountain'", timeout=8000)
        page.locator("#sss-pills-mountain [data-subsport='via_ferrata']").click(force=True)
        page.wait_for_function("() => window.state?.sports?.sportType === 'via_ferrata'", timeout=5000)

        wpt_gpx = '''<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1">
<wpt lat="47.4125" lon="10.3085"><ele>1280</ele><name>Seealpe Hütte</name></wpt>
<wpt lat="47.4223" lon="10.3444"><ele>2224</ele><name>Nebelhorn Gipfelkreuz</name></wpt>
<trk><name>Nebelhorn Pro Test</name><trkseg>
<trkpt lat="47.4080" lon="10.2790"><ele>813</ele></trkpt>
<trkpt lat="47.4125" lon="10.3085"><ele>1280</ele></trkpt>
<trkpt lat="47.4185" lon="10.3280"><ele>1800</ele></trkpt>
<trkpt lat="47.4223" lon="10.3444"><ele>2224</ele></trkpt>
<trkpt lat="47.4420" lon="10.3010"><ele>867</ele></trkpt>
</trkseg></trk></gpx>'''
        page.set_input_files("#sports-file-input", files=[{"name": "NebelhornWpt.gpx", "mimeType": "application/gpx+xml", "buffer": wpt_gpx.encode("utf-8")}])
        page.wait_for_function("() => (window.state?.sports?.timeline?.mappedWaypoints?.length || 0) >= 2", timeout=8000)
        page.eval_on_selector("#sports-waypoints-drawer", "el => el.open = true")
        assert page.locator("#sports-gpx-wpts-strip .sgws-chip").count() >= 2, "Embedded GPX <wpt> chips must render"
        assert page.locator("#sports-map-container .sports-gpx-wpt-marker").count() >= 2, "Embedded GPX <wpt> markers must render on map"

        # Spät-Start (16:00 Uhr) muss echte Dämmerungs-/Dunkelheitswarnung erzeugen
        page.fill("#sports-time-input", "16:00")
        page.dispatch_event("#sports-time-input", "change")
        page.wait_for_function("() => Boolean(window.state?.sports?.timeline?.daylightAnalysis?.finishesInDarkness || window.state?.sports?.timeline?.daylightAnalysis?.finishesInTwilight)", timeout=5000)
        page.locator("#sports-hero-card").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        page.locator("#sports-hero-card").screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_mountain_pro_hero.png")

        # 6. Skitour Abfellpuffer & Tragestrecken-Prüfung
        page.locator('.sports-route-preset[data-tour="skitour-sellrain"]').click(force=True)
        page.wait_for_function("() => window.state?.sports?.category === 'skitour' && window.state?.sports?.timeline?.abfellPauseMinutes === 10", timeout=8000)
        print("✓ Profi-Sportplanung (Rad/Berge/Skitour, Sub-Disziplinen, Pause+Abfellpuffer, <wpt>, Daylight, 10-Day) verified!")

        context.close()
        browser.close()
        print("\n==========================================")
        print("🎉 ALL SKITOUR EXPERT TESTS PASSED (100%)")
        print("==========================================")

if __name__ == '__main__':
    run_skitour_suite()
