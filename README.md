# Best Weather ☀️🏔️🌧️

**Best Weather** ist eine ultra-präzise Wetter-App für das iPhone im Apple iOS 18 Glassmorphic Design, ausgestattet mit einer eigens entwickelten **10-Meter Mikro-Topografie Engine** für den Alpenraum und anspruchsvolles Terrain.

---

## ⚡ Die 10-Meter Mikro-Topografie Engine

In den Alpen entstehen über 80 % der lokalen Wetter- und Temperaturunterschiede auf kleinstem Raum (z. B. Nordwand vs. Südgrat) durch die Mikro-Topografie des Geländes. Best Weather verknüpft makroskalige Atmosphärendaten von Open-Meteo mit hochauflösenden 10- bis 30-Meter-Geländemodellen:

### 1. Temperatur auf 10 Meter genau: Dynamischer Gradient & Inversionen
- **Physikalischer Gradient**: Berechnet den echten vertikalen Temperaturgradienten $\Gamma$ live aus den atmosphärischen Druckschichten (925, 850, 700, 600, 500 hPa):
  $$\Gamma = \frac{T_{\text{upper}} - T_{\text{lower}}}{z_{\text{upper}} - z_{\text{lower}}}$$
- **Inversionserkennung**: Erkennt sofort winterliche Inversionswetterlagen (Kaltluftseen im Tal bei z. B. $-8\text{ °C}$ vs. warme Sonnenlagen am Berg bei $+5\text{ °C}$) und interpoliert die Temperatur metergenau auf die Felshöhe.

### 2. Nordwand vs. Südhang: 10-Meter-Sonneneinstrahlung (Tilt & Azimuth)
- Nutzt die physikalische Global Tilted Irradiance (GTI) unter Berücksichtigung von Hangneigung (`&tilt=` 0 bis 90°) und Hangausrichtung (`&azimuth=` 0° Süd bis 180° Nord).
- Zeigt im Side-by-Side-Vergleich, wie auf nur 30 Metern Distanz zwischen windgeschütztem Südhang (Gefühlt $+10\text{ °C}$) und schattiger Nordwand (Gefühlt $-15\text{ °C}$) massive Temperatur- und Schneestabilitäts-Klüfte entstehen.

### 3. Wind-Beschleunigung am Grat (30-Meter Venturi- & Lee-Effekt)
- Berechnet den **Topographic Position Index (TPI)**:
  $$\text{TPI}_{300\text{m}} = z_0 - \bar{z}_{300\text{m}}$$
- **Positiver TPI (Grat/Gipfel)**: Berechnet den orografischen Venturi-Speed-Up ($+20\%$ bis $+60\%$ Windverstärkung) und bezieht Höhenwinde der freien Atmosphäre (700hPa/600hPa) ein.
- **Negativer TPI (Mulde/Couloir)**: Erkennt Lee-Dämpfung und Kaltluft-Rinnen.

### 4. Bergschatten auf die Minute genau (Horizon Raycasting)
- Berechnet live die exakte Sonnenposition (Elevation & Azimut).
- Führt ein radiales Horizon Raycasting in Richtung des Sonnenstrahls durch: Sobald ein Nachbargipfel einen höheren Hinderniswinkel aufweist als der Sonnenstand, wird der Bergschatten aktiviert (Temperatursturz um $4\text{ bis }8\text{ °C}$).

---

## 📡 Weitere Kern-Features
- **Polarimetrisches Live-Radar**: 100–250 m Auflösung via RainViewer HD API mit interaktiver Leaflet-Karte und Zeitleiste.
- **24-Stunden-Slider**: Stündliche Vorhersage im Apple Weather Horizontalslider mit Niederschlagswahrscheinlichkeit.
- **10-Tage-Trend**: Normalisierte Apple-Weather-Farbgradienten für den täglichen Temperaturbereich.
- **Bento-Detail-Grid**: UV-Index, Windkompass, Sonnenbogen, Feuchtigkeit/Taupunkt, QNH/QFE-Luftdruck, Sichtweite und Mondphase.
- **PWA-fähig**: Kann direkt in Safari über *"Zum Home-Bildschirm"* als vollwertige iPhone-App installiert werden.

---

## 🚀 Lokaler Start

```bash
python3 -m http.server 8080
```
Öffne [http://localhost:8080](http://localhost:8080) im Browser.
