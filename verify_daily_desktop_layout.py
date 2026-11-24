import http.server
import socketserver
import threading
import time
import os
import sys

node_dir = '/Users/jona/Library/Python/3.9/lib/python/site-packages/playwright/driver'
if os.path.exists(node_dir) and node_dir not in os.environ.get('PATH', ''):
    os.environ['PATH'] = f"{node_dir}:{os.environ.get('PATH', '')}"

from playwright.sync_api import sync_playwright

def run_verification():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    
    print(f"🚀 Verification server running on http://127.0.0.1:{port}")
    
    artifacts_dir = "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f"
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        # Test 1: Full Desktop Mac Viewport (1440 x 900, Retina scale 2)
        print("\n--- Test 1: Mac Desktop Viewport (1440 x 900) ---")
        context = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            device_scale_factor=2,
            service_workers="block"
        )
        page = context.new_page()
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.wait_for_selector("#daily-item-0 .daily-interactive-row", timeout=10000)
        time.sleep(1)
        
        # Expand 10 days
        expand_btn = page.locator('#daily-expand-toggle-btn')
        if expand_btn.is_visible():
            expand_btn.click()
            time.sleep(0.5)
            
        rows_info = page.evaluate("""() => {
            const results = [];
            const rows = document.querySelectorAll('#daily-forecast-list .daily-interactive-row');
            rows.forEach((row, idx) => {
                const condText = row.querySelector('.daily-cond-text');
                const condCell = row.querySelector('.daily-condition-cell');
                const sunCell = row.querySelector('.daily-sun-cell');
                const astroPill = row.querySelector('.daily-astro-pill');
                const tempCell = row.querySelector('.daily-temp-cell');
                
                const text = condText ? condText.textContent.trim() : '';
                const condTruncated = condText ? (condText.scrollWidth > condText.clientWidth) : false;
                
                const astroText = astroPill ? astroPill.textContent.replace(/\\s+/g, ' ').trim() : '';
                const astroClipped = astroPill ? (astroPill.scrollWidth > astroPill.clientWidth) : false;
                
                const sunRect = sunCell ? sunCell.getBoundingClientRect() : null;
                const tempRect = tempCell ? tempCell.getBoundingClientRect() : null;
                const gapBetweenSunAndTemp = (tempRect && sunRect) ? Math.round(tempRect.left - sunRect.right) : 0;
                
                results.push({
                    index: idx,
                    text,
                    condTruncated,
                    astroText,
                    astroClipped,
                    astroScrollW: astroPill ? Math.round(astroPill.scrollWidth) : 0,
                    astroClientW: astroPill ? Math.round(astroPill.clientWidth) : 0,
                    gapBetweenSunAndTemp
                });
            });
            return results;
        }""")
        
        print(f"Total rows inspected: {len(rows_info)}")
        any_clipped = False
        for r in rows_info:
            astro_status = "CLIPPED!" if r['astroClipped'] else "OK (full timestamp)"
            cond_status = "TRUNCATED!" if r['condTruncated'] else "OK (full text)"
            print(f"  Row {r['index']}: cond='{r['text']}' -> {cond_status} | astro='{r['astroText']}' -> {astro_status} ({r['astroClientW']}px/{r['astroScrollW']}px) | gap={r['gapBetweenSunAndTemp']}px")
            if r['astroClipped'] or r['condTruncated']:
                any_clipped = True
                
        assert not any_clipped, "ZERO clipping allowed for both weather condition and sunset timestamps!"
        
        # Capture screenshot
        card = page.locator(".daily-card")
        screenshot_path = os.path.join(artifacts_dir, "verified_godlike_content_driven_10days.png")
        card.screenshot(path=screenshot_path)
        print(f"  ✓ Saved visual verification screenshot to: {screenshot_path}")
        
        # Test 2: Compact Desktop Viewport (1150 x 800)
        print("\n--- Test 2: Compact Desktop Viewport (1150 x 800) ---")
        page.set_viewport_size({'width': 1150, 'height': 800})
        time.sleep(0.5)
        
        compact_info = page.evaluate("""() => {
            const row = document.querySelector('#daily-item-0 .daily-interactive-row');
            const condText = row.querySelector('.daily-cond-text');
            const sunCell = row.querySelector('.daily-sun-cell');
            const tempCell = row.querySelector('.daily-temp-cell');
            const astroPill = row.querySelector('.daily-astro-pill');
            
            const sunRect = sunCell ? sunCell.getBoundingClientRect() : null;
            const tempRect = tempCell ? tempCell.getBoundingClientRect() : null;
            const astroVisible = astroPill ? window.getComputedStyle(astroPill).display !== 'none' : false;
            
            return {
                text: condText.textContent,
                condTruncated: condText.scrollWidth > condText.clientWidth,
                astroVisible,
                gapBetweenSunAndTemp: tempRect.left - sunRect.right
            };
        }""")
        print(f"  Compact desktop: '{compact_info['text']}' -> truncated: {compact_info['condTruncated']}, astroVisible: {compact_info['astroVisible']}, gap: {compact_info['gapBetweenSunAndTemp']}px")
        assert not compact_info['condTruncated'], "Condition text must not be truncated at 1150px!"
        
        # Test 3: iPad / Tablet Viewport (820 x 1180)
        print("\n--- Test 3: iPad / Tablet Viewport (820 x 1180) ---")
        page.set_viewport_size({'width': 820, 'height': 1180})
        time.sleep(0.5)
        
        tablet_info = page.evaluate("""() => {
            const row = document.querySelector('#daily-item-0 .daily-interactive-row');
            const condText = row.querySelector('.daily-cond-text');
            const astroPill = row.querySelector('.daily-astro-pill');
            return {
                text: condText.textContent,
                condTruncated: condText.scrollWidth > condText.clientWidth,
                astroClipped: astroPill ? (astroPill.scrollWidth > astroPill.clientWidth) : false
            };
        }""")
        print(f"  Tablet: '{tablet_info['text']}' -> condTruncated: {tablet_info['condTruncated']}, astroClipped: {tablet_info['astroClipped']}")
        assert not tablet_info['condTruncated'] and not tablet_info['astroClipped'], "Must not be truncated or clipped on iPad!"
        
        context.close()
        browser.close()
        print("\n🎉 ALL CONTENT-DRIVEN DYNAMIC LAYOUT TESTS PASSED WITH 100% SUCCESS!")

if __name__ == "__main__":
    run_verification()
