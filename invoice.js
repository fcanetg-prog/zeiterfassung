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
  const leer = '<tr class="leer"><td>&nbsp;</td><td></td><td></td><td></td></tr>';
  const zeile = (text, prozent, betrag, cls) => `<tr class="${cls || ''}"><td>${esc(text)}</td><td>${esc(prozent || '')}</td><td>CHF</td><td class="r">${chf(betrag)}</td></tr>`;

  const tabelle = `
    <table class="pos">
      <colgroup><col style="width:62.6%"><col style="width:11.8%"><col style="width:11.8%"><col style="width:13.8%"></colgroup>
      <tr class="kopf"><td>Arbeit</td><td>Prozent</td><td>Währung</td><td class="r">Betrag</td></tr>
      ${leer}
      ${m.positionen.map((p) => zeile(p.text, '', p.betrag)).join('')}
      ${leer}
      ${m.mitMwst ? zeile('Zwischentotal', '', m.zwischentotal) + zeile('Mehrwertsteuer', `${m.mwstSatz}%`, m.mwst) + leer : ''}
      ${zeile('Total', '', m.total, 'total')}
    </table>`;

  const konto = `Überweisung bitte innerhalb von ${m.zahlungsfrist} Tagen auf das Konto ${ibanFormat(a.iban)}${a.bank ? `, ${a.bank}` : ''}, lautend auf ${a.firma}. Danke für das Vertrauen in meine Arbeit.`;

  return `<!doctype html>
<html lang="de-CH"><head><meta charset="utf-8"><title>Rechnung</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, "Liberation Serif", serif; font-size: 12pt; line-height: 13pt; color: #000; -webkit-print-color-adjust: exact; }
  .seite { width: 210mm; height: 297mm; position: relative; overflow: hidden; page-break-after: always; }
  .seite:last-child { page-break-after: auto; }
  .inhalt { position: absolute; left: 105.8pt; top: 33pt; width: 415pt; }
  .logo { position: absolute; left: 322pt; top: 34pt; width: 208pt; height: auto; }
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
  table.pos { width: 415pt; margin-top: 26pt; border-collapse: collapse; table-layout: fixed; font-family: Arial, Helvetica, "Liberation Sans", sans-serif; font-size: 8pt; line-height: 9.4pt; }
  table.pos td { border: 0.5pt solid #d4d4d4; padding: 0.7pt 2.4pt; vertical-align: top; overflow-wrap: anywhere; }
  table.pos td.r { text-align: right; }
  table.pos tr.kopf td { font-weight: bold; border-bottom: 1pt solid #000; }
  table.pos tr.total td { font-weight: bold; border-top: 1.2pt solid #000; border-bottom: 1.2pt solid #000; }
  table.pos tr.total td:first-child { border-left: 1.2pt solid #000; }
  table.pos tr.total td:last-child { border-right: 1.2pt solid #000; }
  .konto { margin-top: 26pt; }
  .gruss { margin-top: 13pt; }
  .name { margin-top: 39pt; }
  .qr { position: absolute; left: 0; bottom: 0; width: 210mm; height: 105mm; }
  .qr > svg { display: block; overflow: visible; }
</style></head>
<body>
  <section class="seite">
    ${a.logo ? `<img class="logo" src="${esc(a.logo)}" alt="">` : ''}
    <div class="inhalt">
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
      <div class="konto">${esc(konto)}</div>
      <div class="gruss">Freundliche Grüsse</div>
      <div class="name">${esc(a.unterschrift || a.firma)}</div>
    </div>
  </section>
  <section class="seite">
    <div class="qr">${qrSvg(a, m.total)}</div>
  </section>
</body></html>`;
}

function dateiname(m, projekt) {
  const sauber = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return [m.datum.replace(/-/g, ''), 'Rechnung', sauber(projekt.kunde), sauber(projekt.name)].filter(Boolean).join('_') + '.pdf';
}

module.exports = { buildHtml, absenderFehler, dateiname };
