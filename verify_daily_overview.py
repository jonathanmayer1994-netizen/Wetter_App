import sys
import time
import subprocess
from playwright.sync_api import sync_playwright

def main():
    print("🚀 Starting local HTTP server...")
    srv = subprocess.Popen([sys.executable, "-m", "http.server", "57980"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)

    try:
        with sync_playwright() as p:
            # 1. iPhone 15 Pro Viewport (393 x 852)
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
            page = context.new_page()

            page_errors = []
            page.on("pageerror", lambda err: page_errors.append(str(err)))

            print("📱 Navigating to app on iPhone viewport...")
            page.goto("http://127.0.0.1:57980", wait_until="networkidle")
            page.wait_for_selector(".daily-item-wrapper", timeout=12000)

            # Check no old gradient bar
            bars = page.query_selector_all(".daily-bar-container")
            print(f"Old temperature bars found in DOM: {len(bars)} (Expected: 0)")
            assert len(bars) == 0, "Old daily-bar-container must be 0!"

            # Check sun hours
            sun_hours = page.query_selector_all(".dsm-hours")
            print(f"Sun hours elements found: {len(sun_hours)}")
            assert len(sun_hours) >= 3, "Sun hours elements should be rendered!"
            first_sun = sun_hours[0].inner_text()
            print(f"First day sun hours: {first_sun}")

            # Check mini sparklines
            sparklines = page.query_selector_all(".dsm-chart")
            print(f"Mini sparklines found: {len(sparklines)}")
            assert len(sparklines) >= 3, "Sparklines should be rendered!"

            # Check micro bars
            bars_in_first = sparklines[0].query_selector_all(".msb-bar")
            print(f"Micro-bars in first day sparkline: {len(bars_in_first)}")
            assert len(bars_in_first) == 13, f"Expected 13 daylight micro-bars, got {len(bars_in_first)}"

            # Check astro pills (sunrise & sunset)
            astro_pills = page.query_selector_all(".daily-astro-pill")
            print(f"Astro pills found: {len(astro_pills)}")
            assert len(astro_pills) >= 3, "Astro pills should be rendered!"
            first_astro = astro_pills[0].inner_text()
            print(f"First day astro times: {first_astro}")

            # Check min/max temp badge
            min_temp = page.query_selector(".dt-min").inner_text()
            max_temp = page.query_selector(".dt-max").inner_text()
            print(f"First day min/max: {min_temp} / {max_temp}")

            # Scroll to 10-day section
            daily_section = page.locator(".daily-card")
            daily_section.scroll_into_view_if_needed()
            page.wait_for_timeout(400)

            # Capture collapsed screenshot
            page.screenshot(path="overview_daily_rows_collapsed.png")
            print("📸 Captured overview_daily_rows_collapsed.png")

            # Tap first daily row to expand accordion
            first_row = page.locator(".daily-interactive-row").first
            first_row.click()
            page.wait_for_timeout(350)

            # Verify accordion is visible
            first_accordion = page.locator("#inline-accordion-0")
            assert first_accordion.is_visible(), "Accordion #inline-accordion-0 must be visible after click!"
            print("✓ Accordion opened successfully on tapping the day row!")

            # Verify accordion elements
            parts = page.query_selector_all("#inline-accordion-0 .inline-part-card")
            print(f"Day parts cards in accordion: {len(parts)} (Expected: 4)")
            assert len(parts) == 4, "Expected 4 dayparts cards!"

            sun_section = page.locator("#inline-accordion-0 .inline-sun-section")
            assert sun_section.is_visible(), "Sun timeline section must be visible!"

            stats = page.query_selector_all("#inline-accordion-0 .isg-card")
            print(f"Metric cards in accordion: {len(stats)} (Expected: 4)")
            assert len(stats) == 4, "Expected 4 meteorological metric cards!"

            # Capture expanded screenshot
            page.screenshot(path="overview_daily_accordion_expanded.png")
            print("📸 Captured overview_daily_accordion_expanded.png")

            # Test closing accordion on second click
            first_row.click()
            page.wait_for_timeout(250)
            assert not first_accordion.is_visible(), "Accordion must be hidden after second click!"
            print("✓ Accordion closed cleanly on second tap!")

            # Re-open for screenshot of card
            first_row.click()
            page.wait_for_timeout(250)

            # Copy screenshots to artifact directory
            subprocess.run(["cp", "overview_daily_rows_collapsed.png", "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/overview_daily_rows_collapsed.png"])
            subprocess.run(["cp", "overview_daily_accordion_expanded.png", "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/overview_daily_accordion_expanded.png"])

            # 2. Desktop Viewport (1280 x 900)
            desktop_page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
            desktop_page.goto("http://127.0.0.1:57980", wait_until="networkidle")
            desktop_page.wait_for_selector(".daily-item-wrapper", timeout=12000)
            desktop_daily = desktop_page.locator(".daily-card")
            desktop_daily.scroll_into_view_if_needed()
            desktop_page.wait_for_timeout(300)

            # Click second row on desktop
            desktop_page.locator(".daily-interactive-row").nth(1).click()
            desktop_page.wait_for_timeout(300)

            desktop_page.screenshot(path="overview_daily_desktop.png")
            subprocess.run(["cp", "overview_daily_desktop.png", "/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/overview_daily_desktop.png"])
            print("📸 Captured overview_daily_desktop.png")

            assert len(page_errors) == 0, f"JS errors: {page_errors}"
            print("🎉 ALL DAILY OVERVIEW TESTS PASSED WITH 0 ERRORS!")

            browser.close()
    finally:
        srv.terminate()

if __name__ == "__main__":
    main()
