'use strict';
/* Baut die Rechnung als HTML (Seite 1: Rechnung, Seite 2: QR-Zahlteil). main.js druckt sie als PDF. */
const { SwissQRBill } = require('swissqrbill/svg');

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function chf(x) {
  const [g, r] = Math.abs(x).toFixed(2).split('.');
  return (x < 0 ? '-' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + '.' + r;
}

function ibanFormat(iban) {
  return String(iban || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

/** Prüft, ob die Absenderangaben für Rechnung und QR-Zahlteil reichen. */
function absenderFehler(a) {
  const fehlt = [];
  const need = { firma: 'Firma', strasse: 'Strasse', plz: 'PLZ', ort: 'Ort', iban: 'IBAN' };
  for (const k of Object.keys(need)) if (!String((a || {})[k] || '').trim()) fehlt.push(need[k]);
  return fehlt.length ? [`In den Einstellungen fehlen Absenderangaben: ${fehlt.join(', ')}.`] : [];
}

function qrSvg(a, total) {
  const bill = new SwissQRBill({
    amount: total,
    currency: 'CHF',
    creditor: {
      account: String(a.iban).replace(/\s+/g, ''),
      name: a.firma,
      address: a.strasse,
      buildingNumber: a.hausnummer || undefined,
      zip: a.plz,
      city: a.ort,
      country: a.land || 'CH',
    },
  }, { language: 'DE' });
  return bill.toString();
}

function buildHtml(m, a) {
  const kontakt = [['Mobile', a.mobile], ['Homepage', a.homepage], ['E-Mail', a.email]].filter((r) => r[1]);
  const strasse = [a.strasse, a.hausnummer].filter(Boolean).join(' ');

  const tabelle = `
    <table class="pos">
      <thead><tr><th>Arbeit</th><th class="r">Betrag in CHF</th></tr></thead>
      <tbody>${m.positionen.map((p) => `<tr><td>${esc(p.text)}</td><td class="r">${chf(p.betrag)}</td></tr>`).join('')}</tbody>
    </table>
    <table class="summe">
      ${m.mitMwst ? `<tr><td>Zwischentotal</td><td class="r">${chf(m.zwischentotal)}</td></tr>
      <tr><td>Mehrwertsteuer ${esc(m.mwstSatz)}%</td><td class="r">${chf(m.mwst)}</td></tr>` : ''}
      <tr class="total"><td>Total CHF</td><td class="r">${chf(m.total)}</td></tr>
    </table>`;

  const konto = `Überweisung bitte innerhalb von ${m.zahlungsfrist} Tagen auf das Konto ${ibanFormat(a.iban).replace(/ /g, ' ')}${a.bank ? `, ${a.bank}` : ''}, lautend auf ${a.firma}. Danke für das Vertrauen in meine Arbeit.`;

  return `<!doctype html>
<html lang="de-CH"><head><meta charset="utf-8"><title>Rechnung</title>
<style>
  @page rechnung { size: A4; margin: 33pt 0 48pt 0; }
  @page zahlteil { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, "Liberation Serif", serif; font-size: 12pt; line-height: 13pt; color: #000; -webkit-print-color-adjust: exact; }
  .rechnung { page: rechnung; position: relative; padding-left: 105.8pt; width: 520.8pt; }
  .logo { position: absolute; left: 322pt; top: 1pt; width: 208pt; height: auto; }
  .firma { font-size: 15pt; line-height: 16pt; font-weight: bold; }
  .klein { font-size: 10pt; line-height: 10.8pt; }
  .klein table { border-collapse: collapse; }
  .klein td { padding: 0; }
  .klein td:first-child { width: 50.7pt; }
  .abs { margin-top: 10.8pt; }
  .empf { margin-top: 13pt; }
  .ref { margin-top: 26pt; }
  .datum { margin-top: 39pt; }
  .titel { margin-top: 39pt; font-weight: bold; }
  .anrede { margin-top: 26pt; }
  .einl { margin-top: 13pt; }
  table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  table.pos { width: 415pt; margin-top: 24pt; line-height: 14pt; }
  table.pos th { text-align: left; font-size: 10pt; font-weight: bold; padding: 0 0 4pt; border-bottom: 0.9pt solid #000; }
  table.pos th.r { text-align: right; }
  table.pos td { padding: 5pt 0; vertical-align: top; border-bottom: 0.4pt solid #b9c2c2; }
  table.pos td:first-child { padding-right: 18pt; }
  table.pos tr { break-inside: avoid; }
  table.summe { margin: 3pt 0 0 auto; width: 207pt; line-height: 14pt; break-inside: avoid; }
  table.summe td { padding: 3pt 0; }
  table.summe tr.total td { font-weight: bold; font-size: 13pt; padding: 6pt 0 5pt; border-top: 0.9pt solid #000; border-bottom: 2pt solid #26a9a8; }
  .schluss { break-inside: avoid; }
  .konto { margin-top: 28pt; }
  .gruss { margin-top: 13pt; }
  .name { margin-top: 39pt; }
  .zahlteil { page: zahlteil; break-before: page; position: relative; width: 210mm; height: 296.5mm; overflow: hidden; }
  .qr { position: absolute; left: 0; bottom: 0; width: 210mm; height: 105mm; }
  .qr > svg { display: block; overflow: visible; }
</style></head>
<body>
  <section class="rechnung">
    ${a.logo ? `<img class="logo" src="${esc(a.logo)}" alt="">` : ''}
    <div class="firma">${esc(a.firma)}</div>
    <div class="klein">${esc(strasse)}<br>${esc([a.plz, a.ort].filter(Boolean).join(' '))}</div>
    ${a.uid || a.mwstNr ? `<div class="klein abs">${a.uid ? `UID-Nummer: ${esc(a.uid)}<br>` : ''}${a.mwstNr ? `Mwst.-Nummer: ${esc(a.mwstNr)}` : ''}</div>` : ''}
    ${kontakt.length ? `<div class="klein abs"><table>${kontakt.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table></div>` : ''}
    <div class="empf">${m.empfaenger.map(esc).join('<br>')}</div>
    ${m.referenz.length ? `<div class="ref">Ihre Referenz:<br>${m.referenz.map(esc).join('<br>')}</div>` : ''}
    <div class="datum">${esc(a.rechnungsort || a.ort)}, ${esc(m.datumLang)}</div>
    <div class="titel">Rechnung</div>
    <div class="anrede">Guten Tag</div>
    <div class="einl">${esc(m.einleitung)}</div>
    ${tabelle}
    <div class="schluss">
      <div class="konto">${esc(konto)}</div>
      <div class="gruss">Freundliche Grüsse</div>
      <div class="name">${esc(a.unterschrift || a.firma)}</div>
    </div>
  </section>
  <section class="zahlteil">
    <div class="qr">${qrSvg(a, m.total)}</div>
  </section>
</body></html>`;
}

/** Dateiname: Datum_Rechnung_Kunde_Projekt.pdf, bei Sammelrechnungen ohne Projekt. */
function dateiname(m) {
  const sauber = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const ps = m.projekte || [];
  const kunden = [...new Set(ps.map((p) => p.kunde))];
  const wer = kunden.length === 1 ? kunden[0] : m.empfaenger[0];
  const was = ps.length === 1 ? ps[0].name : '';
  return [m.datum.replace(/-/g, ''), 'Rechnung', sauber(wer), sauber(was)].filter(Boolean).join('_') + '.pdf';
}

module.exports = { buildHtml, absenderFehler, dateiname };
