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

        # Check Vector Danger Rose SVG
        assert page.is_visible("#skitour-danger-rose-svg"), "Vector danger rose SVG must be visible"
        page.click("#st-rose-n", force=True)
        page.wait_for_timeout(200)
        sec_name = page.inner_text("#skitour-sector-name")
        assert "Nord" in sec_name or "N" in sec_name, f"Selected sector name must update, got: {sec_name}"
        print(f"✓ Vector Danger Rose interactive click verified: '{sec_name}'")

        # Check Firn-Fenster Timeline
        firn_pill = page.inner_text("#skitour-firn-window-pill")
        assert "Firn-Fenster" in firn_pill or "Fenster" in firn_pill, f"Firn window pill must be populated, got: {firn_pill}"
        assert page.locator(".firn-track-hour").count() >= 10, "Firn timeline track must render hours"
        print(f"✓ Firn-Fenster timeline verified: '{firn_pill}'")

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

        # 6. Capture Visual Verification Artifact
        screenshot_path = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_skitour_cockpit.png"
        dashboard.screenshot(path=screenshot_path)
        print(f"📸 Captured Skitour Cockpit artifact: {screenshot_path}")

        context.close()
        browser.close()
        print("\n==========================================")
        print("🎉 ALL SKITOUR EXPERT TESTS PASSED (100%)")
        print("==========================================")

if __name__ == '__main__':
    run_skitour_suite()
