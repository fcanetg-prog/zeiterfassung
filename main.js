'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const invoice = require('./invoice');
const crypto = require('crypto');

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

function loadData() {
  const file = dataPath();
  if (!fs.existsSync(file)) return { data: null, path: file };
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')), path: file };
  } catch (err) {
    // Beschädigte Datei nie überschreiben: zur Seite legen und melden.
    const kaputt = file.replace(/\.json$/, `-beschaedigt-${stamp(true)}.json`);
    try { fs.copyFileSync(file, kaputt); } catch { /* egal */ }
    return { data: null, path: file, error: `Die Datendatei konnte nicht gelesen werden (${err.message}). Eine Kopie liegt unter ${kaputt}.` };
  }
}

function stamp(mitZeit) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const tag = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return mitZeit ? `${tag}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : tag;
}

/** Erste Speicherung des Tages: den bisherigen Stand als Sicherung ablegen. */
function backup(file, mitZeit) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(path.dirname(file), BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ziel = path.join(dir, `zeiterfassung-${stamp(mitZeit)}.json`);
  if (!mitZeit && fs.existsSync(ziel)) return;
  fs.copyFileSync(file, ziel);
  const alle = fs.readdirSync(dir).filter((f) => /^zeiterfassung-.*\.json$/.test(f)).sort();
  while (alle.length > KEEP_BACKUPS) fs.unlinkSync(path.join(dir, alle.shift()));
}

function saveData(data, opts) {
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  backup(file, opts && opts.sicherungErzwingen);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
  fs.renameSync(tmp, file);
  return { ok: true, path: file };
}

/* ---------- Rechnung als PDF ---------- */

/** Lädt das HTML in ein unsichtbares Fenster und druckt es als A4-PDF. */
async function renderPdf(html) {
  const tmp = path.join(app.getPath('temp'), `zeiterfassung-rechnung-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    return await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  } finally {
    w.destroy();
    try { fs.unlinkSync(tmp); } catch { /* egal */ }
  }
}

/* ---------- Rechnungen für Gmail bereitstellen ---------- */

const MANIFEST = 'rechnungen.json';

/**
 * Hält im gewählten (von Google Drive synchronisierten) Ordner pro fällige Rechnung ein PDF bereit,
 * dazu die Liste rechnungen.json, die das Google-Skript täglich liest.
 * Gelöscht werden nur PDFs, die diese Funktion früher selbst angelegt hat.
 */
async function syncInvoices(jobs, absender, ordner) {
  if (!ordner) return { ok: false, fehler: 'Kein Ordner gewählt.' };
  if (!fs.existsSync(ordner)) return { ok: false, fehler: `Der Ordner ${ordner} ist nicht erreichbar.` };
  const absFehler = invoice.absenderFehler(absender);
  if (absFehler.length) return { ok: false, fehler: absFehler.join(' ') };

  const manifestPath = path.join(ordner, MANIFEST);
  let alt = [];
  try { alt = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).rechnungen || []; } catch { /* noch keine Liste */ }
  const altNachId = new Map(alt.map((r) => [r.id, r]));

  const neu = [];
  let erstellt = 0;
  for (const job of jobs) {
    const hash = crypto.createHash('sha1').update(JSON.stringify([job.modell, absender, job.an])).digest('hex');
    const datei = `${job.id}_${invoice.dateiname(job.modell, job.projekt)}`;
    const vorher = altNachId.get(job.id);
    const ziel = path.join(ordner, datei);
    if (!(vorher && vorher.hash === hash && vorher.datei === datei && fs.existsSync(ziel))) {
      fs.writeFileSync(ziel, await renderPdf(invoice.buildHtml(job.modell, absender)));
      erstellt++;
    }
    neu.push({ id: job.id, hash, datum: job.modell.datum, an: job.an, kunde: job.projekt.kunde, projekt: job.projekt.name, total: job.modell.total, datei });
  }
  const behalten = new Set(neu.map((r) => r.datei));
  let entfernt = 0;
  for (const r of alt) {
    if (r.datei && !behalten.has(r.datei) && path.basename(r.datei) === r.datei) {
      try { fs.unlinkSync(path.join(ordner, r.datei)); entfernt++; } catch { /* schon weg */ }
    }
  }
  const inhalt = JSON.stringify({ version: 1, aktualisiert: new Date().toISOString(), rechnungen: neu }, null, 1);
  let bisher = null;
  try { bisher = fs.readFileSync(manifestPath, 'utf8'); } catch { /* neu */ }
  // Nur schreiben, wenn sich an den Rechnungen etwas geändert hat, damit Drive nicht ständig neu synchronisiert.
  const gleich = bisher && JSON.stringify((JSON.parse(bisher).rechnungen)) === JSON.stringify(neu);
  if (!gleich) fs.writeFileSync(manifestPath, inhalt, 'utf8');
  return { ok: true, anzahl: neu.length, erstellt, entfernt };
}

/* ---------- Fenster ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
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
      return { path: ziel, vorhanden };
    });
    ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataPath: dataPath() }));
    ipcMain.handle('invoice:sync', async (_e, jobs, absender, ordner) => {
      try { return await syncInvoices(jobs, absender, ordner); } catch (err) { return { ok: false, fehler: err.message }; }
    });
    ipcMain.handle('invoice:chooseFolder', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Ordner in Google Drive für die Rechnungen wählen', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths[0] ? { canceled: true } : { path: r.filePaths[0] };
    });
    ipcMain.handle('invoice:pdf', async (_e, modell, absender, projekt) => {
      try {
        const fehler = invoice.absenderFehler(absender);
        if (fehler.length) return { fehler };
        const pdf = await renderPdf(invoice.buildHtml(modell, absender));
        const dir = path.join(dataDir(), 'Rechnungen');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, invoice.dateiname(modell, projekt));
        fs.writeFileSync(file, pdf);
        if (!process.env.ZEITERFASSUNG_KEIN_OEFFNEN) shell.openPath(file);
        return { path: file };
      } catch (err) {
        return { fehler: [`Die Rechnung konnte nicht erstellt werden: ${err.message}`] };
      }
    });

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
