/**
 * Rechnungsentwürfe für Gmail
 *
 * Die Zeiterfassungs-App legt fällige Rechnungen als PDF in einen Ordner von Google Drive,
 * zusammen mit der Liste «rechnungen.json». Dieses Skript läuft einmal pro Tag und erstellt
 * für jede Rechnung, deren Rechnungsdatum erreicht ist, einen Entwurf in Gmail mit dem PDF im Anhang.
 * Es sendet nichts.
 *
 * Einrichten: Funktion «einrichten» einmal ausführen.
 */

// Name des Ordners in «Meine Ablage», in den die App die Rechnungen legt.
const ORDNER_NAME = 'Zeiterfassung-Rechnungen';

const BETREFF = 'Rechnung';

const TEXT = [
  'Geschätzte Kundin',
  'Geschätzter Kunde',
  '',
  'Das ist ein automatisch generiertes E-Mail. Im Anhang finden Sie die Rechnung für meine Arbeiten; Sie finden alle Details dazu im angehängten Dokument.',
  '',
  'Ich danke Ihnen für das Vertrauen in meine Arbeit.',
  '',
  'Freundliche Grüsse',
  '',
  'Fabio',
].join('\n');

const ZEITZONE = 'Europe/Zurich';
const LISTE = 'rechnungen.json';

/** Einmal ausführen: richtet die tägliche Prüfung ein und prüft gleich ein erstes Mal. */
function einrichten() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'rechnungsEntwuerfeErstellen'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rechnungsEntwuerfeErstellen').timeBased().everyDays(1).atHour(6).inTimezone(ZEITZONE).create();
  console.log('Die tägliche Prüfung ist eingerichtet (jeweils zwischen 6 und 7 Uhr).');
  rechnungsEntwuerfeErstellen();
}

/** Läuft täglich: erstellt Entwürfe für alle Rechnungen, deren Rechnungsdatum heute ist oder schon vorbei. */
function rechnungsEntwuerfeErstellen() {
  const ordner = findeOrdner_();
  if (!ordner) { console.log('Der Ordner «' + ORDNER_NAME + '» wurde in Google Drive nicht gefunden.'); return; }
  const liste = neusteDatei_(ordner, LISTE);
  if (!liste) { console.log('Im Ordner liegt noch keine Liste «' + LISTE + '». Öffne die Zeiterfassungs-App, damit sie die Rechnungen bereitstellt.'); return; }

  const rechnungen = JSON.parse(liste.getBlob().getDataAsString('UTF-8')).rechnungen || [];
  const heute = Utilities.formatDate(new Date(), ZEITZONE, 'yyyy-MM-dd');
  const merker = PropertiesService.getScriptProperties();
  let erstellt = 0;

  rechnungen.forEach(function (r) {
    if (!r.datum || r.datum > heute) return;                 // noch nicht fällig
    const schluessel = 'entwurf_' + r.id + '_' + r.datum;
    if (merker.getProperty(schluessel)) return;              // für dieses Datum schon erstellt
    if (!r.an) { console.log('Übersprungen (keine E-Mail-Adresse): ' + r.kunde + ' – ' + r.projekt); return; }
    const pdf = neusteDatei_(ordner, r.datei);
    if (!pdf) { console.log('PDF noch nicht in Drive angekommen: ' + r.datei); return; }   // beim nächsten Lauf erneut versuchen

    GmailApp.createDraft(r.an, BETREFF, TEXT, { attachments: [pdf.getAs('application/pdf').setName(anhangName_(r))] });
    merker.setProperty(schluessel, heute);
    erstellt++;
    console.log('Entwurf erstellt: ' + r.kunde + ' – ' + r.projekt + ' an ' + r.an);
  });

  console.log(erstellt + ' Entwürfe erstellt, ' + rechnungen.length + ' Rechnungen in der Liste.');
}

function findeOrdner_() {
  const treffer = DriveApp.getFoldersByName(ORDNER_NAME);
  return treffer.hasNext() ? treffer.next() : null;
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

/** Dateiname des Anhangs ohne die interne Projektnummer am Anfang. */
function anhangName_(r) {
  return String(r.datei).indexOf(r.id + '_') === 0 ? String(r.datei).slice(r.id.length + 1) : r.datei;
}
