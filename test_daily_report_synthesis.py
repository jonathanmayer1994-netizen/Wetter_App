#!/usr/bin/env python3
"""
Test Suite: Intelligent Daily Report Synthesis Engine (buildDailyReport)
Tests alpine snow line logic, sunshine distribution, and extreme hazard highlights via Chromium.
"""

import sys
import subprocess
import time
from playwright.sync_api import sync_playwright

def run_tests():
    port = 52915
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
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")

            print("\n--- TEST SUITE: Intelligent Daily Report Synthesis Engine ---")

            eval_res = page.evaluate("""async () => {
                const { buildDailyReport } = await import('./core/dailyReportEngine.js');
                const results = [];

                // TEST 1: Wintertag im Tal (Durach 714m, 0°C auf 1.400m -> Schneefallgrenze 1.150m)
                const devTal = { location: { name: 'Durach', elevation: 714 } };
                const weatherTal = {
                    current: { weather_code: 3, temperature_2m: 3 },
                    daily: {
                        weather_code: [3],
                        temperature_2m_max: [5],
                        temperature_2m_min: [1],
                        precipitation_probability_max: [80],
                        precipitation_sum: [8.5],
                        sunshine_duration: [1800],
                        wind_gusts_10m_max: [25]
                    },
                    hourly: {
                        cloud_cover: new Array(24).fill(90),
                        freezing_level_height: new Array(24).fill(1400),
                        weather_code: new Array(24).fill(3)
                    }
                };
                const rep1 = buildDailyReport(devTal, weatherTal, { dateString: '2026-11-20' });
                results.push({ name: 'Title matches format', pass: rep1.title === '📊 Täglicher Bericht — Durach' });
                results.push({ name: 'Identifies rain in valley', pass: rep1.body.includes('Regen im Tal') });
                results.push({ name: 'Calculates snow line 250m below freezing level (1.150 m)', pass: rep1.body.includes('1.150 m') });
                results.push({ name: 'Reports low sunshine', pass: rep1.body.includes('Kaum Sonne') });

                // TEST 2: Wintertag an der Schneefallgrenze (Oberstdorf 813m, Schneefallgrenze ~800m)
                const devGrenz = { location: { name: 'Oberstdorf', elevation: 813 } };
                const weatherGrenz = {
                    current: { weather_code: 68, temperature_2m: 1.5 },
                    daily: {
                        weather_code: [68],
                        temperature_2m_max: [2],
                        temperature_2m_min: [-1],
                        precipitation_probability_max: [90],
                        precipitation_sum: [12],
                        sunshine_duration: [0]
                    },
                    hourly: {
                        cloud_cover: new Array(24).fill(100),
                        freezing_level_height: new Array(24).fill(1050),
                        weather_code: new Array(24).fill(68)
                    }
                };
                const rep2 = buildDailyReport(devGrenz, weatherGrenz, { dateString: '2026-11-20' });
                results.push({ name: 'Flags transition/slush at location', pass: rep2.body.includes('Vor Ort Schneeregen / nass') });

                // TEST 3: Wintertag am Berg (Nebelhorn 2.224m)
                const devBerg = { location: { name: 'Nebelhorn', elevation: 2224 } };
                const weatherBerg = {
                    current: { weather_code: 73, temperature_2m: -6 },
                    daily: {
                        weather_code: [73],
                        temperature_2m_max: [-3],
                        temperature_2m_min: [-8],
                        precipitation_probability_max: [95],
                        precipitation_sum: [15],
                        snowfall_sum: [8.5],
                        sunshine_duration: [7200],
                        wind_gusts_10m_max: [65]
                    },
                    hourly: {
                        cloud_cover: new Array(24).fill(70),
                        freezing_level_height: new Array(24).fill(1100),
                        weather_code: new Array(24).fill(73)
                    }
                };
                const rep3 = buildDailyReport(devBerg, weatherBerg, { dateString: '2026-11-20' });
                results.push({ name: 'Identifies full snowfall on mountain', pass: rep3.body.includes('Schneefall vor Ort') });
                results.push({ name: 'Shows snowfall amount', pass: rep3.body.includes('8 cm Neuschnee') || rep3.body.includes('9 cm Neuschnee') });
                results.push({ name: 'Includes storm gust warning', pass: rep3.body.includes('Böen bis 65 km/h') });

                // TEST 4: Sommertag mit Hitze & Nachmittagsgewitter (Bozen 262m)
                const devSommer = { location: { name: 'Bozen', elevation: 262 } };
                const weatherSommer = {
                    current: { weather_code: 1, temperature_2m: 22 },
                    daily: {
                        weather_code: [1],
                        temperature_2m_max: [34],
                        temperature_2m_min: [19],
                        precipitation_probability_max: [65],
                        precipitation_sum: [5],
                        sunshine_duration: [32400],
                        uv_index_max: [8.5],
                        wind_gusts_10m_max: [40]
                    },
                    hourly: {
                        cloud_cover: [20, 20, 20, 20, 20, 20, 10, 10, 10, 10, 15, 20, 25, 30, 40, 60, 80, 80, 50, 40, 20, 20, 20, 20],
                        freezing_level_height: new Array(24).fill(4200),
                        weather_code: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 95, 95, 2, 1, 1, 1, 1, 1, 1]
                    }
                };
                const rep4 = buildDailyReport(devSommer, weatherSommer, { dateString: '2026-07-15' });
                results.push({ name: 'Flags extreme summer heat and UV', pass: rep4.body.includes('Hitze bis 34°C (UV 9)') });
                results.push({ name: 'Detects afternoon thunderstorm & hail risk', pass: rep4.body.includes('Gewitter- & Hagelrisiko') });
                results.push({ name: 'Detects morning sun before convective clouds', pass: rep4.body.includes('vor allem vormittags') || rep4.body.includes('9h Sonne') });

                return results;
            }""")

            for item in eval_res:
                assert_test(item["name"], item["pass"])

            browser.close()

    finally:
        server.terminate()

    print(f"\n==========================================")
    print(f"DAILY REPORT SYNTHESIS: {passed}/{passed + failed} PASSED")
    print(f"==========================================")
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
