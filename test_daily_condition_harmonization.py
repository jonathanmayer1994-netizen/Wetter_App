import http.server
import socketserver
import threading
import time
import os
import sys
from playwright.sync_api import sync_playwright

def run_harmonization_tests():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    Handler = http.server.SimpleHTTPRequestHandler
    Handler.log_message = lambda *args: None
    
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    
    print(f"🚀 Harmonization Test Server running on http://127.0.0.1:{port}")
    
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
        page = browser.new_page()
        
        page.goto(f"http://127.0.0.1:{port}/index.html")
        page.wait_for_selector("#hero-location-name", timeout=10000)
        
        print("\n--- TEST: Daily Weather Condition & Sunshine Harmonization ---")
        
        test_results = page.evaluate("""() => {
            // Test MicroEngine.computeRepresentativeDailyCondition directly
            const daily = {
                time: ['2026-11-24', '2026-11-25', '2026-11-26'],
                sunrise: ['2026-11-24T07:35:00', '2026-11-25T07:36:00', '2026-11-26T07:37:00'],
                sunset: ['2026-11-24T16:35:00', '2026-11-25T16:34:00', '2026-11-26T16:33:00'],
                daylight_duration: [32400, 32280, 32160], // 9.0h daylight in November
                sunshine_duration: [23400, 19800, 0],    // Heute: 6.5h, Mi: 5.5h, Do: 0.0h
                precipitation_sum: [0.0, 0.0, 0.0],
                snowfall_sum: [0.0, 0.0, 0.0]
            };

            // 72 hours of hourly data
            const hourlyTimes = [];
            const hourlySun = [];
            const hourlyPrecip = [];
            const hourlySnow = [];
            const hourlyCloud = [];
            const hourlyCodes = [];
            const hourlyIsDay = [];

            for (let day = 0; day < 3; day++) {
                for (let h = 0; h < 24; h++) {
                    const padH = String(h).padStart(2, '0');
                    hourlyTimes.push(`2026-11-2${4 + day}T${padH}:00`);
                    const isDay = (h >= 8 && h <= 16) ? 1 : 0;
                    hourlyIsDay.push(isDay);

                    if (day === 0) {
                        // Heute: 6.5h Sonne (von 9h bis 15h sonnig)
                        const sun = (h >= 9 && h <= 15) ? (h === 15 ? 1800 : 3600) : 0;
                        hourlySun.push(sun);
                        hourlyCloud.push(sun > 0 ? 15 : 75);
                        hourlyCodes.push(sun > 0 ? 1 : 3);
                    } else if (day === 1) {
                        // Mi: 5.5h Sonne, Frühnebel um 7-9h
                        const isFog = (h >= 7 && h <= 9);
                        const sun = (h >= 10 && h <= 15) ? (h === 15 ? 1800 : 3600) : 0;
                        hourlySun.push(sun);
                        hourlyCloud.push(isFog ? 95 : (sun > 0 ? 20 : 60));
                        hourlyCodes.push(isFog ? 45 : (sun > 0 ? 1 : 2));
                    } else {
                        // Do: 0.0h Sonne, ganztägig bedeckt
                        hourlySun.push(0);
                        hourlyCloud.push(95);
                        hourlyCodes.push(3);
                    }
                    hourlyPrecip.push(0);
                    hourlySnow.push(0);
                }
            }

            const hourly = {
                time: hourlyTimes,
                sunshine_duration: hourlySun,
                cloud_cover: hourlyCloud,
                weather_code: hourlyCodes,
                precipitation: hourlyPrecip,
                snowfall: hourlySnow,
                is_day: hourlyIsDay
            };

            // Case A: Heute (6.5h Sonne) with curWeather momentary cloud_cover = 85% at 13:00
            const curWeatherCloudy = { cloud_cover: 85, weather_code: 3 };
            const resHeute = window.MicroEngine.computeRepresentativeDailyCondition(0, daily, hourly, true, curWeatherCloudy);

            // Case B: Mittwoch (5.5h Sonne mit Frühnebel)
            const resMi = window.MicroEngine.computeRepresentativeDailyCondition(1, daily, hourly, false, null);

            // Case C: Donnerstag (0.0h Sonne, bedeckt)
            const resDo = window.MicroEngine.computeRepresentativeDailyCondition(2, daily, hourly, false, null);

            return {
                heute: resHeute,
                mi: resMi,
                do: resDo
            };
        }""")
        
        heute = test_results["heute"]
        mi = test_results["mi"]
        do_res = test_results["do"]
        
        # Test 1: Heute (6.5h sun) is NOT 'Bedeckt'
        report("Heute (6.5h Sonne) is NOT labeled as 'Bedeckt'", heute["label"] != "Bedeckt" and heute["icon"] != "☁️",
               f"Got icon={heute['icon']}, label={heute['label']}")
               
        # Test 2: Heute is 'Heiter' or 'Sonnig'
        is_heiter_or_sonnig = "heiter" in heute["label"].lower() or "sonnig" in heute["label"].lower()
        report("Heute is labeled as 'Heiter' or 'Sonnig' ('🌤️' or '☀️')", is_heiter_or_sonnig and heute["icon"] in ["🌤️", "☀️"],
               f"Got icon={heute['icon']}, label={heute['label']}")
               
        # Test 3: Mi (5.5h sun with morning fog) recognizes fog resolution
        report("Mi (5.5h sun + Frühnebel) has Frühnebel or Heiter", "heiter" in mi["label"].lower() or "nebel" in mi["label"].lower(),
               f"Got icon={mi['icon']}, label={mi['label']}")
               
        # Test 4: Donnerstag (0.0h sun) is 'Bedeckt' ☁️
        report("Donnerstag (0.0h Sonne) is labeled as 'Bedeckt' ('☁️')", do_res["label"] == "Bedeckt" and do_res["icon"] == "☁️",
               f"Got icon={do_res['icon']}, label={do_res['label']}")
               
        # Test 5: Distinction between 6.5h and 0.0h
        report("Heute and Donnerstag have DISTINCT conditions (no false duplicate 'Bedeckt')",
               heute["label"] != do_res["label"] and heute["icon"] != do_res["icon"])
               
        browser.close()
        
    print(f"\nSummary: {passed_tests}/{total_tests} Tests Passed.")
    return total_tests == passed_tests

if __name__ == "__main__":
    success = run_harmonization_tests()
    if not success:
        sys.exit(1)
