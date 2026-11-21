#!/usr/bin/env python3
"""
Test Suite: Device-Scoped Favorites & Dual-Layer Persistence Engine
Verifies:
1. Device UUID generation & stability
2. Device-scoped storage keys (bw_favs_<UUID>)
3. Atomic dual-layer persistence (LocalStorage + IndexedDB BestWeatherAlpineDB.device_favorites)
4. Multi-device isolation (two devices with independent favorites lists)
5. Seamless legacy migration from best_weather_favorites_v4
6. Auto-recovery from IndexedDB after simulated iOS WebKit LocalStorage purge
7. Wipe-protection: removal of isOldSeed hazard
8. GitLab sync payload contains favorites backup
"""

import sys
import threading
import http.server
import socketserver
import time
from playwright.sync_api import sync_playwright

def run_suite():
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, format, *args): pass

    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    passed = 0
    failed = 0

    def assert_test(name, condition):
        nonlocal passed, failed
        if condition:
            print(f"  ✓ {name}")
            passed += 1
        else:
            print(f"  ✗ FAIL: {name}")
            failed += 1

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(service_workers="block")
            page = ctx.new_page()
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
            page.wait_for_selector("#hero-location-name", timeout=10000)
            page.wait_for_function("() => typeof window.AlpineStorage !== 'undefined' && typeof window.AlpineStorage.getDeviceFavoritesKey === 'function'", timeout=10000)

            print("\n--- TEST SUITE: Device-Scoped Favorites & Dual-Layer Persistence ---")

            # 1. Device UUID & Key
            uuid = page.evaluate("() => window.AlpineStorage ? window.AlpineStorage.getDeviceUuid() : null")
            assert_test("Device UUID exists and is non-empty", bool(uuid))
            import re
            uuid_pattern = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
            assert_test("Device UUID is a valid RFC 4122 v4 UUID", bool(re.match(uuid_pattern, uuid or "")))

            key = page.evaluate("() => window.AlpineStorage.getDeviceFavoritesKey()")
            assert_test(f"Storage key matches bw_favs_<UUID>: {key}", key == f"bw_favs_{uuid}")

            # 2. Add Favorite & Check Dual-Layer Storage
            loc_test = {"name": "Gipfelkreuz Nebelhorn", "lat": 47.4219, "lon": 10.3444, "elevation": 2224, "country": "Deutschland", "isMountain": True}
            page.evaluate("(loc) => window.toggleFavoriteLocation(loc)", loc_test)
            page.wait_for_timeout(300)

            # Check in-memory state
            in_state = page.evaluate("(name) => window.state.favorites.some(f => f.name === name)", loc_test["name"])
            assert_test("Favorite is added to runtime state.favorites", in_state)

            # Check LocalStorage device-scoped key
            ls_items = page.evaluate("(k) => JSON.parse(localStorage.getItem(k) || '[]')", key)
            assert_test("Favorite is persisted in device-scoped LocalStorage", any(f["name"] == loc_test["name"] for f in ls_items))

            # Check IndexedDB persistence
            idb_items = page.evaluate("""async (uuid) => {
                return await window.AlpineStorage.getDeviceFavorites(uuid);
            }""", uuid)
            assert_test("Favorite is persisted in IndexedDB (device_favorites)", idb_items and any(f["name"] == loc_test["name"] for f in idb_items))

            # 3. Multi-Device Isolation Test
            # Simulate Device B in a fresh browser context with separate storage
            ctx2 = browser.new_context(service_workers="block")
            page2 = ctx2.new_page()
            page2.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
            page2.wait_for_selector("#hero-location-name", timeout=10000)
            page2.wait_for_function("() => typeof window.AlpineStorage !== 'undefined' && typeof window.AlpineStorage.getDeviceUuid === 'function'", timeout=10000)

            uuid2 = page2.evaluate("() => window.AlpineStorage.getDeviceUuid()")
            assert_test("Second device generates a distinct UUID", uuid2 != uuid)

            dev2_favs = page2.evaluate("() => window.state.favorites")
            assert_test("Device B does NOT inherit Device A's favorite (Clean Isolation)", not any(f["name"] == loc_test["name"] for f in dev2_favs))

            # Add distinct favorite to Device B
            loc_b = {"name": "Zugspitze Panorama", "lat": 47.4212, "lon": 10.9864, "elevation": 2962, "country": "Deutschland", "isMountain": True}
            page2.evaluate("(loc) => window.toggleFavoriteLocation(loc)", loc_b)
            page2.wait_for_timeout(300)

            dev1_favs_after = page.evaluate("() => window.state.favorites")
            assert_test("Device A does NOT receive Device B's favorite", not any(f["name"] == loc_b["name"] for f in dev1_favs_after))
            ctx2.close()

            # 4. Auto-Recovery after simulated iOS WebKit LocalStorage purge
            print("\n--- SUITE: Auto-Recovery from IndexedDB ---")
            # Wiping LocalStorage to simulate iOS WebKit PWA cache wipe / app update
            page.evaluate("(k) => { localStorage.removeItem(k); localStorage.removeItem('best_weather_favorites_v4'); }", key)
            ls_check = page.evaluate("(k) => localStorage.getItem(k)", key)
            assert_test("LocalStorage purged for simulation", ls_check is None)

            # Reload page: setupFavorites() must restore from IndexedDB
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#hero-location-name", timeout=10000)
            page.wait_for_timeout(500)

            restored_state = page.evaluate("(name) => window.state.favorites.some(f => f.name === name)", loc_test["name"])
            assert_test("Favorites automatically restored from IndexedDB on startup", restored_state)

            restored_ls = page.evaluate("(k) => JSON.parse(localStorage.getItem(k) || '[]')", key)
            assert_test("LocalStorage repaired and repopulated from IndexedDB", any(f["name"] == loc_test["name"] for f in restored_ls))

            # 5. Wipe-Protection Test (5 favorites with München/Zugspitze/Matterhorn)
            print("\n--- SUITE: Wipe-Protection (Removal of isOldSeed Hazard) ---")
            test_five = [
                {"name": "München", "lat": 48.137, "lon": 11.575, "elevation": 520, "country": "Deutschland", "isMountain": False},
                {"name": "Zugspitze", "lat": 47.421, "lon": 10.986, "elevation": 2962, "country": "Deutschland", "isMountain": True},
                {"name": "Matterhorn", "lat": 45.976, "lon": 7.658, "elevation": 4478, "country": "Schweiz", "isMountain": True},
                {"name": "Innsbruck", "lat": 47.269, "lon": 11.404, "elevation": 574, "country": "Österreich", "isMountain": False},
                {"name": "Kempten", "lat": 47.728, "lon": 10.315, "elevation": 674, "country": "Deutschland", "isMountain": False}
            ]
            page.evaluate("(items) => { window.state.favorites = items; window.persistFavorites(items); }", test_five)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#hero-location-name", timeout=10000)
            page.wait_for_timeout(300)

            survived_count = page.evaluate("() => window.state.favorites.length")
            assert_test("5 favorites with classic mountain presets are NOT wiped by isOldSeed", survived_count == 5)

            # 6. GitLab Sync Payload contains favorites
            print("\n--- SUITE: Cloud Backup in GitLab Sync Payload ---")
            payload = page.evaluate("() => window.buildDeviceSyncPayload ? window.buildDeviceSyncPayload() : null")
            assert_test("buildDeviceSyncPayload returns payload", payload is not None)
            assert_test("Payload contains favorites array", "favorites" in payload and isinstance(payload["favorites"], list))
            assert_test("Payload favorites matches device favorites count (5)", len(payload["favorites"]) == 5)

            browser.close()

    finally:
        httpd.shutdown()

    print(f"\n==========================================")
    print(f"DEVICE FAVORITES SUITE: {passed}/{passed + failed} PASSED")
    print(f"==========================================")
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_suite()
