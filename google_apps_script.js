/**
 * =============================================================================
 * BEST WEATHER — Google Apps Script Web App Backend (Google Sheets Cloud DB)
 * =============================================================================
 * 
 * ANLEITUNG ZUR BEREITSTELLUNG (1 Minute):
 * 1. Öffne dein Google Sheet (oder erstelle ein neues auf sheets.google.com)
 * 2. Klicke im Menü oben auf: Erweiterungen -> Apps Script
 * 3. Lösche den vorhandenen Code und füge diesen gesamten Code hier ein.
 * 4. Speichere mit Strg+S (Cmd+S auf Mac).
 * 5. Klicke oben rechts auf die blaue Schaltfläche: "Bereitstellen" -> "Neue Bereitstellung"
 * 6. Klicke auf das Zahnrad-Symbol ("Typ auswählen") und wähle: "Web-App"
 * 7. WICHTIGE EINSTELLUNGEN:
 *    - Beschreibung: Best Weather Sync
 *    - Ausführen als: "Ich (deine-email@gmail.com)"
 *    - Wer hat Zugriff: "Jeder"   <=== SEHR WICHTIG! (NICHT "Nur ich"!)
 * 8. Klicke auf "Bereitstellen", autorisiere den Zugriff einmalig.
 * 9. Kopiere die generierte Web-App-URL (https://script.google.com/macros/s/.../exec).
 * 
 * Ab sofort synchronisiert deine Best Weather App vollautomatisch:
 * - Sofort beim Hinzufügen eines Ortes (★)
 * - Sofort beim Löschen eines Favoriten (✕)
 * - Automatisch bei jedem App-Start
 * - Automatisch beim Nach-unten-Ziehen (Pull-down-to-refresh)
 * =============================================================================
 */

var SHEET_NAME = 'Favoriten';
var HEADERS = ['Name', 'Breitengrad', 'Laengengrad', 'Hoehe_m', 'Typ', 'Land', 'Notizen', 'Zuletzt_Geaendert'];

function doGet(e) {
  return handleRequest(e, false);
}

function doPost(e) {
  return handleRequest(e, true);
}

function handleRequest(e, isPost) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateSheet(ss, SHEET_NAME);
    var params = (e && e.parameter) ? e.parameter : {};
    var postData = {};

    if (isPost && e && e.postData && e.postData.contents) {
      try {
        postData = JSON.parse(e.postData.contents);
      } catch (err) {
        postData = {};
      }
    }

    var action = (postData.action || params.action || 'get_all').toLowerCase();
    var callback = params.callback;
    var result = { success: false };

    if (action === 'get_all' || action === 'get_favorites' || action === 'list') {
      result = {
        success: true,
        favoriten: readAllFavorites(sheet),
        timestamp: new Date().toISOString()
      };
    } else if (action === 'save_favorite' || action === 'add_favorite') {
      var fav = postData.favorite || postData || params;
      result = saveFavorite(sheet, fav);
    } else if (action === 'delete_favorite' || action === 'remove_favorite') {
      var name = postData.name || params.name;
      result = deleteFavorite(sheet, name);
    } else {
      result = { success: false, error: 'Unbekannte Aktion: ' + action };
    }

    var jsonString = JSON.stringify(result);

    // JSONP Support für Cross-Origin Umgebungen
    if (callback) {
      return ContentService.createTextOutput(callback + '(' + jsonString + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService.createTextOutput(jsonString)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    var errString = JSON.stringify({ success: false, error: err.toString() });
    return ContentService.createTextOutput(errString)
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readAllFavorites(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
  var nameIdx = findHeaderIndex(headers, ['name', 'ort', 'location', 'titel']);
  var latIdx = findHeaderIndex(headers, ['breitengrad', 'lat', 'latitude', 'breite']);
  var lonIdx = findHeaderIndex(headers, ['laengengrad', 'längengrad', 'lon', 'lng', 'longitude', 'länge', 'laenge']);
  var eleIdx = findHeaderIndex(headers, ['hoehe_m', 'höhe_m', 'hoehe', 'höhe', 'elevation', 'altitude']);
  var typIdx = findHeaderIndex(headers, ['typ', 'type', 'kategorie']);
  var landIdx = findHeaderIndex(headers, ['land', 'country']);
  var notizenIdx = findHeaderIndex(headers, ['notizen', 'notes', 'beschreibung']);

  var list = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rawName = nameIdx >= 0 ? row[nameIdx] : row[0];
    if (!rawName) continue;

    var name = String(rawName).trim();
    if (!name) continue;

    var lat = latIdx >= 0 ? parseFloat(row[latIdx]) : parseFloat(row[1]);
    var lon = lonIdx >= 0 ? parseFloat(row[lonIdx]) : parseFloat(row[2]);
    var ele = eleIdx >= 0 ? parseInt(row[eleIdx], 10) : 500;
    var typ = typIdx >= 0 ? String(row[typIdx] || 'Ort') : 'Ort';
    var land = landIdx >= 0 ? String(row[landIdx] || 'Deutschland') : 'Deutschland';
    var notizen = notizenIdx >= 0 ? String(row[notizenIdx] || '') : '';

    list.push({
      Name: name,
      Breitengrad: isNaN(lat) ? 0 : lat,
      Laengengrad: isNaN(lon) ? 0 : lon,
      Hoehe_m: isNaN(ele) ? 500 : ele,
      Typ: typ,
      Land: land,
      Notizen: notizen
    });
  }
  return list;
}

function findHeaderIndex(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = headers.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function saveFavorite(sheet, fav) {
  if (!fav || !fav.name) return { success: false, error: 'Kein Name angegeben' };

  var name = String(fav.name).trim();
  var lat = fav.lat !== undefined ? fav.lat : (fav.Breitengrad || 0);
  var lon = fav.lon !== undefined ? fav.lon : (fav.Laengengrad || 0);
  var ele = fav.elevation !== undefined ? fav.elevation : (fav.Hoehe_m || 500);
  var typ = fav.type || fav.Typ || (fav.isMountain ? 'Berg' : 'Ort');
  var land = fav.country || fav.Land || 'Deutschland';
  var notizen = fav.notes || fav.Notizen || '';
  var nowStr = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd HH:mm:ss');

  var data = sheet.getDataRange().getValues();
  var rowIdx = -1;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === name.toLowerCase()) {
      rowIdx = i + 1;
      break;
    }
  }

  var rowValues = [name, lat, lon, ele, typ, land, notizen, nowStr];

  if (rowIdx > 0) {
    sheet.getRange(rowIdx, 1, 1, rowValues.length).setValues([rowValues]);
    return { success: true, action: 'updated', name: name };
  } else {
    sheet.appendRow(rowValues);
    return { success: true, action: 'inserted', name: name };
  }
}

function deleteFavorite(sheet, name) {
  if (!name) return { success: false, error: 'Kein Name angegeben' };
  var cleanName = String(name).toLowerCase().trim();

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === cleanName) {
      sheet.deleteRow(i + 1);
      return { success: true, action: 'deleted', name: name };
    }
  }
  return { success: true, action: 'not_found', name: name };
}
