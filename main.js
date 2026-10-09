'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const invoice = require('./invoice');
const crypto = require('crypto');
const os = require('os');
const Calc = require('./src/calc.js');

const DATA_FILE = 'zeiterfassung-daten.json';
const BACKUP_DIR = 'Sicherungen';
const KEEP_BACKUPS = 60;

let win = null;

// Datumsfelder und Dialoge in Schweizer Schreibweise, unabhängig von der Windows-Sprache.
app.commandLine.appendSwitch('lang', 'de-CH');

/* ---------- Speicherort ---------- */

function configPath() { return path.join(app.getPath('userData'), 'config.json'); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function dataDir() {
  if (process.env.ZEITERFASSUNG_DATA_DIR) return process.env.ZEITERFASSUNG_DATA_DIR;
  const cfg = readConfig();
  return cfg.dataDir || path.join(app.getPath('documents'), 'Zeiterfassung');
}

function dataPath() { return path.join(dataDir(), DATA_FILE); }

/* ---------- Lesen und Schreiben ---------- */

// Stand der Datendatei, wie ihn diese App zuletzt gelesen oder geschrieben hat.
// Weicht die Datei davon ab, hat ein anderer Rechner (über Dropbox o. ä.) geschrieben.
let bekannt = null;

function dateiStand(file) {
  try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; } catch { return null; }
}

function stamp(mitZeit) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const tag = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return mitZeit ? `${tag}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : tag;
}

function rechnerName() {
  return os.hostname().replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 24) || 'rechner';
}

/** Konfliktkopien, wie Dropbox sie anlegt, wenn zwei Rechner gleichzeitig offline geändert haben. */
function konfliktDateien(dir) {
  const basis = DATA_FILE.replace(/\.json$/, '');
  try {
    return fs.readdirSync(dir).filter((f) => f !== DATA_FILE && f.startsWith(basis) && f.endsWith('.json') && !f.includes('-beschaedigt-'));
  } catch { return []; }
}

const warte = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Ersetzt die Datendatei durch die fertig geschriebene Zwischendatei.
 * Dropbox oder ein Virenscanner halten die Datei manchmal kurz gesperrt (EPERM/EBUSY/EACCES):
 * dann mehrmals versuchen und zuletzt direkt in die Datei schreiben.
 */
function ersetzeDatei(tmp, file, data) {
  let fehler = null;
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      fehler = e; warte(60 + i * 60);
    }
  }
  try { fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8'); }
  catch (_) { throw fehler; }
  try { fs.unlinkSync(tmp); } catch (_) { /* bleibt liegen, stört nicht */ }
}

function schreibe(file, data) {
  const tmp = `${file}.${rechnerName()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  ersetzeDatei(tmp, file, data);
  bekannt = dateiStand(file);
}

function loadData() {
  const file = dataPath();
  const dir = path.dirname(file);
  let data = null;
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // Beschädigte Datei nie überschreiben: zur Seite legen und melden.
      const kaputt = file.replace(/\.json$/, `-beschaedigt-${stamp(true)}.json`);
      try { fs.copyFileSync(file, kaputt); } catch { /* egal */ }
      return { data: null, path: file, error: `Die Datendatei konnte nicht gelesen werden (${err.message}). Eine Kopie liegt unter ${kaputt}.` };
    }
  }
  bekannt = dateiStand(file);

  // Konfliktkopien einarbeiten und danach zu den Sicherungen legen.
  let eingearbeitet = 0;
  for (const name of konfliktDateien(dir)) {
    const quelle = path.join(dir, name);
    try {
      data = Calc.mergeData(data, JSON.parse(fs.readFileSync(quelle, 'utf8')));
      const ziel = path.join(dir, BACKUP_DIR);
      fs.mkdirSync(ziel, { recursive: true });
      fs.renameSync(quelle, path.join(ziel, `konflikt-${stamp(true)}-${name}`));
      eingearbeitet++;
    } catch { /* unlesbare Kopie liegen lassen */ }
  }
  if (eingearbeitet && data) schreibe(file, data);
  return { data, path: file, eingearbeitet };
}

/** Erste Speicherung des Tages auf diesem Rechner: den bisherigen Stand als Sicherung ablegen. */
function backup(file, mitZeit) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(path.dirname(file), BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ziel = path.join(dir, `zeiterfassung-${stamp(mitZeit)}-${rechnerName()}.json`);
  if (!mitZeit && fs.existsSync(ziel)) return;
  fs.copyFileSync(file, ziel);
  const alle = fs.readdirSync(dir).filter((f) => /^zeiterfassung-.*\.json$/.test(f)).sort();
  while (alle.length > KEEP_BACKUPS) fs.unlinkSync(path.join(dir, alle.shift()));
}

function saveData(data, opts) {
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backup(file, opts && opts.sicherungErzwingen);
  // Hat inzwischen ein anderer Rechner geschrieben, dessen Änderungen nicht überschreiben, sondern zusammenführen.
  let zusammengefuehrt = null;
  if (!(opts && opts.ersetzen) && bekannt && dateiStand(file) && dateiStand(file) !== bekannt) {
    try {
      zusammengefuehrt = Calc.mergeData(data, JSON.parse(fs.readFileSync(file, 'utf8')));
      data = zusammengefuehrt;
    } catch { /* Datei wird gerade geschrieben: unseren Stand behalten, der Wächter meldet die Änderung erneut */ }
  }
  schreibe(file, data);
  return { ok: true, path: file, data: zusammengefuehrt };
}

/* ---------- Änderungen von anderen Rechnern bemerken ---------- */

let waechter = null, waechterTimer = null, abfrage = null;

function pruefeAenderung() {
  const file = dataPath();
  const stand = dateiStand(file);
  const fremd = konfliktDateien(path.dirname(file)).length > 0;
  if ((stand && stand !== bekannt) || fremd) {
    if (win && !win.isDestroyed()) win.webContents.send('data:changed');
  }
}

function starteWaechter() {
  if (waechter) { try { waechter.close(); } catch { /* egal */ } waechter = null; }
  clearInterval(abfrage);
  const dir = dataDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    waechter = fs.watch(dir, () => { clearTimeout(waechterTimer); waechterTimer = setTimeout(pruefeAenderung, 600); });
    waechter.on('error', () => { /* die Abfrage unten fängt es auf */ });
  } catch { /* kein Wächter möglich: die Abfrage unten reicht */ }
  // Sicherheitsnetz, falls der Ordner keine Änderungsmeldungen liefert.
  abfrage = setInterval(pruefeAenderung, 15000);
}

/* ---------- Rechnung als PDF ---------- */

/** Lädt das HTML in ein unsichtbares Fenster und druckt es als A4-PDF. */
async function renderPdf(html, fuss) {
  const tmp = path.join(app.getPath('temp'), `zeiterfassung-rechnung-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    if (fuss == null) return await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    // Mehrseitige Berichte: Ränder in Zoll, unten Datum und Seitenzahl wie im Banana-Ausdruck.
    const sicher = String(fuss).replace(/[<>&]/g, '');
    return await w.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, displayHeaderFooter: true,
      margins: { top: 0.55, bottom: 0.7, left: 0.72, right: 0.6 },
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;padding:0 44px;display:flex;justify-content:space-between;"><span></span><span>${sicher}</span><span>-<span class="pageNumber"></span>-</span></div>`,
    });
  } finally {
    w.destroy();
    try { fs.unlinkSync(tmp); } catch { /* egal */ }
  }
}

/* ---------- Rechnungen für Gmail bereitstellen ---------- */

let letzterAbgleich = null; // Signatur des letzten erfolgreichen Abgleichs, spart unnötige Anfragen

function webAppErlaubt(url) {
  if (process.env.ZEITERFASSUNG_TEST_WEBAPP && url.startsWith(process.env.ZEITERFASSUNG_TEST_WEBAPP)) return true;
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
}

async function webAppAnfrage(url, inhalt) {
  let res;
  try {
    res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(inhalt), redirect: 'follow' });
  } catch (err) {
    throw new Error('Keine Verbindung zum Google-Skript. Prüfe die Internetverbindung.');
  }
  const text = await res.text();
  let antwort;
  try { antwort = JSON.parse(text); } catch {
    throw new Error('Das Google-Skript antwortet nicht wie erwartet. Prüfe die Adresse der Web-App und ob der Zugriff auf «Jeder» steht.');
  }
  if (!antwort.ok) throw new Error(antwort.fehler || 'Das Google-Skript meldet einen Fehler.');
  return antwort;
}

/**
 * Schickt die fälligen Rechnungen an das Google-Skript. Das Skript legt sie in Google Drive ab
 * und erstellt am Rechnungsdatum den Entwurf in Gmail. PDFs werden nur hochgeladen, wenn sie neu oder geändert sind.
 */
async function pushInvoices(jobs, absender, ziel, erzwingen) {
  const url = String((ziel && ziel.url) || '').trim();
  const schluessel = String((ziel && ziel.schluessel) || '').trim();
  if (!url || !schluessel) return { ok: false, fehler: 'Adresse der Web-App oder Schlüssel fehlt.' };
  if (!webAppErlaubt(url)) return { ok: false, fehler: 'Die Adresse muss mit https://script.google.com/macros/s/ beginnen und auf /exec enden.' };
  if (jobs.length) {
    const absFehler = invoice.absenderFehler(absender);
    if (absFehler.length) return { ok: false, fehler: absFehler.join(' ') };
  }

  const liste = jobs.map((job) => ({
    id: job.id,
    hash: crypto.createHash('sha1').update(JSON.stringify([job.modell, absender, job.an, job.bereich])).digest('hex'),
    datum: job.modell.datum, an: job.an, bereich: job.bereich || '', kunde: job.kunde, projekt: job.projekt, total: job.modell.total,
    datei: `${job.id}_${invoice.dateiname(job.modell)}`,
  }));
  const signatur = crypto.createHash('sha1').update(JSON.stringify([url, schluessel, liste])).digest('hex');
  if (!erzwingen && signatur === letzterAbgleich) return { ok: true, anzahl: liste.length, hochgeladen: 0, unveraendert: true };

  const vorhanden = new Map((await webAppAnfrage(url, { schluessel, aktion: 'liste' })).rechnungen.map((r) => [r.id, r.hash]));
  let hochgeladen = 0;
  for (let i = 0; i < liste.length; i++) {
    if (vorhanden.get(liste[i].id) === liste[i].hash) continue;
    const pdf = await renderPdf(invoice.buildHtml(jobs[i].modell, absender));
    liste[i] = Object.assign({}, liste[i], { pdf: pdf.toString('base64') });
    hochgeladen++;
  }
  const antwort = await webAppAnfrage(url, { schluessel, aktion: 'abgleich', rechnungen: liste });
  if (antwort.fehlt && antwort.fehlt.length) throw new Error('Einzelne Rechnungen sind bei Google nicht angekommen. Klicke auf «Jetzt abgleichen».');
  letzterAbgleich = signatur;
  return { ok: true, anzahl: liste.length, hochgeladen };
}

/* ---------- Fenster ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 520,
    minHeight: 480,
    backgroundColor: '#f6f8f8',
    title: 'Zeiterfassung',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    ipcMain.handle('data:load', () => loadData());
    ipcMain.handle('data:save', (_e, data, opts) => {
      try { return saveData(data, opts); } catch (err) { return { ok: false, error: err.message }; }
    });
    ipcMain.handle('data:import', async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Daten importieren',
        filters: [{ name: 'Zeiterfassungs-Daten', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      try {
        return { data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')), path: r.filePaths[0] };
      } catch (err) {
        return { error: `Die Datei konnte nicht gelesen werden: ${err.message}` };
      }
    });
    ipcMain.handle('data:export', async (_e, data) => {
      const r = await dialog.showSaveDialog(win, {
        title: 'Daten exportieren',
        defaultPath: path.join(app.getPath('documents'), `Zeiterfassung-Export-${stamp()}.json`),
        filters: [{ name: 'Zeiterfassungs-Daten', extensions: ['json'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      fs.writeFileSync(r.filePath, JSON.stringify(data, null, 1), 'utf8');
      return { path: r.filePath };
    });
    ipcMain.handle('data:exportCsv', async (_e, name, text) => {
      const r = await dialog.showSaveDialog(win, {
        title: 'Als CSV exportieren',
        defaultPath: path.join(app.getPath('documents'), name),
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      fs.writeFileSync(r.filePath, '﻿' + text, 'utf8');
      return { path: r.filePath };
    });
    ipcMain.handle('data:openFolder', () => {
      fs.mkdirSync(dataDir(), { recursive: true });
      return shell.openPath(dataDir());
    });
    ipcMain.handle('data:chooseFolder', async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Speicherort für die Daten wählen',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      const neu = r.filePaths[0];
      const alt = dataPath();
      const ziel = path.join(neu, DATA_FILE);
      const vorhanden = fs.existsSync(ziel);
      // Liegt am neuen Ort noch nichts, den aktuellen Stand mitnehmen.
      if (!vorhanden && fs.existsSync(alt)) fs.copyFileSync(alt, ziel);
      const cfg = readConfig();
      cfg.dataDir = neu;
      writeConfig(cfg);
      bekannt = null;
      starteWaechter();
      return { path: ziel, vorhanden };
    });
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataPath: dataPath() }));
    ipcMain.handle('invoice:push', async (_e, jobs, absender, ziel, erzwingen) => {
      try { return await pushInvoices(jobs, absender, ziel, erzwingen); } catch (err) { return { ok: false, fehler: err.message }; }
    });
    ipcMain.handle('file:openText', async (_e, titel, endungen) => {
      const r = await dialog.showOpenDialog(win, { title: String(titel || 'Datei öffnen'), filters: [{ name: 'Export', extensions: Array.isArray(endungen) && endungen.length ? endungen.map(String) : ['csv'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return { canceled: true };
      try {
        const roh = fs.readFileSync(r.filePaths[0]);
        let text;
        // Bankexporte sind je nach Alter UTF-8 oder Windows-1252.
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(roh); } catch { text = new TextDecoder('windows-1252').decode(roh); }
        return { text, name: path.basename(r.filePaths[0]) };
      } catch (err) {
        return { fehler: `Die Datei konnte nicht gelesen werden: ${err.message}` };
      }
    });
    ipcMain.handle('pdf:save', async (_e, html, opts) => {
      try {
        const ordner = path.basename(String((opts && opts.ordner) || 'Berichte'));
        const name = path.basename(String((opts && opts.name) || 'Bericht.pdf')).replace(/[\\/:*?"<>|]/g, '_');
        const pdf = await renderPdf(html, (opts && opts.fuss) || '');
        const dir = path.join(dataDir(), ordner);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, name);
        fs.writeFileSync(file, pdf);
        if (!process.env.ZEITERFASSUNG_KEIN_OEFFNEN) shell.openPath(file);
        return { path: file };
      } catch (err) {
        return { fehler: `Das PDF konnte nicht erstellt werden: ${err.message}` };
      }
    });
    ipcMain.handle('invoice:pdf', async (_e, modell, absender) => {
      try {
        const fehler = invoice.absenderFehler(absender);
        if (fehler.length) return { fehler };
        const pdf = await renderPdf(invoice.buildHtml(modell, absender));
        const dir = path.join(dataDir(), 'Rechnungen');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, invoice.dateiname(modell));
        fs.writeFileSync(file, pdf);
        if (!process.env.ZEITERFASSUNG_KEIN_OEFFNEN) shell.openPath(file);
        return { path: file };
      } catch (err) {
        return { fehler: [`Die Rechnung konnte nicht erstellt werden: ${err.message}`] };
      }
    });

    createWindow();
    starteWaechter();
  });

  app.on('window-all-closed', () => app.quit());
}
