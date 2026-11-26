import http.server
import json
import os
import threading
import time
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright


def run_overview_expert_suite():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"Overview Expert Test Server running on http://127.0.0.1:{port}")

    total = 0
    passed = 0

    def report(name, ok, detail=""):
        nonlocal total, passed
        total += 1
        if ok:
            passed += 1
            print(f"  ✓ {name}")
        else:
            print(f"  ✗ {name}: {detail}")

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    midnight = datetime(now.year, now.month, now.day, 0, 0, 0)

    # 12 past hours + 240 forecast hours (local ISO strings as returned by Open-Meteo timezone=auto)
    past_start = midnight - timedelta(hours=12)
    hourly_times = [(past_start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(12 + 240)]
    total_h = len(hourly_times)
    hourly_temp = [round(4.0 + 4.0 * ((i % 24) / 24.0), 1) for i in range(total_h)]
    hourly_precip = [0.2 if (i % 24) in (14, 15) else 0.0 for i in range(total_h)]
    hourly_pressure = [1015.0 - (1.2 if i >= 12 else 0.0) for i in range(total_h)]
    # Create explicit -1.2 hPa/h drop (-3.6 hPa/3h) across the current-hour window
    cur_h_pos = 12 + now.hour
    for k in range(max(0, cur_h_pos - 5), min(total_h, cur_h_pos + 3)):
        hourly_pressure[k] = round(1018.0 - (k - max(0, cur_h_pos - 5)) * 1.2, 1)

    m15_start = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0) - timedelta(hours=1)
    m15_times = [(m15_start + timedelta(minutes=15 * i)).strftime("%Y-%m-%dT%H:%M") for i in range(28)]
    m15_temp = [round(1.5 + 0.2 * i, 2) for i in range(28)]
    m15_precip = [1.4 if 4 <= i <= 8 else 0.0 for i in range(28)]

    daily_times = [(midnight + timedelta(days=d)).strftime("%Y-%m-%d") for d in range(10)]

    captured_urls = []

    def make_forecast_payload(url):
        if "models=" in url:
            # Multi-model endpoint
            mm_times = [(midnight + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(240)]
            return {
                "latitude": 47.421,
                "longitude": 10.986,
                "elevation": 2962,
                "utc_offset_seconds": 3600,
                "timezone": "Europe/Berlin",
                "hourly": {
                    "time": mm_times,
                    "temperature_2m_icon_eu": [(-4.0 + 0.02 * i) if i < 120 else None for i in range(240)],
                    "precipitation_icon_eu": [0.1 if i < 120 else None for i in range(240)],
                    "wind_speed_10m_icon_eu": [22.0 if i < 120 else None for i in range(240)],
                    "temperature_2m_ecmwf_ifs025": [-4.5 + 0.03 * i for i in range(240)],
                    "precipitation_ecmwf_ifs025": [0.2 if i % 12 == 0 else 0.0 for i in range(240)],
                    "wind_speed_10m_ecmwf_ifs025": [25.0 for _ in range(240)],
                    "temperature_2m_gfs_seamless": [-3.8 + 0.025 * i for i in range(240)],
                    "precipitation_gfs_seamless": [0.0 for _ in range(240)],
                    "wind_speed_10m_gfs_seamless": [20.0 for _ in range(240)],
                }
            }
        # Primary Open-Meteo multi-layer forecast
        return {
            "latitude": 47.421,
            "longitude": 10.986,
            "elevation": 2962,
            "utc_offset_seconds": 3600,
            "timezone": "Europe/Berlin",
            "current": {
                "time": now.strftime("%Y-%m-%dT%H:%M"),
                "temperature_2m": 0.0,
                "relative_humidity_2m": 82,
                "apparent_temperature": -4.0,
                "is_day": 1,
                "precipitation": 0.0,
                "rain": 0.0,
                "showers": 0.0,
                "snowfall": 0.0,
                "weather_code": 2,
                "cloud_cover": 45,
                "pressure_msl": 1013.2,
                "surface_pressure": 710.0,
                "wind_speed_10m": 18,
                "wind_direction_10m": 225,
                "wind_gusts_10m": 32,
                "uv_index": 0.0
            },
            "hourly": {
                "time": hourly_times,
                "temperature_2m": hourly_temp,
                "relative_humidity_2m": [82] * total_h,
                "dew_point_2m": [-2.7] * total_h,
                "apparent_temperature": [-4.0] * total_h,
                "is_day": [1 if 7 <= (i % 24) <= 17 else 0 for i in range(total_h)],
                "precipitation_probability": [20] * total_h,
                "precipitation": hourly_precip,
                "weather_code": [2] * total_h,
                "pressure_msl": hourly_pressure,
                "surface_pressure": [710.0] * total_h,
                "visibility": [15000] * total_h,
                "wind_speed_10m": [18] * total_h,
                "wind_direction_10m": [225] * total_h,
                "wind_gusts_10m": [32] * total_h,
                "uv_index": [0.0] * total_h,
                "cloud_cover": [45] * total_h,
                "cape": [0] * total_h,
                "snowfall": [0.1 if hourly_precip[i] > 0 else 0.0 for i in range(total_h)],
                "snow_depth": [0.8] * total_h,
                "freezing_level_height": [2100] * total_h,
                "shortwave_radiation": [200] * total_h,
                "global_tilted_irradiance": [220] * total_h,
                "sunshine_duration": [1800] * total_h,
            },
            "minutely_15": {
                "time": m15_times,
                "temperature_2m": m15_temp,
                "precipitation": m15_precip,
                "weather_code": [61 if p > 0.2 else 2 for p in m15_precip],
                "wind_speed_10m": [18] * len(m15_times),
                "wind_gusts_10m": [30] * len(m15_times),
            },
            "daily": {
                "time": daily_times,
                "weather_code": [2] * 10,
                "temperature_2m_max": [6.0] * 10,
                "temperature_2m_min": [-2.0] * 10,
                "apparent_temperature_max": [3.0] * 10,
                "apparent_temperature_min": [-6.0] * 10,
                "sunrise": [f"{d}T07:35" for d in daily_times],
                "sunset": [f"{d}T16:35" for d in daily_times],
                "uv_index_max": [2.0] * 10,
                "precipitation_sum": [0.4] * 10,
                "precipitation_probability_max": [30] * 10,
                "precipitation_hours": [2] * 10,
                "snowfall_sum": [0.2] * 10,
                "sunshine_duration": [18000] * 10,
                "daylight_duration": [32400] * 10,
                "wind_speed_10m_max": [24] * 10,
                "wind_gusts_10m_max": [38] * 10,
            }
        }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        def handle_route(route):
            url = route.request.url
            if "api.open-meteo.com/v1/forecast" in url:
                captured_urls.append(url)
                payload = make_forecast_payload(url)
                route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
            elif "api.open-meteo.com/v1/elevation" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"elevation": [2962, 2940, 2900, 2910, 2890]}))
            elif "air-quality-api.open-meteo.com" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "hourly": {"time": hourly_times[:24], "uv_index": [0.5]*24, "uv_index_clear_sky": [1.0]*24, "pm10": [8]*24, "pm2_5": [5]*24, "ozone": [70]*24}
                }))
            elif "api.rainviewer.com" in url or "brightsky.dev" in url or "dataset.api.hub.geosphere.at" in url or "lawis.at" in url or "avalanche.report" in url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({}))
            else:
                route.continue_()

        page.route("**/*", handle_route)
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="domcontentloaded")
        page.wait_for_function("typeof window.loadLocation === 'function'", timeout=10000)
        captured_urls.clear()

        res = page.evaluate("""async () => {
            const loc = { name: 'Zugspitze', lat: 47.4212, lon: 10.9864, elevation: 2962, country: 'Deutschland', isMountain: true };
            await window.loadLocation(loc, { forceRefresh: true });
            const ov = await import('./features/overview.js');
            const bs = await import('./features/bentoSheets.js');
            const st = await import('./core/state.js');
            const me = await import('./microEngine.js');

            // Ensure meteogram is visible & rendered
            ov.renderEnsembleMeteogram('temp');

            // Check Hero vs Now consistency and minutely_15 nowcast item
            const heroTemp = document.getElementById('hero-current-temp')?.innerText;
            const nowHourlyTemp = document.querySelector('.hourly-item.current-now .hourly-temp')?.innerText;
            const hasMin15PrecipCard = Array.from(document.querySelectorAll('.hourly-item.next5m .hourly-pop')).some(el => (el.innerText || '').includes('1.'));

            // Check SVG vs removed canvas
            const hasDeadCanvas = Boolean(document.getElementById('ensemble-meteogram-canvas'));
            const metTitle = document.getElementById('meteogram-title')?.innerText || '';
            const polylines = Array.from(document.querySelectorAll('#ensemble-meteogram-svg polyline')).map(pl => {
              const pts = (pl.getAttribute('points') || '').trim().split(/\\s+/);
              return { color: pl.getAttribute('stroke'), count: pts.length, lastX: pts[pts.length - 1]?.split(',')[0] };
            });

            // Check Day 6..9 weightedHourlyTemp is NOT frozen on static Day 0 temperature
            const mm = st.state.multiModel;
            const day1Temp = mm?.weightedConsensus?.hourlyTemp?.[24];
            const day8Temp = mm?.weightedConsensus?.hourlyTemp?.[190];

            // Test 0 C & UV 0 & Barometer -3.6hPa/3h in Bento grid + sheets
            st.state.weatherData.current.temperature_2m = 0.0;
            st.state.weatherData.current.relative_humidity_2m = 82;
            st.state.weatherData.current.uv_index = 0.0;
            st.state.weatherData.current.wind_direction_10m = 225;
            st.state.weatherData.current.pressure_msl = 1013.2;
            ov.renderBentoGrid(st.state.weatherData.current, st.state.weatherData.daily, st.state.weatherData.hourly);

            const uvDesc = document.getElementById('uv-index-desc')?.innerText;
            const windDirTxt = document.getElementById('wind-direction-text')?.innerText;
            const dewSub = document.getElementById('dew-point-sub')?.innerText;
            const condHint = document.getElementById('condensation-risk-hint')?.innerText;
            const pressTrend = document.getElementById('pressure-trend')?.innerText;
            const sunCx = document.getElementById('sun-arc-point')?.getAttribute('cx');

            // Check sheets
            bs.openBentoSheet('humidity');
            const humSheetHtml = document.getElementById('bdm-body')?.innerHTML || '';
            bs.openBentoSheet('pressure');
            const pressSheetHtml = document.getElementById('bdm-body')?.innerHTML || '';
            bs.openBentoSheet('sun');
            const sunSheetHtml = document.getElementById('bdm-body')?.innerHTML || '';
            bs.closeBentoSheet();

            // Check daily resync after nowcast adjustment
            const todayKey = st.state.lastWeatherDayKey;
            const dIdx = st.state.weatherData.daily.time.findIndex(t => t.startsWith(todayKey));
            const hTodaySum = st.state.weatherData.hourly.time.reduce((acc, ts, idx) => {
              return ts.startsWith(todayKey) ? acc + (st.state.weatherData.hourly.precipitation[idx] || 0) : acc;
            }, 0);
            const dailyTodaySum = st.state.weatherData.daily.precipitation_sum[dIdx];

            return {
              heroTemp,
              nowHourlyTemp,
              hasMin15PrecipCard,
              sourceBadge: document.getElementById('hero-source-badge')?.innerText || '',
              hasDeadCanvas,
              metTitle,
              polylines,
              day1Temp,
              day8Temp,
              hasMinutely15: Boolean(st.state.weatherData?.minutely_15?.time?.length),
              hasEmbeddedHist: Boolean(st.state.microData?.modelHistory?.time?.length >= 6),
              uvDesc,
              windDirTxt,
              dewSub,
              condHint,
              pressTrend,
              sunCx,
              humSheetHasZeroTempBug: humSheetHtml.includes('10.0°C'),
              humSheetHasZeroTemp: humSheetHtml.includes('0.0°C'),
              pressSheetHasFall: pressSheetHtml.includes('Stark fallend'),
              sunSheetHardcodedSouth: sunSheetHtml.includes('Volle Süd-Besonnung'),
              dailySyncDiff: Math.abs((Math.round(hTodaySum * 10) / 10) - dailyTodaySum)
            };
        }""")

        primary_urls = [u for u in captured_urls if "models=" not in u]
        mm_urls = [u for u in captured_urls if "models=" in u]
        extra_hist_urls = [u for u in captured_urls if "forecast_hours=1" in u]

        report("Zero unhandled JS page errors", len(page_errors) == 0, str(page_errors))
        report("Primary fetch requests minutely_15 & past_hours=12 & timezone=auto",
               any("minutely_15=" in u and "past_hours=12" in u and "timezone=auto" in u for u in primary_urls),
               str(primary_urls))
        report("No redundant fetchModelHistory API call fired", len(extra_hist_urls) == 0, f"Found {len(extra_hist_urls)}")
        report("Multi-model fetch passes elevation=2962, timezone=auto & forecast_days=10",
               any("elevation=2962" in u and "timezone=auto" in u and "forecast_days=10" in u for u in mm_urls),
               str(mm_urls))
        report("Hero temp matches 'Jetzt' hourly item",
               res["heroTemp"] is not None and f"{res['heroTemp']}°" == res["nowHourlyTemp"],
               f"hero={res['heroTemp']} vs now={res['nowHourlyTemp']}")
        report("#hero-source-badge populated", len(res["sourceBadge"]) > 3, res["sourceBadge"])
        report("minutely_15 preserved on weatherData", res["hasMinutely15"], str(res["hasMinutely15"]))
        report("5-/15-Min nowcast reflects live minutely_15 precipitation", res["hasMin15PrecipCard"], str(res["hasMin15PrecipCard"]))
        report("Dead hidden canvas #ensemble-meteogram-canvas removed", not res["hasDeadCanvas"], str(res["hasDeadCanvas"]))
        report("Meteogram dynamically shows 10-TAGE horizon", "10-TAGE" in res["metTitle"], res["metTitle"])
        report("ICON polyline ends honestly around Day 5 instead of fake 10d waves",
               len(res["polylines"]) == 3 and float(res["polylines"][2]["lastX"]) < 500 and float(res["polylines"][0]["lastX"]) > 850,
               str(res["polylines"]))
        report("Weighted consensus Day 8 is not frozen at Day 1 temperature",
               res["day8Temp"] is not None and res["day1Temp"] is not None and res["day8Temp"] != res["day1Temp"],
               f"day1={res['day1Temp']}, day8={res['day8Temp']}")
        report("Bento UV 0 updates #uv-index-desc to 'Keine UV (Nacht)'", res["uvDesc"] == "Keine UV (Nacht)", res["uvDesc"])
        report("Bento wind shows compass + degrees 'SW (225°)'", res["windDirTxt"] == "SW (225°)", res["windDirTxt"])
        report("Bento dewpoint & condensation spread dynamic", "°C" in res["dewSub"] and "Spread" in res["condHint"], f"{res['dewSub']} / {res['condHint']}")
        report("Bento pressure trend computes 'Stark fallend (-3.6 hPa/3h)'", "Stark fallend" in res["pressTrend"] and "-3.6" in res["pressTrend"], res["pressTrend"])
        report("Humidity detail sheet handles 0.0°C cleanly (no || 10 bug)",
               res["humSheetHasZeroTemp"] and not res["humSheetHasZeroTempBug"],
               f"has0={res['humSheetHasZeroTemp']}, has10Bug={res['humSheetHasZeroTempBug']}")
        report("Pressure detail sheet shows 'Stark fallend'", res["pressSheetHasFall"], str(res["pressSheetHasFall"]))
        report("Sun detail sheet uses dynamic terrain aspect (no hardcoded string)", not res["sunSheetHardcodedSouth"], str(res["sunSheetHardcodedSouth"]))
        report("Daily precipitation_sum re-synced with hourly sum", res["dailySyncDiff"] <= 0.11, f"diff={res['dailySyncDiff']}")

        browser.close()

    print(f"\nSummary: {passed}/{total} Tests Passed.")
    if passed < total:
        raise SystemExit(1)


if __name__ == "__main__":
    run_overview_expert_suite()
