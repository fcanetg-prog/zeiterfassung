// Prüft die App-Rechenlogik gegen die im Excel gespeicherten Werte.
const Calc = require('../src/calc.js');
const data = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const xl = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const s = Calc.settings(data), hrs = Calc.hoursByProject(data.entries);
let bad = 0, n = 0;
const cmp = (what, a, b) => { n++; if (a == null && b == null) return; if (a == null || b == null || Math.abs(a - b) > 0.006) { bad++; console.log('ABWEICHUNG', what, a, b); } };
for (const p of data.projects) {
  const f = Calc.projectFigures(p, hrs.get(p.id), s, '2026-10-08'), x = xl.cols[p.sort];
  cmp(p.name + ' meinTeil', f.meinTeil, x.meinTeil); cmp(p.name + ' eff', f.stundenEff, x.eff);
  cmp(p.name + ' lohnZiel', f.lohnZiel, x.lohnZiel);
  if (p.abrechnung !== 'intern') cmp(p.name + ' lohnEff', f.lohnEff, x.lohnEff);
  if (p.abrechnung === 'rechnung') cmp(p.name + ' rechnung', f.rechnungsbetrag, x.rechnung == null ? null : Math.round(x.rechnung * 100 + 1e-6) / 100);
}
const mo = Calc.monthly(data, 2026, '2026-10-08');
mo.forEach((m, i) => { if (xl.monat[i]) { cmp('Monat ' + (i + 1) + ' ist', m.ist, xl.monat[i].ist); cmp('Monat soll', m.soll, xl.monat[i].soll); } });
console.log(n, 'Vergleiche,', bad, 'Abweichungen');
console.log(mo.map(m => [m.monat + 1, m.ist.toFixed(2), m.ueberzeit == null ? '-' : m.ueberzeit.toFixed(2)].join(' ')).join(' | '));
