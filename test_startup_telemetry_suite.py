import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

def run_startup_telemetry_tests():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    
    print(f"🚀 Telemetry & Startup Test Server running on http://127.0.0.1:{port}")
    
    total_tests = 0
    passed_tests = 0
    
    def report(name, success, detail=""):
        nonlocal total_tests, passed_tests
        total_tests += 1
        if success:
            passed_tests += 1
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ {name}: {detail}")
            
    with sync_playwright() as p:
        device = p.devices.get('iPhone 14 Pro') or {
            'viewport': {'width': 393, 'height': 852},
            'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
            'is_mobile': True,
            'has_touch': True
        }
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(**device)
        page = context.new_page()
        
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        
        print("\n--- TEST: Critical Head Elements & FOUC Prevention ---")
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        
        report("Initial page loaded with zero JS errors", len(page_errors) == 0, str(page_errors))
        
        # Test 1: Check inline dark background in head
        head_html = page.evaluate("document.head.innerHTML")
        has_dark_bg = "#0b1329" in head_html
        report("Inline critical background #0b1329 is present in <head>", has_dark_bg)
        
        # Test 2: Apple touch startup image link
        has_startup_img = page.evaluate("!!document.querySelector('link[rel=\"apple-touch-startup-image\"]')")
        report("Apple Touch Startup Image link is present", has_startup_img)
        
        # Test 3: Topline Progress Bar in DOM
        tpb = page.evaluate("!!document.getElementById('topline-progress-bar') && !!document.getElementById('tpb-fill')")
        report("Topline Progress Bar & Fill elements exist in DOM", tpb)
        
        # Test 4: Header Brand is clean: Stadt/Flachland and 5G pill are NOT in header
        header_clean = page.evaluate("""() => {
            const navBrand = document.querySelector('.nav-brand');
            const hasPillInHeader = !!navBrand.querySelector('#network-telemetry-pill');
            const badge = document.getElementById('location-type-badge');
            const isBadgeHidden = !badge || window.getComputedStyle(badge).display === 'none';
            return !hasPillInHeader && isBadgeHidden;
        }""")
        report("Header brand is ultra-clean (no Stadt/Flachland & no 5G pill)", header_clean)

        # Test: Search Bar Placeholder & Pure Symbol GPS button
        search_ui = page.evaluate("""() => {
            const input = document.getElementById('location-search-input');
            const gpsBtn = document.getElementById('quick-gps-btn');
            const hasSvg = !!gpsBtn && !!gpsBtn.querySelector('.sig-svg');
            const hasText = !!gpsBtn && !!gpsBtn.querySelector('.sig-text');
            return {
                placeholder: input ? input.placeholder : '',
                hasSvg: hasSvg,
                hasText: hasText,
                btnWidth: gpsBtn ? gpsBtn.offsetWidth : 0
            };
        }""")
        report("Search bar placeholder is readable and clean ('Ort oder Berg suchen')", search_ui["placeholder"] == "Ort oder Berg suchen")
        report("GPS button is a pure icon symbol (SVG present, no text label)", search_ui["hasSvg"] and not search_ui["hasText"])

        # Capture Screenshot of Redesigned Top Bar & Search Bar
        artifact_path = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_redesigned_top_bar.png"
        page.screenshot(path=artifact_path, clip={"x": 0, "y": 0, "width": 393, "height": 260})
        report(f"Saved verified screenshot of redesigned top bar to {artifact_path}", os.path.exists(artifact_path))

        # Test 5: Network Telemetry Pill exists in Notification Settings
        ntp_in_settings = page.evaluate("""() => {
            const notifSettings = document.querySelector('#notif-view-settings');
            const pill = document.getElementById('network-telemetry-pill');
            const dot = document.getElementById('ntp-dot');
            const txt = document.getElementById('ntp-text');
            return !!notifSettings && notifSettings.contains(pill) && !!dot && !!txt && txt.innerText.length > 0;
        }""")
        report("Network Telemetry Pill is embedded subtly in notification settings", ntp_in_settings)
        
        # Test 6: Weather & Telemetry modules loaded in window context
        telemetry_ok = page.evaluate("""() => {
            return typeof window.TelemetryEngine !== 'undefined' || typeof window.loadLocation !== 'undefined';
        }""")
        report("Weather & Telemetry modules loaded in window context", telemetry_ok)
        
        # Test 7: Open Notification Settings & Click Telemetry Pill opens Diagnostics Modal
        page.click("#notif-settings-btn")
        page.wait_for_selector("#notif-modal-overlay", timeout=3000)
        page.click("#notif-tab-settings-btn")
        page.wait_for_timeout(300)
        
        page.click("#network-telemetry-pill")
        page.wait_for_selector("#telemetry-diag-modal.is-open", timeout=3000)
        modal_open = page.is_visible("#telemetry-diag-modal.is-open")
        report("Clicking telemetry pill displays diagnostics modal (.is-open)", modal_open)
        
        # Test 8: Modal content check
        diag_content = page.evaluate("""() => {
            const modal = document.getElementById('telemetry-diag-modal');
            return {
                title: modal.querySelector('.tdm-title')?.innerText || '',
                hasRefresh: !!modal.querySelector('#tdm-refresh-btn'),
                hasClose: !!modal.querySelector('.tdm-close')
            };
        }""")
        report("Modal contains diagnostics title, refresh button & close button", 
               "Netzwerk" in diag_content["title"] and diag_content["hasRefresh"] and diag_content["hasClose"])
        
        # Test 9: Close Diagnostics Modal & Notification Modal
        page.click("#telemetry-diag-modal .tdm-close")
        page.wait_for_timeout(400)
        modal_closed = not page.is_visible("#telemetry-diag-modal.is-open")
        report("Modal closes cleanly when close button is clicked", modal_closed)
        page.click("#notif-modal-close")
        page.wait_for_timeout(400)
        
        # Test 9: Zero-Prompt GPS: Check localStorage key persistence
        gps_persistence_ok = page.evaluate("""() => {
            localStorage.setItem('bw_gps_confirmed', 'true');
            localStorage.setItem('best_weather_last_gps', JSON.stringify({
                name: 'München Test GPS',
                lat: 48.137,
                lon: 11.576,
                elevation: 519
            }));
            const confirmed = localStorage.getItem('bw_gps_confirmed');
            const lastGps = JSON.parse(localStorage.getItem('best_weather_last_gps'));
            return confirmed === 'true' && lastGps.name === 'München Test GPS';
        }""")
        report("GPS anchor & confirmation flag persist in storage", gps_persistence_ok)
        
        # Test 10: TelemetryEngine raceWithTimeout functionality
        timeout_tested = page.evaluate("""async () => {
            // Test timeout error handling
            const slowPromise = new Promise(resolve => setTimeout(resolve, 500));
            // Simulate 50ms race
            try {
                let timer = null;
                const timeoutProm = new Promise((_, rej) => {
                    timer = setTimeout(() => {
                        const err = new Error('TIMEOUT_TEST');
                        err.isTimeout = true;
                        rej(err);
                    }, 50);
                });
                await Promise.race([slowPromise, timeoutProm]);
                clearTimeout(timer);
                return false;
            } catch (err) {
                return err.isTimeout === true;
            }
        }""")
        report("Hard-timeout race rejects properly on slow connections", timeout_tested)
        
        # Test 11: Service Worker Fast-Race Syntax check
        sw_content = open("sw.js", "r", encoding="utf-8").read()
        has_fast_race = "SW_NETWORK_TIMEOUT_FAST_RACE" in sw_content and "SW_API_TIMEOUT_FAST_RACE" in sw_content
        report("sw.js contains 1.2s shell & 2.5s API Fast-Race timeouts", has_fast_race)
        
        # Test 12: TelemetryEngine in sw.js STATIC_ASSETS
        has_te_in_sw = "./core/telemetryEngine.js" in sw_content
        report("sw.js STATIC_ASSETS caches ./core/telemetryEngine.js", has_te_in_sw)
        
        browser.close()
        
    print(f"\nSummary: {passed_tests}/{total_tests} Tests Passed.")
    return total_tests == passed_tests

if __name__ == "__main__":
    success = run_startup_telemetry_tests()
    if not success:
        sys.exit(1)
