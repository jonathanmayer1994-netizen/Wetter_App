import time
from playwright.sync_api import sync_playwright

def run_desktop_verification():
    with sync_playwright() as p:
        # Launch browser with Mac desktop viewport (1440 x 900)
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            device_scale_factor=2
        )
        page = context.new_page()

        print("Navigating to http://127.0.0.1:8080 ...")
        page.goto("http://127.0.0.1:8080", wait_until="domcontentloaded")
        page.wait_for_selector("#daily-item-0 .daily-interactive-row", timeout=10000)
        time.sleep(1)

        # ----------------------------------------------------------------------
        # TEST 1: Expanded Day Accordion & 24h-Tagesverlauf on Desktop
        # ----------------------------------------------------------------------
        print("\n--- Verifying 24h-Tagesverlauf Chart on Mac Desktop ---")
        today_row = page.locator("#daily-item-0 .daily-interactive-row")
        today_row.wait_for(state="visible", timeout=8000)
        today_row.click()
        time.sleep(1)

        accordion = page.locator("#inline-accordion-0")
        assert accordion.is_visible(), "Inline accordion 0 should be visible"

        chart_card = page.locator("#inline-accordion-0 .inline-day-chart-card")
        assert chart_card.is_visible(), "Inline day chart card should be visible"

        svg = page.locator("#inline-accordion-0 .inline-day-svg")
        assert svg.is_visible(), "Inline day SVG should be visible"

        viewbox = svg.get_attribute("viewBox")
        print(f"  ✓ SVG viewBox on desktop: {viewbox}")
        assert "0 0 680" in viewbox, f"SVG viewBox width must be 680 on desktop, got: {viewbox}"

        # Check that 3-hour ticks are present on desktop
        time_axis_text = svg.locator(".chart-time-axis text").all_text_contents()
        print(f"  ✓ Time axis ticks: {time_axis_text}")
        assert "03:00" in time_axis_text and "09:00" in time_axis_text and "15:00" in time_axis_text, \
            "Desktop 24h chart must display 3-hour ticks"

        # Check HUD Idle state
        hud_idle = page.locator("#inline-accordion-0 .dch-idle")
        assert hud_idle.is_visible(), "Day chart HUD idle hint should be visible initially"
        print("  ✓ Day chart HUD idle hint is visible")

        # Check that rain bars have ZERO overlapping text labels
        precip_texts = svg.locator("text[fill=\"#38bdf8\"]").all_text_contents()
        # Only the section header '💧 NIEDERSCHLAG (mm / h)' is allowed, no individual bar texts!
        precip_num_texts = [t for t in precip_texts if "%" in t or "." in t]
        assert len(precip_num_texts) == 0, f"No crowded numbers allowed on precip bars, found: {precip_num_texts}"
        print("  ✓ Zero crowded text numbers on precip bars (clean profile)")

        # Hover over the SVG via Playwright's hover API
        svg_wrap = page.locator("#inline-accordion-0 .day-chart-svg-wrap")
        svg_wrap.hover()
        time.sleep(0.3)

        hud_active = page.locator("#inline-accordion-0 .dch-active")
        assert hud_active.is_visible(), "HUD active state must be visible on hover"

        time_val = page.locator("#inline-accordion-0 .dch-val-time").inner_text()
        temp_val = page.locator("#inline-accordion-0 .dch-val-temp").inner_text()
        sun_val = page.locator("#inline-accordion-0 .dch-val-sun").inner_text()
        precip_val = page.locator("#inline-accordion-0 .dch-val-precip").inner_text()

        print(f"  ✓ Hover Scrubber HUD: Time='{time_val}', Temp='{temp_val}', Sun='{sun_val}', Precip='{precip_val}'")
        assert ":" in time_val, "Time must be formatted as clock time"
        assert "°" in temp_val, "Temp must contain °"
        assert "Min" in sun_val, "Sun must contain minutes"
        assert "mm" in precip_val or "%" in precip_val, "Precip must contain mm and %"

        # Check scrubber indicator group in SVG
        scrubber_group = svg.locator(".chart-scrubber-group")
        assert scrubber_group.is_visible(), "Scrubber indicator line & dot must be visible in SVG"
        print("  ✓ Scrubber hairline and glowing dot visible on spline")

        # Capture screenshot while hovered
        page.locator("#daily-item-0").screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/desktop_accordion_hover_hud.png")
        print("  📸 Captured artifact: desktop_accordion_hover_hud.png")

        # Check geometry of 2-column layout
        chart_box = chart_card.bounding_box()
        stats_box = page.locator("#inline-accordion-0 .inline-stats-grid").bounding_box()
        footer_box = page.locator("#inline-accordion-0 .inline-footer-actions").bounding_box()

        print(f"  ✓ Chart card width: {chart_box['width']:.1f}px, height: {chart_box['height']:.1f}px")
        print(f"  ✓ Stats grid width: {stats_box['width']:.1f}px, height: {stats_box['height']:.1f}px")
        print(f"  ✓ Chart X: {chart_box['x']:.1f}, Stats X: {stats_box['x']:.1f}")

        # In 2-column layout, stats grid X should be strictly greater than chart card X
        assert stats_box['x'] > chart_box['x'], "Stats grid must be in right column beside chart card"
        assert chart_box['height'] < 260, f"Chart card height must be well-proportioned (< 260px), got {chart_box['height']}"

        # Capture Desktop screenshot of Overview with 2-Column Accordion
        page.screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/desktop_accordion_perfect.png")
        print("  📸 Captured artifact: desktop_accordion_perfect.png")

        # Also capture close-up of accordion element
        page.locator("#daily-item-0").screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/desktop_accordion_element.png")
        print("  📸 Captured artifact: desktop_accordion_element.png")

        # ----------------------------------------------------------------------
        # TEST 2: Map Tab & Centered Layer Drawer on Mac Desktop
        # ----------------------------------------------------------------------
        print("\n--- Verifying Ebenen & Kartenstil Drawer on Mac Desktop ---")
        map_tab_btn = page.locator(".tab-btn[data-tab=\"tab-map\"]")
        map_tab_btn.click()
        time.sleep(1.5)

        layer_pill = page.locator("#map-layer-pill")
        layer_pill.wait_for(state="visible", timeout=5000)
        layer_pill.click()
        time.sleep(1)

        drawer = page.locator("#map-layer-drawer")
        assert drawer.is_visible(), "Map layer drawer must be visible after clicking pill"

        drawer_box = drawer.bounding_box()
        viewport_w = 1440
        viewport_h = 900

        drawer_center_x = drawer_box['x'] + drawer_box['width'] / 2
        print(f"  ✓ Drawer bounding box: x={drawer_box['x']:.1f}, y={drawer_box['y']:.1f}, w={drawer_box['width']:.1f}, h={drawer_box['height']:.1f}")
        print(f"  ✓ Drawer center X: {drawer_center_x:.1f}px (Viewport center: {viewport_w/2:.1f}px)")

        # Verify drawer is horizontally centered in the desktop container
        assert abs(drawer_center_x - (viewport_w / 2)) < 60, "Drawer should be centered on desktop"

        # Check Done Button (✓ Fertig) visibility and bounding box
        done_btn = page.locator("#map-layer-done-btn")
        assert done_btn.is_visible(), "Done button '✓ Fertig' must be visible"

        done_box = done_btn.bounding_box()
        print(f"  ✓ Done button bounding box: x={done_box['x']:.1f}, y={done_box['y']:.1f}, w={done_box['width']:.1f}, h={done_box['height']:.1f}")

        # Assert done button is fully inside the drawer and visible on screen
        assert done_box['y'] + done_box['height'] <= drawer_box['y'] + drawer_box['height'], \
            "Done button must be completely contained within the drawer bottom boundary"
        assert done_box['y'] + done_box['height'] < viewport_h - 10, \
            "Done button must not exceed the viewport bottom edge"

        # Capture desktop screenshot of Map with Centered Drawer
        page.screenshot(path="/Users/jona/.gemini/antigravity/brain/651643d1-e15d-4786-a068-5a561de2bd2f/desktop_map_drawer_perfect.png")
        print("  📸 Captured artifact: desktop_map_drawer_perfect.png")

        # Click Fertig to verify it works
        done_btn.click()
        time.sleep(0.5)
        assert not drawer.is_visible(), "Drawer should close when '✓ Fertig' is clicked"
        print("  ✓ '✓ Fertig' button clicked and cleanly closed drawer")

        browser.close()
        print("\n==========================================")
        print("ALL MAC DESKTOP VERIFICATIONS PASSED (100%)")
        print("==========================================")

if __name__ == '__main__':
    run_desktop_verification()
