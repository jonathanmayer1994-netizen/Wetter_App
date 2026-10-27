import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

def run_mobile_tests():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    
    print(f"🚀 Mobile Test server running on http://127.0.0.1:{port}")
    
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
        # iPhone 14/15 Pro viewport (393 x 852)
        device = p.devices.get('iPhone 14 Pro') or {
            'viewport': {'width': 393, 'height': 852},
            'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'is_mobile': True,
            'has_touch': True
        }
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(**device)
        page = context.new_page()
        
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        
        print("\n--- TEST: Mobile Viewport Initial Load & Bottom Bar ---")
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        page.wait_for_timeout(1000)
        
        report("Initial page loaded with zero JS errors", len(page_errors) == 0, str(page_errors))
        report("Mobile bottom navigation is visible initially", page.is_visible("#mobile-bottom-nav"))
        
        print("\n--- TEST: Tapping Map Button in Mobile Bottom Nav Enters Fullscreen ---")
        page.click("#mobile-bottom-nav .mbn-btn[data-tab='tab-map']")
        page.wait_for_timeout(800)
        
        is_fullscreen_active = page.eval_on_selector("body", "el => el.classList.contains('mobile-map-fullscreen-active')")
        report("body has 'mobile-map-fullscreen-active' class", is_fullscreen_active)
        
        # Bottom nav bar must be completely hidden
        nav_visible = page.is_visible("#mobile-bottom-nav")
        report("Mobile bottom navigation is completely hidden in fullscreen", not nav_visible)
        
        # Header must be completely hidden
        header_visible = page.is_visible(".app-header")
        report("App top header is completely hidden in fullscreen", not header_visible)
        
        # Check map wrapper dimensions (occupies entire screen)
        viewport_w = page.viewport_size["width"]
        viewport_h = page.viewport_size["height"]
        map_box = page.locator("#interactive-map").bounding_box()
        report("Map occupies 100% of mobile screen width", map_box is not None and abs(map_box["width"] - viewport_w) < 2)
        report("Map occupies 100% of mobile screen height", map_box is not None and abs(map_box["height"] - viewport_h) < 2)
        
        # Check Dedicated Close Button
        close_btn_visible = page.is_visible("#map-mobile-close-btn")
        report("Mobile close '✕' button is visible", close_btn_visible)
        close_box = page.locator("#map-mobile-close-btn").bounding_box()
        report("Close button is comfortably sized (44x44px)", close_box is not None and close_box["width"] >= 40 and close_box["height"] >= 40)
        report("Close button is in top-right corner", close_box is not None and close_box["x"] > 300 and close_box["y"] < 50)
        
        # Check Topbar positioning vs Close Button (no overlap!)
        topbar_box = page.locator("#map-floating-topbar").bounding_box()
        report("Floating topbar does not overlap close button", topbar_box is not None and close_box is not None and topbar_box["x"] + topbar_box["width"] <= close_box["x"] + 2)
        
        # Check Zoom Dock (placed above radar player without collision!)
        zoom_box = page.locator("#map-floating-zoom-dock").bounding_box()
        report("Floating zoom dock is visible and positioned on right edge", zoom_box is not None and zoom_box["x"] > 300)
        
        # Check Radar Timeline Player
        radar_box = page.locator("#radar-floating-controls").bounding_box()
        report("Radar player is docked at the bottom of the screen", radar_box is not None and abs(radar_box["y"] + radar_box["height"] - viewport_h) <= 15)
        
        # Verify Zoom Dock and Radar Player do NOT collide vertically
        report("Zoom dock is cleanly positioned above radar player", zoom_box is not None and radar_box is not None and zoom_box["y"] + zoom_box["height"] <= radar_box["y"] + 20)

        # Screenshot 1: Precip / Radar Fullscreen Mobile View
        screenshot_path_1 = "mobile_map_fullscreen_radar.png"
        page.screenshot(path=screenshot_path_1)
        print(f"  📸 Captured screenshot: {screenshot_path_1}")
        
        print("\n--- TEST: Wind Overlay & Mobile Wind Compass Ergonomics ---")
        page.click(".map-overlay-btn[data-overlay='wind']")
        page.wait_for_timeout(600)
        
        compass_visible = page.is_visible("#map-wind-compass-widget")
        report("Wind Compass widget is visible on Wind overlay", compass_visible)
        
        compass_box = page.locator("#map-wind-compass-widget").bounding_box()
        report("Wind compass is well proportioned (width <= 245px, height <= 80px)", compass_box is not None and compass_box["width"] <= 245 and compass_box["height"] <= 80)
        report("Wind compass does not collide with close button", compass_box is not None and close_box is not None and compass_box["x"] + compass_box["width"] < close_box["x"])
        
        dial_box = page.locator(".mwc-compass-dial").bounding_box()
        report("Wind compass dial is perfectly sized (~44px)", dial_box is not None and abs(dial_box["width"] - 44) <= 4)
        
        speed_text = page.inner_text("#mwc-speed-val")
        report("Wind speed value is displayed cleanly", len(speed_text) > 0 and int(speed_text) >= 0)
        
        # Screenshot 2: Wind Fullscreen Mobile View with Compass
        screenshot_path_2 = "mobile_map_fullscreen_wind.png"
        page.screenshot(path=screenshot_path_2)
        print(f"  📸 Captured screenshot: {screenshot_path_2}")
        
        print("\n--- TEST: Closing Fullscreen Map Mode via '✕' Button ---")
        page.click("#map-mobile-close-btn")
        page.wait_for_timeout(600)
        
        is_fullscreen_after_close = page.eval_on_selector("body", "el => el.classList.contains('mobile-map-fullscreen-active')")
        report("Fullscreen mode deactivated after clicking '✕'", not is_fullscreen_after_close)
        
        nav_visible_after = page.is_visible("#mobile-bottom-nav")
        report("Mobile bottom navigation is visible again", nav_visible_after)
        
        overview_active = page.is_visible("#tab-overview")
        report("Returned back to overview tab", overview_active)
        
        # Screenshot 3: Returned to normal tab view
        screenshot_path_3 = "mobile_returned_to_overview.png"
        page.screenshot(path=screenshot_path_3)
        print(f"  📸 Captured screenshot: {screenshot_path_3}")
        
        report("Zero unhandled JS exceptions throughout mobile flow", len(page_errors) == 0, str(page_errors))
        
        page.close()
        context.close()
        browser.close()
        
    httpd.shutdown()
    
    print(f"\n==========================================")
    print(f"MOBILE MAP TEST RESULTS: {passed_tests}/{total_tests} PASSED ({int(passed_tests/total_tests*100)}%)")
    print(f"==========================================")
    
    if passed_tests < total_tests:
        sys.exit(1)

if __name__ == '__main__':
    run_mobile_tests()
