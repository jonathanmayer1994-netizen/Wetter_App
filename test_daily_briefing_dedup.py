#!/usr/bin/env python3
"""
Test Suite: Strict 1x Daily Briefing & Deduplication Engine
Verifies that:
1. evaluateAlertRules generates EXACTLY 1 daily report per calendar day.
2. Runs at 07:11, 08:10, 09:09 on the same day are completely suppressed.
3. Next day (2026-11-25) triggers the new day's briefing.
4. Devices sharing the same push subscription endpoint are strictly deduplicated.
5. Client getNotifications() cleanses multiple historical briefing records on the same day into 1 clean card.
6. Once a briefing is read, incoming duplicates do not reset read status or renotify.
"""

import sys
import os
import shutil
import subprocess
import time
from playwright.sync_api import sync_playwright

def find_node():
    if shutil.which("node"):
        return shutil.which("node")
    fallback = os.path.expanduser("~/Library/Python/3.9/lib/python/site-packages/playwright/driver/node")
    if os.path.exists(fallback):
        return fallback
    raise RuntimeError("Node.js binary not found")

def run_tests():
    node_bin = find_node()
    port = 52918
    server = subprocess.Popen(["python3", "-m", "http.server", str(port)])
    time.sleep(1)

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
        # -------------------------------------------------------------
        # TEST PHASE 1: Server Dispatcher 1x-Briefing & Endpoint Dedup
        # -------------------------------------------------------------
        print("\n--- TEST PHASE 1: Server Dispatcher 1x-Briefing & Endpoint Dedup ---")
        node_script = """
        import { evaluateAlertRules, loadDeviceConfigs } from './scripts/weather-push-dispatcher.mjs';

        const device = {
          deviceId: '4a61352e-503c-41ad-99ea-4fca1d5ce5da',
          enabled: true,
          subscription: { endpoint: 'https://web.push.apple.com/QCn9W...' },
          rules: {
            briefingAlert: true,
            briefingTime: '07:00'
          },
          location: { name: 'Durach', lat: 47.7, lon: 10.3, elevation: 714 }
        };

        const weatherMock = {
          current: { weather_code: 3, temperature_2m: 1 },
          daily: {
            weather_code: [3],
            temperature_2m_max: [2],
            temperature_2m_min: [-2],
            sunshine_duration: [21600],
            precipitation_probability_max: [3],
            precipitation_sum: [0]
          },
          hourly: { cloud_cover: new Array(24).fill(20) }
        };

        const devState = {};

        // Run 1: 07:11 Uhr Heute (2026-11-24)
        const timeInfo1 = { hour: 7, minute: 11, dateString: '2026-11-24', isQuietHours: false };
        const alerts1 = evaluateAlertRules(device, weatherMock, devState, timeInfo1, 1795521070000);

        if (alerts1.length !== 1 || alerts1[0].type !== 'briefing') {
          console.error('FAIL: Run 1 should produce exactly 1 briefing alert');
          process.exit(1);
        }
        if (devState.lastBriefingDate !== '2026-11-24') {
          console.error('FAIL: devState.lastBriefingDate not set to 2026-11-24');
          process.exit(1);
        }
        console.log('PASS: Run 1 (07:11 Uhr) generated 1 briefing alert and set state');

        // Run 2: 08:10 Uhr Heute (59 Min später)
        const timeInfo2 = { hour: 8, minute: 10, dateString: '2026-11-24', isQuietHours: false };
        const alerts2 = evaluateAlertRules(device, weatherMock, devState, timeInfo2, 1795524600000);
        if (alerts2.length !== 0) {
          console.error('FAIL: Run 2 (08:10 Uhr) produced duplicate alert! Count:', alerts2.length);
          process.exit(1);
        }
        console.log('PASS: Run 2 (08:10 Uhr) strictly suppressed (0 alerts)');

        // Run 3: 08:10 Uhr Zweiter Runner / Concurrent Retry
        const alerts3 = evaluateAlertRules(device, weatherMock, devState, timeInfo2, 1795524605000);
        if (alerts3.length !== 0) {
          console.error('FAIL: Run 3 (08:10 Retry) produced duplicate alert!');
          process.exit(1);
        }
        console.log('PASS: Run 3 (08:10 Retry) strictly suppressed (0 alerts)');

        // Run 4: 09:09 Uhr Heute (59 Min später)
        const timeInfo4 = { hour: 9, minute: 9, dateString: '2026-11-24', isQuietHours: false };
        const alerts4 = evaluateAlertRules(device, weatherMock, devState, timeInfo4, 1795528140000);
        if (alerts4.length !== 0) {
          console.error('FAIL: Run 4 (09:09 Uhr) produced duplicate alert!');
          process.exit(1);
        }
        console.log('PASS: Run 4 (09:09 Uhr) strictly suppressed (0 alerts)');

        // Run 5: Nächster Tag (2026-11-25) um 07:05 Uhr
        const timeInfoNextDay = { hour: 7, minute: 5, dateString: '2026-11-25', isQuietHours: false };
        const alertsNextDay = evaluateAlertRules(device, weatherMock, devState, timeInfoNextDay, 1795607100000);
        if (alertsNextDay.length !== 1 || alertsNextDay[0].type !== 'briefing') {
          console.error('FAIL: Next day should generate 1 briefing alert');
          process.exit(1);
        }
        console.log('PASS: Next day (2026-11-25) generated 1 briefing alert');

        // Test Endpoint Deduplication in loadDeviceConfigs
        const mockEnv = {
          WEATHER_PUSH_DEV_UUID1: JSON.stringify({
            deviceId: 'uuid-1',
            updatedAt: '2026-11-24T06:00:00Z',
            subscription: { endpoint: 'https://web.push.apple.com/SAME_ENDPOINT' }
          }),
          WEATHER_PUSH_DEV_UUID2: JSON.stringify({
            deviceId: 'uuid-2',
            updatedAt: '2026-11-24T07:00:00Z',
            subscription: { endpoint: 'https://web.push.apple.com/SAME_ENDPOINT' }
          })
        };
        const loaded = loadDeviceConfigs(mockEnv, { disableLocalFallback: true });
        if (loaded.length !== 1) {
          console.error('FAIL: Endpoint deduplication failed, devices loaded:', loaded.length);
          process.exit(1);
        }
        if (loaded[0].deviceId !== 'uuid-2') {
          console.error('FAIL: Should keep newer device uuid-2');
          process.exit(1);
        }
        console.log('PASS: loadDeviceConfigs deduplicated multiple UUIDs sharing the same push endpoint');
        """

        node_proc = subprocess.run([node_bin, "--input-type=module", "-e", node_script], capture_output=True, text=True)
        if node_proc.returncode == 0:
            for line in node_proc.stdout.strip().split("\n"):
                if line.startswith("PASS:"):
                    assert_test(line[6:], True)
        else:
            print("Node Error:", node_proc.stderr)
            assert_test("Server Dispatcher 1x-Briefing & Endpoint Dedup", False)

        # -------------------------------------------------------------
        # TEST PHASE 2: Client Feed Deduplication & Read Status Sync
        # -------------------------------------------------------------
        print("\n--- TEST PHASE 2: Client Feed Deduplication & Read Status Sync ---")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")

            eval_res = page.evaluate("""async () => {
                const { saveNotification, getNotifications, markNotificationAsRead, clearAllNotifications } = await import('./features/notification-store.js');
                await clearAllNotifications();

                // 1. Simuliere die 4 Benachrichtigungen von heute morgen (07:11, 08:10, 08:10, 09:09)
                await saveNotification({
                    id: 'briefing_2026-11-24_0711',
                    title: '📊 Täglicher Bericht — Mein Standort (Durach)',
                    body: 'Sonnig, nachts Schnee • -2° bis 2°C • ☀️ 6h Sonne',
                    type: 'briefing',
                    tag: 'briefing-2026-11-24',
                    timestamp: new Date('2026-11-24T07:11:00').getTime(),
                    read: false,
                    data: { dateString: '2026-11-24' }
                });
                await saveNotification({
                    id: 'briefing_2026-11-24_0810_1',
                    title: '📊 Täglicher Bericht — Mein Standort (Durach)',
                    body: 'Raureifnebel • -2° bis 2°C • ☀️ 6h Sonne',
                    type: 'briefing',
                    tag: 'briefing-2026-11-24',
                    timestamp: new Date('2026-11-24T08:10:00').getTime(),
                    read: false,
                    data: { dateString: '2026-11-24' }
                });
                await saveNotification({
                    id: 'briefing_2026-11-24_0810_2',
                    title: '📊 Täglicher Bericht — Mein Standort (Durach)',
                    body: 'Raureifnebel • -2° bis 2°C • ☀️ 6h Sonne',
                    type: 'briefing',
                    tag: 'briefing-2026-11-24',
                    timestamp: new Date('2026-11-24T08:10:01').getTime(),
                    read: false,
                    data: { dateString: '2026-11-24' }
                });
                await saveNotification({
                    id: 'briefing_2026-11-24_0909',
                    title: '📊 Täglicher Bericht — Mein Standort (Durach)',
                    body: 'Raureifnebel • -2° bis 2°C • ☀️ 6h Sonne',
                    type: 'briefing',
                    tag: 'briefing-2026-11-24',
                    timestamp: new Date('2026-11-24T09:09:00').getTime(),
                    read: false,
                    data: { dateString: '2026-11-24' }
                });

                const results = [];

                // Abruf der Mitteilungen: Die 4 alten Spam-Meldungen müssen auf genau 1 Eintrag dedupliziert werden
                const list = await getNotifications();
                results.push({
                    name: 'Four duplicate morning briefings collapsed to exactly 1 in feed',
                    pass: list.length === 1
                });
                results.push({
                    name: 'Kept the latest update (09:09 Uhr)',
                    pass: list[0]?.id === 'briefing_2026-11-24_0909'
                });

                // 2. Als gelesen markieren
                await markNotificationAsRead(list[0].id);
                const listAfterRead = await getNotifications();
                results.push({
                    name: 'Briefing is now marked as read: true',
                    pass: listAfterRead[0]?.read === true
                });

                // 3. Simuliere erneutes Eintreffen eines Pushes mit selber ID: read-Status darf NICHT überschrieben werden!
                await saveNotification({
                    id: 'briefing_2026-11-24_0909',
                    title: '📊 Täglicher Bericht — Mein Standort (Durach)',
                    body: 'Raureifnebel • -2° bis 2°C • ☀️ 6h Sonne',
                    type: 'briefing',
                    tag: 'briefing-2026-11-24',
                    timestamp: Date.now(),
                    read: false
                });

                const listAfterResave = await getNotifications();
                results.push({
                    name: 'Resaving read briefing strictly preserves read: true status',
                    pass: listAfterResave[0]?.read === true
                });

                return results;
            }""")

            for item in eval_res:
                assert_test(item["name"], item["pass"])

            browser.close()

    finally:
        server.terminate()

    print(f"\n==========================================")
    print(f"STRICT 1X DAILY BRIEFING SUITE: {passed}/{passed + failed} PASSED")
    print(f"==========================================")
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
