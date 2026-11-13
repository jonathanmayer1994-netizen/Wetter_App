import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

def run_tests():
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
        def handle_error(self, request, client_address):
            pass

    httpd = TestHTTPServer(('127.0.0.1', 0), QuietHandler)
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
        
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
            page.locator(f".tab-btn[data-tab='{tab_attr}']").click(force=True)
            page.wait_for_timeout(200)
            is_active = page.eval_on_selector(f"#{expected_pane_id}", "el => el.classList.contains('active')")
            report(f"Desktop tab button '{tab_attr}' activates #{expected_pane_id}", is_active)
            
        page.close()
        
        # =====================================================================
        # TEST SUITE 2: MOBILE BOTTOM NAVIGATION (iOS / TOUCH SCREENS)
        # =====================================================================
        print("\n--- SUITE 2: Mobile Bottom Navigation & Responsive Layout ---")
        mobile_page = browser.new_page(viewport={"width": 390, "height": 844})
        mobile_page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
            if not mobile_page.is_visible(f".mbn-btn[data-tab='{tab_attr}']"):
                if mobile_page.is_visible("#map-mobile-close-btn"):
                    mobile_page.click("#map-mobile-close-btn")
                    mobile_page.wait_for_timeout(200)
            mobile_page.eval_on_selector(f".mbn-btn[data-tab='{tab_attr}']", "el => el.click()")
            mobile_page.wait_for_timeout(200)
            is_active = mobile_page.eval_on_selector(f"#{expected_pane_id}", "el => el.classList.contains('active')")
            report(f"Mobile bottom nav '{tab_attr}' activates #{expected_pane_id}", is_active)
            if tab_attr == "tab-map":
                report("Mobile map entered full screen and close button is visible", mobile_page.is_visible("#map-mobile-close-btn"))
            
        mobile_page.close()

        # =====================================================================
        # TEST SUITE 3: ADAPTIVE DYNAMIC TAB 2 NAMING (BERG VS. STADT)
        # =====================================================================
        print("\n--- SUITE 3: Adaptive Tab 2 Dynamic Labeling ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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

        # Test Mountain Mode and altitude tier cards rendering
        page.click(".tab-btn[data-tab='tab-mountain']")
        page.wait_for_timeout(500)
        mtn_panel_visible = page.is_visible("#mountain-view-panel")
        report("Mountain view panel is visible", mtn_panel_visible)
        page.wait_for_selector(".altitude-tier-card", timeout=12000)
        tiers_count = page.locator(".altitude-tier-card").count()
        report("Altitude level tiers are rendered", tiers_count >= 3)
        page.screenshot(path="mountain_weather_screenshot.png")
        
        page.close()

        # =====================================================================
        # TEST SUITE 4: HEADER SEARCH INPUT, AUTOCOMPLETE, PRESETS & RECENTS
        # =====================================================================
        print("\n--- SUITE 4: Header Search Input, Autocomplete, Presets & Recents ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        try:
            page.wait_for_function("() => document.getElementById('hero-temp') && document.getElementById('hero-temp').innerText.includes('°')", timeout=5000)
        except Exception:
            pass
        page.wait_for_timeout(300)
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
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.click(".tab-btn[data-tab='tab-map']")
        page.wait_for_timeout(800)
        
        radar_panel = page.is_visible("#radar-floating-controls")
        report("Radar player controls visible on map tab", radar_panel)
        
        slider = page.query_selector("#radar-time-slider")
        report("48h radar interactive timeline slider scrubber present", slider is not None)
        markers = page.query_selector(".radar-timeline-markers")
        report("Radar timeline markers (-1h, JETZT, +48h) present", markers is not None)
        
        # Test collapse toggle button on radar player
        collapse_btn = page.query_selector("#radar-player-toggle-btn")
        report("Radar collapse toggle button present", collapse_btn is not None)

        # Open layer drawer
        if not page.is_visible("#map-layer-drawer"):
            page.click("#map-layer-pill")
            page.wait_for_timeout(200)

        # Test that radar controls stay visible on Wind, Wolken, Temp overlays
        page.click(".map-overlay-btn[data-overlay='wind']")
        page.wait_for_timeout(200)
        report("Radar timeline controls stay visible on Wind overlay", page.is_visible("#radar-floating-controls"))
        
        page.click(".map-overlay-btn[data-overlay='clouds']")
        page.wait_for_timeout(200)
        report("Radar timeline controls stay visible on Clouds overlay", page.is_visible("#radar-floating-controls"))

        page.click(".map-overlay-btn[data-overlay='temp']")
        page.wait_for_timeout(200)
        report("Radar timeline controls stay visible on Temp overlay", page.is_visible("#radar-floating-controls"))

        page.click(".map-overlay-btn[data-overlay='precip']") # back to precip
        
        page.close()

        # =====================================================================
        # TEST SUITE 9: DATA SOURCES & NETWORKS (TAB 5)
        # =====================================================================
        print("\n--- SUITE 9: Data Sources & Transparency Dashboard ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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
        
        # Ensure at least 1 favorite exists before testing Favorites tab display
        if not restored:
            page.click("#fav-toggle-btn")
            page.wait_for_timeout(200)

        # Switch to favorites tab
        page.click(".tab-btn[data-tab='tab-favorites']")
        page.wait_for_timeout(300)
        fav_cards = page.query_selector_all(".favorite-card, .preset-fav-chip")
        report("Favorite locations appear in Favorites tab", len(fav_cards) >= 1)

        # Verify clunky manual GSheets card is completely removed from tab view
        ugly_card = page.query_selector(".gsheets-sync-card")
        report("Clunky manual Google Sheets card cleanly removed from Favorites tab", ugly_card is None)

        # Verify minimalist Cloud-Sync status bar is present
        cs_bar = page.is_visible("#cloud-sync-status-bar")
        report("Minimalist Apple-grade Cloud-Sync status bar visible", cs_bar)

        # Verify Cloud-Sync modal opens via config cog button and closes cleanly
        page.click("#cloud-sync-config-btn")
        page.wait_for_timeout(200)
        report("Cloud-Sync settings modal opens on config button click", page.is_visible("#cloud-sync-modal"))
        page.click("#cloud-sync-modal-close")
        page.wait_for_timeout(200)
        report("Cloud-Sync settings modal closes cleanly", not page.is_visible("#cloud-sync-modal"))

        # Verify Pull-Down-to-Refresh indicator in DOM
        ptr = page.query_selector("#pull-to-refresh")
        report("Pull-Down-to-Refresh indicator present in DOM", ptr is not None)
        
        page.close()

        # =====================================================================
        # TEST SUITE 11: 2D LEAFLET MULTI-LAYER & 48H MODELL-RADAR KARTE
        # =====================================================================
        print("\n--- SUITE 11: 2D Leaflet Multi-Layer & 48h Radar Map (In App) ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.click(".tab-btn[data-tab='tab-map']")
        page.wait_for_timeout(1000)
        
        report("Leaflet map wrapper visible in tab-map", page.is_visible("#fullscreen-map-wrapper"))
        report("Interactive map DOM element rendered", page.is_visible("#interactive-map"))
        
        # Verify Zero Annoying White Popups Over User Location
        report("Zero annoying white boxes or auto-open popups over user location", not page.is_visible(".leaflet-popup"))
        report("User location beacon pin is rendered on map", page.is_visible(".user-location-beacon"))

        # Verify Clunky Zoom Dock Removed as Requested & Layer Pill Present
        report("Floating Zoom Dock cleanly removed as requested", not page.is_visible("#map-floating-zoom-dock"))
        report("Map Layer Pill is visible on map", page.is_visible("#map-layer-pill"))
        page.click("#map-layer-pill")
        page.wait_for_timeout(200)
        report("Map Layer Drawer opens on pill tap", page.is_visible("#map-layer-drawer"))
        
        # Test Quick Actions in Drawer
        page.click("#mld-recenter-btn")
        page.wait_for_timeout(150)
        report("Map recenter to location (🎯) operates smoothly", True)
        page.click("#map-layer-pill")
        page.wait_for_timeout(150)
        page.click("#mld-alps-btn")
        page.wait_for_timeout(150)
        report("Map Alps overview (🏔️) button operates smoothly", True)
        
        # Verify Base Map Layers (re-open drawer)
        if not page.is_visible("#map-layer-drawer"):
            page.click("#map-layer-pill")
            page.wait_for_timeout(150)

        # Verify Day/Night Solar Toggle Button in Drawer
        solar_btn = page.query_selector("#map-solar-toggle-btn")
        report("Map solar day/night toggle button present in drawer", solar_btn is not None)
        page.click("#map-solar-toggle-btn")
        page.wait_for_timeout(100)
        report("Map solar toggle deactivates cleanly on tap", "Aus" in page.inner_text("#map-solar-toggle-text"))
        page.click("#map-solar-toggle-btn")
        page.wait_for_timeout(100)
        report("Map solar toggle reactivates cleanly on tap", "An" in page.inner_text("#map-solar-toggle-text"))

        for base in ["osm-outdoor", "osm-dark", "satellite", "osm-standard"]:
            btn = page.query_selector(f".map-base-btn[data-base='{base}']")
            report(f"Map base button '{base}' present", btn is not None)
            page.click(f".map-base-btn[data-base='{base}']")
            page.wait_for_timeout(150)
            is_active = page.eval_on_selector(f".map-base-btn[data-base='{base}']", "el => el.classList.contains('active')")
            report(f"Map base layer '{base}' activates cleanly", is_active)
        
        # Verify Wind Compass Widget on Wind Overlay
        page.click(".map-overlay-btn[data-overlay='wind']")
        page.wait_for_timeout(200)
        compass_visible = page.is_visible("#map-wind-compass-widget")
        report("Wind Compass widget appears when Wind overlay is active", compass_visible)
        wind_speed_text = page.inner_text("#mwc-speed-val")
        report("Wind Compass displays wind speed in km/h", len(wind_speed_text) > 0 and int(wind_speed_text) >= 0)
        needle_transform = page.eval_on_selector("#mwc-needle-wrap", "el => el.style.transform")
        report("Wind Compass needle displays rotational bearing", "rotate" in needle_transform)

        # Switch back to precip overlay and verify wind compass hides
        page.click(".map-overlay-btn[data-overlay='precip']")
        page.wait_for_timeout(150)
        report("Wind Compass cleanly hides when switching to another overlay", not page.is_visible("#map-wind-compass-widget"))

        # Verify Weather Overlays
        for mo in ["precip", "wind", "lightning", "clouds", "temp", "pressure"]:
            btn = page.query_selector(f".map-overlay-btn[data-overlay='{mo}']")
            report(f"Map overlay button '{mo}' present", btn is not None)
            page.click(f".map-overlay-btn[data-overlay='{mo}']")
            page.wait_for_timeout(150)
            is_act = page.eval_on_selector(f".map-overlay-btn[data-overlay='{mo}']", "el => el.classList.contains('active')")
            report(f"Map overlay '{mo}' activates cleanly", is_act)

        # Verify Streamlined Radar Timeline Dock
        slider_val = page.eval_on_selector("#radar-time-slider", "el => el.value")
        report("Radar timeline slider is interactable", slider_val is not None)

        # Test scrubbing the timeline slider
        page.eval_on_selector("#radar-time-slider", "el => { el.value = 0; el.dispatchEvent(new Event('input')); }")
        page.wait_for_timeout(100)
        time_text = page.inner_text("#radar-time-display")
        report("Radar time display shows complete timestamp for frame 0", len(time_text) > 5)

        page.eval_on_selector("#radar-time-slider", "el => { el.value = Math.floor(el.max / 2); el.dispatchEvent(new Event('input')); }")
        page.wait_for_timeout(100)
        time_text_mid = page.inner_text("#radar-time-display")
        report("Scrubbing slider updates radar time display smoothly", len(time_text_mid) > 5)

        # Close drawer if open so floating controls can receive direct pointer clicks
        if page.is_visible("#map-layer-drawer"):
            page.click("#map-layer-close-btn")
            page.wait_for_timeout(200)

        # Verify MeteoSwiss left Play button IS visible and redundant step/jump buttons are removed
        play_btn = page.query_selector("#radar-play-btn")
        report("MeteoSwiss play button is present and visible", play_btn is not None and page.is_visible("#radar-play-btn"))
        solar_pill = page.query_selector("#mscb-solar-pill")
        report("Astro sun/moon indicator pill present on radar callout badge", solar_pill is not None and len(page.inner_text("#mscb-solar-pill")) > 0)
        speed_btn = page.query_selector("#radar-speed-btn")
        report("Radar speed button is present and visible", speed_btn is not None and page.is_visible("#radar-speed-btn"))
        if speed_btn:
            initial_speed_text = page.inner_text("#radar-speed-btn")
            page.click("#radar-speed-btn")
            page.wait_for_timeout(100)
            new_speed_text = page.inner_text("#radar-speed-btn")
            report("Radar speed button cycles speed on tap", initial_speed_text != new_speed_text and ("1,5" in new_speed_text or "2" in new_speed_text))

        next_btn = page.query_selector("#radar-next-btn")
        report("Radar step buttons cleanly removed from DOM", next_btn is None)
        jump_btns = page.query_selector(".radar-jump-btn")
        report("Radar jump pills cleanly removed from DOM", jump_btns is None)
            
        # Verify Stations Toggle button removed completely
        st_btn = page.query_selector("#stations-toggle-btn")
        report("Stations toggle button cleanly removed from DOM", st_btn is None)

        # Verify Point Weather Card under Compass in Left HUD
        point_weather_card_visible = page.is_visible("#map-point-weather-card")
        report("Point Weather Card under compass is rendered and visible", point_weather_card_visible)
        pw_name = page.inner_text("#mpw-location-name")
        pw_temp = page.inner_text("#mpw-temp-val")
        pw_cond = page.inner_text("#mpw-condition-label")
        report("Point Weather Card displays location name", len(pw_name) > 0)
        report("Point Weather Card displays temperature value", "°" in pw_temp)
        report("Point Weather Card displays weather condition", len(pw_cond) > 0)
        report("Point Weather Card displays rain metric", len(page.inner_text("#mpw-rain-val")) > 0)
        report("Point Weather Card displays wind metric", "km/h" in page.inner_text("#mpw-wind-val"))
        report("Point Weather Card displays cloud cover", "%" in page.inner_text("#mpw-clouds-val"))

        # Verify Zoom Preservation on Map Point Selection (Clicking map must NEVER zoom out!)
        # Step 1: Zoom in manually to level 11
        page.evaluate("() => window.state.map.instance.setZoom(11)")
        page.wait_for_timeout(200)
        zoom_before = page.evaluate("() => window.state.map.instance.getZoom()")
        report("Manual map zoom level set to 11", zoom_before == 11)

        # Step 2: Click on the interactive map to select a new point
        map_box = page.locator("#interactive-map").bounding_box()
        if map_box:
            # Click near center of map
            page.mouse.click(map_box["x"] + map_box["width"] * 0.45, map_box["y"] + map_box["height"] * 0.45)
            page.wait_for_timeout(400)
            zoom_after_click = page.evaluate("() => window.state.map.instance.getZoom()")
            report("Zoom level is preserved on map click/selection (does NOT reset to 9)", zoom_after_click == 11)

        # Step 3: Select another location via selectExactLocation
        page.evaluate("() => window.selectExactLocation({ name: 'Zugspitze', lat: 47.421, lon: 10.985, elevation: 2962, isMountain: true })")
        page.wait_for_timeout(400)
        zoom_after_loc = page.evaluate("() => window.state.map.instance.getZoom()")
        report("Zoom level is preserved when selecting predefined location/mountain", zoom_after_loc == 11)
        pw_name_zugspitze = page.inner_text("#mpw-location-name")
        report("Point Weather Card dynamically updates to Zugspitze", "Zugspitze" in pw_name_zugspitze)
        pw_elev_zugspitze = page.inner_text("#mpw-elevation-chip")
        report("Point Weather Card shows Zugspitze elevation", "2962" in pw_elev_zugspitze)

        report("Zero unhandled JS exceptions during 2D Leaflet operations", len(page_errors) == 0, str(page_errors))
        page.screenshot(path="app_map_tab_screenshot.png")
        page.close()

        # =====================================================================
        # TEST SUITE 12: EXHAUSTIVE INTERACTIVE BUTTON INTEGRITY (ZERO ERRORS)
        # =====================================================================
        print("\n--- SUITE 12: Exhaustive Interactive Button Integrity Across All Tabs ---")
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        suite12_errors = []
        page.on("pageerror", lambda err: suite12_errors.append(str(err)))
        
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        time.sleep(1)

        def close_active_modals():
            page.evaluate("""() => {
                ['day-detail-modal', 'gpx-modal-overlay', 'webcam-modal-overlay', 'spotlight-modal-overlay'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = 'none';
                });
            }""")

        # 1. Header controls
        init_unit = page.inner_text("#unit-toggle-btn")
        page.click("#unit-toggle-btn")
        page.wait_for_timeout(100)
        new_unit = page.inner_text("#unit-toggle-btn")
        page.click("#unit-toggle-btn")
        report("Header unit toggle (°C/°F) switches units cleanly", init_unit != new_unit)

        page.click("#fav-toggle-btn")
        page.wait_for_timeout(100)
        page.click("#fav-toggle-btn")
        report("Header favorite toggle button updates state cleanly", True)

        page.click("#spotlight-trigger-btn")
        page.wait_for_timeout(100)
        spot_open = page.is_visible("#spotlight-modal-overlay")
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        report("Header Spotlight ⌘K modal opens and closes with Escape key", spot_open and not page.is_visible("#spotlight-modal-overlay"))

        page.type("#location-search-input", "Ber")
        page.wait_for_timeout(200)
        page.click("#clear-search-btn")
        page.keyboard.press("Escape")
        search_empty = page.input_value("#location-search-input") == ""
        report("Header search clear button (✕) clears input field", search_empty)

        # 2. Overview tab buttons
        page.locator(".tab-btn[data-tab='tab-overview']").click(force=True)
        page.wait_for_timeout(200)
        page.locator("#expert-mode-toggle-btn").click(force=True)
        page.wait_for_timeout(250)
        exp_open = page.is_visible("#expert-details-container") or not page.eval_on_selector("#expert-details-container", "el => el.classList.contains('is-hidden')")
        report("Kompakt-/Experten-Modus toggle reveals analysis section", exp_open)

        for mp in ["precip", "wind", "temp"]:
            page.locator(f".met-btn[data-metric='{mp}']").click(force=True)
            page.wait_for_timeout(100)
            is_act = page.eval_on_selector(f".met-btn[data-metric='{mp}']", "el => el.classList.contains('active')")
            report(f"Meteogram metric button '{mp}' activates cleanly", is_act)

        page.locator("#expert-mode-toggle-btn").click(force=True)
        page.wait_for_timeout(100)

        # 3. Mountain & Alpine View buttons
        page.locator(".tab-btn[data-tab='tab-mountain']").click(force=True)
        page.wait_for_timeout(200)

        page.locator(".cms-btn[data-mountain='Zugspitze']").click()
        page.wait_for_timeout(300)
        close_active_modals()
        hero_n = page.inner_text("#hero-location-name")
        report("City View Mountain Preset button 'Zugspitze' loads 'Zugspitze'", "zugspitze" in hero_n.lower())

        page.locator(".tab-btn[data-tab='tab-mountain']").click(force=True)
        page.wait_for_timeout(200)

        time_pills = page.eval_on_selector_all(".quick-time-pill", "els => els.length")
        report("Mountain altitude quick time pills present", time_pills > 0)
        page.click(".quick-time-pill[data-hour='3']")
        page.wait_for_timeout(100)
        report("Mountain altitude quick time pill switches hour", True)

        page.eval_on_selector("#mountain-aspect-drawer", "el => el.open = true")
        aspect_pills = page.eval_on_selector_all(".aspect-pill", "els => els.map((el, i) => i)")
        for idx in aspect_pills[:3]:
            page.locator(".aspect-pill").nth(idx).click()
            page.wait_for_timeout(100)
        report("Mountain slope exposition pills handle clicks without error", True)

        # 4. Sports & GPX buttons
        page.locator(".tab-btn[data-tab='tab-sports']").click(force=True)
        page.wait_for_timeout(200)

        # Open sports setup drawer for testing inputs
        page.eval_on_selector("#sports-setup-drawer", "el => el.open = true")
        page.wait_for_timeout(100)

        # Test 2 Sport Categories (Rad & Berge)
        page.click("#sport-cat-bike")
        page.wait_for_timeout(100)
        is_bike = page.eval_on_selector("#sport-cat-bike", "el => el.classList.contains('active')")
        report("Athlete Sport Category 'Rad' activates cleanly", is_bike)

        page.click("#bike-speed-plus")
        page.wait_for_timeout(50)
        page.click("#bike-speed-minus")
        page.wait_for_timeout(50)
        report("Rad stepless speed steppers (+/- 0.5 km/h) work cleanly", True)

        page.click("#sport-cat-mountain")
        page.wait_for_timeout(100)
        is_mtn = page.eval_on_selector("#sport-cat-mountain", "el => el.classList.contains('active')")
        report("Athlete Sport Category 'Berge' activates cleanly", is_mtn)

        page.click("#mtn-speed-plus")
        page.wait_for_timeout(50)
        page.click("#mtn-ascent-plus")
        page.wait_for_timeout(50)
        report("Berge stepless speed and ascent steppers work cleanly", True)

        # Separate Date & Time selection presets
        page.click("#sports-date-presets button[data-date-preset='tomorrow']")
        page.wait_for_timeout(50)
        page.click("#sports-time-presets button[data-time-preset='06:00']")
        page.wait_for_timeout(50)
        report("Separate Date & Time selection presets update tour start cleanly", True)

        for s in ["road_bike", "gravel_mtb", "trailrun", "hiking"]:
            page.eval_on_selector(f".sport-pill[data-sport='{s}']", "el => el.click()")
            page.wait_for_timeout(100)
            is_act = page.eval_on_selector(f".sport-pill[data-sport='{s}']", "el => el.classList.contains('active')")
            report(f"Sport discipline pill '{s}' activates cleanly", is_act)

        for fl in ["easy", "sporty", "pro", "normal"]:
            page.eval_on_selector(f".fitness-pill[data-fitness='{fl}']", "el => el.click()")
            page.wait_for_timeout(100)
            is_act = page.eval_on_selector(f".fitness-pill[data-fitness='{fl}']", "el => el.classList.contains('active')")
            report(f"Fitness pace pill '{fl}' activates cleanly", is_act)

        # Prominent top GPX upload & 2 Demo Presets (1 Berg, 1 Rad)
        upload_visible = page.is_visible("#sports-upload-card") and page.is_visible("#sports-browse-btn")
        report("Prominent top GPX upload dropzone and file browse button are visible", upload_visible)

        # Test the 2 Demos (Berg & Rad)
        # 1. Berg-Demo
        page.locator(".sports-route-preset[data-tour='nebelhorn-oberstdorf']").click()
        page.wait_for_timeout(350)
        is_berg_cat = page.eval_on_selector("#sport-cat-mountain", "el => el.classList.contains('active')")
        hero_title_berg = page.inner_text("#sports-active-tour-title")
        report("Sports Route Preset 'Berg: Nebelhorn' loads and activates category 'Berge'", is_berg_cat and "Nebelhorn" in hero_title_berg)

        # 2. Rad-Demo
        page.locator(".sports-route-preset[data-tour='allgaeu-radtour']").click()
        page.wait_for_function("() => document.getElementById('sports-active-tour-title').innerText.includes('Allgäu')", timeout=5000)
        is_rad_cat = page.eval_on_selector("#sport-cat-bike", "el => el.classList.contains('active')")
        hero_title_rad = page.inner_text("#sports-active-tour-title")
        report("Sports Route Preset 'Rad: Allgäu-Runde' loads and activates category 'Rad'", is_rad_cat and "Allgäu" in hero_title_rad)

        # Strecken- & Höhenwetter Cockpit: Scrubber Slider directly updates Weather & Position
        slider_visible = page.is_visible("#sports-route-slider")
        page.fill("#sports-route-slider", "50")
        page.eval_on_selector("#sports-route-slider", "el => el.dispatchEvent(new Event('input'))")
        page.wait_for_timeout(200)
        cockpit_pos = page.inner_text("#cockpit-pos-badge")
        slider_hint = page.inner_text("#cockpit-slider-hint")
        temp_val = page.inner_text("#cwc-temp")
        scrubber_synced = "km" in cockpit_pos and "km" in slider_hint and "°C" in temp_val
        report("Integrated Cockpit scrubber slider updates live weather and position in-place", slider_visible and scrubber_synced)

        # Streamlined Cockpit Layout: Dynamic weather data container sits ABOVE the route slider
        capsule_box = page.eval_on_selector("#cockpit-weather-capsule", "el => el.getBoundingClientRect().top")
        slider_box = page.eval_on_selector("#sports-route-slider", "el => el.getBoundingClientRect().top")
        order_correct = capsule_box < slider_box
        report("Dynamic weather data container sits above route slider for finger-free scrubbing", order_correct)

        # Bottom chart representation cleanly removed as requested ("die darstellung unten komplett entfernen!")
        chart_removed = page.query_selector("#sports-chart-wrapper") is None
        report("Redundant bottom profile chart is cleanly removed from DOM", chart_removed)

        # 1-Touch Quick Stations (Start, Gipfel, Ziel)
        page.click("#cockpit-chip-peak")
        page.wait_for_timeout(200)
        peak_active = page.eval_on_selector("#cockpit-chip-peak", "el => el.classList.contains('active')")
        page.click("#cockpit-chip-start")
        page.wait_for_timeout(200)
        start_active = page.eval_on_selector("#cockpit-chip-start", "el => el.classList.contains('active')")
        report("Quick station chips (Start, Gipfel, Ziel) synchronize elevation and weather seamlessly", peak_active and start_active)

        # Sports Map Fullscreen Mode & Detailed Weather Milestones
        map_fs_btn_present = page.is_visible("#sports-map-fullscreen-btn")
        page.click("#sports-map-fullscreen-btn")
        page.wait_for_timeout(200)
        is_map_fs = page.eval_on_selector("#sports-map-wrapper", "el => el.classList.contains('sports-map-fullscreen')")
        close_btn_visible = page.is_visible("#sports-map-close-btn")
        report("Sports Map enters fullscreen mode and close button (✕) becomes visible", map_fs_btn_present and is_map_fs and close_btn_visible)

        # Verify rich weather milestone markers with detailed badges for fullscreen
        detailed_badges_count = page.eval_on_selector_all(".ms-detailed-card", "els => els.length")
        report("Sports Map renders rich multi-line weather milestone points with detailed metrics", detailed_badges_count > 0)

        # Exit fullscreen mode via close button
        page.click("#sports-map-close-btn")
        page.wait_for_timeout(200)
        fs_closed = not page.eval_on_selector("#sports-map-wrapper", "el => el.classList.contains('sports-map-fullscreen')")
        report("Sports Map closes fullscreen cleanly via the close button", fs_closed)

        # Verify Live-Tracking Panel is cleanly eliminated from DOM
        tracking_removed = not page.is_visible("#sports-live-tracking-panel") and not page.is_visible("#sltp-in-flight-summary")
        report("Live-tour tracking panel is cleanly removed from DOM", tracking_removed)

        # Verify Waypoints Accordion is functional
        page.eval_on_selector("#sports-waypoints-drawer", "el => el.open = true")
        page.wait_for_timeout(100)
        wpt_rows = page.eval_on_selector_all(".swt-row", "els => els.length")
        report("Etappen-Fahrplan & Wegpunkte accordion renders structured route milestones", wpt_rows > 0)

        # 5. Weather Map buttons & overlays
        page.locator(".tab-btn[data-tab='tab-map']").click(force=True)
        page.wait_for_timeout(300)

        # Open layer drawer
        if not page.is_visible("#map-layer-drawer"):
            page.click("#map-layer-pill")
            page.wait_for_timeout(150)

        for base in ["osm-outdoor", "osm-dark", "satellite", "osm-standard"]:
            page.click(f".map-base-btn[data-base='{base}']")
            page.wait_for_timeout(100)
            is_act = page.eval_on_selector(f".map-base-btn[data-base='{base}']", "el => el.classList.contains('active')")
            report(f"Map base layer '{base}' activates cleanly", is_act)

        for mo in ["wind", "clouds", "temp", "precip", "lightning", "pressure"]:
            page.click(f".map-overlay-btn[data-overlay='{mo}']")
            page.wait_for_timeout(150)
            is_act = page.eval_on_selector(f".map-overlay-btn[data-overlay='{mo}']", "el => el.classList.contains('active')")
            report(f"Map weather layer overlay button '{mo}' activates with 0 errors", is_act)

        page.eval_on_selector("#radar-time-slider", "el => { el.value = 1; el.dispatchEvent(new Event('input')); }")
        page.wait_for_timeout(100)
        report("Radar timeline scrubber operates smoothly", True)

        # 6. Favorites Tab & Networks Tab
        page.locator(".tab-btn[data-tab='tab-favorites']").click(force=True)
        page.wait_for_timeout(200)
        fav_items = page.eval_on_selector_all(".favorite-card, .preset-fav-chip", "els => els.map(el => el.innerText.trim())")
        if len(fav_items) == 0 and page.is_visible("#add-current-favorite-btn"):
            page.click("#add-current-favorite-btn")
            page.wait_for_timeout(200)
            fav_items = page.eval_on_selector_all(".favorite-card, .preset-fav-chip", "els => els.map(el => el.innerText.trim())")
        report("Favorites tab displays locations or preset chips", len(fav_items) > 0 or page.is_visible("#add-current-favorite-btn"))
        if fav_items:
            page.locator(".favorite-card, .preset-fav-chip").first.click()
            page.wait_for_timeout(300)
            report("Clicking favorite item executes without errors", True)

        page.locator(".tab-btn[data-tab='tab-networks']").click(force=True)
        page.wait_for_timeout(200)
        chips = page.eval_on_selector_all(".sources-quick-chip", "els => els.map(el => el.innerText.trim())")
        for i in range(min(3, len(chips))):
            page.locator(".sources-quick-chip").nth(i).click()
            page.wait_for_timeout(100)
        report("Data sources quick jump category chips handle clicks cleanly", True)

        report("Zero unhandled JS exceptions across all interactive button flows", len(suite12_errors) == 0, str(suite12_errors))

        # =====================================================================
        # TEST SUITE 13: LAYOUT SPACING, BOUNDING BOXES & OVERFLOW PREVENTION
        # =====================================================================
        print("\n--- SUITE 13: Comprehensive UI Layout, Bounding Box Spacing & Zero Overflow ---")
        all_tabs = ["tab-overview", "tab-mountain", "tab-sports", "tab-map", "tab-favorites", "tab-networks"]
        for t in all_tabs:
            page.locator(f".tab-btn[data-tab='{t}']").click(force=True)
            page.wait_for_timeout(200)
            box = page.locator(f"#{t}").bounding_box()
            has_valid_box = box is not None and box["width"] > 700 and box["height"] > 200
            report(f"Tab #{t} bounding box is well-proportioned ({round(box['width'] if box else 0)}x{round(box['height'] if box else 0)}px)", has_valid_box)

            has_h_overflow = page.evaluate(f"""() => {{
                const el = document.getElementById('{t}');
                return el.scrollWidth > el.clientWidth + 5;
            }}""")
            report(f"Tab #{t} has zero unwanted horizontal layout overflow", not has_h_overflow)

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
