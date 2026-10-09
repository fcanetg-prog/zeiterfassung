/* Reiter Buchhaltung: Buchungen, Konten, Bilanz und Erfolgsrechnung, Kontoauszug, Dossier als PDF. */
(function () {
  'use strict';
  const L = window.Ledger;

  window.Buchhaltung = function (ctx) {
    const { state, C, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;
    const $ = (sel, root) => (root || document).querySelector(sel);

    state.bh = { tab: 'buchungen', konto: null, edit: null, q: '', alleKonten: false, neu: null, kEdit: null };

    /* ---------- Daten ---------- */

    const jahr = () => state.year;
    const plan = () => { const p = state.data.kontenplaene[jahr()]; return p ? p.zeilen : null; };
    const buchungen = () => state.data.buchungen.filter((b) => b.jahr === jahr());
    const konten = () => (plan() || []).filter((z) => z.konto);
    const kontoName = (nr) => { const z = konten().find((x) => x.konto === nr); return z ? z.text : ''; };
    const firma = () => (state.data.settings.absender && state.data.settings.absender.firma) || 'Buchhaltung';

    function chf(x, leerBeiNull) {
      if (x == null || !isFinite(x) || (leerBeiNull && Math.abs(x) < 0.005)) return '';
      const [g, r] = Math.abs(x).toFixed(2).split('.');
      return (x < -0.004 ? '-' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + '.' + r;
    }

    function neuVorlage() {
      const bs = buchungen();
      const letzte = L.sortiert(bs).pop();
      return { datum: letzte && letzte.datum > `${jahr()}-01-01` ? (heute.startsWith(String(jahr())) ? heute : letzte.datum) : (heute.startsWith(String(jahr())) ? heute : `${jahr()}-01-01`), beleg: L.naechsterBeleg(bs), text: '', soll: '', haben: '', betrag: '' };
    }
    function neu() {
      if (!state.bh.neu || state.bh.neuJahr !== jahr()) { state.bh.neu = neuVorlage(); state.bh.neuJahr = jahr(); }
      return state.bh.neu;
    }

    /** Prüft eine Buchung aus dem Formular. Gibt die fertige Buchung oder eine Fehlermeldung zurück. */
    function pruefe(f) {
      const betrag = C.parseAmount(f.betrag);
      const nummern = new Set(konten().map((z) => z.konto));
      const soll = String(f.soll).trim().split(/\s/)[0], haben = String(f.haben).trim().split(/\s/)[0];
      if (!f.datum) return { fehler: 'Das Datum fehlt.', feld: 'datum' };
      if (!f.datum.startsWith(jahr() + '-')) return { fehler: `Das Datum liegt nicht im Jahr ${jahr()}. Wähle links das passende Jahr.`, feld: 'datum' };
      if (!String(f.text).trim()) return { fehler: 'Die Beschreibung fehlt.', feld: 'text' };
      if (!nummern.has(soll)) return { fehler: `Das Soll-Konto «${soll}» gibt es im Kontenplan nicht.`, feld: 'soll' };
      if (!nummern.has(haben)) return { fehler: `Das Haben-Konto «${haben}» gibt es im Kontenplan nicht.`, feld: 'haben' };
      if (betrag == null || betrag <= 0) return { fehler: 'Der Betrag muss eine Zahl grösser als null sein.', feld: 'betrag' };
      return { buchung: { datum: f.datum, beleg: String(f.beleg).trim(), text: String(f.text).trim(), soll, haben, betrag: Math.round(betrag * 100) / 100 } };
    }

    /* ---------- Ansicht ---------- */

    const TABS = [['buchungen', 'Buchungen'], ['konten', 'Konten'], ['abschluss', 'Bilanz und Erfolgsrechnung'], ['auszug', 'Kontoauszug']];

    function view() {
      if (!plan()) return viewLeer();
      const t = L.totalsummen(plan(), buchungen());
      const gewinn = -t.erfolg;
      const inhalt = { buchungen: viewBuchungen, konten: viewKonten, abschluss: viewAbschluss, auszug: viewAuszug }[state.bh.tab]();
      return `
      <header class="head">
        <h1>Buchhaltung ${jahr()}</h1>
        <div class="bignum"><b class="${gewinn < 0 ? 'neg' : ''}">${chf(gewinn)}</b><span>${gewinn < 0 ? 'Jahresverlust' : 'Jahresgewinn'} bisher</span></div>
      </header>
      <div class="bh-bar">
        <div class="seg">${TABS.map(([k, l]) => `<button class="${state.bh.tab === k ? 'on' : ''}" data-bh="tab" data-tab="${k}">${l}</button>`).join('')}</div>
        <span class="grow"></span>
        ${Math.abs(t.differenz) > 0.004 ? `<span class="warn">Differenz Soll/Haben: ${chf(t.differenz)}</span>` : ''}
        <button class="btn" data-bh="pdf">Dossier als PDF</button>
      </div>
      ${inhalt}`;
    }

    function viewLeer() {
      const vor = state.data.kontenplaene[jahr() - 1];
      return `<header class="head"><h1>Buchhaltung ${jahr()}</h1></header>
      <div class="sec"><p>Für ${jahr()} gibt es noch keine Buchhaltung.</p>
        <div class="row" style="margin-top:12px">
          ${vor ? `<button class="btn primary" data-bh="eroeffnen">Aus ${jahr() - 1} eröffnen</button>` : ''}
          <button class="btn" data-action="import">Buchhaltung importieren</button>
        </div>
        ${vor ? `<p class="hint">«Eröffnen» übernimmt den Kontenplan von ${jahr() - 1} und bucht per 1. Januar die Schlusssaldi aller Bilanzkonten gegen das Konto 2970 (Gewinnvortrag oder Verlustvortrag). Der Jahreserfolg ${jahr() - 1} landet damit im Vortrag.</p>` : ''}
      </div>`;
    }

    const kontoListe = () => `<datalist id="bh-konten">${konten().map((z) => `<option value="${esc(z.konto)}">${esc(z.text)}</option>`).join('')}</datalist>`;

    function formZeile(f, pre, aktion) {
      const feld = (key, extra) => `<input id="${pre}-${key}" data-bh="feld" data-form="${aktion}" data-key="${key}" value="${esc(f[key])}" ${extra || ''}>`;
      return `
        <td>${feld('datum', 'type="date"')}</td>
        <td>${feld('beleg', 'type="text"')}</td>
        <td>${feld('text', 'type="text" list="bh-texte" placeholder="Beschreibung"')}</td>
        <td>${feld('soll', 'type="text" list="bh-konten" placeholder="Soll" inputmode="numeric"')}</td>
        <td>${feld('haben', 'type="text" list="bh-konten" placeholder="Haben" inputmode="numeric"')}</td>
        <td>${feld('betrag', 'type="text" class="num r" placeholder="0.00" inputmode="decimal"')}</td>`;
    }

    function viewBuchungen() {
      const alle = L.sortiert(buchungen());
      const q = state.bh.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const liste = alle.filter((b) => !q.length || q.every((t) => `${fmtDate(b.datum)} ${b.beleg} ${b.text} ${b.soll} ${b.haben} ${b.betrag.toFixed(2)}`.toLowerCase().includes(t))).reverse();
      const texte = [...new Set(alle.map((b) => b.text))].sort();
      const summe = liste.reduce((a, b) => a + b.betrag, 0);
      const zeile = (b) => (state.bh.edit === b.id
        ? `<tr class="bh-edit" data-id="${b.id}">${formZeile(state.bh.editForm, 'be', 'edit')}
            <td class="r"><button class="btn small primary" data-bh="edit-save">Speichern</button> <button class="btn small" data-bh="edit-cancel">Abbrechen</button> <button class="btn small danger" data-bh="del" data-id="${b.id}">Löschen</button></td></tr>`
        : `<tr class="bh-row" data-bh="edit" data-id="${b.id}" tabindex="0">
            <td class="num">${fmtDate(b.datum)}</td><td>${esc(b.beleg)}</td><td class="bt">${esc(b.text)}</td>
            <td class="num" title="${esc(kontoName(b.soll))}">${esc(b.soll)}</td><td class="num" title="${esc(kontoName(b.haben))}">${esc(b.haben)}</td>
            <td class="num r">${chf(b.betrag)}</td><td></td></tr>`);
      return `
      ${kontoListe()}<datalist id="bh-texte">${texte.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="bh-wrap"><table class="bh-tab">
        <colgroup><col style="width:128px"><col style="width:84px"><col><col style="width:84px"><col style="width:84px"><col style="width:118px"><col style="width:272px"></colgroup>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Soll</th><th>Haben</th><th class="r">Betrag CHF</th>
          <th class="r"><input type="search" id="bh-q" placeholder="Suchen" value="${esc(state.bh.q)}" data-bh="suche"></th></tr></thead>
        <tbody>
          <tr class="bh-neu">${formZeile(neu(), 'bn', 'neu')}<td class="r"><button class="btn primary small" data-bh="neu-save">Buchen</button> <span class="dim" id="bh-hinweis">${esc(hinweisNeu())}</span></td></tr>
          ${liste.map(zeile).join('')}
        </tbody>
        <tfoot><tr><td colspan="5">${liste.length} Buchungen${q.length ? ' gefunden' : ''}</td><td class="num r">${chf(summe)}</td><td></td></tr></tfoot>
      </table></div>`;
    }

    function hinweisNeu() {
      const f = neu();
      const s = String(f.soll).trim(), h = String(f.haben).trim();
      return [kontoName(s) && `Soll: ${kontoName(s)}`, kontoName(h) && `Haben: ${kontoName(h)}`].filter(Boolean).join(', ');
    }

    function viewKonten() {
      const a = L.auswertung(plan(), buchungen());
      const sichtbar = plan().filter((z) => {
        if (state.bh.alleKonten || !z.konto) return true;
        return a.konto.has(z.konto);
      });
      // Gruppen ohne sichtbares Konto und ohne Saldo ausblenden, wenn nur bewegte Konten gezeigt werden.
      const zeilen = sichtbar.filter((z) => state.bh.alleKonten || !z.gruppe || Math.abs(a.saldoVon(z)) > 0.004);
      const gruppen = (plan() || []).filter((z) => z.gruppe);
      const k = state.bh.kEdit;
      return `
      <div class="bh-bar2">
        <label class="check"><input type="checkbox" data-bh="alle-konten" ${state.bh.alleKonten ? 'checked' : ''}> Auch Konten ohne Bewegung zeigen</label>
        <span class="grow"></span>
        <button class="btn" data-bh="konto-neu">Konto hinzufügen</button>
      </div>
      ${k ? `<form class="sec bh-kform" data-bh-form="konto">
        <div class="fld"><label for="bk-konto">Konto</label><input id="bk-konto" type="text" value="${esc(k.konto)}" data-bh="kfeld" data-key="konto" ${k.alt ? 'disabled' : ''}></div>
        <div class="fld grow"><label for="bk-text">Beschreibung</label><input id="bk-text" type="text" value="${esc(k.text)}" data-bh="kfeld" data-key="text"></div>
        <div class="fld"><label for="bk-bk">Klasse</label><select id="bk-bk" data-bh="kfeld" data-key="bklasse">${[['1', '1 Aktiven'], ['2', '2 Passiven'], ['3', '3 Aufwand'], ['4', '4 Ertrag']].map(([v, l]) => `<option value="${v}" ${k.bklasse === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="fld"><label for="bk-in">Summiert in Gruppe</label><select id="bk-in" data-bh="kfeld" data-key="summe_in">${gruppen.map((g) => `<option value="${esc(g.gruppe)}" ${k.summe_in === g.gruppe ? 'selected' : ''}>${esc(g.gruppe)} ${esc(g.text.slice(0, 44))}</option>`).join('')}</select></div>
        <div class="row"><button class="btn primary" type="submit">${k.alt ? 'Speichern' : 'Hinzufügen'}</button><button class="btn" type="button" data-bh="konto-abbr">Abbrechen</button>
          ${k.alt && !a.konto.has(k.alt) ? '<button class="btn danger" type="button" data-bh="konto-del">Löschen</button>' : ''}</div>
      </form>` : ''}
      <div class="bh-wrap"><table class="bh-tab konten">
        <colgroup><col style="width:70px"><col style="width:70px"><col style="width:70px"><col><col style="width:70px"><col style="width:84px"><col style="width:130px"><col style="width:96px"></colgroup>
        <thead><tr><th>Sektion</th><th>Gruppe</th><th>Konto</th><th>Beschreibung</th><th>Klasse</th><th>Summ. in</th><th class="r">Saldo CHF</th><th></th></tr></thead>
        <tbody>${zeilen.map((z) => {
          const s = a.saldoVon(z);
          if (z.sektion && !z.konto && !z.gruppe) return `<tr class="k-sek"><td>${esc(z.sektion)}</td><td></td><td></td><td colspan="5">${esc(z.text)}</td></tr>`;
          if (z.gruppe) return `<tr class="k-grp ${/^(1|2|00|E\d|10|14|20|24|2A|28)$/.test(z.gruppe) ? 'gross' : ''}"><td></td><td>${esc(z.gruppe)}</td><td></td><td>${esc(z.text)}</td><td></td><td>${esc(z.summe_in)}</td><td class="num r">${chf(s, true)}</td><td></td></tr>`;
          return `<tr class="k-kto"><td></td><td></td><td class="num">${esc(z.konto)}</td><td>${esc(z.text)}</td><td>${esc(z.bklasse)}</td><td>${esc(z.summe_in)}</td><td class="num r">${chf(s, true)}</td>
            <td class="r"><button class="link" data-bh="auszug" data-konto="${esc(z.konto)}">Auszug</button> <button class="link" data-bh="konto-edit" data-konto="${esc(z.konto)}">Ändern</button></td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }

    /** Zeilen eines Abschnitts mit Saldo, für die kompakte Darstellung: nur was einen Saldo hat. vz dreht das Vorzeichen. */
    function kompakt(zeilen, a, vz) {
      return zeilen.filter((z) => (z.konto || z.gruppe) && Math.abs(a.saldoVon(z)) > 0.004 && z.gruppe !== '00')
        .map((z) => ({ nr: z.konto || '', text: z.text, wert: vz * a.saldoVon(z), gruppe: !!z.gruppe, gross: !!z.gruppe && /^(1|2|E\d|10|14|20|24|2A|28|3|5|6)$/.test(z.gruppe) }));
    }

    function abschlussTabelle(titel, zeilen) {
      return `<section class="sec"><h2>${titel}</h2><table class="bh-ab">
        <tbody>${zeilen.map((z) => `<tr class="${z.gruppe ? 'g' : ''} ${z.gross ? 'gross' : ''}"><td class="num">${esc(z.nr)}</td><td>${esc(z.text)}</td><td class="num r">${chf(z.wert)}</td></tr>`).join('')}</tbody></table></section>`;
    }

    function viewAbschluss() {
      const a = L.auswertung(plan(), buchungen());
      const ab = L.abschnitte(plan());
      return `<div class="bh-zwei">
        <div>${abschlussTabelle('Bilanz: Aktiven', kompakt(ab.aktiven, a, 1))}${abschlussTabelle('Bilanz: Passiven', kompakt(ab.passiven, a, -1))}</div>
        <div>${abschlussTabelle('Erfolgsrechnung', kompakt(ab.erfolg, a, -1))}
          <p class="hint">Erträge und Gewinne stehen positiv, Aufwände negativ. In der Bilanz stehen Aktiven und Passiven je positiv.</p></div>
      </div>`;
    }

    function viewAuszug() {
      const a = L.auswertung(plan(), buchungen());
      const mit = konten().filter((z) => a.konto.has(z.konto));
      if (!state.bh.konto || !konten().some((z) => z.konto === state.bh.konto)) state.bh.konto = mit.length ? mit[0].konto : (konten()[0] || {}).konto;
      const nr = state.bh.konto;
      const k = L.kontoauszug(nr, buchungen());
      return `
      <div class="bh-bar2"><label for="bh-konto">Konto</label>
        <select id="bh-konto" data-bh="konto-wahl">${konten().map((z) => `<option value="${esc(z.konto)}" ${z.konto === nr ? 'selected' : ''}>${esc(z.konto)} ${esc(z.text)}${a.konto.has(z.konto) ? '' : ' (ohne Bewegung)'}</option>`).join('')}</select></div>
      <div class="bh-wrap"><table class="bh-tab">
        <colgroup><col style="width:100px"><col style="width:84px"><col><col style="width:84px"><col style="width:118px"><col style="width:118px"><col style="width:126px"></colgroup>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Gegenkto.</th><th class="r">Soll CHF</th><th class="r">Haben CHF</th><th class="r">Saldo CHF</th></tr></thead>
        <tbody>${k.zeilen.map((z) => `<tr><td class="num">${fmtDate(z.datum)}</td><td>${esc(z.beleg)}</td><td class="bt">${esc(z.text)}</td><td class="num" title="${esc(kontoName(z.gegenkonto))}">${esc(z.gegenkonto)}</td>
          <td class="num r">${chf(z.soll)}</td><td class="num r">${chf(z.haben)}</td><td class="num r">${chf(z.saldo)}</td></tr>`).join('') || '<tr><td colspan="7" class="dim">Keine Bewegungen.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="4">Totalsumme Bewegungen</td><td class="num r">${chf(k.soll)}</td><td class="num r">${chf(k.haben)}</td><td class="num r">${chf(k.saldo)}</td></tr></tfoot>
      </table></div>`;
    }

    /* ---------- Dossier als PDF ---------- */

    function dossierHtml() {
      const p = plan(), bs = L.sortiert(buchungen());
      const a = L.auswertung(p, bs), t = L.totalsummen(p, bs), ab = L.abschnitte(p);
      const titel = `${firma()} ${jahr()}`;
      const kopf = (name, spalten) => `<thead><tr><th colspan="${spalten.length}" class="kopf"><div class="t1">${esc(titel)}</div><div class="t2">${esc(name)}</div></th></tr>
        <tr class="sp">${spalten.map((s) => `<th class="${s[1] || ''}">${s[0]}</th>`).join('')}</tr></thead>`;
      const abschluss = (name, zeilen) => `<table class="ab">${kopf(name, [['Konto'], ['Beschreibung'], ['CHF', 'r']])}
        <tbody>${zeilen.map((z) => `<tr class="${z.gruppe ? 'g' : ''} ${z.gross ? 'gross' : ''}"><td>${esc(z.nr)}</td><td>${esc(z.text)}</td><td class="r">${chf(z.wert)}</td></tr>`).join('')}</tbody></table>`;

      const kontenTab = `<table class="kt">${kopf('Konten', [['Sektion'], ['Gruppe'], ['Konto'], ['Beschreibung'], ['BKlasse', 'c'], ['Summ. in', 'c'], ['Saldo CHF', 'r']])}
        <tbody>${p.map((z) => {
          if (z.sektion && !z.konto && !z.gruppe) return `<tr class="sek"><td>${esc(z.sektion)}</td><td></td><td></td><td colspan="4">${esc(z.text)}</td></tr>`;
          if (z.gruppe) return `<tr class="g ${/^(1|2|00|E\d|10|14|20|24|2A|28)$/.test(z.gruppe) ? 'gross' : ''}"><td></td><td>${esc(z.gruppe)}</td><td></td><td>${esc(z.text)}</td><td></td><td class="c">${esc(z.summe_in)}</td><td class="r">${chf(a.saldoVon(z), true)}</td></tr>`;
          return `<tr><td></td><td></td><td>${esc(z.konto)}</td><td>${esc(z.text)}</td><td class="c">${esc(z.bklasse)}</td><td class="c">${esc(z.summe_in)}</td><td class="r">${chf(a.saldoVon(z), true)}</td></tr>`;
        }).join('')}</tbody></table>`;

      const tot = [['1', 'Totalsumme Aktiven', t.aktiven], ['2', 'Total Passiven und Eigenkapital', t.passiven], ['01', 'Gewinn(+) Verlust(-) der Bilanz', t.bilanz],
        ['3', 'Totalsumme Aufwand', t.aufwand], ['4', 'Totalsumme Ertrag', t.ertrag], ['02', 'Verlust(+) Gewinn(-) der Erfolgsrechnung', t.erfolg], ['00', 'Differenz muss = 0 sein', t.differenz]];
      const totalTab = `<table class="tt">${kopf('Totalsummen', [['Gruppe'], ['Beschreibung'], ['Saldo CHF', 'r']])}
        <tbody>${tot.map((r) => `<tr class="${r[0].length === 2 ? 'g' : ''}"><td>${r[0]}</td><td>${r[1]}</td><td class="r">${chf(r[2], r[0] === '00')}</td></tr>`).join('')}</tbody></table>`;

      const journal = `<table class="jr">${kopf('Journal', [['Datum'], ['Beleg'], ['Beschreibung'], ['KtSoll'], ['KtHaben'], ['Betrag CHF', 'r']])}
        <tbody>${bs.map((b) => `<tr><td>${fmtDate(b.datum)}</td><td>${esc(b.beleg)}</td><td>${esc(b.text)}</td><td>${esc(b.soll)}</td><td>${esc(b.haben)}</td><td class="r">${chf(b.betrag)}</td></tr>`).join('')}</tbody></table>`;

      const auszuege = konten().filter((z) => a.konto.has(z.konto)).map((z) => {
        const k = L.kontoauszug(z.konto, bs);
        return `<table class="ka">${kopf(`${z.konto} ${z.text}`, [['Datum'], ['Beleg'], ['Beschreibung'], ['Gegenkto.'], ['Soll CHF', 'r'], ['Haben CHF', 'r'], ['Saldo CHF', 'r']])}
          <tbody>${k.zeilen.map((r) => `<tr><td>${fmtDate(r.datum)}</td><td>${esc(r.beleg)}</td><td>${esc(r.text)}</td><td>${esc(r.gegenkonto)}</td><td class="r">${chf(r.soll)}</td><td class="r">${chf(r.haben)}</td><td class="r">${chf(r.saldo, true)}</td></tr>`).join('')}
          <tr class="g"><td>${fmtDate(`${jahr()}-12-31`)}</td><td></td><td>Totalsumme Bewegungen</td><td></td><td class="r">${chf(k.soll, true)}</td><td class="r">${chf(k.haben, true)}</td><td class="r">${chf(k.saldo, true)}</td></tr></tbody></table>`;
      }).join('');

      const gewinn = -t.erfolg;
      return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>
        @page { size: A4; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, "Liberation Sans", sans-serif; font-size: 8.5pt; line-height: 1.32; color: #000; margin: 0; }
        .deck { height: 240mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
        .deck h1 { font-size: 24pt; margin: 0 0 6pt; }
        .deck p { font-size: 11pt; margin: 2pt 0; }
        .deck dl { margin-top: 26pt; display: grid; grid-template-columns: max-content max-content; gap: 4pt 22pt; font-size: 10.5pt; }
        .deck dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
        table { width: 100%; border-collapse: collapse; page-break-before: always; font-variant-numeric: tabular-nums; }
        table.ab.erste, table.ab.folgt { page-break-before: auto; }
        table.ab.folgt { margin-top: 22pt; }
        table.ab tr.g td { padding-bottom: 3.5pt; }
        table.ab tr.gross td { font-size: 10pt; padding-top: 3pt; padding-bottom: 4.5pt; }
        th { text-align: left; font-weight: normal; font-size: 7pt; padding: 0 3pt 5pt; vertical-align: bottom; }
        th.kopf { padding: 0 0 12pt; }
        .t1 { font-size: 9pt; font-weight: bold; }
        .t2 { font-size: 10.5pt; font-weight: bold; margin-top: 14pt; }
        td { padding: 1.1pt 3pt; vertical-align: top; }
        .r { text-align: right; white-space: nowrap; }
        .c { text-align: center; }
        tr { page-break-inside: avoid; }
        tr.g td { font-weight: bold; padding-bottom: 6pt; }
        tr.gross td { font-size: 10.5pt; padding-top: 5pt; padding-bottom: 8pt; }
        tr.sek td { font-size: 11pt; font-weight: bold; padding: 8pt 3pt 6pt; }
        table.kt td:nth-child(1), table.kt td:nth-child(2), table.kt td:nth-child(3) { width: 34pt; }
        table.kt td:nth-child(5), table.kt td:nth-child(6) { width: 40pt; }
        table.kt td:nth-child(7), table.tt td:nth-child(3), table.ab td:nth-child(3) { width: 78pt; }
        table.ab td:nth-child(1), table.tt td:nth-child(1) { width: 44pt; }
        table.jr td:nth-child(1), table.ka td:nth-child(1) { width: 54pt; }
        table.jr td:nth-child(2), table.ka td:nth-child(2) { width: 44pt; }
        table.jr td:nth-child(4), table.jr td:nth-child(5), table.ka td:nth-child(4) { width: 40pt; }
        table.jr td:nth-child(6) { width: 64pt; }
        table.ka td:nth-child(5), table.ka td:nth-child(6), table.ka td:nth-child(7) { width: 62pt; }
        table.tt tr.g td { padding-bottom: 10pt; }
      </style></head><body>
        <div class="deck"><h1>${esc(titel)}</h1><p>Buchhaltung, Stand ${fmtDate(heute)}</p>
          <dl><dt>Total Aktiven</dt><dd>${chf(t.aktiven)}</dd><dt>Ertrag</dt><dd>${chf(-t.ertrag)}</dd><dt>Aufwand</dt><dd>${chf(t.aufwand)}</dd>
          <dt><b>${gewinn < 0 ? 'Jahresverlust' : 'Jahresgewinn'}</b></dt><dd><b>${chf(gewinn)}</b></dd><dt>Buchungen</dt><dd>${bs.length}</dd></dl></div>
        ${abschluss('Bilanz: Aktiven', kompakt(ab.aktiven, a, 1)).replace('class="ab"', 'class="ab erste"')}
        ${abschluss('Bilanz: Passiven', kompakt(ab.passiven, a, -1)).replace('class="ab"', 'class="ab folgt"')}
        ${abschluss('Erfolgsrechnung', kompakt(ab.erfolg, a, -1))}
        ${kontenTab}${totalTab}${journal}${auszuege}
      </body></html>`;
    }

    async function pdf() {
      const name = `${firma().replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '_')}_${jahr()}_Stand_${heute.replace(/-/g, '')}.pdf`;
      const r = await api.savePdf(dossierHtml(), { ordner: 'Buchhaltung', name, fuss: fmtDate(heute) });
      if (r.fehler) toast(r.fehler, { fehler: true }); else toast('Dossier gespeichert: ' + r.path);
    }

    /* ---------- Aktionen ---------- */

    function buche() {
      const p = pruefe(neu());
      if (p.fehler) { toast(p.fehler, { fehler: true }); const el = $('#bn-' + p.feld); if (el) el.focus(); return; }
      const pos = state.data.buchungen.reduce((m, b) => Math.max(m, b.pos || 0), 0) + 1;
      state.data.buchungen.push(Object.assign({ id: uid('b'), jahr: jahr(), pos }, p.buchung));
      const datum = p.buchung.datum;
      state.bh.neu = null;
      persist(); neu().datum = datum; render();
      const el = $('#bn-text'); if (el) el.focus();
    }

    function speichereEdit() {
      const b = state.data.buchungen.find((x) => x.id === state.bh.edit);
      const p = pruefe(state.bh.editForm);
      if (p.fehler) { toast(p.fehler, { fehler: true }); const el = $('#be-' + p.feld); if (el) el.focus(); return; }
      Object.assign(b, p.buchung);
      state.bh.edit = null; persist(); render(); toast('Buchung gespeichert');
    }

    /** Gleiche Beschreibung wie früher: Soll und Haben der letzten solchen Buchung vorschlagen. */
    function vorschlag(f) {
      if (String(f.soll).trim() || String(f.haben).trim()) return false;
      const letzte = L.sortiert(buchungen()).reverse().find((b) => b.text === String(f.text).trim());
      if (!letzte) return false;
      f.soll = letzte.soll; f.haben = letzte.haben;
      return true;
    }

    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-bh]');
      if (!el || !state.data || state.view !== 'buchhaltung') return;
      const a = el.dataset.bh;
      if (a === 'tab') { state.bh.tab = el.dataset.tab; state.bh.edit = null; render(); }
      else if (a === 'pdf') pdf();
      else if (a === 'neu-save') buche();
      else if (a === 'edit') {
        if (ev.target.closest('input,button')) return;
        const b = state.data.buchungen.find((x) => x.id === el.dataset.id);
        state.bh.edit = b.id; state.bh.editForm = { datum: b.datum, beleg: b.beleg, text: b.text, soll: b.soll, haben: b.haben, betrag: b.betrag.toFixed(2) };
        render(); const f = $('#be-text'); if (f) f.focus();
      } else if (a === 'edit-save') speichereEdit();
      else if (a === 'edit-cancel') { state.bh.edit = null; render(); }
      else if (a === 'del') {
        const i = state.data.buchungen.findIndex((x) => x.id === el.dataset.id);
        const [weg] = state.data.buchungen.splice(i, 1);
        state.bh.edit = null; persist(); render();
        toast('Buchung gelöscht', { actionLabel: 'Rückgängig', action: () => { state.data.buchungen.splice(i, 0, weg); persist(); render(); } });
      } else if (a === 'auszug') { state.bh.konto = el.dataset.konto; state.bh.tab = 'auszug'; render(); }
      else if (a === 'konto-neu') { state.bh.kEdit = { konto: '', text: '', bklasse: '3', summe_in: (plan().find((z) => z.gruppe) || {}).gruppe || '', alt: null }; render(); const f = $('#bk-konto'); if (f) f.focus(); }
      else if (a === 'konto-edit') { const z = konten().find((x) => x.konto === el.dataset.konto); state.bh.kEdit = { konto: z.konto, text: z.text, bklasse: z.bklasse, summe_in: z.summe_in, alt: z.konto }; render(); $('.main').scrollTop = 0; const f = $('#bk-text'); if (f) f.focus(); }
      else if (a === 'konto-abbr') { state.bh.kEdit = null; render(); }
      else if (a === 'konto-del') {
        const p = state.data.kontenplaene[jahr()];
        p.zeilen = p.zeilen.filter((z) => z.konto !== state.bh.kEdit.alt);
        state.bh.kEdit = null; persist(); render(); toast('Konto gelöscht');
      } else if (a === 'eroeffnen') {
        const vor = state.data.kontenplaene[jahr() - 1];
        const vortrag = vor.zeilen.some((z) => z.konto === '2970') ? '2970' : null;
        if (!vortrag) { toast('Im Kontenplan fehlt das Konto 2970 für den Gewinnvortrag.', { fehler: true }); return; }
        state.data.kontenplaene[jahr()] = { zeilen: JSON.parse(JSON.stringify(vor.zeilen)), mod: 0 };
        const er = L.eroeffnung(vor.zeilen, state.data.buchungen.filter((b) => b.jahr === jahr() - 1), jahr(), vortrag);
        let pos = state.data.buchungen.reduce((m, b) => Math.max(m, b.pos || 0), 0);
        for (const b of er) state.data.buchungen.push(Object.assign(b, { id: uid('b'), pos: ++pos }));
        persist(); render(); toast(`Buchhaltung ${jahr()} eröffnet mit ${er.length} Eröffnungsbuchungen`);
      }
    });

    document.addEventListener('input', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bh;
      if (!a || !state.data) return;
      if (a === 'feld') {
        const f = el.dataset.form === 'neu' ? neu() : state.bh.editForm;
        f[el.dataset.key] = el.value;
        if (el.dataset.form === 'neu') { const h = $('#bh-hinweis'); if (h) h.textContent = hinweisNeu(); }
      } else if (a === 'suche') { state.bh.q = el.value; render(); }
      else if (a === 'kfeld') state.bh.kEdit[el.dataset.key] = el.value;
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bh;
      if (!a || !state.data) return;
      if (a === 'feld' && el.dataset.key === 'text') {
        const neuForm = el.dataset.form === 'neu';
        const f = neuForm ? neu() : state.bh.editForm;
        if (neuForm && vorschlag(f)) { render(); const b = $('#bn-betrag'); if (b) b.focus(); }
      } else if (a === 'alle-konten') { state.bh.alleKonten = el.checked; render(); }
      else if (a === 'konto-wahl') { state.bh.konto = el.value; render(); }
    });

    document.addEventListener('keydown', (ev) => {
      const el = ev.target;
      if (!state.data || state.view !== 'buchhaltung') return;
      if (el.dataset && el.dataset.bh === 'feld') {
        if (ev.key === 'Enter') { ev.preventDefault(); if (el.dataset.form === 'neu') buche(); else speichereEdit(); }
        else if (ev.key === 'Escape' && el.dataset.form === 'edit') { state.bh.edit = null; render(); }
      } else if (ev.key === 'Enter' && el.classList && el.classList.contains('bh-row')) el.click();
    });

    document.addEventListener('submit', (ev) => {
      if (ev.target.dataset.bhForm !== 'konto') return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      const k = state.bh.kEdit, p = state.data.kontenplaene[jahr()];
      const nr = String(k.konto).trim(), text = String(k.text).trim();
      if (!/^\d{3,6}$/.test(nr)) { toast('Die Kontonummer muss aus 3 bis 6 Ziffern bestehen.', { fehler: true }); return; }
      if (!text) { toast('Die Beschreibung fehlt.', { fehler: true }); return; }
      if (k.alt) {
        const z = p.zeilen.find((x) => x.konto === k.alt);
        const gruppeGeaendert = z.summe_in !== k.summe_in;
        Object.assign(z, { text, bklasse: k.bklasse, summe_in: k.summe_in });
        if (gruppeGeaendert) { p.zeilen = p.zeilen.filter((x) => x !== z); einfuegen(p.zeilen, z); }
      } else {
        if (p.zeilen.some((x) => x.konto === nr)) { toast(`Das Konto ${nr} gibt es schon.`, { fehler: true }); return; }
        einfuegen(p.zeilen, { sektion: '', gruppe: '', konto: nr, text, bklasse: k.bklasse, summe_in: k.summe_in });
      }
      state.bh.kEdit = null; persist(); render(); toast(k.alt ? 'Konto gespeichert' : 'Konto hinzugefügt');
    }, true);

    /** Fügt ein Konto vor der Zeile seiner Gruppe ein, sortiert nach Nummer unter den Konten derselben Gruppe. */
    function einfuegen(zeilen, konto) {
      const iGruppe = zeilen.findIndex((z) => z.gruppe === konto.summe_in);
      let i = iGruppe < 0 ? zeilen.length : iGruppe;
      while (i > 0 && zeilen[i - 1].konto && zeilen[i - 1].summe_in === konto.summe_in && zeilen[i - 1].konto > konto.konto) i--;
      zeilen.splice(i, 0, konto);
    }

    return { view, dossierHtml };
  };
})();
