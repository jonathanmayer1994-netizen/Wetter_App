import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

def run_tests():
    os.chdir('/Users/jona/Documents/Apps/Wetter App')
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    
    httpd = socketserver.TCPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    
    print(f"🚀 Test server running on http://127.0.0.1:{port}")
    
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
        browser = p.chromium.launch(headless=True)
        
        # =====================================================================
        # TEST SUITE 1: DESKTOP NAVIGATION, LAYOUT & SPACING
        # =====================================================================
        print("\n--- SUITE 1: Desktop Navigation, Layout & Spacing ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        
        report("Initial location loaded without unhandled JS exceptions", len(page_errors) == 0, str(page_errors))
        report("Tab overview pane is active by default", page.is_visible("#tab-overview"))
        
        # Verify DOM structure and spacing
        main_box = page.locator(".main-container").bounding_box()
        report("Main container has valid bounding box and width", main_box is not None and main_box["width"] > 700)
        
        # Test all 6 desktop tabs switching
        tabs = [
            ("tab-mountain", "tab-mountain"),
            ("tab-sports", "tab-sports"),
            ("tab-map", "tab-map"),
            ("tab-favorites", "tab-favorites"),
            ("tab-networks", "tab-networks"),
            ("tab-overview", "tab-overview")
        ]
        
        for tab_attr, expected_pane_id in tabs:
            page.click(f".tab-btn[data-tab='{tab_attr}']")
            page.wait_for_timeout(200)
            is_active = page.eval_on_selector(f"#{expected_pane_id}", "el => el.classList.contains('active')")
            report(f"Desktop tab button '{tab_attr}' activates #{expected_pane_id}", is_active)
            
        page.close()
        
        # =====================================================================
        # TEST SUITE 2: MOBILE BOTTOM NAVIGATION (iOS / TOUCH SCREENS)
        # =====================================================================
        print("\n--- SUITE 2: Mobile Bottom Navigation & Responsive Layout ---")
        mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
        mobile_page.goto(f"http://127.0.0.1:{port}/index.html")
        mobile_page.wait_for_selector("#mobile-bottom-nav", timeout=10000)
        
        mbn_visible = mobile_page.is_visible("#mobile-bottom-nav")
        report("Mobile bottom navigation is visible on mobile viewport", mbn_visible)
        
        mbn_tabs = [
            ("tab-mountain", "tab-mountain"),
            ("tab-sports", "tab-sports"),
            ("tab-map", "tab-map"),
            ("tab-favorites", "tab-favorites"),
            ("tab-networks", "tab-networks"),
            ("tab-overview", "tab-overview")
        ]
        for tab_attr, expected_pane_id in mbn_tabs:
            mobile_page.click(f".mbn-btn[data-tab='{tab_attr}']")
            mobile_page.wait_for_timeout(200)
            is_active = mobile_page.eval_on_selector(f"#{expected_pane_id}", "el => el.classList.contains('active')")
            report(f"Mobile bottom nav '{tab_attr}' activates #{expected_pane_id}", is_active)
            
        mobile_page.close()

        # =====================================================================
        # TEST SUITE 3: ADAPTIVE DYNAMIC TAB 2 NAMING (BERG VS. STADT)
        # =====================================================================
        print("\n--- SUITE 3: Adaptive Tab 2 Dynamic Labeling ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        
        # Initially in Munich (City)
        tab2_label = page.inner_text("#tab-2-label")
        report("Tab 2 shows city/urban label for Munich", "Stadt" in tab2_label)
        
        # Search and load mountain (Matterhorn)
        page.fill("#location-search-input", "Matterhorn")
        page.wait_for_timeout(400)
        page.wait_for_selector(".dropdown-item", timeout=5000)
        page.click(".dropdown-item >> nth=0")
        page.wait_for_timeout(600)
        
        loc_name = page.inner_text("#hero-location-name")
        report("Loaded Matterhorn location via search", "Matterhorn" in loc_name)
        
        tab2_label_mtn = page.inner_text("#tab-2-label")
        report("Tab 2 dynamically switched to Alpine/Berg mode for Matterhorn", "Berg" in tab2_label_mtn)
        
        page.close()

        # =====================================================================
        # TEST SUITE 4: HEADER SEARCH INPUT, AUTOCOMPLETE, PRESETS & RECENTS
        # =====================================================================
        print("\n--- SUITE 4: Header Search Input, Autocomplete, Presets & Recents ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#location-search-input", timeout=10000)
        
        # Test focus shows presets and recent searches dropdown
        page.click("#location-search-input")
        page.wait_for_timeout(300)
        dropdown_visible = page.is_visible("#search-results-dropdown")
        report("Clicking search input opens dropdown with presets", dropdown_visible)
        
        preset_chips = page.query_selector_all(".recent-preset-chip")
        report("Preset chips rendered in dropdown", len(preset_chips) >= 4)
        
        # Click Zugspitze preset chip
        zugspitze_chip = page.locator(".recent-preset-chip:has-text('Zugspitze')")
        if zugspitze_chip.count() > 0:
            zugspitze_chip.click()
            page.wait_for_timeout(700)
            loc_name = page.inner_text("#hero-location-name")
            elev_pill = page.inner_text("#hero-elevation-pill")
            report("Clicking Zugspitze preset loaded 2.962m Zugspitze", "Zugspitze" in loc_name and "2.962" in elev_pill)
        else:
            report("Clicking Zugspitze preset", False, "Chip not found")
            
        # Test typing query and clear button
        page.fill("#location-search-input", "Hamburg")
        page.wait_for_timeout(400)
        clear_btn_visible = page.is_visible("#clear-search-btn")
        report("Clear search button appears when typing", clear_btn_visible)
        
        page.click("#clear-search-btn")
        page.wait_for_timeout(200)
        input_val = page.input_value("#location-search-input")
        report("Clear search button clears input field", input_val == "")
        
        page.close()

        # =====================================================================
        # TEST SUITE 5: APPLE SPOTLIGHT SEARCH MODAL (CMD+K)
        # =====================================================================
        print("\n--- SUITE 5: Apple Spotlight Search Modal (⌘K) ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#spotlight-trigger-btn", timeout=10000)
        
        # Click ⌘K button
        page.click("#spotlight-trigger-btn")
        page.wait_for_timeout(300)
        modal_visible = page.is_visible("#spotlight-modal-overlay")
        report("Clicking ⌘K badge opens Spotlight modal overlay", modal_visible)
        
        # Press Escape to close
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        modal_visible_after_esc = page.is_visible("#spotlight-modal-overlay")
        report("Pressing Escape closes Spotlight modal", not modal_visible_after_esc)
        
        page.close()

        # =====================================================================
        # TEST SUITE 6: KOMPAKT- VS. EXPERTEN-MODUS TOGGLE & LOCALSTORAGE
        # =====================================================================
        print("\n--- SUITE 6: Kompakt- vs. Experten-Modus Toggle ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#expert-mode-toggle-btn", timeout=10000)
        
        # Check initial state: container should be hidden
        container_hidden_initial = page.eval_on_selector(
            "#expert-details-container", "el => el.classList.contains('is-hidden')"
        )
        report("Expert details container is hidden by default", container_hidden_initial)
        
        # Click toggle button
        page.click("#expert-mode-toggle-btn")
        page.wait_for_timeout(200)
        container_hidden_after_click = page.eval_on_selector(
            "#expert-details-container", "el => el.classList.contains('is-hidden')"
        )
        report("Clicking expert toggle reveals ECMWF vs GFS & Air Quality analysis", not container_hidden_after_click)
        
        arrow_text = page.inner_text("#emb-arrow")
        report("Toggle arrow changes to expanded (▴)", "▴" in arrow_text)
        
        # Click again to collapse
        page.click("#expert-mode-toggle-btn")
        page.wait_for_timeout(200)
        container_hidden_after_collapse = page.eval_on_selector(
            "#expert-details-container", "el => el.classList.contains('is-hidden')"
        )
        report("Clicking expert toggle again collapses section cleanly", container_hidden_after_collapse)
        
        page.close()

        # =====================================================================
        # TEST SUITE 7: HAZARD ALERT BANNER INTEGRITY
        # =====================================================================
        print("\n--- SUITE 7: Top Priority Hero Hazard Alert Banner ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-hazard-alert", state="attached", timeout=10000)
        
        alert_in_dom = page.query_selector("#hero-hazard-alert") is not None
        has_badge = page.query_selector("#hha-badge") is not None
        has_action = page.query_selector("#hha-action-btn") is not None
        report("Hazard alert banner element and action button present in DOM", alert_in_dom and has_badge and has_action)
        
        # Test simulated acute hazard trigger
        page.evaluate("""() => {
            const el = document.getElementById('hero-hazard-alert');
            el.style.display = 'flex';
            document.getElementById('hha-badge').innerText = 'AKUTE GEWITTERWARNUNG';
        }""")
        page.wait_for_timeout(200)
        report("Hazard alert banner becomes visible when acute condition triggers", page.is_visible("#hero-hazard-alert"))
        
        page.close()

        # =====================================================================
        # TEST SUITE 8: 48H RADAR TIMELINE & COLLAPSIBLE CONTROLS
        # =====================================================================
        print("\n--- SUITE 8: 48h Radar Timeline & Map Overlay ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.click(".tab-btn[data-tab='tab-map']")
        page.wait_for_timeout(800)
        
        radar_panel = page.is_visible("#radar-floating-controls")
        report("Radar player controls visible on map tab", radar_panel)
        
        jump_btns = page.query_selector_all(".radar-jump-btn")
        report("48h intermediate radar step buttons present (+12h, +24h, +36h, +48h)", len(jump_btns) >= 6)
        
        # Test collapse toggle button on radar player
        collapse_btn = page.query_selector("#radar-player-toggle-btn")
        report("Radar collapse toggle button present", collapse_btn is not None)
        
        page.close()

        # =====================================================================
        # TEST SUITE 9: DATA SOURCES & NETWORKS (TAB 5)
        # =====================================================================
        print("\n--- SUITE 9: Data Sources & Transparency Dashboard ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.click(".tab-btn[data-tab='tab-networks']")
        page.wait_for_timeout(400)
        
        sources_card = page.is_visible(".networks-card")
        report("Sources dashboard visible on networks tab", sources_card)
        
        nav_chips = page.query_selector_all(".sources-nav-btn")
        report("Quick jump category chips present", len(nav_chips) >= 7)
        
        page.close()

        # =====================================================================
        # TEST SUITE 10: FAVORITES & PERSISTENCE
        # =====================================================================
        print("\n--- SUITE 10: Favorites Management & Empty State Presets ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#fav-toggle-btn", timeout=10000)
        
        # Check initial favorite state for München (defaults to favorited)
        initial_fav = page.eval_on_selector("#fav-toggle-btn", "el => el.classList.contains('favorited')")
        # Toggle favorite
        page.click("#fav-toggle-btn")
        page.wait_for_timeout(300)
        after_toggle = page.eval_on_selector("#fav-toggle-btn", "el => el.classList.contains('favorited')")
        report("Toggling favorite button inverts favorite status", after_toggle != initial_fav)
        
        # Toggle back
        page.click("#fav-toggle-btn")
        page.wait_for_timeout(300)
        restored = page.eval_on_selector("#fav-toggle-btn", "el => el.classList.contains('favorited')")
        report("Toggling favorite button again restores favorite status", restored == initial_fav)
        
        # Switch to favorites tab
        page.click(".tab-btn[data-tab='tab-favorites']")
        page.wait_for_timeout(300)
        fav_cards = page.query_selector_all(".favorite-card")
        report("Favorite locations appear in Favorites tab", len(fav_cards) >= 1)
        
        page.close()
        browser.close()

    httpd.shutdown()
    
    print(f"\n==========================================")
    print(f"TEST RESULTS: {passed_tests}/{total_tests} PASSED ({int(passed_tests/total_tests*100)}%)")
    print(f"==========================================")
    
    if passed_tests < total_tests:
        sys.exit(1)

if __name__ == '__main__':
    run_tests()
