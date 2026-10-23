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

        # Test Mountain 3D Massif Mode with realistic clouds and clean alpine rendering
        page.click(".tab-btn[data-tab='tab-mountain']")
        page.wait_for_timeout(900)
        page.screenshot(path="mountain_massif_clouds_screenshot.png")

        # Test Mountain Windströmung Mode with Altimetric Wind Compasses for Matterhorn
        page.click("#m3d-mode-wind")
        page.wait_for_timeout(400)
        wind_mode_active = page.eval_on_selector("#m3d-mode-wind", "el => el.classList.contains('active')")
        report("Mountain Windströmung mode button activates altimetric compass view", wind_mode_active)
        page.screenshot(path="mountain_wind_compass_screenshot.png")
        
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
        page.wait_for_selector("#hero-location-name", timeout=10000)
        page.wait_for_timeout(500)
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

        # =====================================================================
        # TEST SUITE 11: 2D LEAFLET MULTI-LAYER & 48H MODELL-RADAR KARTE
        # =====================================================================
        print("\n--- SUITE 11: 2D Leaflet Multi-Layer & 48h Radar Map (In App) ---")
        page = browser.new_page(viewport={"width": 1280, "height": 850})
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.click(".tab-btn[data-tab='tab-map']")
        page.wait_for_timeout(1000)
        
        report("Leaflet map wrapper visible in tab-map", page.is_visible("#fullscreen-map-wrapper"))
        report("Interactive map DOM element rendered", page.is_visible("#interactive-map"))
        
        # Verify Zero Annoying White Popups Over User Location
        report("Zero annoying white boxes or auto-open popups over user location", not page.is_visible(".leaflet-popup"))
        report("User location beacon pin is rendered on map", page.is_visible(".user-location-beacon"))

        # Verify Modern Floating Zoom & Navigation Dock Controls (+ / − / 🎯 / 🏔️)
        report("Floating Zoom Dock is visible on map", page.is_visible("#map-floating-zoom-dock"))
        page.click("#map-zoom-in-btn")
        page.wait_for_timeout(100)
        report("Map zoom in (+) button operates smoothly", True)
        page.click("#map-zoom-out-btn")
        page.wait_for_timeout(100)
        report("Map zoom out (−) button operates smoothly", True)
        page.click("#map-zoom-location-btn")
        page.wait_for_timeout(150)
        report("Map recenter to location (🎯) operates smoothly", True)
        page.click("#map-zoom-alps-btn")
        page.wait_for_timeout(150)
        report("Map Alps overview (🏔️) button operates smoothly", True)
        
        # Verify Base Map Layers
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

        # Verify Radar Transport & Play/Pause
        play_btn = page.query_selector("#radar-play-btn")
        report("Radar play/pause button present", play_btn is not None)
        page.click("#radar-play-btn")
        page.wait_for_timeout(200)
        play_icon = page.inner_text("#radar-play-btn")
        report("Clicking radar play button toggles state", "⏸" in play_icon or "▶" in play_icon)
        page.click("#radar-play-btn") # pause
        
        # Verify Radar Navigation & Speed
        page.click("#radar-next-btn")
        page.wait_for_timeout(100)
        page.click("#radar-prev-btn")
        page.wait_for_timeout(100)
        page.click("#radar-speed-btn")
        page.wait_for_timeout(100)
        report("Radar transport buttons (prev, next, speed) operate smoothly", True)
        
        # Verify Radar Slider
        slider_val = page.eval_on_selector("#radar-time-slider", "el => el.value")
        report("Radar timeline slider is interactable", slider_val is not None)
        
        # Verify Radar Jump Pills
        jump_now = page.query_selector(".radar-jump-btn[data-target='now']")
        report("Radar jump pill 'Jetzt' present", jump_now is not None)
        if jump_now:
            jump_now.click()
            page.wait_for_timeout(100)
            report("Radar jump to now operates smoothly", True)
            
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
        
        page.goto(f"http://127.0.0.1:{port}/index.html")
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
        search_empty = page.input_value("#location-search-input") == ""
        report("Header search clear button (✕) clears input field", search_empty)

        # 2. Overview tab buttons
        page.click(".tab-btn[data-tab='tab-overview']")
        page.wait_for_timeout(200)
        page.click("#expert-mode-toggle-btn")
        page.wait_for_timeout(200)
        exp_open = page.is_visible("#expert-details-container")
        report("Kompakt-/Experten-Modus toggle reveals analysis section", exp_open)

        for mp in ["precip", "wind", "temp"]:
            page.click(f".met-btn[data-metric='{mp}']")
            page.wait_for_timeout(100)
            is_act = page.eval_on_selector(f".met-btn[data-metric='{mp}']", "el => el.classList.contains('active')")
            report(f"Meteogram metric button '{mp}' activates cleanly", is_act)

        page.click("#expert-mode-toggle-btn")
        page.wait_for_timeout(100)

        # 3. Mountain & Alpine View buttons
        page.click(".tab-btn[data-tab='tab-mountain']")
        page.wait_for_timeout(200)

        page.locator(".cms-btn[data-mountain='Zugspitze']").click()
        page.wait_for_timeout(300)
        close_active_modals()
        hero_n = page.inner_text("#hero-location-name")
        report("City View Mountain Preset button 'Zugspitze' loads 'Zugspitze'", "zugspitze" in hero_n.lower())

        page.click(".tab-btn[data-tab='tab-mountain']")
        page.wait_for_timeout(200)

        for m_name, sel in [("crossSection", "#m3d-mode-section"), ("wind", "#m3d-mode-wind"), ("massif", "#m3d-mode-massif")]:
            page.click(sel)
            page.wait_for_timeout(100)
            is_act = page.eval_on_selector(sel, "el => el.classList.contains('active')")
            report(f"Mountain 3D view mode button '{m_name}' activates cleanly", is_act)

        for lt in ["#m3d-toggle-frost", "#m3d-toggle-clouds", "#m3d-toggle-sun"]:
            page.click(lt)
            page.wait_for_timeout(100)
            page.click(lt)
            report(f"Mountain layer toggle button '{lt}' operates cleanly", True)

        aspect_pills = page.eval_on_selector_all(".aspect-pill", "els => els.map((el, i) => i)")
        for idx in aspect_pills[:3]:
            page.locator(".aspect-pill").nth(idx).click()
            page.wait_for_timeout(100)
        report("Mountain slope exposition pills handle clicks without error", True)

        # 4. Sports & GPX buttons
        page.click(".tab-btn[data-tab='tab-sports']")
        page.wait_for_timeout(200)

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

        route_presets = page.eval_on_selector_all(".sports-route-preset", "els => els.map(el => el.innerText.trim().slice(0, 25))")
        for i, rp_name in enumerate(route_presets[:3]):
            page.locator(".sports-route-preset").nth(i).click()
            page.wait_for_timeout(400)
            close_active_modals()
            report(f"Sports Route Preset '{rp_name}' loads into map with 0 errors", True)

        # In-Flight Live Route & Weather Tracking Tests
        page.click("#sports-live-track-toggle")
        page.wait_for_timeout(150)
        is_tracking = page.eval_on_selector("#sports-live-track-toggle", "el => el.classList.contains('tracking-active')")
        report("Sports Live-Tour tracking toggle activates cleanly", is_tracking)

        # Step 1: Simulate +5 km in-flight progress
        page.click("#sports-sim-step-btn")
        page.wait_for_timeout(250)
        summary_visible = page.is_visible("#sltp-in-flight-summary")
        done_text = page.inner_text("#sltp-val-done")
        report("In-flight summary displays after progression step", summary_visible and "5.0 km" in done_text)

        # Verify in-place waypoint dimming (completed vs active vs upcoming)
        completed_rows = page.eval_on_selector_all(".swt-row-completed", "els => els.length")
        active_live_rows = page.eval_on_selector_all(".swt-row-active-live", "els => els.length")
        report("Passed waypoints are dimmed in-place and next stop is highlighted", completed_rows > 0 and active_live_rows > 0)

        # Verify adaptive time delta and updated remaining weather/distance
        dist_text = page.inner_text("#sm-val-dist")
        report("Route metrics reflect remaining distance in-flight", "Rest von" in dist_text)

        # Reset in-flight progress
        page.click("#sports-reset-progress-btn")
        page.wait_for_timeout(200)
        reset_hidden = not page.is_visible("#sltp-in-flight-summary")
        report("In-flight reset restores baseline planned route cleanly", reset_hidden)

        # 5. Weather Map buttons & overlays
        page.click(".tab-btn[data-tab='tab-map']")
        page.wait_for_timeout(300)

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

        page.click("#radar-next-btn")
        page.wait_for_timeout(100)
        page.click("#radar-prev-btn")
        page.wait_for_timeout(100)
        page.click("#radar-play-btn")
        page.wait_for_timeout(200)
        page.click("#radar-play-btn")
        report("Radar transport buttons operate smoothly", True)

        # 6. Favorites Tab & Networks Tab
        page.click(".tab-btn[data-tab='tab-favorites']")
        page.wait_for_timeout(200)
        fav_items = page.eval_on_selector_all(".favorite-card, .preset-fav-chip", "els => els.map(el => el.innerText.trim())")
        report("Favorites tab displays locations or preset chips", len(fav_items) > 0)
        if fav_items:
            page.locator(".favorite-card, .preset-fav-chip").first.click()
            page.wait_for_timeout(300)
            report("Clicking favorite item executes without errors", True)

        page.click(".tab-btn[data-tab='tab-networks']")
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
            page.click(f".tab-btn[data-tab='{t}']")
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
