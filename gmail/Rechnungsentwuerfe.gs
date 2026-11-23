/**
 * Rechnungsentwürfe für Gmail
 *
 * Die Zeiterfassungs-App schickt fällige Rechnungen als PDF an dieses Skript (Web-App).
 * Das Skript legt sie in Google Drive im Ordner «Zeiterfassung-Rechnungen» ab. Einmal pro Tag
 * erstellt es für jede Rechnung, deren Rechnungsdatum erreicht ist, einen Entwurf in Gmail
 * mit dem PDF im Anhang. Es sendet nichts.
 *
 * Einrichten:
 *   1. Funktion «einrichten» einmal ausführen und die Berechtigungen bestätigen.
 *   2. Bereitstellen → Neue Bereitstellung → Web-App, ausführen als «Ich», Zugriff «Jeder».
 *   3. Die Adresse der Web-App und den Schlüssel in der Zeiterfassungs-App eintragen.
 */

// Geheimer Schlüssel. Derselbe Text muss in der Zeiterfassungs-App unter Einstellungen stehen.
const SCHLUESSEL = 'HIER-EINEN-LANGEN-ZUFAELLIGEN-SCHLUESSEL-EINTRAGEN';

// Ordner in «Meine Ablage», in dem die Rechnungen liegen. Wird bei Bedarf angelegt.
const ORDNER_NAME = 'Zeiterfassung-Rechnungen';

// Betreff: «Rechnung: Geldcast – Folge 112, Folge 113» usw. (Bereich und Projekte der Rechnung, siehe betreff_).
const BETREFF = 'Rechnung';

const TEXT = [
  'Geschätzte Kundin',
  'Geschätzter Kunde',
  '',
  'Das ist ein automatisch generiertes E-Mail. Im Anhang finden Sie die Rechnung für meine Arbeiten. Sie finden alle Details dazu im angehängten Dokument.',
  '',
  'Ich danke Ihnen für das Vertrauen in meine Arbeit.',
  '',
  'Freundliche Grüsse',
  '',
  'Fabio',
].join('\n');

const ZEITZONE = 'Europe/Zurich';

// Die tägliche Prüfung läuft in der Stunde ab dieser Uhrzeit, also zwischen 3 und 4 Uhr nachts.
// Nach einer Änderung die Funktion «einrichten» einmal ausführen.
const STUNDE = 3;
const LISTE = 'rechnungen.json';

// Sammelrechnungen mit fester Kennung (beginnt mit «R-») erst ab diesem Rechnungsdatum als Entwurf erstellen.
// So entstehen für ältere Rechnungen, die schon einen Entwurf hatten, keine doppelten.
const NEUE_KENNUNG_AB = '2026-11-23';

/** Einmal ausführen: legt den Ordner an, richtet die tägliche Prüfung ein und prüft gleich ein erstes Mal. */
function einrichten() {
  ordner_();
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'rechnungsEntwuerfeErstellen'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rechnungsEntwuerfeErstellen').timeBased().everyDays(1).atHour(STUNDE).inTimezone(ZEITZONE).create();
  console.log('Die tägliche Prüfung ist eingerichtet (jeweils zwischen ' + STUNDE + ' und ' + (STUNDE + 1) + ' Uhr).');
  rechnungsEntwuerfeErstellen();
}

/** Läuft täglich: erstellt Entwürfe für alle Rechnungen, deren Rechnungsdatum heute ist oder schon vorbei. */
function rechnungsEntwuerfeErstellen() {
  const ordner = ordner_();
  const rechnungen = leseListe_(ordner);
  const heute = Utilities.formatDate(new Date(), ZEITZONE, 'yyyy-MM-dd');
  const merker = PropertiesService.getScriptProperties();
  let erstellt = 0;
  let ersetzt = 0;

  rechnungen.forEach(function (r) {
    if (!r.datum || r.datum > heute) return;                 // noch nicht fällig
    if (String(r.id).indexOf('R-') === 0 && r.datum < NEUE_KENNUNG_AB) return;
    const schluessel = 'entwurf_' + r.id + '_' + r.datum;
    const mitglieder = r.mitglieder || '';
    const vorher = merkerLesen_(merker.getProperty(schluessel));
    let alterEntwurf = null;
    if (vorher) {
      // Schon erstellt. Nur wenn seither Projekte dazugekommen oder weggefallen sind, den Entwurf ersetzen.
      if (!vorher.entwurf || vorher.mitglieder === mitglieder) return;
      try { alterEntwurf = GmailApp.getDraft(vorher.entwurf); } catch (e) { alterEntwurf = null; }
      if (!alterEntwurf) {
        // Schon gesendet oder von Hand gelöscht: nichts Neues erstellen, damit nichts doppelt verrechnet wird.
        console.log('Nicht ersetzt, der Entwurf ist schon gesendet oder gelöscht: ' + r.kunde + ' – ' + r.projekt);
        merker.setProperty(schluessel, JSON.stringify({ datum: vorher.datum, entwurf: vorher.entwurf, mitglieder: mitglieder }));
        return;
      }
    }
    if (!r.an) { console.log('Übersprungen (keine E-Mail-Adresse): ' + r.kunde + ' – ' + r.projekt); return; }
    const pdf = neusteDatei_(ordner, r.datei);
    if (!pdf) { console.log('PDF fehlt in Drive: ' + r.datei); return; }

    if (alterEntwurf) { alterEntwurf.deleteDraft(); ersetzt++; }
    const entwurf = GmailApp.createDraft(r.an, betreff_(r), TEXT, { attachments: [pdf.getAs('application/pdf').setName(anhangName_(r))] });
    merker.setProperty(schluessel, JSON.stringify({ datum: heute, entwurf: entwurf.getId(), mitglieder: mitglieder }));
    if (!alterEntwurf) erstellt++;
    console.log((alterEntwurf ? 'Entwurf ersetzt: ' : 'Entwurf erstellt: ') + r.kunde + ' – ' + r.projekt + ' an ' + r.an);
  });

  console.log(erstellt + ' Entwürfe erstellt, ' + ersetzt + ' ersetzt, ' + rechnungen.length + ' Rechnungen in der Liste.');
}

/* ---------- Web-App: nimmt die Rechnungen der Zeiterfassungs-App entgegen ---------- */

function doPost(e) {
  let antwort;
  try {
    const anfrage = JSON.parse(e.postData.contents);
    if (SCHLUESSEL.length < 16 || SCHLUESSEL.indexOf('HIER-') === 0) antwort = { ok: false, fehler: 'Im Google-Skript ist noch kein eigener Schlüssel eingetragen.' };
    else if (anfrage.schluessel !== SCHLUESSEL) antwort = { ok: false, fehler: 'Der Schlüssel stimmt nicht mit dem im Google-Skript überein.' };
    else if (anfrage.aktion === 'liste') antwort = { ok: true, rechnungen: vorhandene_() };
    else if (anfrage.aktion === 'abgleich') antwort = abgleich_(anfrage.rechnungen || []);
    else antwort = { ok: false, fehler: 'Unbekannte Aktion.' };
  } catch (err) {
    antwort = { ok: false, fehler: 'Fehler im Google-Skript: ' + err };
  }
  return ContentService.createTextOutput(JSON.stringify(antwort)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Die Web-App für die Rechnungsentwürfe läuft.');
}

/** Welche Rechnungen (mit welchem Stand) schon vollständig in Drive liegen. */
function vorhandene_() {
  const ordner = ordner_();
  return leseListe_(ordner)
    .filter(function (r) { return neusteDatei_(ordner, r.datei); })
    .map(function (r) { return { id: r.id, hash: r.hash }; });
}

/** Übernimmt die aktuelle Liste der App: neue oder geänderte PDFs speichern, erledigte entfernen. */
function abgleich_(neu) {
  const sperre = LockService.getScriptLock();
  sperre.waitLock(30000);
  try {
    const ordner = ordner_();
    const alt = leseListe_(ordner);
    const fehlt = [];
    const liste = [];
    neu.forEach(function (r) {
      if (r.pdf) {
        loesche_(ordner, r.datei);
        ordner.createFile(Utilities.newBlob(Utilities.base64Decode(r.pdf), 'application/pdf', r.datei));
      } else if (!neusteDatei_(ordner, r.datei)) {
        fehlt.push(r.id);
        return;
      }
      liste.push({ id: r.id, hash: r.hash, datum: r.datum, an: r.an, bereich: r.bereich || '', kunde: r.kunde, projekt: r.projekt, mitglieder: r.mitglieder || '', total: r.total, datei: r.datei });
    });
    const behalten = {};
    liste.forEach(function (r) { behalten[r.datei] = true; });
    alt.forEach(function (r) { if (r.datei && !behalten[r.datei]) loesche_(ordner, r.datei); });
    loesche_(ordner, LISTE);
    ordner.createFile(LISTE, JSON.stringify({ version: 1, aktualisiert: new Date().toISOString(), rechnungen: liste }, null, 1), 'application/json');
    return { ok: true, anzahl: liste.length, fehlt: fehlt };
  } finally {
    sperre.releaseLock();
  }
}

/* ---------- Hilfen ---------- */

function ordner_() {
  const treffer = DriveApp.getFoldersByName(ORDNER_NAME);
  return treffer.hasNext() ? treffer.next() : DriveApp.createFolder(ORDNER_NAME);
}

function leseListe_(ordner) {
  const datei = neusteDatei_(ordner, LISTE);
  if (!datei) return [];
  return JSON.parse(datei.getBlob().getDataAsString('UTF-8')).rechnungen || [];
}

/** Liefert die zuletzt geänderte Datei mit diesem Namen im Ordner (falls es mehrere gibt). */
function neusteDatei_(ordner, name) {
  const dateien = ordner.getFilesByName(name);
  let beste = null;
  while (dateien.hasNext()) {
    const d = dateien.next();
    if (!beste || d.getLastUpdated() > beste.getLastUpdated()) beste = d;
  }
  return beste;
}

/** Legt alle Dateien mit diesem Namen im Ordner in den Papierkorb. */
function loesche_(ordner, name) {
  const dateien = ordner.getFilesByName(name);
  while (dateien.hasNext()) dateien.next().setTrashed(true);
}

/** Dateiname des Anhangs ohne die interne Projektnummer am Anfang. */
function anhangName_(r) {
  return String(r.datei).indexOf(r.id + '_') === 0 ? String(r.datei).slice(r.id.length + 1) : r.datei;
}

/**
 * Betreff aus dem Inhalt der Rechnung: «Rechnung: Geldcast – Folge 112, Folge 113».
 * Steht der Bereich schon vorne im Projektnamen, wird er nicht doppelt geschrieben.
 * Bei langen Listen: «Rechnung: Geldcast – Folge 112 und 7 weitere».
 */
function betreff_(r) {
  const bereich = String(r.bereich || '').trim();
  const namen = String(r.projekt || '').split(', ')
    .map(function (n) {
      n = n.trim();
      if (bereich && n.toLowerCase().indexOf(bereich.toLowerCase()) === 0) n = n.slice(bereich.length).replace(/^[\s:–-]+/, '');
      return n;
    })
    .filter(Boolean);
  let inhalt = namen.join(', ');
  if (inhalt.length > 70 && namen.length > 1) inhalt = namen[0] + ' und ' + (namen.length - 1) + ' weitere';
  const teile = [bereich, inhalt].filter(Boolean);
  return teile.length ? BETREFF + ': ' + teile.join(' – ') : BETREFF;
}

/** Gespeicherter Stand eines Entwurfs. Ältere Fassungen des Skripts speicherten nur das Datum. */
function merkerLesen_(wert) {
  if (!wert) return null;
  try { const o = JSON.parse(wert); return o && typeof o === 'object' ? o : { datum: wert }; } catch (e) { return { datum: wert }; }
}
