import http.server
import socketserver
import threading
import time
import os
import sys

# Ensure Playwright driver node is on PATH if needed
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
        
        # Test 1: Desktop Mac Viewport (1440 x 900, Retina scale 2)
        print("\n--- Test 1: Mac Desktop Viewport (1440 x 900) ---")
        context = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            device_scale_factor=2,
            service_workers="block"
        )
        page = context.new_page()
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.wait_for_selector("#daily-item-0 .daily-interactive-row", timeout=10000)
        time.sleep(1.5)
        
        # Let's inspect the rows in #daily-forecast-list
        rows_info = page.evaluate("""() => {
            const results = [];
            const rows = document.querySelectorAll('#daily-forecast-list .daily-interactive-row');
            rows.forEach((row, idx) => {
                const condText = row.querySelector('.daily-cond-text');
                const condCell = row.querySelector('.daily-condition-cell');
                const sunCell = row.querySelector('.daily-sun-cell');
                const tempCell = row.querySelector('.daily-temp-cell');
                const dateCell = row.querySelector('.daily-date-cell');
                
                const text = condText ? condText.textContent.trim() : '';
                const textScrollWidth = condText ? condText.scrollWidth : 0;
                const textClientWidth = condText ? condText.clientWidth : 0;
                const isTruncated = textScrollWidth > textClientWidth;
                
                const condRect = condCell ? condCell.getBoundingClientRect() : null;
                const sunRect = sunCell ? sunCell.getBoundingClientRect() : null;
                const tempRect = tempCell ? tempCell.getBoundingClientRect() : null;
                
                // Gap between sun cell right edge and temp cell left edge
                const gapBetweenSunAndTemp = (tempRect && sunRect) ? (tempRect.left - sunRect.right) : 0;
                
                results.push({
                    index: idx,
                    text,
                    isTruncated,
                    textScrollWidth,
                    textClientWidth,
                    condCellWidth: condRect ? condRect.width : 0,
                    sunCellWidth: sunRect ? sunRect.width : 0,
                    gapBetweenSunAndTemp
                });
            });
            return results;
        }""")
        
        print(f"Total rows inspected: {len(rows_info)}")
        any_truncated = False
        for r in rows_info:
            status = "TRUNCATED" if r['isTruncated'] else "OK (full text)"
            print(f"  Row {r['index']}: '{r['text']}' -> {status} (width: {r['textClientWidth']}px, scroll: {r['textScrollWidth']}px, cell: {r['condCellWidth']}px, gap to temp: {r['gapBetweenSunAndTemp']}px)")
            if r['isTruncated']:
                any_truncated = True
        
        assert not any_truncated, "No daily condition text should be truncated on desktop view!"
        
        # Also test with a long string like 'Überwiegend heiter' explicitly
        test_long_text = page.evaluate("""() => {
            const row2 = document.querySelector('#daily-item-2 .daily-cond-text');
            if (row2) {
                row2.textContent = 'Überwiegend heiter';
                return {
                    scrollWidth: row2.scrollWidth,
                    clientWidth: row2.clientWidth,
                    isTruncated: row2.scrollWidth > row2.clientWidth
                };
            }
            return null;
        }""")
        print(f"\nExplicit 'Überwiegend heiter' check on Row 2: {test_long_text}")
        assert test_long_text and not test_long_text['isTruncated'], "'Überwiegend heiter' must NOT be truncated!"
        
        # Capture screenshot of the daily card
        daily_card = page.locator(".daily-card")
        screenshot_path = os.path.join(artifacts_dir, "verified_mac_desktop_daily_forecast.png")
        daily_card.screenshot(path=screenshot_path)
        print(f"  ✓ Saved visual verification screenshot to: {screenshot_path}")
        
        # Full page screenshot on desktop
        full_screenshot_path = os.path.join(artifacts_dir, "verified_mac_desktop_full_overview.png")
        page.screenshot(path=full_screenshot_path)
        print(f"  ✓ Saved full overview screenshot to: {full_screenshot_path}")
        
        # Test 2: Compact Desktop / Window Resize (1150 x 800)
        print("\n--- Test 2: Compact Desktop Viewport (1150 x 800) ---")
        page.set_viewport_size({'width': 1150, 'height': 800})
        time.sleep(0.5)
        
        compact_info = page.evaluate("""() => {
            const row = document.querySelector('#daily-item-2 .daily-interactive-row');
            const condText = row.querySelector('.daily-cond-text');
            const sunCell = row.querySelector('.daily-sun-cell');
            const tempCell = row.querySelector('.daily-temp-cell');
            const astroPill = row.querySelector('.daily-astro-pill');
            
            const sunRect = sunCell ? sunCell.getBoundingClientRect() : null;
            const tempRect = tempCell ? tempCell.getBoundingClientRect() : null;
            const astroVisible = astroPill ? window.getComputedStyle(astroPill).display !== 'none' : false;
            
            return {
                text: condText.textContent,
                isTruncated: condText.scrollWidth > condText.clientWidth,
                textWidth: condText.clientWidth,
                astroVisible,
                gapBetweenSunAndTemp: tempRect.left - sunRect.right
            };
        }""")
        print(f"  Compact desktop: '{compact_info['text']}' -> isTruncated: {compact_info['isTruncated']}, textWidth: {compact_info['textWidth']}px, astroVisible: {compact_info['astroVisible']}, gap: {compact_info['gapBetweenSunAndTemp']}px")
        assert not compact_info['isTruncated'], "'Überwiegend heiter' must not be truncated at 1150px!"
        
        # Test 3: iPad / Tablet Viewport (820 x 1180)
        print("\n--- Test 3: iPad / Tablet Viewport (820 x 1180) ---")
        page.set_viewport_size({'width': 820, 'height': 1180})
        time.sleep(0.5)
        
        tablet_info = page.evaluate("""() => {
            const row = document.querySelector('#daily-item-2 .daily-interactive-row');
            const condText = row.querySelector('.daily-cond-text');
            return {
                text: condText.textContent,
                isTruncated: condText.scrollWidth > condText.clientWidth,
                textWidth: condText.clientWidth
            };
        }""")
        print(f"  Tablet: '{tablet_info['text']}' -> isTruncated: {tablet_info['isTruncated']}, textWidth: {tablet_info['textWidth']}px")
        assert not tablet_info['isTruncated'], "'Überwiegend heiter' must not be truncated on iPad!"
        
        context.close()
        browser.close()
        print("\n🎉 ALL DESKTOP, COMPACT & TABLET VERIFICATION TESTS PASSED PERFECTLY!")

if __name__ == "__main__":
    run_verification()
