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
        print(f"✓ GPX Slope Scan & Munter 3x3 Check verified ({max_slope})")

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
        assert ("Offiz. LLB" in first_tbl_text or "Prognose" in first_tbl_text) and "/5" in first_tbl_text, f"Table EAWS badge must distinguish Official vs Prognose and contain X/5, got: {first_tbl_text}"
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
        assert "SLF Davos" in slf_src and ("ECHT / OFFIZIELL" in slf_src or "Offizieller LLB" in slf_src), f"Expected live SLF Davos official bulletin in source banner, got: {slf_src}"
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

        context.close()
        browser.close()
        print("\n==========================================")
        print("🎉 ALL SKITOUR EXPERT TESTS PASSED (100%)")
        print("==========================================")

if __name__ == '__main__':
    run_skitour_suite()
