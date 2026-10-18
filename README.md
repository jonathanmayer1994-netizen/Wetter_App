# Best Weather ☀️🏔️🌧️

**Best Weather** ist eine ultra-präzise, moderne Wetter-App für **iPhone, iPad und Desktop** im Apple iOS 18 Glassmorphic Design, ausgestattet mit einer eigens entwickelten **10-Meter Mikro-Topografie Engine** für den gesamten Alpenraum und anspruchsvolles Gelände.

---

## 🌟 Neu strukturiertes Menü- & Tab-System

Die Benutzeroberfläche ist dynamisch für **Desktop (Wide Dashboard), iPad (2-3 Spalten Bento) und iPhone (Touch Tab-Bar)** optimiert und in 5 spezialisierte Menü-Tabs gegliedert:

### 1. 🌤️ Übersicht (Wetterbericht & 10-Tage-Details)
- **Adaptiver Hero-Bereich**: Erkennt automatisch den Unterschied zwischen Stadt/Flachland und hochalpinem Berggipfel.
- **24-Stunden-Slider**: Apple-Weather-Stundenvorhersage mit Niederschlagsrisiko und Wind.
- **Interaktiver 10-Tage-Trend**: Jeder Tag lässt sich anklicken und öffnet ein detailliertes Tages-Dashboard:
  - Tagesabschnitte (Morgens, Mittags, Abends, Nachts) mit Temperatur & Regenwahrscheinlichkeit
  - Max. Windböen & Windrichtung
  - UV-Index Maximum
  - Exakte Sonnenauf- und -untergangszeiten
- **Apple Bento-Grid**: UV-Index, drehbarer Windkompass, Sonnenbogen, Niederschlagssumme, Taupunkt/Kondensation, Stations- und Meeresluftdruck (QNH/QFE).

### 2. 🏔️ Berg & Höhe (Alpine Topo & Mikroklima)
- **Vertikales Höhenprofil (Tal vs. Berg)**:
  - Grafische Aufdröselung von **Temperatur, Wind und Niederschlagsart (Schnee vs. Regen)** über 4 Höhenstufen: Talboden, Mittelstation, Gipfel und freie Atmosphäre.
  - **Interaktiver 24h-Zeitslider**: Mit dem Schieberegler lässt sich das Höhenprofil zu jeder Stunde des Tages abrufen!
- **Wand-Ausrichtung pro Berg anpassbar**:
  - Wähle für jeden Berg die genaue Wand: **Südwand (45°), Nordwand (75° Steilwand), Ostflanke (50°), Westflanke (50°) oder Automatische 10m-Terrain-Erkennung**.
  - Berechnet live die gefühlte Temperatur, Sonneneinstrahlung (GTI in W/m²), Schneebeschaffenheit (Pulver vs. Firn/Sulz) und Windanströmung (Luv vs. Lee-Rotor-Gefahr).
- **Schneefallgrenze & Inversions-Erkennung**: Zeigt sofort an, ob eine Inversion vorliegt (oben wärmer und sonnig, unten Kaltluftsee/Nebel).

### 3. 🗺️ Live-Karte & Radar
- Vollwertige, interaktive Karte mit **Standort-Marker** und genauer Position.
- **Dynamische Layer-Umschaltung**:
  - 🌧️ Polarimetrisches HD-Niederschlagsradar (RainViewer HD mit Play/Pause und Zeitleiste)
  - 🏔️ Topografie-Karte (OpenTopoMap für Höhenlinien & Bergmassive)
  - 🛰️ Satellitenbild (ESRI World Imagery)
- **Klick-Erkennung**: Ein Klick auf einen beliebigen Berg oder Punkt auf der Karte lädt sofort die Wetterdaten für diese exakte Koordinate.

### 4. ⭐ Favoriten & Exakte Suche
- **Exakte Ortssuche**: Über die Geocoding-API werden eingegebene Städte, Berge und Alpengipfel mit exakter Höhe und Koordinaten verknüpft.
- **Echte Favoritenverwaltung**: Speichere deine Hausberge und Lieblingsorte mit einem Klick auf den Stern (★).
- Schneller Wechsel zwischen gespeicherten Orten inklusive Löschfunktion.

### 5. 📡 Alpen-Messnetze & Geo-Routing
Automatische Erkennung und Zuschaltung der spezialisierten regionalen Hochgebirgs-APIs je nach GPS-Position:
- **DWD OpenData & LfU Bayern**: MOSMIX-L Punkteraster mit 5.400 Stationen und RADOLAN Niederschlagsradar.
- **LAWIS Public API & LWD Bayern**: Hunderte automatische Grat- und Gipfelstationen (Nebelhorn, Fellhorn, Zugspitzplatt, Tirol) mit Schneehöhe, Böen und Lawinenlageberichten.
- **Open Data Hub Südtirol**: Offizieller Bergwetterbericht in 1.000m-Stufen bis 4.000 m (Dolomiten, Ortler) und Südalpen-Radare.
- **SLF IMIS Schweiz & Météo-France**: 180+ IMIS-Hochgebirgsstationen (Wallis, Zermatt) und 1,1-km AROME-HD-Modell.

---

## 🚀 Lokale Vorschau

```bash
python3 -m http.server 8080
```
Öffne [http://localhost:8080/index.html](http://localhost:8080/index.html) im Browser.
