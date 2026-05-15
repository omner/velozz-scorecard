// ═══════════════════════════════════════════════════════════════
//  VELOZZ — DSP Scorecard PDF Parser v3
//  Usa Drive API v3
//
//  Setup en appsscript.json:
//  "enabledAdvancedServices": [{ "userSymbol": "Drive", "serviceId": "drive", "version": "v3" }]
//
//  Uso:
//    1. Sube el PDF a la carpeta configurada en DSP_CONFIG.FOLDER_NAME
//    2. Ejecuta parseDSPAndDeploy() manualmente
//    3. El script detecta semanas ya procesadas y las mueve a "Procesados" sin reprocesar
// ═══════════════════════════════════════════════════════════════

const DSP_CONFIG = {
  FOLDER_NAME:      'VELOZZ DSP Scorecards',
  PROCESSED_FOLDER: 'Procesados',
  SPREADSHEET_ID:   '1q1eeFANmApodmXy2Ri2yW5ROvIq-A40zydrC7gvloRE',
};

// ═══════════════════════════════════════════════════════════════
//  DIAGNÓSTICO — ejecutar primero para validar el entorno
// ═══════════════════════════════════════════════════════════════
function diagnosticoDrive() {
  Logger.log('▶ Diagnóstico Drive v3');
  try {
    var iter = DriveApp.getFoldersByName(DSP_CONFIG.FOLDER_NAME);
    Logger.log('✅ DriveApp OK — carpeta: ' + (iter.hasNext() ? 'encontrada' : 'NO encontrada'));
    if (!iter.hasNext()) return;
    var folder = iter.next();

    var files = folder.getFilesByType(MimeType.PDF);
    if (!files.hasNext()) { Logger.log('❌ No hay PDFs en la carpeta'); return; }
    var pdf = files.next();
    Logger.log('✅ PDF: ' + pdf.getName() + ' (' + Math.round(pdf.getSize()/1024) + ' KB)');

    Logger.log('  Probando Drive.Files.copy (v3)...');
    var copied = Drive.Files.copy(
      { name: 'test_diag_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
      pdf.getId(), { supportsAllDrives: true }
    );
    Logger.log('✅ Drive.Files.copy OK — docId: ' + copied.id);

    var text = DocumentApp.openById(copied.id).getBody().getText();
    Logger.log('✅ Texto extraído: ' + text.length + ' chars');
    Logger.log('   Primeros 200: ' + text.substring(0, 200).replace(/\n/g,' '));

    Drive.Files.remove(copied.id);
    Logger.log('✅ Doc temporal eliminado');
    Logger.log('✅ Diagnóstico completo — todo OK');
  } catch(e) {
    Logger.log('❌ Error: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════
function parseDSPAndDeploy() {
  Logger.log('▶ Buscando PDFs en: ' + DSP_CONFIG.FOLDER_NAME);

  var iter = DriveApp.getFoldersByName(DSP_CONFIG.FOLDER_NAME);
  if (!iter.hasNext()) throw new Error('Carpeta "' + DSP_CONFIG.FOLDER_NAME + '" no encontrada.');
  var folder   = iter.next();
  var processed = getOrCreateSubfolder_(folder, DSP_CONFIG.PROCESSED_FOLDER);

  var files = folder.getFilesByType(MimeType.PDF);
  var pdfs  = [];
  while (files.hasNext()) pdfs.push(files.next());

  if (!pdfs.length) { Logger.log('⚠️ No hay PDFs en la carpeta.'); return; }
  Logger.log('  ' + pdfs.length + ' PDF(s) encontrado(s).');

  // ── Leer DSP_DATA existente del suffix para detectar semanas ya cargadas ──
  var existingWeeks = getExistingDSPWeeks_();
  Logger.log('  Semanas ya en DSP_DATA: ' + (existingWeeks.length ? existingWeeks.join(', ') : 'ninguna'));

  var idMap      = buildIdMap_();
  var parsedData = {};
  var skipped    = [];
  var failed     = [];

  var parsedBonus = {};   // weekKey → bonus data

  for (var i = 0; i < pdfs.length; i++) {
    var file = pdfs[i];
    var fileName = file.getName();
    Logger.log('\n  Revisando: ' + fileName);

    // ── Detectar tipo de PDF por nombre ────────────────────────
    var isBonusPdf = isBonusFileName_(fileName);

    if (isBonusPdf) {
      // ── Reporte de Bono Mensual ─────────────────────────────
      var weekKey = getWeekFromFileName_(fileName);
      var existingBonusWeeks = getExistingBonusWeeks_();

      if (weekKey && existingBonusWeeks.indexOf(weekKey) >= 0) {
        Logger.log('  ⏭️  Bono semana ' + weekKey + ' ya está en BONUS_DATA — moviendo a Procesados.');
        file.moveTo(processed);
        skipped.push(fileName);
        continue;
      }

      try {
        var bonusData = parseSingleBonusPdf_(file, idMap);
        // Only process DGD4 station for now; skip others but move to processed
        if (bonusData.station !== 'DGD4') {
          Logger.log('  ⏭️  Estación ' + bonusData.station + ' omitida (solo DGD4 por ahora) — moviendo a Procesados.');
          file.moveTo(processed);
          skipped.push(fileName);
          continue;
        }
        parsedBonus[weekKey || bonusData._weekKey] = bonusData;
        Logger.log('  ✅ Bono ' + bonusData.station + ' ' + bonusData.month +
                   ' | ' + bonusData.total + ' DAs | Ambos: ' + bonusData.both);
      } catch(e) {
        Logger.log('  ❌ Error parseando bono ' + fileName + ': ' + e.message);
        failed.push(fileName);
      }
      continue;
    }

    // ── Scorecard DSP ───────────────────────────────────────────
    var weekFromName = getWeekFromFileName_(fileName);
    if (weekFromName && existingWeeks.indexOf(weekFromName) >= 0) {
      Logger.log('  ⏭️  Semana ' + weekFromName + ' ya está en DSP_DATA — moviendo a Procesados.');
      file.moveTo(processed);
      skipped.push(fileName);
      continue;
    }

    try {
      var weekData = parseSingleDSPPdf_(file, idMap);
      if (existingWeeks.indexOf(weekData.weekKey) >= 0) {
        Logger.log('  ⏭️  Semana ' + weekData.weekKey + ' ya existe — moviendo a Procesados.');
        file.moveTo(processed);
        skipped.push(fileName);
        continue;
      }
      parsedData[weekData.weekKey] = weekData;
      Logger.log('  ✅ ' + weekData.weekKey + ' | ' + weekData.score + '% ' + weekData.tier +
                 ' | ' + weekData.das.length + ' DAs');
    } catch(e) {
      Logger.log('  ❌ Error parseando ' + fileName + ': ' + e.message);
      failed.push(fileName);
    }
  }

  // ── Resumen ────────────────────────────────────────────────────
  if (skipped.length) Logger.log('\n  ⏭️  Omitidos (ya cargados): ' + skipped.join(', '));
  if (failed.length)  Logger.log('  ❌ Fallidos: ' + failed.join(', '));

  if (!Object.keys(parsedData).length) {
    Logger.log('ℹ️  No hay datos nuevos para desplegar.');
    return;
  }

  var hasNew = Object.keys(parsedData).length > 0;
  var hasBonus = Object.keys(parsedBonus).length > 0;

  if (!hasNew && !hasBonus) {
    Logger.log('ℹ️  No hay datos nuevos para desplegar.');
    return;
  }

  Logger.log('\n  Iniciando deploy...');
  if (hasNew)   Logger.log('  DSP nuevas semanas: ' + Object.keys(parsedData).join(', '));
  if (hasBonus) Logger.log('  Bono nuevas semanas: ' + Object.keys(parsedBonus).join(', '));
  buildAndDeployWithDSP(parsedData, parsedBonus);

  // Mover PDFs procesados exitosamente
  Object.keys(parsedData).forEach(function(weekKey) {
    var pdf = pdfs.find(function(f) {
      var wk = getWeekFromFileName_(f.getName());
      return wk === weekKey || (parsedData[weekKey] && parsedData[weekKey]._fileName === f.getName());
    });
    if (pdf) {
      try { pdf.moveTo(processed); } catch(e) {}
    }
  });

  // Move any remaining PDFs that weren't skipped or failed
  pdfs.forEach(function(f) {
    try {
      // If still in original folder (not yet moved), move it
      var stillThere = folder.getFilesByName(f.getName()).hasNext();
      if (stillThere) f.moveTo(processed);
    } catch(e) {}
  });

  Logger.log('✅ parseDSPAndDeploy completado.');
  if (skipped.length) Logger.log('   ' + skipped.length + ' archivo(s) ya estaban cargados y fueron omitidos.');
}

// ── Extraer semana del nombre del archivo ──────────────────────
// Formato esperado: MX_VZLY_DGD4_Week19_2026_DSPScorecard.pdf
function getWeekFromFileName_(fileName) {
  var m = fileName.match(/Week(\d+)_(\d{4})/i);
  if (!m) return null;
  var wn   = ('0' + m[1]).slice(-2);
  var year = m[2];
  return year + '-' + wn;  // e.g. "2026-19"
}

// ── Leer semanas existentes en DSP_DATA desde el HTML desplegado ─
// Lee el suffix del Code.gs para extraer las semanas ya cargadas
function getExistingDSPWeeks_() {
  try {
    // The suffix b64 is in HTML_SUFFIX_B64 — decode and search for DSP_DATA weeks
    var suffixStr = Utilities.newBlob(Utilities.base64Decode(HTML_SUFFIX_B64)).getDataAsString('UTF-8');
    var dspStart  = suffixStr.indexOf('var DSP_DATA = ');
    if (dspStart < 0) return [];
    var dspEnd = suffixStr.indexOf(';\nvar curDspWeek', dspStart) + 1;
    var json  = suffixStr.substring(dspStart + 'var DSP_DATA = '.length, dspEnd);
    // Strip trailing semicolon and whitespace before parsing
    json = json.replace(/;\s*$/, '').trim();
    var obj   = JSON.parse(json);
    return Object.keys(obj);
  } catch(e) {
    Logger.log('  ⚠️  No se pudo leer DSP_DATA existente: ' + e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
//  PARSER DEL PDF — usa Drive API v3
// ═══════════════════════════════════════════════════════════════
function parseSingleDSPPdf_(pdfFile, idMap) {
  var text      = '';
  var tempDocId = null;

  try {
    Logger.log('    Convirtiendo PDF → Google Doc (Drive v3)...');
    var copied = Drive.Files.copy(
      { name: 'temp_dsp_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
      pdfFile.getId(), { supportsAllDrives: true }
    );
    tempDocId = copied.id;
    Utilities.sleep(1500);
    text = DocumentApp.openById(tempDocId).getBody().getText();
    Logger.log('    Texto extraído: ' + text.length + ' chars');
  } finally {
    if (tempDocId) try { Drive.Files.remove(tempDocId); } catch(e) {}
  }

  if (!text || text.length < 100) {
    throw new Error('Texto extraído muy corto (' + (text||'').length + ' chars).');
  }

  return parseDSPText_(text, idMap, pdfFile.getName());
}

// ═══════════════════════════════════════════════════════════════
//  PARSEO DEL TEXTO
// ═══════════════════════════════════════════════════════════════
function parseDSPText_(text, idMap, fileName) {
  var wm = text.match(/Week (\d+)\s*[-–]\s*(\d{4})/) || text.match(/Week (\d+)\s*\n(\d{4})/);
  if (!wm) throw new Error('No se encontró número de semana');
  var weekKey = wm[2] + '-' + ('0' + wm[1]).slice(-2);

  var sm    = text.match(/([\d.]+)%\s*\|\s*(Fair|Great|Fantastic Plus|Fantastic|Poor)/);
  var score = sm ? parseFloat(sm[1]) : 0;
  var tier  = sm ? sm[2] : '';

  var rm   = text.match(/Rank at DGD4:\s*\n\s*(\d+)/);
  var rank = rm ? parseInt(rm[1]) : 1;

  var sc    = text.substring(text.indexOf('DSP WEEKLY SCORECARD'));
  var scEnd = sc.indexOf('\f');
  if (scEnd > 0) sc = sc.substring(0, scEnd);

  var beforeSafety = sc.substring(0, sc.indexOf('Safety') > 0 ? sc.indexOf('Safety') : sc.length);
  var pcts = (beforeSafety.match(/([\d]+\.?\d*)%/g) || []).map(parseFloat);
  var dnrM = beforeSafety.match(/\n(\d{2,5})\n/);

  var whcSec = sc.substring(sc.indexOf('Working Hour Compliance'));
  var whcM   = whcSec.match(/Metric\s*\n\s*([\d.]+)%/);
  var swSec  = sc.substring(sc.indexOf('Swipe to Finish'));
  var swM    = swSec.match(/Metric\s*\n\s*([\d.]+)%\s*\n\s*([\d.]+)%/);

  var allSc  = sc.match(/\d+\.?\d*\/\d+\.?\d*/g) || [];
  var tens   = allSc.filter(function(s){ return /\/10$/.test(s); });
  var sevens = allSc.filter(function(s){ return s.indexOf('7.5') >= 0; });

  var result = {
    weekKey:      weekKey,
    score:        score,
    tier:         tier,
    rank:         rank,
    dvic:         pcts[0] || 0,
    dcr:          pcts[1] || 0,
    attrition:    pcts[2] || 0,
    route_cancel: pcts[3] || 0,
    dnr_dpmo:     dnrM ? parseInt(dnrM[1]) : 0,
    whc:          whcM ? parseFloat(whcM[1]) : 0,
    swipe:        swM  ? parseFloat(swM[1])  : 0,
    contact:      swM  ? parseFloat(swM[2])  : 0,
    kpiScores: {
      dvic:         tens[0]   || '',
      whc:          tens[1]   || '',
      swipe:        sevens[0] || '',
      contact:      sevens[1] || '',
      dcr:          allSc.find(function(s){ return s.indexOf('/25') >= 0; }) || '',
      dnr_dpmo:     allSc.find(function(s){ return s.indexOf('/20') >= 0; }) || '',
      attrition:    allSc.find(function(s){ return /\/8$/.test(s); })        || '',
      route_cancel: allSc.find(function(s){ return s.indexOf('/12') >= 0; }) || '',
    },
    das:       parseDaTable_(text, idMap),
    _fileName: fileName || '',
  };
  return result;
}

// ═══════════════════════════════════════════════════════════════
//  TABLA DE CONDUCTORES
// ═══════════════════════════════════════════════════════════════
function parseDaTable_(text, idMap) {
  var daParts = text.split(/\*Drivers ranked by overall score[^\n]*\n/);
  if (daParts.length < 2) return [];
  var daText = daParts[1].split(/Metric Definitions|DEFINICIÓN DE MÉTRICAS/)[0];

  var TIER_MAP = {
    'Fantástico Plus':'Fantastic Plus','Fantástico':'Fantastic',
    'Genial':'Great','Justo':'Fair','Pobre':'Poor',
  };

  var blocks = daText.split(/\n\n+/)
    .map(function(b){ return b.trim(); })
    .filter(function(b){ return b.split('\n').length >= 10; })
    .map(function(b){ return b.split('\n'); });

  var ids  = blocks[1]  || [];
  var scrs = blocks[2]  || [];
  var dels = blocks[3]  || [];
  var dcrs = blocks[4]  || [];
  var dnrs = blocks[5]  || [];
  var whcs = blocks[9]  || [];
  var tirs = blocks[10] || [];

  var das = [];
  for (var i = 0; i < ids.length; i++) {
    var tid = (ids[i] || '').trim();
    if (!/^[A-Z0-9]{8,}$/.test(tid)) continue;
    das.push({
      id:        tid,
      name:      idMap[tid] || tid,
      score:     parseFloat(scrs[i]) || 0,
      delivered: parseInt(dels[i])   || 0,
      dcr:       parseFloat((dcrs[i] || '0').replace('%','')) || 0,
      dnr_dpmo:  parseInt(dnrs[i])   || 0,
      whc:       (whcs[i] || '').trim() === 'Yes',
      tier:      TIER_MAP[(tirs[i] || '').trim()] || (tirs[i] || 'Fair').trim(),
    });
  }
  return das;
}

// ═══════════════════════════════════════════════════════════════
//  ID → NOMBRE — lee ambas hojas en tiempo real desde Sheets
// ═══════════════════════════════════════════════════════════════
function buildIdMap_() {
  var ss  = SpreadsheetApp.openById(DSP_CONFIG.SPREADSHEET_ID);
  var map = {};

  // 1. DATA_AMAZON — semana más reciente gana para cada ID
  var sheetAmazon = ss.getSheetByName('DATA_AMAZON');
  if (sheetAmazon) {
    var data = sheetAmazon.getDataRange().getValues();
    data.slice(1).sort(function(a, b){
      return String(a[0]).localeCompare(String(b[0]));
    }).forEach(function(row) {
      var tid  = String(row[2]).trim();
      var name = String(row[1]).trim();
      if (tid && name && tid !== 'nan' && name !== 'nan') map[tid] = name;
    });
    Logger.log('  DATA_AMAZON: ' + Object.keys(map).length + ' IDs');
  } else {
    Logger.log('⚠️ Hoja DATA_AMAZON no encontrada');
  }

  // 2. SCORECARD VELOZZ — conductores activos, sobrescribe DATA_AMAZON
  var sheetScore = ss.getSheetByName('SCORECARD VELOZZ');
  if (sheetScore) {
    var data2 = sheetScore.getDataRange().getValues();
    data2.slice(1).sort(function(a, b){
      return String(a[0]).localeCompare(String(b[0]));
    }).forEach(function(row) {
      var tid  = String(row[2]).trim();
      var name = String(row[1]).trim();
      if (tid && name && tid !== 'nan' && name !== 'nan' &&
          tid !== 'Transporter ID' && tid !== 'ID') {
        map[tid] = name;
      }
    });
    Logger.log('  SCORECARD VELOZZ: ' + Object.keys(map).length + ' IDs total');
  } else {
    Logger.log('⚠️ Hoja SCORECARD VELOZZ no encontrada');
  }

  Logger.log('  ID→Nombre final: ' + Object.keys(map).length + ' entradas');
  return map;
}

// ═══════════════════════════════════════════════════════════════
//  BRIDGE — conecta parser con deploy principal (en Code.gs)
// ═══════════════════════════════════════════════════════════════
function buildAndDeployWithDSP(newDspData, newBonusData) {
  newDspData   = newDspData   || {};
  newBonusData = newBonusData || {};

  var ss       = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var allData  = parseScorecard(ss);
  var dnrData  = parseDNR(ss);
  var weeks    = getAvailableWeeks(allData);
  var weekOpts = buildWeekOptions(weeks);

  Logger.log('  Semanas Excel: ' + weeks.join(', '));
  if (Object.keys(newDspData).length)   Logger.log('  DSP nuevas: '  + Object.keys(newDspData).join(', '));
  if (Object.keys(newBonusData).length) Logger.log('  Bono nuevas: ' + Object.keys(newBonusData).join(', '));

  var html = buildHTMLWithDSP(allData, dnrData, weeks, weekOpts, newDspData, newBonusData);
  saveHTMLToDrive(html);
  deployToFirebase(html);
  sendSuccessEmail(weeks);
}

function buildHTMLWithDSP(allData, dnrData, weeks, weekOpts, newDspData, newBonusData) {
  newBonusData = newBonusData || {};
  var prefixBytes = Utilities.base64Decode(HTML_PREFIX_B64);
  var suffixStr   = Utilities.newBlob(Utilities.base64Decode(HTML_SUFFIX_B64)).getDataAsString('UTF-8');

  // Merge DSP_DATA: leer existente + agregar/reemplazar con nuevos datos
  var dspStart = suffixStr.indexOf('var DSP_DATA = ');
  var dspEnd   = suffixStr.indexOf(';\nvar curDspWeek', dspStart) + 1;

  if (dspStart >= 0 && dspEnd > dspStart) {
    var existingJson = suffixStr.substring(dspStart + 'var DSP_DATA = '.length, dspEnd);
    // Strip trailing semicolon before parsing
    existingJson = existingJson.replace(/;\s*$/, '').trim();
    var existingDSP  = {};
    try { existingDSP = JSON.parse(existingJson); } catch(e) {
      Logger.log('⚠️ No se pudo parsear DSP_DATA existente: ' + e.message);
    }

    // Remove internal _fileName field before storing
    Object.keys(newDspData).forEach(function(k){
      var d = JSON.parse(JSON.stringify(newDspData[k]));
      delete d._fileName;
      existingDSP[k] = d;
    });

    // Sort by week key
    var sortedDSP = {};
    Object.keys(existingDSP).sort().forEach(function(k){ sortedDSP[k] = existingDSP[k]; });
    Logger.log('  DSP_DATA final: ' + Object.keys(sortedDSP).join(', '));

    suffixStr = suffixStr.substring(0, dspStart) +
                'var DSP_DATA = ' + JSON.stringify(sortedDSP) +
                suffixStr.substring(dspEnd);
  }

  // ── Merge BONUS_DATA ────────────────────────────────────────────
  if (Object.keys(newBonusData).length > 0) {
    var bonStart = suffixStr.indexOf('var BONUS_DATA = ');
    if (bonStart >= 0) {
      var bonEnd2 = bonStart + 'var BONUS_DATA = '.length;
      var depth2 = 0, inStr2 = false, esc2 = false;
      for (var bi = bonEnd2; bi < suffixStr.length; bi++) {
        var bc = suffixStr[bi];
        if (esc2) { esc2 = false; continue; }
        if (bc === '\\' && inStr2) { esc2 = true; continue; }
        if (bc === '"' && !esc2) { inStr2 = !inStr2; continue; }
        if (!inStr2) {
          if (bc === '{') depth2++;
          else if (bc === '}') { depth2--; if (depth2 === 0) { bonEnd2 = bi + 1; break; } }
        }
      }
      var existBonJson = suffixStr.substring(bonStart + 'var BONUS_DATA = '.length, bonEnd2)
                                  .replace(/;\s*$/, '').trim();
      var existBonus = {};
      try { existBonus = JSON.parse(existBonJson); } catch(e) {
        Logger.log('⚠️ No se pudo parsear BONUS_DATA existente: ' + e.message);
      }
      // Merge: remove internal fields before storing
      Object.keys(newBonusData).forEach(function(k) {
        var d = JSON.parse(JSON.stringify(newBonusData[k]));
        delete d._weekKey; delete d._fileName;
        existBonus[k] = d;
      });
      var sortedBonus = {};
      Object.keys(existBonus).sort().forEach(function(k){ sortedBonus[k] = existBonus[k]; });
      Logger.log('  BONUS_DATA final: ' + Object.keys(sortedBonus).join(', '));
      var newBonusStr = 'var BONUS_DATA = ' + JSON.stringify(sortedBonus) + ';';
      suffixStr = suffixStr.substring(0, bonStart) + newBonusStr + '\n' +
                  suffixStr.substring(bonEnd2 + 2);
    }
  }

  var generated = new Date().toLocaleString('es-MX', {timeZone: 'America/Mexico_City'});
  var dataBlock = 'const ALL = '  + JSON.stringify(allData) + ';\n' +
                  'const DNR = '  + JSON.stringify(dnrData)  + ';\n' +
                  'const __GENERATED__ = "' + generated + '";\n';

  var dataBytes   = Utilities.newBlob(dataBlock, 'text/plain', 'data.js').getBytes();
  var suffixBytes = Utilities.newBlob(suffixStr,  'text/plain', 'suffix.js').getBytes();

  return [].concat(
    Array.from(prefixBytes),
    Array.from(dataBytes),
    Array.from(suffixBytes)
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function getOrCreateSubfolder_(parent, name) {
  var s = parent.getFoldersByName(name);
  return s.hasNext() ? s.next() : parent.createFolder(name);
}

function setupDSPTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t){ return t.getHandlerFunction() === 'parseDSPAndDeploy'; })
    .forEach(function(t){ ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('parseDSPAndDeploy').timeBased().everyHours(1).create();
  Logger.log('✅ Trigger: parseDSPAndDeploy cada hora');
}

// ═══════════════════════════════════════════════════════════════
//  BONUS PDF DETECTION & PARSING
// ═══════════════════════════════════════════════════════════════

// Detect bonus PDF by filename
// Formato: MX_VZLY_DGD4_Week20_2026_Bonus_Report.pdf
function isBonusFileName_(fileName) {
  return /Bonus_Report/i.test(fileName);
}

// Read existing BONUS_DATA week keys from current suffix
function getExistingBonusWeeks_() {
  try {
    var suffixStr = Utilities.newBlob(Utilities.base64Decode(HTML_SUFFIX_B64)).getDataAsString('UTF-8');
    var start = suffixStr.indexOf('var BONUS_DATA = ');
    if (start < 0) return [];
    start += 'var BONUS_DATA = '.length;
    // Find closing brace
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < suffixStr.length; i++) {
      var c = suffixStr[i];
      if (esc)          { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"' && !esc)   { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { var end = i + 1; break; } }
      }
    }
    var json = suffixStr.substring(start, end).replace(/;\s*$/, '').trim();
    return Object.keys(JSON.parse(json));
  } catch(e) {
    Logger.log('  ⚠️  No se pudo leer BONUS_DATA existente: ' + e.message);
    return [];
  }
}

// Parse a Bonus Report PDF
function parseSingleBonusPdf_(pdfFile, idMap) {
  var text      = '';
  var tempDocId = null;

  try {
    Logger.log('    Convirtiendo Bonus PDF → Google Doc...');
    var copied = Drive.Files.copy(
      { name: 'temp_bonus_' + Date.now(), mimeType: 'application/vnd.google-apps.document' },
      pdfFile.getId(), { supportsAllDrives: true }
    );
    tempDocId = copied.id;
    Utilities.sleep(1500);
    text = DocumentApp.openById(tempDocId).getBody().getText();
    Logger.log('    Texto extraído: ' + text.length + ' chars');
  } finally {
    if (tempDocId) try { Drive.Files.remove(tempDocId); } catch(e) {}
  }

  if (!text || text.length < 100) {
    throw new Error('Texto extraído muy corto (' + (text||'').length + ' chars).');
  }

  return parseBonusText_(text, idMap, pdfFile.getName());
}

function parseBonusText_(text, idMap, fileName) {
  var parts = text.split('\n\n');

  // ── Header ────────────────────────────────────────────────────
  var monthRaw = (parts[0] || '').trim();   // "Apr'26 Summary"
  var MONTH_MAP = {
    'Jan':'Enero','Feb':'Febrero','Mar':'Marzo','Apr':'Abril',
    'May':'Mayo','Jun':'Junio','Jul':'Julio','Aug':'Agosto',
    'Sep':'Septiembre','Oct':'Octubre','Nov':'Noviembre','Dec':'Diciembre'
  };
  var mm = monthRaw.match(/(\w{3})'(\d{2})/);
  var monthStr = mm ? (MONTH_MAP[mm[1]] || mm[1]) + ' 20' + mm[2] : monthRaw;

  var stationM = text.match(/VZLY\s*-\s*(\w+)/);
  var station  = stationM ? stationM[1] : 'UNKNOWN';

  // Week key from filename: MX_VZLY_DGD4_Week20_2026_Bonus_Report.pdf
  var weekKey = getWeekFromFileName_(fileName);

  // ── Counts ────────────────────────────────────────────────────
  var countLines = (parts[2] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var total = parseInt(countLines[0]) || 0;

  // ── DA data blocks ────────────────────────────────────────────
  var ids      = (parts[26] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var dcrVals  = (parts[28] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var dnrVals  = (parts[29] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var part32   = (parts[32] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var part33   = (parts[33] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);
  var part34   = (parts[34] || '').split('\n').map(function(l){return l.trim();}).filter(Boolean);

  // part32 + part33 = safety/quality scores for all DAs
  var allQual = part32.concat(part33);

  function parseElig(line) {
    var eligible = line.indexOf('Not Eligible') < 0 && line.indexOf('Eligible') >= 0;
    var score    = parseFloat(line.replace('Not Eligible','').replace('Eligible','').trim().replace('%','')) || 0;
    return { score: score, eligible: eligible };
  }

  var das = [];
  for (var i = 0; i < ids.length; i++) {
    var tid = ids[i];
    if (!tid || !(/^[A-Z0-9]{8,}$/.test(tid))) continue;

    var dcr = parseFloat((dcrVals[i] || '0').replace('%','')) || 0;
    var dnr = parseFloat((dnrVals[i] || '0').replace('%','')) || 0;

    var qParsed = parseElig(allQual[i] || '');
    var sBon    = (part34[i] || '') === 'Eligible';

    // Helper: safety_score == 0.00 within first len(part32) DAs
    var isHelper = (i < part32.length) && (qParsed.score === 0.0);
    var dvcr     = isHelper ? null : qParsed.score;

    das.push({
      id:            tid,
      name:          idMap[tid] || tid,
      dcr:           dcr,
      dnr_lp:        dnr,
      dvcr:          dvcr !== null ? Math.round(dvcr * 100) / 100 : null,
      quality_score: Math.round(qParsed.score * 100) / 100,
      safety_score:  dvcr !== null ? Math.round(dvcr * 100) / 100 : null,
      quality_bonus: qParsed.eligible,
      safety_bonus:  sBon,
      is_helper:     isHelper,
    });
  }

  var both    = das.filter(function(d){return  d.quality_bonus &&  d.safety_bonus;}).length;
  var qOnly   = das.filter(function(d){return  d.quality_bonus && !d.safety_bonus;}).length;
  var sOnly   = das.filter(function(d){return !d.quality_bonus &&  d.safety_bonus;}).length;
  var neither = das.filter(function(d){return !d.quality_bonus && !d.safety_bonus;}).length;

  return {
    month:   monthStr,
    station: station,
    total:   total,
    both: both, quality_only: qOnly, safety_only: sOnly, neither: neither,
    amount_quality:        275,
    amount_safety:         275,
    amount_quality_helper: 175,
    amount_safety_helper:  0,
    das:     das,
    _weekKey: weekKey || '',
    _fileName: fileName || '',
  };
}
