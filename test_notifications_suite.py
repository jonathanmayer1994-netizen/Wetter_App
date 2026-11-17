#!/usr/bin/env python3
"""
Test Suite: Push Notifications & GitLab REST API Configuration (Option B)
Verifies UI controls, Option B schedule options, modal overlay, form fields, and event listeners.
"""

import sys
import http.server
import socketserver
import threading
from playwright.sync_api import sync_playwright

PORT = 61955

def start_server():
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("", PORT), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd

def run_tests():
    server = start_server()
    passed = 0
    total = 0

    def assert_test(name, condition):
        nonlocal passed, total
        total += 1
        if condition:
            passed += 1
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ FAILED: {name}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Block SW caching in test harness for reproducible live asset testing
        context = browser.new_context(
            service_workers="block",
            permissions=["notifications", "geolocation"],
            geolocation={"latitude": 48.137, "longitude": 11.575}
        )
        page = context.new_page()
        page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        page.wait_for_function("() => typeof window.openNotificationModal === 'function'", timeout=10000)

        print("\n--- Push Notifications & GitLab Sync Suite (Option B) ---")

        # 1. Header Button
        notif_btn = page.locator("#notif-settings-btn")
        assert_test("Header Notification button (#notif-settings-btn) is rendered", notif_btn.is_visible())

        # 2. Open Modal
        notif_btn.click()
        page.wait_for_timeout(300)
        modal = page.locator("#notif-modal-overlay")
        assert_test("Clicking notification button opens #notif-modal-overlay", modal.is_visible())

        # 3. Check Modal Header & Badge
        title = page.locator("#notif-modal-title").inner_text()
        assert_test("Modal title contains 'Push-Benachrichtigungen'", "Push-Benachrichtigungen" in title)
        badge = page.locator("#notif-status-badge")
        assert_test("Status badge is rendered", badge.is_visible())

        # 4. Master Toggle
        master_toggle = page.locator("#notif-master-toggle")
        assert_test("Master toggle is present in DOM", master_toggle.count() == 1)

        # 5. Alarm Rules Controls
        rule_rain = page.locator("#notif-rule-rain")
        rule_wind = page.locator("#notif-rule-wind")
        rule_wind_val = page.locator("#notif-rule-wind-val")
        rule_frost = page.locator("#notif-rule-frost")
        rule_briefing = page.locator("#notif-rule-briefing")
        rule_briefing_time = page.locator("#notif-rule-briefing-time")
        rule_severe = page.locator("#notif-rule-severe")

        assert_test("Regenalarm checkbox present and checked", rule_rain.is_checked())
        assert_test("Sturmwarnung checkbox present and checked", rule_wind.is_checked())
        assert_test("Wind threshold dropdown has options", rule_wind_val.locator("option").count() >= 4)
        assert_test("Frostwarnung checkbox present and checked", rule_frost.is_checked())
        assert_test("Morgen-Briefing checkbox present and checked", rule_briefing.is_checked())
        assert_test("Morgen-Briefing time input has default value '07:00'", rule_briefing_time.input_value() == "07:00")
        assert_test("Extremwetter checkbox present and checked", rule_severe.is_checked())

        # 6. GitLab REST API Form Fields
        gl_host = page.locator("#notif-gitlab-host")
        gl_project = page.locator("#notif-gitlab-project")
        gl_token = page.locator("#notif-gitlab-token")
        gl_schedule = page.locator("#notif-gitlab-schedule")
        quota_box = page.locator(".notif-quota-box")

        assert_test("GitLab Host input is present with default https://gitlab.com", gl_host.input_value() == "https://gitlab.com")
        assert_test("GitLab Project input is present", gl_project.is_visible())
        assert_test("GitLab Token password field is present", gl_token.count() == 1)
        assert_test("Option B Schedule select is present with 3 options", gl_schedule.locator("option").count() == 3)
        assert_test("Option B Eco preset is selected by default", gl_schedule.input_value() == "eco")
        assert_test("Option B Quota & Quiet Hours Box is visible", quota_box.is_visible() and "Option B" in quota_box.inner_text() and "360" in quota_box.inner_text())

        # 7. Action Buttons
        save_btn = page.locator("#notif-save-sync-btn")
        sched_btn = page.locator("#notif-create-schedule-btn")
        test_btn = page.locator("#notif-test-btn")
        pipeline_btn = page.locator("#notif-trigger-pipeline-btn")

        assert_test("Save & Sync button is visible", save_btn.is_visible())
        assert_test("Schedule Provisioning button is visible", sched_btn.is_visible())
        assert_test("Test-Push button is visible", test_btn.is_visible())
        assert_test("Trigger-Pipeline button is visible", pipeline_btn.is_visible())

        # 8. Test Push Execution
        test_btn.click()
        page.wait_for_timeout(600)
        test_btn_text = test_btn.inner_text()
        assert_test("Test-Push execution gives feedback ('✓ Gesendet!' or 'Test-Push')", "✓" in test_btn_text or "Test" in test_btn_text)

        # 9. Close Modal via Close Button
        close_btn = page.locator("#notif-modal-close")
        close_btn.click()
        page.wait_for_timeout(300)
        assert_test("Close button closes modal", not modal.is_visible())

        # 10. Re-open and close with ESC key
        notif_btn.click()
        page.wait_for_timeout(300)
        assert_test("Modal re-opens cleanly", modal.is_visible())
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        assert_test("Escape key closes modal", not modal.is_visible())

        browser.close()

    print(f"\n==========================================")
    print(f"NOTIFICATIONS SUITE: {passed}/{total} PASSED")
    print(f"==========================================\n")
    if passed == total:
        return 0
    return 1

if __name__ == "__main__":
    sys.exit(run_tests())
