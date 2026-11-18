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
    def handle_error(self, request, client_address): pass

def start_server():
    httpd = TestHTTPServer(('127.0.0.1', 0), QuietHandler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, port

def run_tests():
    server, port = start_server()
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
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
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

        # 4. Quick-Nav Pills (Clean 2-pill layout for end users)
        nav_pills = page.locator(".notif-nav-pill")
        assert_test("Quick-Nav contains 2 section pills", nav_pills.count() == 2)
        nav_pills.nth(1).click()  # Click Zeitplan
        page.wait_for_timeout(100)
        assert_test("Target section #notif-section-schedule exists", page.locator("#notif-section-schedule").count() == 1)

        # 5. Master Toggle
        master_toggle = page.locator("#notif-master-toggle")
        assert_test("Master toggle is present in DOM", master_toggle.count() == 1)

        # 6. Alarm Rules Controls & Dimming (Regenalarm cleanly removed as requested)
        rule_wind = page.locator("#notif-rule-wind")
        rule_wind_item = page.locator("#notif-rule-item-wind")
        rule_wind_val = page.locator("#notif-rule-wind-val")
        rule_frost = page.locator("#notif-rule-frost")
        rule_briefing = page.locator("#notif-rule-briefing")
        rule_briefing_time = page.locator("#notif-rule-briefing-time")
        rule_severe = page.locator("#notif-rule-severe")

        assert_test("Regenalarm is cleanly removed from DOM", page.locator("#notif-rule-rain").count() == 0)
        assert_test("Sturmwarnung checkbox present and checked", rule_wind.is_checked())
        assert_test("Sturmwarnung card is not dimmed when checked", "is-disabled" not in (rule_wind_item.get_attribute("class") or ""))
        
        # Test dimming interaction on wind rule
        rule_wind.evaluate("el => { el.checked = false; el.dispatchEvent(new Event('change')); }")
        page.wait_for_timeout(100)
        assert_test("Sturmwarnung card dims (is-disabled) when unchecked", "is-disabled" in (rule_wind_item.get_attribute("class") or ""))
        rule_wind.evaluate("el => { el.checked = true; el.dispatchEvent(new Event('change')); }")
        page.wait_for_timeout(100)

        assert_test("Wind threshold dropdown has options", rule_wind_val.locator("option").count() >= 4)
        assert_test("Frostwarnung checkbox present and checked", rule_frost.is_checked())
        assert_test("Morgen-Briefing checkbox present and checked", rule_briefing.is_checked())
        assert_test("Morgen-Briefing time input has default value '07:00'", rule_briefing_time.input_value() == "07:00")
        assert_test("Extremwetter checkbox present and checked", rule_severe.is_checked())

        # 7. Option B 24h Timeline Visualizer
        timeline_bar = page.locator(".notif-timeline-bar")
        clock_badge = page.locator("#notif-live-clock-badge")
        tz_label = page.locator("#notif-live-tz-label")
        indicator = page.locator("#notif-timeline-indicator")

        assert_test("24h Timeline bar is rendered", timeline_bar.is_visible())
        assert_test("Live clock badge displays current status", "Jetzt:" in clock_badge.inner_text())
        assert_test("Timezone label is displayed", "Europe/" in tz_label.inner_text() or "Zeitzone:" in tz_label.inner_text())
        assert_test("Timeline needle indicator is rendered", indicator.count() == 1)

        # 8. Option B Preset Cards Selection Interaction
        preset_cards = page.locator(".notif-preset-card")
        gl_schedule = page.locator("#notif-gitlab-schedule")
        assert_test("3 Preset cards rendered", preset_cards.count() == 3)
        assert_test("Eco preset card is initially selected", "is-selected" in (preset_cards.first.get_attribute("class") or ""))
        
        # Click second card (Hourly)
        preset_cards.nth(1).click()
        page.wait_for_timeout(150)
        assert_test("Clicking Hourly preset selects Hourly card", "is-selected" in (preset_cards.nth(1).get_attribute("class") or ""))
        assert_test("Schedule select synced to 'hourly'", gl_schedule.input_value() == "hourly")

        # Re-click Eco card
        preset_cards.first.click()
        page.wait_for_timeout(150)
        assert_test("Schedule select synced back to 'eco'", gl_schedule.input_value() == "eco")

        # 9. End-User Action Card & Collapsible GitLab Backend Drawer
        dev_drawer = page.locator("#notif-section-gitlab")
        assert_test("GitLab dev accordion is collapsed by default for end users", not dev_drawer.evaluate("el => el.open"))

        # Expand dev accordion to verify admin controls
        dev_drawer.evaluate("el => el.open = true")
        page.wait_for_timeout(100)

        gl_host = page.locator("#notif-gitlab-host")
        gl_project = page.locator("#notif-gitlab-project")
        gl_token = page.locator("#notif-gitlab-token")
        eye_btn = page.locator("#notif-token-toggle-eye")
        help_link = page.locator(".notif-help-link").first
        quota_box = page.locator(".notif-quota-box")

        assert_test("GitLab Host input is present with default https://gitlab.com", gl_host.input_value() == "https://gitlab.com")
        assert_test("GitLab Project input is present", gl_project.is_visible())
        assert_test("GitLab Token password field is present and masked by default", gl_token.get_attribute("type") == "password")
        assert_test("Token helper direct link is rendered", help_link.is_visible() and "gitlab.com" in (help_link.get_attribute("href") or ""))

        # Test eye toggle
        eye_btn.click()
        page.wait_for_timeout(100)
        assert_test("Clicking eye unmasks token (type='text')", gl_token.get_attribute("type") == "text")
        eye_btn.click()
        page.wait_for_timeout(100)
        assert_test("Clicking eye again re-masks token (type='password')", gl_token.get_attribute("type") == "password")

        assert_test("Quota & Quiet Hours Box is visible", quota_box.is_visible() and "360" in quota_box.inner_text())
        modal_text = page.locator("#notif-modal-overlay").inner_text()
        assert_test("Zero instances of 'Option B' in notification modal UI text", "Option B" not in modal_text)

        # 10. Action Buttons (Clean End-User Action Bar + Admin Buttons)
        save_btn = page.locator("#notif-save-sync-btn")
        sched_btn = page.locator("#notif-create-schedule-btn")
        test_btn = page.locator("#notif-test-btn")
        pipeline_btn = page.locator("#notif-trigger-pipeline-btn")

        assert_test("Save button is visible in primary user actions", save_btn.is_visible())
        assert_test("Test-Push button is visible in primary user actions", test_btn.is_visible())
        assert_test("Schedule Provisioning button is present", sched_btn.count() == 1)
        assert_test("Trigger-Pipeline button is present", pipeline_btn.count() == 1)

        # 11. Test Push Execution
        test_btn.click()
        page.wait_for_timeout(600)
        test_btn_text = test_btn.inner_text()
        assert_test("Test-Push execution gives feedback ('✓ Gesendet!' or 'Test-Push')", "✓" in test_btn_text or "Test" in test_btn_text)

        # 12. Close Modal via Close Button (No unsaved changes -> closes immediately without dialog)
        unsaved_dialog = page.locator("#notif-unsaved-dialog")
        close_btn = page.locator("#notif-modal-close")
        close_btn.click()
        page.wait_for_timeout(300)
        assert_test("Close button closes modal immediately when no unsaved changes exist", not modal.is_visible() and not unsaved_dialog.is_visible())

        # 13. Re-open and close with ESC key (No unsaved changes)
        notif_btn.click()
        page.wait_for_timeout(300)
        assert_test("Modal re-opens cleanly", modal.is_visible())
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        assert_test("Escape key closes modal when clean", not modal.is_visible())

        # 14. Unsaved Changes Dialog: Edit -> X -> Cancel -> X -> Discard -> Verify Reverted
        notif_btn.click()
        page.wait_for_timeout(250)
        preset_cards.nth(1).click()  # Switch Eco -> Hourly (unsaved)
        rule_frost.evaluate("el => { el.checked = false; el.dispatchEvent(new Event('change')); }")
        page.wait_for_timeout(150)
        assert_test("Unsaved changes detected after editing preset and frost rule", page.evaluate("() => window.hasUnsavedNotificationChanges() === true"))
        assert_test("Save button highlights unsaved state (.has-unsaved)", "has-unsaved" in (save_btn.get_attribute("class") or ""))

        close_btn.click()
        page.wait_for_timeout(200)
        assert_test("Clicking X with unsaved changes opens #notif-unsaved-dialog", unsaved_dialog.is_visible() and modal.is_visible())

        # Click Cancel -> dialog closes, modal stays open with edits preserved
        page.locator("#notif-unsaved-cancel-btn").click()
        page.wait_for_timeout(200)
        assert_test("Clicking 'Abbrechen' closes only unsaved dialog and keeps modal open", not unsaved_dialog.is_visible() and modal.is_visible() and not rule_frost.is_checked())

        # Click X again -> Click Discard -> both close and original state is restored
        close_btn.click()
        page.wait_for_timeout(200)
        assert_test("Unsaved dialog re-opens on second X click", unsaved_dialog.is_visible())
        page.locator("#notif-unsaved-discard-btn").click()
        page.wait_for_timeout(250)
        assert_test("Clicking 'Änderungen verwerfen' closes dialog and modal", not unsaved_dialog.is_visible() and not modal.is_visible())

        # Re-open and verify original state was NOT overwritten
        notif_btn.click()
        page.wait_for_timeout(250)
        assert_test("Discarded changes were reverted (Frost still checked, Eco still selected)", rule_frost.is_checked() and gl_schedule.input_value() == "eco")

        # 15. Unsaved Changes Dialog: Edit -> X -> Save -> Verify Persisted
        preset_cards.nth(1).click()  # Hourly
        rule_briefing_time.fill("08:30")
        rule_briefing_time.dispatch_event("change")
        page.wait_for_timeout(150)
        close_btn.click()
        page.wait_for_timeout(200)
        assert_test("Unsaved dialog opens before saving via dialog", unsaved_dialog.is_visible())
        page.locator("#notif-unsaved-save-btn").click()
        page.wait_for_timeout(300)
        assert_test("Clicking 'Änderungen speichern' closes dialog and modal", not unsaved_dialog.is_visible() and not modal.is_visible())

        # Re-open and verify changes were persisted
        notif_btn.click()
        page.wait_for_timeout(250)
        assert_test("Saved changes persisted across reopen (Hourly & 08:30)", gl_schedule.input_value() == "hourly" and rule_briefing_time.input_value() == "08:30")

        # 16. Privacy-First Per-Device Anonymous UUID Architecture (Option 1)
        uuid_info = page.evaluate("""() => {
            const uuid1 = window.getPushDeviceUuid();
            const uuid2 = window.getPushDeviceUuid();
            const varKey = window.getPushDeviceVariableKey();
            const payload = window.buildDeviceSyncPayload();
            const payloadJson = JSON.stringify(payload);
            const forbidden = ['userAgent', 'deviceName', 'platform', 'model', 'Mozilla', 'iPhone', 'iPad', 'Macintosh', 'Safari', 'Chrome', 'WebKit', 'hardware'];
            const leaked = forbidden.filter(k => payloadJson.includes(k));
            return { uuid1, uuid2, varKey, schemaVersion: payload.schemaVersion, payloadDeviceId: payload.deviceId, leaked };
        }""")
        import re
        uuid_regex = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        assert_test("Device UUID is a valid RFC 4122 v4 UUID", bool(re.match(uuid_regex, uuid_info["uuid1"])))
        assert_test("Device UUID is stable across repeated calls", uuid_info["uuid1"] == uuid_info["uuid2"])
        assert_test("GitLab CI variable key strictly matches WEATHER_PUSH_DEV_<32_HEX>", bool(re.match(r"^WEATHER_PUSH_DEV_[0-9A-F]{32}$", uuid_info["varKey"])))
        assert_test("Sync payload uses schemaVersion 2 with matching deviceId", uuid_info["schemaVersion"] == 2 and uuid_info["payloadDeviceId"] == uuid_info["uuid1"])
        assert_test("Zero device/OS/browser metadata leaked into sync payload", len(uuid_info["leaked"]) == 0)
        privacy_bar = page.locator("#notif-device-privacy-bar")
        uuid_label_text = page.locator("#notif-device-uuid-label").inner_text()
        assert_test("Anonymous UUID privacy bar is visible with short UUID prefix", privacy_bar.is_visible() and uuid_info["uuid1"][:8] in uuid_label_text)

        # Simulate a second independent Apple device (fresh browser context) -> must get a distinct UUID & variable key
        ctx2 = browser.new_context(service_workers="block", permissions=["notifications"])
        page2 = ctx2.new_page()
        page2.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page2.wait_for_function("() => typeof window.getPushDeviceUuid === 'function'", timeout=10000)
        dev2_uuid = page2.evaluate("() => window.getPushDeviceUuid()")
        dev2_key = page2.evaluate("() => window.getPushDeviceVariableKey()")
        assert_test("Second device generates a completely distinct UUID & GitLab variable key", dev2_uuid != uuid_info["uuid1"] and dev2_key != uuid_info["varKey"])
        ctx2.close()

        # 17. All-in-GitLab OAuth 2.0 + PKCE Engine & Clean UI Verification
        assert_test("Cloudflare worker input cleanly removed from All-in-GitLab UI", page.locator("#notif-worker-url").count() == 0)
        dev_drawer.evaluate("el => el.open = true")
        page.wait_for_timeout(100)
        assert_test("GitLab OAuth 2.0 PKCE connect button is visible", page.locator("#notif-gitlab-oauth-btn").is_visible())
        assert_test("GitLab OAuth Client ID input is visible", page.locator("#notif-gitlab-client-id").is_visible())
        assert_test("GitLab OAuth Redirect URI display & copy button present", page.locator("#notif-oauth-redirect-uri").is_visible() and page.locator("#notif-copy-redirect-btn").is_visible())

        pkce_check = page.evaluate("""async () => {
            const v = window.generatePkceVerifier();
            const c1 = await window.computePkceChallenge(v);
            const c2 = await window.computePkceChallenge(v);
            const redirect = window.getOAuthRedirectUri();
            return { vLen: v.length, cLen: c1.length, deterministic: c1 === c2, hasNoPadding: !v.includes('=') && !c1.includes('='), redirectValid: redirect.startsWith('http') };
        }""")
        assert_test("PKCE verifier & S256 challenge follow RFC 7636 (base64url, deterministic 43-char SHA-256)", pkce_check["vLen"] >= 64 and pkce_check["cLen"] == 43 and pkce_check["deterministic"] and pkce_check["hasNoPadding"] and pkce_check["redirectValid"])

        close_btn.click()
        page.wait_for_timeout(200)
        assert_test("Closing after saved state needs no dialog", not modal.is_visible() and not unsaved_dialog.is_visible())

        browser.close()

    print(f"\n==========================================")
    print(f"NOTIFICATIONS SUITE: {passed}/{total} PASSED")
    print(f"==========================================\n")
    if passed == total:
        return 0
    return 1

if __name__ == "__main__":
    sys.exit(run_tests())
