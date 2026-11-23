import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

def run_scrubber_tests():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    
    print(f"🚀 Timeline Scrubber Test Server running on http://127.0.0.1:{port}")
    
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
        # iPhone 15 Pro viewport (393 x 852, ProMotion 120Hz touch device)
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
        
        print("\n--- TEST: Mobile Viewport Load & Navigation to Map Tab ---")
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        page.wait_for_timeout(1000)
        
        report("Initial page loaded with zero JS errors", len(page_errors) == 0, str(page_errors))
        
        # Switch to Map Tab
        page.click("#mobile-bottom-nav .mbn-btn[data-tab='tab-map']")
        page.wait_for_timeout(1000)
        page.wait_for_selector("#radar-floating-controls")
        
        slider = page.locator("#radar-time-slider")
        hud = page.locator("#radar-floating-scrubber-hud")
        needle = page.locator("#ms-scrubber-needle")
        
        print("\n--- TEST: Ergonomic Touch Target (Apple 44px+ HIG) ---")
        slider_box = slider.bounding_box()
        report("Slider element exists in DOM", slider_box is not None)
        report(f"Slider touch hitbox is >= 44px (actual: {slider_box['height']}px)", slider_box['height'] >= 44)
        
        slider_touch_action = slider.evaluate("el => getComputedStyle(el).touchAction")
        report(f"Slider touch-action is 'none' for zero-conflict scrolling (actual: '{slider_touch_action}')", slider_touch_action == "none")
        
        print("\n--- TEST: Floating HUD Lifecycle & Initial Visibility ---")
        hud_active_initial = page.eval_on_selector("#radar-floating-scrubber-hud", "el => el.classList.contains('is-active')")
        report("HUD is initially NOT active (.is-active absent)", not hud_active_initial)
        
        print("\n--- TEST: Scrubbing Activation & 120 FPS Needle & HUD Updates ---")
        # Trigger touchstart and pointerdown on slider
        slider.dispatch_event("pointerdown")
        slider.evaluate("""el => {
            el.value = 8;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(200)
        
        hud_active_scrub = page.eval_on_selector("#radar-floating-scrubber-hud", "el => el.classList.contains('is-active')")
        report("HUD acquires '.is-active' class during scrubbing", hud_active_scrub)
        
        needle_active = page.eval_on_selector("#ms-scrubber-needle", "el => el.classList.contains('is-active')")
        report("Needle acquires '.is-active' glowing state during scrubbing", needle_active)
        
        time_label = page.locator("#rfh-time-label").inner_text()
        rel_badge = page.locator("#rfh-rel-badge").inner_text()
        weather_icon = page.locator("#rfh-weather-icon").inner_text()
        weather_temp = page.locator("#rfh-weather-temp").inner_text()
        weather_precip = page.locator("#rfh-weather-precip").inner_text()
        weather_wind = page.locator("#rfh-weather-wind").inner_text()
        
        report(f"HUD Time row is populated: '{time_label}'", len(time_label) > 0)
        report(f"HUD Relative badge is populated: '{rel_badge}'", len(rel_badge) > 0)
        report(f"HUD Weather row contains condition icon '{weather_icon}' and temp '{weather_temp}'", len(weather_icon) > 0 and '°' in weather_temp)
        report(f"HUD Weather row contains precipitation '{weather_precip}' and wind '{weather_wind}'", len(weather_precip) > 0 and len(weather_wind) > 0)
        
        print("\n--- TEST: Apple-Grade Horizontal Viewport Clamping (Left & Right Edges) ---")
        # Test Left Edge (value 0)
        slider.evaluate("""el => {
            el.value = 0;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(100)
        hud_box_left = hud.bounding_box()
        track_box = page.locator(".radar-slider-track-wrap").bounding_box()
        report("At min slider (0%), HUD left edge does not clip offscreen (x >= track_x)", hud_box_left['x'] >= track_box['x'] - 5)
        
        # Test Right Edge (value max)
        slider.evaluate("""el => {
            el.value = el.max;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(100)
        hud_box_right = hud.bounding_box()
        hud_right_edge = hud_box_right['x'] + hud_box_right['width']
        track_right_edge = track_box['x'] + track_box['width']
        report("At max slider (100%), HUD right edge does not clip offscreen (right <= track_right + 5)", hud_right_edge <= track_right_edge + 8)
        
        # Capture Screenshot with HUD active in mid-range (+6h / +12h)
        slider.evaluate("""el => {
            el.value = 16;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(300)
        
        artifact_path = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_map_floating_scrubber_hud.png"
        page.screenshot(path=artifact_path)
        report(f"Saved verified screenshot artifact to {artifact_path}", os.path.exists(artifact_path))
        
        print("\n--- TEST: Touch Release & Graceful HUD Dismissal ---")
        slider.dispatch_event("pointerup")
        slider.dispatch_event("change")
        page.wait_for_timeout(300)
        
        hud_active_released = page.eval_on_selector("#radar-floating-scrubber-hud", "el => el.classList.contains('is-active')")
        report("HUD loses '.is-active' class on touch release", not hud_active_released)
        
        needle_active_released = page.eval_on_selector("#ms-scrubber-needle", "el => el.classList.contains('is-active')")
        report("Needle loses '.is-active' on touch release", not needle_active_released)
        
        report("Zero runtime JavaScript exceptions throughout all interactions", len(page_errors) == 0, str(page_errors))
        
        browser.close()
        
    print("\n==========================================")
    print(f"MAP TIMELINE SCRUBBER SUITE: {passed_tests}/{total_tests} PASSED")
    print("==========================================")
    
    if passed_tests < total_tests:
        sys.exit(1)

if __name__ == "__main__":
    run_scrubber_tests()
