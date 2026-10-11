// Kleine Selbstprüfung der Rechenlogik: node tools/test-calc.js
const assert = require('assert');
const C = require('../src/calc.js');
const s = C.settings({});
const p = (o) => Object.assign({ mwst: 'drauf', kosten: 0, abrechnung: 'rechnung' }, o);

// Beträge wie auf den Beispielrechnungen
for (const [netto, mwst, total] of [[3820, 309.42, 4129.42], [6224, 504.14, 6728.14], [2260, 183.06, 2443.06], [2500, 202.5, 2702.5], [3750, 303.75, 4053.75], [2255, 182.66, 2437.66]]) {
  const f = C.projectFigures(p({ betrag: netto }), 0, s, '2026-10-08');
  assert.strictEqual(f.mwstBetrag, mwst); assert.strictEqual(f.rechnungsbetrag, total);
}
// Betrag inklusive Mehrwertsteuer
let f = C.projectFigures(p({ betrag: 1081, mwst: 'inkl', stundenZiel: 10 }), 5, s, '2026-10-08');
assert.strictEqual(f.rechnungsbetrag, 1081); assert.ok(Math.abs(f.netto - 1000) < 1e-9); assert.ok(Math.abs(f.lohnZiel - 65) < 1e-9); assert.ok(Math.abs(f.lohnEff - 130) < 1e-9);
// Kosten für Dritte, Stundenlohn
f = C.projectFigures(p({ betrag: 6224, kosten: 1610, stundenZiel: 12 }), 16.75, s, '2026-10-08');
assert.strictEqual(f.meinTeil, 4614); assert.ok(Math.abs(f.lohnZiel - 249.925) < 1e-9); assert.ok(Math.abs(f.lohnEff - 179.0507462686567) < 1e-9);
// Status
assert.strictEqual(C.status(p({ rechnungsdatum: '2026-09-01' }), 3, s, '2026-10-08').code, 'ueberfaellig');
assert.strictEqual(C.status(p({ rechnungsdatum: '2026-09-18' }), 3, s, '2026-10-08').code, 'gestellt');
assert.strictEqual(C.status(p({ rechnungsdatum: '2026-09-01', zahlungsdatum: '2026-09-20' }), 3, s, '2026-10-08').code, 'bezahlt');
assert.strictEqual(C.status(p({}), 3, s, '2026-10-08').code, 'offen');
assert.strictEqual(C.status(p({}), 0, s, '2026-10-08').code, 'geplant');
assert.strictEqual(C.status(p({ abrechnung: 'ohne' }), 3, s, '2026-10-08').code, 'pruefen');
// Eingaben
assert.strictEqual(C.parseHours('1:30'), 1.5); assert.strictEqual(C.parseHours('1,25'), 1.25); assert.strictEqual(C.parseHours('45m'), 0.75); assert.strictEqual(C.parseHours('abc'), null);
assert.strictEqual(C.parseAmount("3’390+430"), 3820); assert.strictEqual(C.parseAmount("6'430-1500"), 4930); assert.strictEqual(C.parseAmount('x'), null);
// Monatliches Soll wie im Excel
assert.ok(Math.abs(C.monthlyTarget(s) - 133.73333333333335) < 1e-9);
console.log('Alle Prüfungen bestanden.');

// Rechnung: Positionen, Einleitung, Summen
{
  const base = { abrechnung: 'rechnung', mwst: 'drauf', kosten: 0, rechnungsadresse: 'Firma\nStrasse 1\n3000 Bern' };
  let m = C.invoiceModel(Object.assign({}, base, { betrag: 3820, rechnungstext: 'Moderation; 3390\nZusatzkosten; 430', rechnungGeplant: '2026-09-18' }), s, '2026-10-08');
  assert.deepStrictEqual(m.fehler, []); assert.strictEqual(m.zwischentotal, 3820); assert.strictEqual(m.mwst, 309.42); assert.strictEqual(m.total, 4129.42); assert.strictEqual(m.datumLang, '18. September 2026');
  m = C.invoiceModel(Object.assign({}, base, { betrag: 3820, rechnungstext: 'A; 3000\nB; 430' }), s, '2026-10-08'); assert.strictEqual(m.fehler.length, 1);
  m = C.invoiceModel(Object.assign({}, base, { betrag: 100, rechnungsadresse: '' }), s, '2026-10-08'); assert.strictEqual(m.fehler.length, 1);
  assert.strictEqual(C.invoiceIntro({}), 'Auf Basis unserer Vereinbarungen stelle ich hiermit folgende Arbeiten in Rechnung.');
  assert.strictEqual(C.invoiceIntro({ offerteVom: '2026-01-15', emailVom: '2026-07-07' }), 'Auf Basis meiner Offerte vom 15. Januar 2026 und unseres E-Mail-Austauschs vom 7. Juli 2026 stelle ich hiermit folgende Arbeiten in Rechnung.');
  console.log('Rechnungsprüfungen bestanden.');
}

// Sammelrechnung und Zusammenführen
{
  const adr = 'Verband\nMattenstrasse 8\n3073 Gümligen';
  const mk = (id, betrag, extra) => Object.assign({ id, sort: +id.slice(1), jahr: 2026, bereich: 'Angebot und Nachgefragt', kunde: 'VSRB', name: 'Folge ' + id, abrechnung: 'rechnung', mwst: 'drauf', kosten: 0, betrag, rechnungsadresse: adr, rechnungsEmail: 'A@b.ch', rechnungGeplant: '2026-10-20' }, extra || {});
  const ps = [mk('p1', 975), mk('p2', 975, { rechnungsEmail: 'a@b.ch ' }), mk('p3', 975, { rechnungGeplant: '2026-11-20' }), mk('p4', 2195, { rechnungsadresse: adr + '\n' })];
  const g = C.invoiceGroup(ps[0], ps);
  assert.deepStrictEqual(g.map((p) => p.id), ['p1', 'p2', 'p4']);
  const m = C.invoiceModelGroup(g, s, '2026-10-08');
  assert.deepStrictEqual(m.fehler, []); assert.strictEqual(m.positionen.length, 3); assert.strictEqual(m.zwischentotal, 4145); assert.strictEqual(m.mwst, 335.75); assert.strictEqual(m.total, 4480.75);
  assert.strictEqual(C.invoiceGroup(ps[2], ps).length, 1);
  // anderer Bereich: eigene Rechnung, auch bei gleichem Datum, gleicher Adresse und gleicher E-Mail
  const anderer = mk('p7', 1725, { bereich: 'Geldcast' });
  assert.deepStrictEqual(C.invoiceGroup(anderer, ps.concat(anderer)).map((p) => p.id), ['p7']);
  assert.deepStrictEqual(C.invoiceGroup(ps[0], ps.concat(anderer)).map((p) => p.id), ['p1', 'p2', 'p4']);
  assert.strictEqual(C.invoiceModelGroup([ps[0], mk('p9', 100, { mwst: 'keine' })], s, '2026-10-08').fehler.length, 1);
  // gestellte Gruppe bleibt zusammen, auch wenn später Daten ändern
  ps[0].rechnungsdatum = ps[1].rechnungsdatum = '2026-10-20'; ps[0].rechnungGruppe = ps[1].rechnungGruppe = 'RG1'; ps[1].rechnungGeplant = '2026-12-01';
  assert.deepStrictEqual(C.invoiceGroup(ps[0], ps).map((p) => p.id), ['p1', 'p2']);
  assert.deepStrictEqual(C.invoiceGroup(ps[3], ps).map((p) => p.id), ['p4']);

  const A = { settings: { x: 1 }, settingsMod: 5, projects: [{ id: 'a', jahr: 2026, sort: 1, name: 'alt', mod: 1 }, { id: 'b', jahr: 2026, sort: 2, mod: 1 }], entries: [{ id: 'e1', projectId: 'a', datum: '2026-01-02', stunden: 1, mod: 1 }, { id: 'e2', projectId: 'b', datum: '2026-01-03', stunden: 2, mod: 1 }], geloescht: {} };
  const B = { settings: { x: 2 }, settingsMod: 9, projects: [{ id: 'a', jahr: 2026, sort: 1, name: 'neu', mod: 7 }, { id: 'c', jahr: 2026, sort: 3, mod: 4 }], entries: [{ id: 'e1', projectId: 'a', datum: '2026-01-02', stunden: 1, mod: 1 }, { id: 'e3', projectId: 'c', datum: '2026-01-01', stunden: 3, mod: 4 }], geloescht: { b: 6, e2: 6 } };
  for (const M of [C.mergeData(A, B), C.mergeData(B, A)]) {
    assert.deepStrictEqual(M.projects.map((p) => p.id + ':' + (p.name || '')), ['a:neu', 'c:']);
    assert.deepStrictEqual(M.entries.map((e) => e.id), ['e3', 'e1']);
    assert.strictEqual(M.settings.x, 2);
  }
  console.log('Sammelrechnung und Zusammenführen bestanden.');
}

// Buchhaltung
{
  const L = require('../src/ledger.js');
  const plan = [
    { sektion: '1', gruppe: '', konto: '', text: 'AKTIVEN' },
    { konto: '1010', text: 'Bank', bklasse: '1', summe_in: '100' }, { gruppe: '100', text: 'Flüssige Mittel', summe_in: '1' }, { gruppe: '1', text: 'Total Aktiven', summe_in: '00' },
    { sektion: '2', gruppe: '', konto: '', text: 'PASSIVEN' },
    { konto: '2800', text: 'Kapital', bklasse: '2', summe_in: '28' }, { konto: '2970', text: 'Vortrag', bklasse: '2', summe_in: '297' },
    { gruppe: '29A', text: 'Jahresgewinn', summe_in: '297' }, { gruppe: '297', text: 'Bilanzgewinn', summe_in: '28' }, { gruppe: '28', text: 'Eigenkapital', summe_in: '2' }, { gruppe: '2', text: 'Total Passiven', summe_in: '00' },
    { sektion: '*', gruppe: '', konto: '', text: 'ERFOLGSRECHNUNG' },
    { konto: '3400', text: 'Ertrag', bklasse: '4', summe_in: 'E7' }, { konto: '6600', text: 'Werbung', bklasse: '3', summe_in: 'E7' }, { gruppe: 'E7', text: 'Jahresgewinn', summe_in: '29A' }, { gruppe: '00', text: 'Differenz', summe_in: '' },
  ];
  const b = [
    { id: 'a', datum: '2026-01-01', beleg: '1', text: 'Eröffnung', soll: '1010', haben: '2800', betrag: 20000, pos: 1 },
    { id: 'b', datum: '2026-03-01', beleg: '2', text: 'Honorar', soll: '1010', haben: '3400', betrag: 1081.05, pos: 2 },
    { id: 'c', datum: '2026-02-01', beleg: '3a', text: 'Werbung', soll: '6600', haben: '1010', betrag: 81.05, pos: 3 },
  ];
  const a = L.auswertung(plan, b);
  assert.strictEqual(a.konto.get('1010').saldo, 21000); assert.strictEqual(a.gruppe.get('1'), 21000); assert.strictEqual(a.gruppe.get('E7'), -1000);
  assert.strictEqual(a.gruppe.get('2'), -21000); assert.strictEqual(a.gruppe.get('00'), 0);
  const t = L.totalsummen(plan, b); assert.strictEqual(t.bilanz, 1000); assert.strictEqual(t.erfolg, -1000); assert.strictEqual(t.differenz, 0);
  const k = L.kontoauszug('1010', b); assert.deepStrictEqual(k.zeilen.map((z) => z.saldo), [20000, 19918.95, 21000]); assert.strictEqual(k.zeilen[1].gegenkonto, '6600');
  const e = L.eroeffnung(plan, b, 2027, '2970'); assert.deepStrictEqual(e.map((x) => [x.soll, x.haben, x.betrag]), [['1010', '2970', 21000], ['2970', '2800', 20000]]);
  assert.strictEqual(L.saldi(e).get('2970').saldo, -1000); assert.strictEqual(L.naechsterBeleg(b), '4');
  const ab = L.abschnitte(plan); assert.strictEqual(ab.aktiven.length, 3); assert.strictEqual(ab.erfolg.length, 4);
  // Zusammenführen zweier Rechner
  const M = C.mergeData({ projects: [], entries: [], buchungen: [Object.assign({}, b[0], { mod: 1 })], kontenplaene: { 2026: { mod: 1, zeilen: plan } } },
    { projects: [], entries: [], buchungen: [Object.assign({}, b[0], { mod: 5, betrag: 1 }), Object.assign({}, b[1], { mod: 2 })], kontenplaene: { 2026: { mod: 3, zeilen: plan.slice(0, 2) }, 2027: { mod: 1, zeilen: [] } } });
  assert.deepStrictEqual(M.buchungen.map((x) => x.id + ':' + x.betrag), ['a:1', 'b:1081.05']); assert.strictEqual(M.kontenplaene[2026].zeilen.length, 2); assert.ok(M.kontenplaene[2027]);
  console.log('Buchhaltung bestanden.');

  // Bankabgleich (erfundene Daten)
  const csv = ['IBAN;Booked At;Text;Credit/Debit Amount;Balance;Valuta Date',
    'CH00;2026-02-01 00:00:00.0;Online Einkauf Meta 31.01.2026, 08:00, Debit Mastercard-Nr. 1234xxxx;-81.05;19918.95;2026-02-01 00:00:00.0',
    'CH00;2026-03-03 00:00:00.0;Gutschrift Kunde AG;1081.05;21000;2026-03-03 00:00:00.0',
    'CH00;2026-04-02 00:00:00.0;Online Einkauf Meta 01.04.2026, 09:00, Debit Mastercard-Nr. 1234xxxx;-50;20950;2026-04-02 00:00:00.0',
    'CH00;2026-04-05 00:00:00.0;Zahlung Unbekannt GmbH;-10;20940;2026-04-05 00:00:00.0'].join('\r\n');
  const pz = L.parseBankCsv(csv); assert.ok(!pz.fehler); assert.strictEqual(pz.zeilen.length, 4);
  assert.strictEqual(pz.zeilen[0].betrag, -81.05); assert.strictEqual(pz.zeilen[0].datum, '2026-02-01'); assert.strictEqual(pz.zeilen[3].saldo, 20940);
  assert.ok(L.parseBankCsv('a;b\n1;2').fehler);
  const ag = L.bankAbgleich(pz.zeilen, b, '1010', []);
  assert.strictEqual(ag.paare.length, 2); assert.strictEqual(ag.neu.length, 2);   // Honorar trotz zwei Tagen Abstand erkannt, Eröffnung bleibt unberührt
  const v1 = L.bankVorschlag(ag.neu[0], ag.paare, '1010');
  assert.deepStrictEqual([v1.text, v1.soll, v1.haben, v1.betrag, v1.sicher], ['Werbung', '6600', '1010', 50, true]);
  const v2 = L.bankVorschlag(ag.neu[1], ag.paare, '1010'); assert.strictEqual(v2.soll, ''); assert.strictEqual(v2.haben, '1010'); assert.strictEqual(v2.sicher, false);
  // Zweiter Import: Vorschläge werden über den Schlüssel wiedererkannt, Verworfenes bleibt weg
  const mitV = b.concat([Object.assign({ id: 'v1', vorschlag: true }, v1)]);
  const ag2 = L.bankAbgleich(pz.zeilen, mitV, '1010', [v2.bankSchluessel]);
  assert.strictEqual(ag2.neu.length, 0); assert.strictEqual(ag2.ignoriert, 1); assert.strictEqual(ag2.paare.length, 3);
  // Zahlungseingänge und offene Rechnungen (erfundene Daten)
  const P = (id, o) => Object.assign({ id, jahr: 2026, abrechnung: 'rechnung', mwst: 'drauf', bereich: 'A', kunde: 'Kunde', name: id, rechnungsadresse: 'Muster Bündner Bank AG\nPostfach', rechnungsdatum: '2026-03-01', zahlungsdatum: null, rechnungGruppe: null }, o);
  const Z = (datum, betrag, text) => ({ datum, betrag, text, schluessel: datum + betrag + text });
  const ps = [P('p1', { betrag: 1000 }), P('p2', { betrag: 2260 }), P('p3', { betrag: 500 }), P('p4', { betrag: 500 }), P('p5', { betrag: 300, mwst: 'keine', rechnungsadresse: 'Verein Beispiel', rechnungsdatum: '2026-05-01' }),
    P('p6', { betrag: 1000, zahlungsdatum: '2026-02-10', rechnungsdatum: '2026-01-15' })];
  const zz = [Z('2026-02-11', 1081, 'Gutschrift Muster Buendner Bank AG'),   // gehört zur bereits bezahlten p6
    Z('2026-02-20', 1081, 'Gutschrift Muster Bundner Bank AG'),              // vor dem Rechnungsdatum von p1: nicht zuordnen
    Z('2026-03-20', 1081, 'Gutschrift Muster Buendner Bank AG'),             // p1
    Z('2026-03-21', 2443.05, 'Gutschrift MUSTER BUNDNER BANK AG'),           // p2, auf fünf Rappen gerundet (2443.06)
    Z('2026-03-25', 1081, 'Gutschrift Muster Bündner Bank AG'),              // p3 + p4 zusammen
    Z('2026-05-20', 300, 'Gutschrift Hans Fremd'),                           // Betrag passt, Zahler nicht
    Z('2026-05-21', -300, 'Zahlung Verein Beispiel')];
  const zr = C.zahlungenZuordnen(zz, ps, {});
  assert.deepStrictEqual(zr.treffer.map((t) => t.zeile.datum + ':' + t.projekte.map((x) => x.id).join('+')), ['2026-03-20:p1', '2026-03-21:p2', '2026-03-25:p3+p4']);
  assert.deepStrictEqual(zr.fast.map((t) => t.zeile.datum + ':' + t.projekte.map((x) => x.id).join('+')), ['2026-05-20:p5']);
  assert.ok(C.zahlerPasst('Gutschrift Universitat Bern', ['Universität Bern'])); assert.ok(!C.zahlerPasst('Gutschrift Live Fabrik GmbH', ['Verband Schweizer Regionalbanken']));
  assert.ok(!C.zahlerPasst('Gutschrift Irgendwer AG', ['AG']));
  // Schon verwendete Gutschrift zahlt keine zweite Rechnung
  ps[0].zahlungsdatum = '2026-03-20'; ps[0].zahlungBank = zz[2].schluessel; ps.push(P('p7', { betrag: 1000, rechnungsdatum: '2026-03-10' }));
  assert.strictEqual(C.zahlungenZuordnen(zz.slice(0, 3), ps, {}).treffer.length, 0);
  // Reihenfolge wie im E-Banking
  const bs = L.bankSortiert([{ id: 'x', datum: '2026-10-31', bankDatum: '2026-09-30', bankNr: 7, pos: 1 }, { id: 'y', datum: '2026-10-01', pos: 2 }, { id: 'z', datum: '2026-09-30', bankDatum: '2026-09-30', bankNr: 5, pos: 9 }, { id: 'w', datum: '2026-09-30', pos: 3 }]);
  assert.deepStrictEqual(bs.map((x) => x.id), ['z', 'x', 'w', 'y']);
  console.log('Bankabgleich bestanden.');
}

// Offerten
{
  const O = require('../src/offertdoc.js');
  const d = O.normalize({ art: 'kostenvoranschlag', teile: [{ nummer: '1a', titel: 'Test & Co.', text: 'Die *Firma* offeriert.', bloecke: [
    { titel: 'A', zeilen: [{ was: 'PM', aufwand: '2h', ansatz: 215, preis: 'inklusive' }, { was: 'Recherche', aufwand: '10h', ansatz: '215' }] },
    { titel: 'B', zeilen: [{ was: 'Vor Ort', aufwand: '4h', ansatz: 275 }, { was: 'Abend', aufwand: 'pauschal', ansatz: 500, preis: 'null' }, { was: 'Auswärts', aufwand: 'pauschal', ansatz: 500 }] }] },
    { titel: 'Liste', bloecke: [{ zeilen: [{ was: 'Werbewoche', ansatz: 1980 }] }] }] });
  assert.strictEqual(O.blockTotal(d.teile[0].bloecke[0]), 2150); assert.strictEqual(O.teilTotal(d.teile[0]), 3750); assert.strictEqual(O.teilTotal(d.teile[1]), 1980);
  assert.strictEqual(O.ansatzText(d.teile[0].bloecke[0].zeilen[1]), '215 Fr./h'); assert.strictEqual(O.ansatzText(d.teile[0].bloecke[1].zeilen[1]), '500 Fr.');
  assert.ok(!O.istEinfach(d.teile[0])); assert.ok(O.istEinfach(d.teile[1])); assert.strictEqual(O.kurz(d), '1a 3750.00 · 1980.00');
  const h = O.html(d, { kunde: 'K & Co', name: 'Anlass', datum: '2026-10-11' }); assert.ok(h.includes('<b>Kostenvoranschlag 1a</b>')); assert.ok(h.includes('Test &amp; Co.')); assert.ok(h.includes('3750.00 Fr.'));
  assert.ok(h.includes('K &amp; Co')); assert.ok(h.includes('11. Oktober 2026')); assert.ok(h.includes('Alle Preise exkl. Mehrwertsteuer')); assert.ok(!h.includes('offeriert'));
  assert.ok(O.html(Object.assign({}, d, { art: 'offerte' })).includes('<b>Offerte 1a</b>'));
  const t = O.latex(d); assert.ok(t.includes('Test \\& Co.')); assert.ok(t.includes('\\textit{Firma}')); assert.ok(t.includes('\\textbf{3750.00 Fr.}'));
  const r = O.ausAntwort('Gerne:\n```json\n' + JSON.stringify(d) + '\n```\nFertig.'); assert.ok(!r.fehler); assert.deepStrictEqual(r.doc, d);
  assert.ok(O.ausAntwort('kein json').fehler); assert.ok(O.ausAntwort('{"a":1}').fehler);
  assert.ok(O.promptAnpassen(d).includes('"nummer": "1a"'));
  const C2 = require('../src/calc.js');
  const m = C2.mergeData({ projects: [], entries: [], offerten: [{ id: 'o1', status: 'offen', mod: 1 }] }, { projects: [], entries: [], offerten: [{ id: 'o1', status: 'zugesagt', mod: 2 }], offertVorlagen: [{ id: 'v1', mod: 1 }] });
  assert.strictEqual(m.offerten[0].status, 'zugesagt'); assert.strictEqual(m.offertVorlagen.length, 1);
  // LaTeX hin und zurück, auch nach einer Änderung von Hand
  const rl = O.ausLatex(O.latex(d)); assert.ok(!rl.fehler); assert.deepStrictEqual(rl.doc, d);
  const ge = O.ausLatex(O.latex(d).replace('10h & 215 Fr./h', '12h & 220 Fr./h').replace('Test \\& Co.', 'Neu')).doc;
  assert.strictEqual(O.teilTotal(ge.teile[0]), 12 * 220 + 1100 + 500); assert.strictEqual(ge.teile[0].titel, 'Neu'); assert.strictEqual(ge.art, 'kostenvoranschlag');
  assert.ok(O.ausLatex('nur Text').fehler); assert.ok(!O.ausDatei({ text: O.latex(d) }).fehler); assert.ok(!O.ausDatei({ text: JSON.stringify(d) }).fehler);
  // PDF-Stücke: Kopf, Einleitung, Tabelle
  const I = (s, x, y, w, o) => Object.assign({ s, x, y, w, fett: false, kursiv: false }, o);
  const pd = O.ausPdf([{ items: [I('Offerte 2:', 40, 50, 60, { fett: true }), I('Referat', 104, 50, 40, { fett: true }), I('Die', 40, 70, 14), I('Firma', 58, 70, 24, { kursiv: true }), I('o', 86, 70, 5), I('ff', 91, 70, 6), I('eriert.', 97, 70, 28),
    I('Was', 45, 90, 18, { fett: true }), I('Aufwand', 540, 90, 42, { fett: true }), I('Ansatz', 606, 90, 31, { fett: true }), I('Preis', 698, 90, 23, { fett: true }), I('Total', 761, 90, 23, { fett: true }),
    I('Vorbereitung', 45, 104, 60, { fett: true }), I('Recherche', 45, 116, 50), I('3h', 540, 116, 10), I('215 Fr./h', 606, 116, 40), I('645.00 Fr.', 680, 116, 41), I('645.00 Fr.', 743, 116, 41),
    I('Preis', 45, 130, 23, { fett: true }), I('645.00 Fr.', 743, 130, 41, { fett: true })] }]);
  assert.ok(!pd.fehler); assert.deepStrictEqual(pd.doc, O.normalize({ art: 'offerte', teile: [{ nummer: '2', titel: 'Referat', text: 'Die *Firma* offeriert.', bloecke: [{ titel: 'Vorbereitung', zeilen: [{ was: 'Recherche', aufwand: '3h', ansatz: 215 }] }] }] }));
  console.log('Offerten bestanden.');
}
