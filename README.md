# Best Weather ☀️🏔️🌧️

**Best Weather** ist eine ultra-präzise, moderne Wetter-App für **iPhone, iPad und Desktop** im Apple iOS 18 Glassmorphic Design, ausgestattet mit einer eigens entwickelten **10-Meter Mikro-Topografie Engine** für den gesamten Alpenraum und anspruchsvolles Gelände.

---

## 🚀 Entwicklung (mit Vite)

### Voraussetzungen
- Node.js (Version 18 oder höher)
- GitHub Desktop (oder Git)

### Setup
\`\`\`bash
npm install
npm run dev
\`\`\`

Die App öffnet sich automatisch unter \`http://localhost:5173\`.

### Weitere Befehle
\`\`\`bash
npm run build      # Produktions-Build nach /dist
npm run preview    # Preview des Builds
npm run test       # Unit-Tests (Vitest)
npm run check      # Syntax-Check aller JS-Dateien
\`\`\`

### Alte statische Vorschau (Fallback)
\`\`\`bash
python3 -m http.server 8080
\`\`\`
Öffne [http://localhost:8080/index.html](http://localhost:8080/index.html).

---

## 🌟 Features

Die Benutzeroberfläche ist dynamisch für **Desktop (Wide Dashboard), iPad (2-3 Spalten Bento) und iPhone (Touch Tab-Bar)** optimiert und in spezialisierte Menü-Tabs gegliedert:

### 1. Übersicht
Adaptiver Hero-Bereich, 24-Stunden-Slider, interaktiver 10-Tage-Trend mit Detail-Dashboards.

### 2. Berg & Höhe
Vertikales Höhenprofil, interaktiver Zeitslider, Wand-Ausrichtung, Schneefallgrenze, Inversions-Erkennung, 3D-Modell.

### 3. Live-Karte & Radar
Interaktive Karte mit dynamischen Layern (Radar, Topo, Satellit) und Klick-Erkennung.

### 4. Favoriten & Suche
Exakte Ortssuche, Favoritenverwaltung.

### 5. Alpen-Messnetze & Geo-Routing
Automatische Zuschaltung regionaler Hochgebirgs-APIs (DWD, LAWIS, Open Data Hub Südtirol, SLF IMIS, etc.).

### Sport & GPX
Routenplanung mit Wetter-Timeline und Gefahrenanalyse.

---

## Architektur (Senior-Level)

- **Modular**: \`core/\` + \`features/\`
- **Reactive State** + Dispatcher
- **Contracts** für API-Validierung
- **Workers** für schwere Berechnungen
- **Service Worker** mit differenzierten Caching-Strategien
- **Vite** für moderne Entwicklung und Builds
- **Vitest** für Unit-Tests der Kernlogik

---

## Lizenz
MIT
