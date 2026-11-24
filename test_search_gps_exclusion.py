import os
import sys
import http.server
import threading
import time

node_dir = '/Users/jona/Library/Python/3.9/lib/python/site-packages/playwright/driver'
if os.path.exists(node_dir) and node_dir not in os.environ.get('PATH', ''):
    os.environ['PATH'] = f"{node_dir}:{os.environ.get('PATH', '')}"

from playwright.sync_api import sync_playwright

def test_gps_exclusion():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    print(f"🚀 Running GPS exclusion tests on http://127.0.0.1:{port}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1280, 'height': 850},
            service_workers="block"
        )
        context.grant_permissions(['geolocation'])
        context.set_geolocation({'latitude': 47.72, 'longitude': 10.32})
        
        page = context.new_page()
        page.goto(f'http://127.0.0.1:{port}/index.html', wait_until='domcontentloaded')
        page.wait_for_selector("#location-search-input", timeout=10000)
        time.sleep(1)
        
        # 1. Trigger GPS button explicitly
        gps_btn = page.locator("#quick-gps-btn")
        assert gps_btn.is_visible(), "GPS button must be visible in search bar"
        gps_btn.click()
        time.sleep(1)
        
        # 2. Check localStorage 'alpine_recent_searches'
        recents = page.evaluate("() => JSON.parse(localStorage.getItem('alpine_recent_searches') || '[]')")
        print("Recents after GPS click:", recents)
        for r in recents:
            assert not r['name'].startswith('Mein Standort'), f"GPS location '{r['name']}' must NOT be in recent searches!"
            assert not r['name'].startswith('Kartenpunkt'), f"Map point '{r['name']}' must NOT be in recent searches!"
            assert not r.get('isGps'), "Item with isGps=true must NOT be in recent searches!"
            
        print("✓ Verified: GPS location is strictly excluded from alpine_recent_searches storage")
        
        # 3. Simulate pre-existing dirty storage with old GPS & Kartenpunkt items
        page.evaluate("""() => {
            const dirty = [
                { name: 'Mein Standort (Durach)', lat: 47.72, lon: 10.32, elevation: 746, isGps: true },
                { name: 'Kartenpunkt (713 m)', lat: 47.70, lon: 10.30, elevation: 713, isMapPoint: true },
                { name: 'Nebelhorn', lat: 47.42, lon: 10.34, elevation: 2224, isMountain: true },
                { name: 'Mein Standort (Kempten)', lat: 47.73, lon: 10.31, elevation: 703 }
            ];
            localStorage.setItem('alpine_recent_searches', JSON.stringify(dirty));
        }""")
        
        # 4. Open search input and inspect dropdown items
        page.click("#location-search-input")
        time.sleep(0.5)
        
        dropdown = page.locator("#search-results-dropdown")
        assert dropdown.is_visible(), "Search results dropdown should open on focus"
        
        # Inspect rendered recent items
        recent_items = page.locator(".recent-search-item").all_text_contents()
        print("Rendered recent search items in dropdown:", recent_items)
        
        for item_text in recent_items:
            assert "Mein Standort" not in item_text, f"Dropdown must NOT render '{item_text}'"
            assert "Kartenpunkt" not in item_text, f"Dropdown must NOT render '{item_text}'"
            
        assert any("Nebelhorn" in t for t in recent_items), "Real searched destination 'Nebelhorn' should still be rendered"
        print("✓ Verified: Existing dirty recents are automatically sanitized and 'Mein Standort' is excluded from dropdown")
        
        # 5. Verify storage was sanitized in-place
        cleaned_storage = page.evaluate("() => JSON.parse(localStorage.getItem('alpine_recent_searches') || '[]')")
        print("Sanitized storage:", cleaned_storage)
        assert len(cleaned_storage) == 1 and cleaned_storage[0]['name'] == 'Nebelhorn', \
            f"Storage must only contain real searched places, got: {cleaned_storage}"
        print("✓ Verified: LocalStorage automatically sanitized to remove old GPS and map points")
        
        # 6. Capture visual verification screenshot of the clean dropdown
        screenshot_path = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/verified_clean_search_dropdown.png"
        dropdown.screenshot(path=screenshot_path)
        print(f"✓ Saved visual verification screenshot to: {screenshot_path}")
        
        context.close()
        browser.close()
        print("\n🎉 ALL GPS EXCLUSION TESTS PASSED PERFECTLY!")

if __name__ == '__main__':
    test_gps_exclusion()
