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
