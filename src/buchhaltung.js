/* Reiter Buchhaltung: Buchungen, Konten, Bilanz und Erfolgsrechnung, Kontoauszug, Dossier als PDF. */
(function () {
  'use strict';
  const L = window.Ledger;

  /**
   * Zwei Buchhaltungen mit demselben Code: das Geschäft (Standard) und privat (opt.privat).
   * Jede hat ihre eigenen Buchungen, Kontenpläne und Bankbewegungen; Rechnungsabgleich und feste Regeln gibt es nur fürs Geschäft.
   */
  window.Buchhaltung = function (ctx, opt = {}) {
    const { state, C, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;
    const $ = (sel, root) => (root || document).querySelector(sel);
    const PRIVAT = !!opt.privat;
    const VIEW = PRIVAT ? 'buchhaltungPrivat' : 'buchhaltung';
    const TITEL = PRIVAT ? 'Buchhaltung privat' : 'Buchhaltung GmbH';
    const K = PRIVAT
      ? { b: 'privatBuchungen', kp: 'privatKontenplaene', bz: 'privatBankZeilen', ign: 'privatBankIgnoriert' }
      : { b: 'buchungen', kp: 'kontenplaene', bz: 'bankZeilen', ign: 'bankIgnoriert' };
    const DB = () => state.data[K.b] || (state.data[K.b] = []);
    const KP = () => state.data[K.kp] || (state.data[K.kp] = {});
    const BZ_ = () => state.data[K.bz] || (state.data[K.bz] = {});
    /** Gespeicherte Bankbewegungen: im Geschäft pro Jahr, privat pro Jahr und Bankkonto (mehrere Banken). */
    const bzKey = (j) => (PRIVAT ? `${j}-${BANK_()}` : String(j));

    const S = state[PRIVAT ? 'bhp' : 'bh'] = { tab: 'buchungen', konto: null, edit: null, q: '', alleKonten: false, neu: null, kEdit: null };

    /* ---------- Daten ---------- */

    const jahr = () => state.year;
    const plan = () => { const p = KP()[jahr()]; return p ? p.zeilen : null; };
    // Vorschläge aus dem Bankabgleich zählen erst, wenn sie bestätigt sind.
    const buchungen = () => DB().filter((b) => b.jahr === jahr() && !b.vorschlag);
    // Neueste zuoberst, wie in der Liste der Buchungen.
    /* Reihenfolge wie im E-Banking: Die eingelesenen Bankbewegungen sind gespeichert; daraus ergibt sich der Platz jeder
       Buchung, auch für später von Hand erfasste oder geänderte Buchungen, ohne dass die Datei neu eingelesen werden muss. */
    let platzMemo = { sig: '', map: new Map() };
    function plaetze() {
      const bz = BZ_()[bzKey(jahr())];
      if (!bz || !bz.zeilen.length) return null;
      const alle = DB().filter((b) => b.jahr === jahr());
      const sig = `${jahr()}|${bz.zeilen.length}|${bz.mod}|${alle.map((b) => `${b.id}:${b.datum}:${b.betrag}:${b.soll}:${b.haben}:${b.bankSchluessel || ''}`).join(',')}`;
      if (platzMemo.sig !== sig) platzMemo = { sig, map: L.bankPlaetze(bz.zeilen, abgleichbar(alle), BANK_()) };
      return platzMemo.map;
    }
    const vorschlaege = () => L.bankSortiert(DB().filter((b) => b.jahr === jahr() && b.vorschlag), plaetze()).reverse();
    /** Privat: Bankkonten für den E-Banking-Import (Aktiven mit Bank im Namen, ohne Wertschriften und GmbH). */
    const bankKonten = () => konten().filter((z) => String(z.bklasse) === '1' && /bank|konto|raiffeisen|post|ubs|zkb|bekb/i.test(z.text) && !/wertschrift|depot|gmbh/i.test(z.text));
    /**
     * Buchungen, die mit E-Banking-Bewegungen abgeglichen werden dürfen. Aus dem Excel übernommene Buchungen («BEBU …»)
     * tragen kein echtes Bankdatum (alle auf demselben Tag) und würden sonst neue Bewegungen mit gleichem Betrag fälschlich als verbucht erkennen.
     */
    const abgleichbar = (liste) => liste.filter((b) => !/^BEBU \d{4}:/.test(b.bankText || ''));
    const kontoMit = (zeilen, re, bk) => zeilen.find((z) => z.konto && String(z.bklasse) === bk && re.test(z.text));
    const wertKonto = (zeilen) => kontoMit(zeilen, /wertschrift|depot/i, '1');

    /* ---------- Privat: automatischer Ausgleich (GmbH-Konto, Wertschriften) ---------- */

    /** Ertragskonto suchen oder nach dem letzten Ertragskonto anlegen. */
    function ertragKonto(zeilen, re, nr, text) {
      const k = kontoMit(zeilen, re, '4'); if (k) return k.konto;
      let i = -1; zeilen.forEach((z, j) => { if (z.konto && String(z.bklasse) === '4') i = j; });
      let n = +nr; while (zeilen.some((z) => z.konto === String(n))) n++;
      zeilen.splice(i >= 0 ? i + 1 : zeilen.length, 0, { sektion: '', gruppe: '', konto: String(n), text, bklasse: '4', summe_in: i >= 0 ? zeilen[i].summe_in : '' });
      return String(n);
    }
    /**
     * Hält zwei Konten der privaten Buchhaltung auf ihrem Sollwert, mit je einer automatischen Buchung pro Jahr:
     * - «Fabio Canetg GmbH» = Saldo des Bankkontos 1010 in der Buchhaltung GmbH (Differenz: Firmengewinn)
     * - Wertschriften = eingetragener Kurswert (Differenz: Anlagegewinn)
     * Gibt true zurück, wenn sich etwas geändert hat.
     */
    function ausgleichen() {
      if (!PRIVAT || !state.data) return false;
      let geaendert = false;
      for (const [j, pl] of Object.entries(KP())) {
        const J = +j, z = pl.zeilen, ziele = [];
        const gmbh = kontoMit(z, /gmbh/i, '1');
        if (gmbh && (state.data.kontenplaene || {})[j]) {
          const s = L.saldi((state.data.buchungen || []).filter((b) => b.jahr === J && !b.vorschlag)).get('1010');
          ziele.push({ id: `auto-gmbh-${j}`, konto: gmbh.konto, ziel: s ? s.saldo : 0, re: /firmengewinn/i, nr: '3800', name: 'Firmengewinn', text: 'Firmengewinn: Ausgleich auf den Kontostand der Bank in der Buchhaltung GmbH (automatisch)' });
        }
        const ws = wertKonto(z), kw = (state.data.settings.privatKurswert || {})[j];
        if (ws && kw && C.isNum(kw.wert)) ziele.push({ id: `auto-wert-${j}`, konto: ws.konto, ziel: kw.wert, datum: kw.datum, re: /anlagegewinn/i, nr: '3810', name: 'Anlagegewinn', text: 'Anlagegewinn: Wertschriften zum Kurswert (automatisch)' });
        else { const i = DB().findIndex((b) => b.id === `auto-wert-${j}`); if (i >= 0) { DB().splice(i, 1); geaendert = true; } }
        for (const a of ziele) {
          const i = DB().findIndex((b) => b.id === a.id), alt = i >= 0 ? DB()[i] : null;
          const s = L.saldi(DB().filter((b) => b.jahr === J && !b.vorschlag && b.id !== a.id)).get(a.konto);
          const diff = C.round2(a.ziel - (s ? s.saldo : 0));
          if (Math.abs(diff) < 0.005) { if (alt) { DB().splice(i, 1); geaendert = true; } continue; }
          const ertrag = ertragKonto(z, a.re, a.nr, a.name);
          const soll = diff > 0 ? a.konto : ertrag, haben = diff > 0 ? ertrag : a.konto, betrag = Math.abs(diff);
          if (alt && alt.soll === soll && alt.haben === haben && Math.abs(alt.betrag - betrag) < 0.005 && alt.text === a.text && (!a.datum || alt.datum === a.datum)) continue;
          const datum = a.datum || (J === +heute.slice(0, 4) ? heute : `${J}-12-31`);
          const neu = { id: a.id, jahr: J, datum, beleg: '', text: a.text, soll, haben, betrag, pos: alt ? alt.pos : DB().reduce((m, b) => Math.max(m, b.pos || 0), 0) + 1, vorschlag: false, sicher: true, bankText: '', bankSchluessel: '', bankDatum: null, bankNr: null, mod: alt ? alt.mod : 0 };
          if (alt) Object.assign(alt, neu); else DB().push(neu);
          geaendert = true;
        }
      }
      return geaendert;
    }

    /**
     * Privat: Vorschlagsregeln für E-Banking-Bewegungen ohne frühere gleiche Buchung.
     * Hinweise im Bank-Text führen zum passenden Aufwandkonto (gesucht über den Kontonamen); sonst gilt das Standardkonto
     * des Bankkontos: Ausgaben über die Kantonalbank (GKB) sind Alltag, über das Raiffeisen-Privatkonto Essen.
     */
    const HINWEISE = [
      [/kleider|\bmode\b|zara|h ?& ?m\b|uniqlo|zalando|\bc ?& ?a\b|mango|bershka|globus|manor|dosenbach|vögele|tally ?weijl|massimo dutti|\bcos\b|esprit|levi'?s|schuh/i, /^kleider/i],
      [/decathlon|transa|bächli|ochsner sport|sportx|intersport|unisport|universit(ä|a)tssport|fitness|\bsport/i, /^sport/i],
      [/\bsbb (cff|mobile|ticket|reisezentrum)|sbb cff ffs|easyride|billett|postauto|halbtax/i, /^sbb/i],
      [/orell f|thalia|ex ?libris|stauffacher|buchhandlung|weltbild/i, /^bücher/i],
      [/krankenkasse|\bcss\b|helsana|swica|sanitas|concordia|visana|\bkpt\b|assura|groupe mutuel|sympany|atupri/i, /^krankenkasse/i],
      [/apotheke|amavita|sun ?store|zahnarzt|arztpraxis|praxis|spital|medbase|dr\.? ?med/i, /^arzt/i],
      [/massage|physio/i, /^massage/i],
      [/fielmann|kochoptik|visilab|mcoptik|optik|lensbest|kontaktlinsen/i, /^linsen/i],
      [/steuerverwaltung|steueramt|gemeindesteuer|staatssteuer/i, /^steuern/i],
      [/mobiliar|\baxa\b|helvetia|generali|baloise|allianz|versicherung/i, /^versicherung privat/i],
      [/\bewb\b|\bbkw\b|serafe|swisscom|\bsalt\b|sunrise|kaminfeger/i, /^nebenkosten/i],
      [/ikea|interio|pfister|\blandi\b|jumbo|hornbach|bauhaus|micasa|möbel|garten/i, /^möbel/i],
      [/tankstelle|migrol|\bsocar\b|\bavia\b|garage|parkhaus|parking|mobility|vignette|\btcs\b/i, /^auto/i],
      [/hotel|booking\.com|airbnb|easyjet|lufthansa|edelweiss|ryanair|expedia/i, /^reisen/i],
      [/digitec|interdiscount|media ?markt|apple\.com|\bfust\b|brack\.ch/i, /^multimedia/i],
      [/gurten|kilbi|ticketcorner|eventfrog/i, /^gurten/i],
      [/kiosk|unihockey|saiten/i, /^zeitschriften/i],
    ];
    function privatRegeln() {
      const aufwand = konten().filter((z) => String(z.bklasse) === '3');
      const kontoNach = (re) => { const k = aufwand.find((z) => re.test(z.text.trim())); return k ? k.konto : ''; };
      const hinweise = HINWEISE.map(([re, name]) => ({ re, gegen: kontoNach(name) })).filter((h) => h.gegen);
      // Eingang mit «Janna» im Text: ihr Anteil an der Wohnungsmiete
      const miete = kontoNach(/^wohnungsmiete/i);
      if (miete) hinweise.push({ re: /janna/i, gegen: miete, text: 'Wohnungsmiete Anteil Janna', richtung: 'ein' });
      // Dauerauftrag an Janna: 3a-Beitrag (Versicherung Janna)
      const vj = kontoNach(/^versicherung janna/i); if (vj) hinweise.push({ re: /janna/i, gegen: vj, text: 'Versicherung Janna', richtung: 'aus' });
      // Lohn: GmbH, Universitäten und Medien
      const ertrag = (re) => (konten().find((z) => String(z.bklasse) === '4' && re.test(z.text.trim())) || {}).konto;
      const lohnGmbH = ertrag(/lohnarbeit gmbh/i), lohn = ertrag(/^ertrag lohnarbeit$/i);
      if (lohnGmbH) hinweise.push({ re: /canetg gmbh/i, gegen: lohnGmbH, text: 'Lohn Fabio Canetg GmbH', richtung: 'ein' });
      if (lohn) hinweise.push({ re: /universit|radio- und fern|\bsrf\b|swissinfo/i, gegen: lohn, richtung: 'ein' });
      const bank = (konten().find((z) => z.konto === BANK_()) || {}).text || '';
      const aus = /kantonalbank|\bgkb\b/i.test(bank) ? kontoNach(/^alltag/i) : /raiffeisen.*privat/i.test(bank) ? kontoNach(/^essen/i) : '';
      return { regeln: false, hinweise, standard: { aus } };
    }
    const vorschlagOpt = () => (PRIVAT ? privatRegeln() : { regeln: true });

    /** Bankkonto, gegen das die E-Banking-Bewegungen gebucht werden: im Geschäft 1010 (Raiffeisen), privat das zuletzt gewählte. */
    function BANK_() {
      if (!PRIVAT) return '1010';
      const gewaehlt = state.data.settings.privatBank;
      if (gewaehlt && konten().some((z) => z.konto === gewaehlt)) return gewaehlt;
      const k = konten().find((z) => String(z.bklasse) === '1' && /bank|konto|raiffeisen|post|ubs|zkb|bekb|cs\b/i.test(z.text));
      return k ? k.konto : '';
    }
    const konten = () => (plan() || []).filter((z) => z.konto);
    const kontoName = (nr) => { const z = konten().find((x) => x.konto === nr); return z ? z.text : ''; };
    const firma = () => (PRIVAT ? 'Buchhaltung privat' : (state.data.settings.absender && state.data.settings.absender.firma) || 'Buchhaltung');

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
      if (!S.neu || S.neuJahr !== jahr()) { S.neu = neuVorlage(); S.neuJahr = jahr(); }
      return S.neu;
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
      // Privat: GmbH-Konto und Wertschriften laufend nachführen (z. B. nach Buchungen in der Buchhaltung GmbH)
      if (PRIVAT && ausgleichen()) setTimeout(() => persist(), 0);
      const t = L.totalsummen(plan(), buchungen());
      const gewinn = -t.erfolg;
      const inhalt = { buchungen: viewBuchungen, konten: viewKonten, abschluss: viewAbschluss, auszug: viewAuszug }[S.tab]();
      return `
      <header class="head">
        <h1>${TITEL} ${jahr()}</h1>
        ${PRIVAT ? (() => {
          // Anlageerfolg: Erfolgskonten der Wertschriften (Anlagegewinn, Kursgewinne, Dividenden, Zinsen)
          const sal = L.saldi(buchungen());
          const anlage = -konten().filter((z) => ['3', '4'].includes(String(z.bklasse)) && /anlage|wertschrift|kurs(gewinn|verlust)|dividend|zins/i.test(z.text)).reduce((x, z) => x + (sal.has(z.konto) ? sal.get(z.konto).saldo : 0), 0);
          const ohne = gewinn - anlage, wort = (v) => (v < 0 ? 'Mehrausgaben' : 'Überschuss');
          return `<div class="bignum"><b class="${ohne < 0 ? 'neg' : ''}">${chf(ohne)}</b><span>${wort(ohne)} bisher ohne Anlageerfolg</span></div>
            <div class="bignum"><b class="${gewinn < 0 ? 'neg' : ''}">${chf(gewinn)}</b><span>${wort(gewinn)} bisher inkl. Anlageerfolg</span></div>`;
        })() : `<div class="bignum"><b class="${gewinn < 0 ? 'neg' : ''}">${chf(gewinn)}</b><span>${gewinn < 0 ? 'Jahresverlust' : 'Jahresgewinn'} bisher</span></div>`}
      </header>
      <div class="bh-bar">
        <div class="seg">${TABS.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-bh="tab" data-tab="${k}">${l}${k === 'buchungen' && vorschlaege().length ? ` <span class="bh-zahl">${vorschlaege().length}</span>` : ''}</button>`).join('')}</div>
        <span class="grow"></span>
        ${Math.abs(t.differenz) > 0.004 ? `<span class="warn">Differenz Soll/Haben: ${chf(t.differenz)}</span>` : ''}
        ${PRIVAT && wertKonto(plan() || []) ? (() => { const kw = (state.data.settings.privatKurswert || {})[jahr()]; return `<label class="bh-kurs" title="Aktueller Wert des Depots. Die Differenz zum Saldo des Kontos ${esc(wertKonto(plan()).konto)} wird als Anlagegewinn gebucht.">Kurswert Wertschriften
          <input id="bh-kurswert" data-bh="kurswert" type="text" inputmode="decimal" placeholder="Fr." value="${kw ? esc(chf(kw.wert)) : ''}">${kw ? `<span class="dim">per ${fmtDate(kw.datum)}</span>` : ''}</label>`; })() : ''}
        <span class="bh-bankmenu-wrap"><button class="btn" data-bh="bank">Bankbewegungen einlesen</button>
          ${PRIVAT && S.bankMenu ? `<div class="bh-bankmenu" role="menu"><div class="bh-bm-t">Bewegungen welches Kontos?</div>${bankKonten().map((z) => `<button role="menuitem" data-bh="bank-konto" data-konto="${esc(z.konto)}">${esc(z.konto)} ${esc(z.text)}</button>`).join('')}</div>` : ''}</span>
        ${BZ_()[bzKey(jahr())] ? `<button class="btn ${S.abgl ? 'on' : ''}" data-bh="abgl" title="Zeigt für die letzten Bankbewegungen, welcher Buchung sie zugeordnet sind">Abgleich ${S.abgl ? 'ausblenden' : 'zeigen'}</button>` : ''}
        <button class="btn" data-bh="pdf">Dossier als PDF</button>
      </div>
      ${PRIVAT ? '' : zahlPanel()}
      ${abgleichPanel()}
      ${inhalt}`;
    }

    function viewLeer() {
      const vor = KP()[jahr() - 1];
      return `<header class="head"><h1>${TITEL} ${jahr()}</h1></header>
      <div class="sec"><p>Für ${jahr()} gibt es noch keine ${PRIVAT ? 'private Buchhaltung. Sobald der Kontenplan geladen ist, funktioniert hier alles wie in der Buchhaltung GmbH' : 'Buchhaltung'}.</p>
        <div class="row" style="margin-top:12px">
          ${vor ? `<button class="btn primary" data-bh="eroeffnen">Aus ${jahr() - 1} eröffnen</button>` : ''}
          <button class="btn" data-action="import">${PRIVAT ? 'Kontenplan importieren' : 'Buchhaltung importieren'}</button>
        </div>
        ${vor ? `<p class="hint">«Eröffnen» übernimmt den Kontenplan von ${jahr() - 1} und bucht per 1. Januar die Schlusssaldi aller Bilanzkonten gegen ${PRIVAT ? 'das Vortrags- oder Eigenkapitalkonto' : 'das Konto 2970 (Gewinnvortrag oder Verlustvortrag)'}. Der Jahreserfolg ${jahr() - 1} landet damit im Vortrag.</p>` : ''}
      </div>`;
    }


    function formZeile(f, pre, aktion) {
      const feld = (key, extra) => `<input id="${pre}-${key}" data-bh="feld" data-form="${aktion}" data-key="${key}" value="${esc(f[key])}" ${extra || ''}>`;
      return `
        <td>${feld('datum', 'type="date"')}</td>
        <td>${feld('beleg', 'type="text"')}</td>
        <td>${feld('text', 'type="text" list="bh-texte" placeholder="Beschreibung"')}</td>
        <td>${feld('soll', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Soll" inputmode="numeric"')}</td>
        <td>${feld('haben', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Haben" inputmode="numeric"')}</td>
        <td>${feld('betrag', 'type="text" class="num r" placeholder="0.00" inputmode="decimal"')}</td>`;
    }

    function viewBuchungen() {
      // Privat: nach Datum, am selben Tag nach Belegnummer (neuste zuoberst); im Geschäft in der Reihenfolge der Bank.
      const belegNr = (b) => { const n = parseInt(String(b.beleg).replace(/\D/g, ''), 10); return isFinite(n) ? n : 0; };
      const alle = PRIVAT ? buchungen().slice().sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : belegNr(a) - belegNr(b) || (a.pos || 0) - (b.pos || 0))) : L.bankSortiert(buchungen(), plaetze());
      const q = S.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const liste = alle.filter((b) => !q.length || q.every((t) => `${fmtDate(b.datum)} ${b.beleg} ${b.text} ${b.soll} ${b.haben} ${b.betrag.toFixed(2)}`.toLowerCase().includes(t))).reverse();
      const texte = [...new Set(alle.map((b) => b.text))].sort();
      const summe = liste.reduce((a, b) => a + b.betrag, 0);
      const zeile = (b) => (S.edit === b.id
        ? `<tr class="bh-edit" data-id="${b.id}">${formZeile(S.editForm, 'be', 'edit')}
            <td class="r"><button class="btn small primary" data-bh="edit-save">Speichern</button> <button class="btn small" data-bh="edit-cancel">Abbrechen</button> <button class="btn small danger" data-bh="del" data-id="${b.id}">Löschen</button></td></tr>`
        : `<tr class="bh-row" data-bh="edit" data-id="${b.id}" tabindex="0">
            <td class="num">${fmtDate(b.datum)}</td><td>${esc(b.beleg)}</td><td class="bt" title="${esc(b.text)}">${esc(b.text)}</td>
            <td class="num" title="${esc(kontoName(b.soll))}">${esc(b.soll)}</td><td class="num" title="${esc(kontoName(b.haben))}">${esc(b.haben)}</td>
            <td class="num r">${chf(b.betrag)}</td><td></td></tr>`);
      return `
      <datalist id="bh-texte">${texte.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="bh-wrap"><table class="bh-tab">
        <colgroup><col style="width:120px"><col style="width:62px"><col><col style="width:68px"><col style="width:68px"><col style="width:104px"><col style="width:${S.edit ? 272 : vorschlaege().length ? 236 : 196}px"></colgroup>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Soll</th><th>Haben</th><th class="r">Betrag CHF</th>
          <th class="r"><input type="search" id="bh-q" placeholder="Suchen" value="${esc(S.q)}" data-bh="suche"></th></tr></thead>
        <tbody>
          <tr class="bh-neu">${formZeile(neu(), 'bn', 'neu')}<td class="r"><button class="btn primary small" data-bh="neu-save">Buchen</button> <span class="dim" id="bh-hinweis">${esc(hinweisNeu())}</span></td></tr>
          ${vorschlagZeilen()}
          ${liste.map(zeile).join('')}
        </tbody>
        <tfoot><tr><td colspan="5">${liste.length} Buchungen${q.length ? ' gefunden' : ''}</td><td class="num r">${chf(summe)}</td><td></td></tr></tfoot>
      </table></div>`;
    }

    function vHinweis(v) {
      if (istSammel(v) && !v.teilVon && !teile(v).length) return 'Sammelzahlung: bitte aufteilen';
      const gegen = v.soll === BANK_() ? v.haben : v.soll;
      if (!gegen) return 'Gegenkonto fehlt';
      const name = kontoName(gegen) || 'Konto unbekannt';
      return v.sicher ? name : `${name}, bitte prüfen`;
    }

    /* Aufteilen einer Bankbewegung (Sammelzahlung): Der Hauptteil kennt das Bank-Total und erhält jeweils den Rest. */
    const istSammel = (v) => /^sammel(zahlung|auftrag)/i.test(String(v.bankText || '').trim());
    // Alle Teile, auch schon bestätigte: Sie gehören weiterhin zur selben Bankbewegung.
    const teile = (h) => DB().filter((x) => x.teilVon === h.id);
    const hauptVon = (v) => (v.teilVon ? DB().find((x) => x.id === v.teilVon) : v);
    function restRechnen(h) {
      if (!h || !h.vorschlag || !C.isNum(h.bankTotal)) return;
      h.betrag = L.round2(h.bankTotal - teile(h).reduce((s, t) => s + (t.betrag || 0), 0));
    }
    function aufteilen(v) {
      const h = hauptVon(v);
      if (!C.isNum(h.bankTotal)) h.bankTotal = h.betrag;
      const ausgang = h.haben === BANK_();
      const t = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), jahr: h.jahr, datum: h.datum, beleg: '', text: '', soll: ausgang ? '' : BANK_(), haben: ausgang ? BANK_() : '', betrag: 0,
        vorschlag: true, sicher: false, bankText: h.bankText, bankSchluessel: h.bankSchluessel, bankDatum: h.bankDatum, bankNr: h.bankNr, teilVon: h.id, pos: h.pos };
      DB().push(t);
      return t;
    }

    /** Buchungsvorschläge aus dem Bankabgleich: farbig, direkt änderbar, zählen erst nach dem Bestätigen. */
    function vorschlagZeilen() {
      const vs = vorschlaege();
      if (!vs.length) return '';
      const sal = L.saldi(buchungen()).get(BANK_());
      let nach = sal ? sal.saldo : 0;
      for (const v of vs) nach += v.soll === BANK_() ? v.betrag : v.haben === BANK_() ? -v.betrag : 0;
      const bank = S.bank && S.bank.jahr === jahr() ? S.bank : null;
      const stimmt = bank && bank.saldo != null && Math.abs(nach - bank.saldo) < 0.005;
      const kopf = `<tr class="bh-vkopf"><td colspan="7"><div class="bh-vk"><b>${vs.length} ${vs.length === 1 ? 'Vorschlag' : 'Vorschläge'} aus dem E-Banking</b>
        <span>Prüfen und bestätigen. Bis dahin zählen sie nicht mit.</span>
        <span class="grow"></span>
        ${bank && bank.saldo != null ? `<span class="${stimmt ? 'pos' : 'neg'}">Bank per ${fmtDate(bank.datum)}: ${chf(bank.saldo)}, Konto ${BANK_()} danach: ${chf(nach)}${stimmt ? ' ✓' : ''}</span>` : ''}
        <button class="btn small" data-bh="v-alle">Alle eindeutigen bestätigen</button></div></td></tr>`;
      const feld = (v, key, extra) => `<input id="bv-${v.id}-${key}" data-bh="vfeld" data-id="${v.id}" data-key="${key}" value="${esc(v[key])}" ${extra || ''}>`;
      return kopf + vs.map((v) => {
        const gegen = v.soll === BANK_() ? v.haben : v.soll;
        const h = hauptVon(v), nTeile = h ? teile(h).length : 0, hauptMitTeilen = !v.teilVon && nTeile > 0;
        return `<tr class="bh-vor ${gegen && v.sicher ? '' : 'unsicher'} ${v.teilVon || hauptMitTeilen ? 'bh-teil' : ''}" data-id="${v.id}">
          <td class="num">${feld(v, 'datum', 'type="date" class="bh-vdat"')}</td><td></td>
          <td>${feld(v, 'text', 'type="text" list="bh-texte"')}<div class="bh-banktext" title="${esc(v.bankText)}">${esc(v.bankText)}</div></td>
          <td>${feld(v, 'soll', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Soll"')}</td>
          <td>${feld(v, 'haben', 'type="text" data-kontowahl="1" autocomplete="off" placeholder="Haben"')}</td>
          <td class="num r">${hauptMitTeilen ? `<span class="bh-rest" title="Rest der Bankbewegung von ${chf(h.bankTotal)}">${chf(v.betrag)}</span>` : `<input id="bv-${v.id}-betrag" data-bh="vfeld" data-id="${v.id}" data-key="betrag" type="text" class="num r bh-vbetrag" inputmode="decimal" value="${esc(Number(v.betrag).toFixed(2))}">`}</td>
          <td class="r"><button class="btn small primary" data-bh="v-ok" data-id="${v.id}">Bestätigen</button> ${v.teilVon ? `<button class="btn small" data-bh="v-teil-weg" data-id="${v.id}" title="Diesen Teil entfernen; der Betrag geht zurück zum ersten Teil">×</button>` : `<button class="btn small" data-bh="v-weg" data-id="${v.id}" title="Nicht verbuchen und bei künftigen Importen nicht mehr vorschlagen">Verwerfen</button>`}
            <div class="bh-vhin"><button class="link bh-teilen" data-bh="v-teilen" data-id="${v.id}" title="Die Bankbewegung auf mehrere Buchungen aufteilen (z. B. Sammelzahlung)">Aufteilen</button> · ${v.teilVon ? 'Teil · ' : hauptMitTeilen ? `Rest von ${chf(h.bankTotal)} · ` : ''}<span class="bh-vhin-t">${esc(vHinweis(v))}</span></div></td></tr>`;
      }).join('');
    }

    function bestaetige(v) {
      if (istSammel(v) && !v.teilVon && !teile(v).length) return 'Sammelzahlungen bitte mit «Aufteilen» einzeln verbuchen.';
      if (!v.teilVon && teile(v).length && !(v.betrag > 0)) return 'Die Teile ergeben schon das ganze Total: Entferne einen Teil oder passe die Beträge an.';
      const p = pruefe({ datum: v.datum, beleg: '', text: v.text, soll: v.soll, haben: v.haben, betrag: String(v.betrag) });
      if (p.fehler) return p.fehler;
      Object.assign(v, p.buchung, { beleg: L.naechsterBeleg(buchungen()), vorschlag: false });
      return null;
    }

    /* ---------- Zahlungseingänge und offene Rechnungen ---------- */

    const projekt = (id) => state.data.projects.find((x) => x.id === id);
    const pName = (id) => { const x = projekt(id); return x ? [x.kunde, x.name].filter(Boolean).join(' – ') : ''; };
    function setzeBezahlt(e) {
      for (const id of e.projekte) { const x = projekt(id); if (x && !x.zahlungsdatum) { x.zahlungsdatum = e.datum; x.zahlungBank = e.schluessel; } }
    }
    /** Gleicht die Gutschriften der Datei mit den offenen Rechnungen ab und trägt eindeutige Zahlungen ein. */
    function rechnungenAbgleichen(zeilen) {
      const nein = new Set(state.data.settings.zahlungNein || []);   // von Hand rückgängig gemacht: nicht erneut eintragen
      const r = C.zahlungenZuordnen(zeilen.filter((z) => !nein.has(z.schluessel)), state.data.projects, state.data.settings);
      const form = (x) => ({ datum: x.zeile.datum, betrag: x.zeile.betrag, text: x.zeile.text, schluessel: x.zeile.schluessel, projekte: x.projekte.map((q) => q.id) });
      const gesetzt = r.treffer.map(form), fast = r.fast.map(form);
      gesetzt.forEach(setzeBezahlt);
      S.zahl = gesetzt.length || fast.length ? { gesetzt, fast } : null;
      return gesetzt.length;
    }
    /**
     * Lernt aus früheren Zahlungen, auf welches Konto die Rechnungen eines Kunden oder Bereichs verbucht wurden.
     * paare: bereits verbuchte Bankbewegungen mit ihrer Buchung.
     */
    function rechnungsBeispiele(paare) {
      const sat = Object.assign({}, C.DEFAULTS, state.data.settings);
      const brutto = (x) => C.projectFigures(x, 0, sat).rechnungsbetrag || 0;
      const namen = (x) => String(x.rechnungsadresse || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2).concat(x.kunde ? [x.kunde] : []);
      const bezahlt = state.data.projects.filter((x) => x.abrechnung === 'rechnung' && x.zahlungsdatum);
      const out = [];
      for (const paar of paare) {
        const z = paar.zeile, b = paar.buchungen[0];
        if (paar.buchungen.length !== 1 || z.betrag <= 0 || b.soll !== BANK_()) continue;
        const nah = bezahlt.filter((x) => x.zahlungBank === z.schluessel || Math.abs(C.daysBetween(x.zahlungsdatum, z.datum)) <= 3);
        const gruppen = (liste) => { const m = new Map(); for (const x of liste) (m.get(x.bereich) || m.set(x.bereich, []).get(x.bereich)).push(x); return [...m.values()]; };
        const passtBetrag = (g) => Math.abs(g.reduce((a, x) => a + brutto(x), 0) - z.betrag) <= 0.05;
        const mitName = gruppen(nah.filter((x) => C.zahlerPasst(z.text, namen(x))));
        let g = mitName.filter(passtBetrag);
        if (g.length !== 1) g = mitName.length === 1 ? mitName : gruppen(nah).filter(passtBetrag);
        if (g.length !== 1) continue;
        out.push({ bereich: g[0][0].bereich, kunden: new Set(g[0].map((x) => x.kunde)), gegen: b.haben, datum: b.datum });
      }
      return out;
    }
    /** Buchungstext aus den Projekten einer Rechnung, z. B. «Honorar VSRB: VSRB Remote Folge 4 (Juni), Folge 5 (September)». */
    function rechnungsText(ps, konto) {
      const nachKunde = new Map();
      for (const x of ps) (nachKunde.get(x.kunde) || nachKunde.set(x.kunde, []).get(x.kunde)).push(x.name);
      const teile = [...nachKunde].map(([k, n]) => [k, n.filter(Boolean).join(', ')].filter(Boolean).join(' '));
      const kopf = kontoName(konto) || 'Honorar';
      return `${kopf}: ${teile.join(', ')}`.slice(0, 140);
    }
    /** Ergänzt einen Vorschlag um das, was die zugeordnete Rechnung verrät: Ertragskonto und Text. */
    function mitRechnung(v, ids, eindeutig, beispiele) {
      const ps = ids.map(projekt).filter(Boolean);
      if (!ps.length || v.soll !== BANK_()) return v;
      const kunden = new Set(ps.map((x) => x.kunde)), bereiche = new Set(ps.map((x) => x.bereich));
      const rang = (e) => ([...e.kunden].some((k) => kunden.has(k)) ? 2 : bereiche.has(e.bereich) ? 1 : 0);
      const bsp = beispiele.filter((e) => rang(e) > 0).sort((a, b) => rang(b) - rang(a) || (a.datum < b.datum ? 1 : -1))[0];
      const konto = bsp ? bsp.gegen : v.haben;
      return Object.assign(v, { haben: konto, text: rechnungsText(ps, konto), sicher: !!bsp && eindeutig && bereiche.size === 1 });
    }

    /** Die letzten Bankbewegungen mit ihrer Zuordnung: So sieht man, warum etwas nicht vorgeschlagen wird, und kann es korrigieren. */
    function abgleichPanel() {
      const bz = BZ_()[bzKey(jahr())];
      if (!S.abgl || !bz) return '';
      const alle = DB().filter((b) => b.jahr === jahr());
      const ign = new Set(state.data.settings[K.ign] || []);
      const a = L.bankAbgleich(bz.zeilen, abgleichbar(alle), BANK_(), [...ign]);
      const zu = new Map(a.paare.map((p) => [p.zeile.schluessel, p.buchungen]));
      const n = S.abglAlle ? bz.zeilen.length : 20;
      const zeilen = bz.zeilen.slice(-n).reverse();
      const zeile = (z) => {
        const bs = zu.get(z.schluessel);
        let status, knopf = '';
        if (bs && bs.some((b) => b.vorschlag)) status = '<span class="over-text">Vorschlag, noch nicht bestätigt</span>';
        else if (bs) {
          status = bs.map((b) => `Beleg ${esc(b.beleg || '–')} vom ${fmtDate(b.datum)}: ${esc(b.text)}`).join('<br>');
          // Nur anbieten, wenn die Zuordnung über Betrag und Datum geraten ist (nicht bei Buchungen, die aus genau dieser Bewegung entstanden sind).
          if (!bs.some((b) => b.bankSchluessel === z.schluessel)) knopf = `<button class="btn small" data-bh="abg-neu" data-key="${esc(z.schluessel)}" title="Die Zuordnung stimmt nicht: diese Bankbewegung als neuen Vorschlag anlegen">Falsch zugeordnet</button>`;
        } else if (ign.has(z.schluessel)) { status = '<span class="dim">verworfen</span>'; knopf = `<button class="btn small" data-bh="abg-neu" data-key="${esc(z.schluessel)}">Wieder vorschlagen</button>`; }
        else { status = '<span class="neg">nicht verbucht</span>'; knopf = `<button class="btn small primary" data-bh="abg-neu" data-key="${esc(z.schluessel)}">Vorschlagen</button>`; }
        return `<tr><td class="num">${fmtDate(z.datum)}</td><td class="num r">${chf(z.betrag)}</td><td class="abg-t" title="${esc(z.text)}">${esc(z.text)}</td><td>${status}</td><td class="r">${knopf}</td></tr>`;
      };
      return `<div class="bh-abgl"><button class="x" data-bh="abgl" title="Schliessen">×</button>
        <h3>Abgleich mit der Bank</h3>
        <p>Jede Bankbewegung und die Buchung, der sie zugeordnet ist. Die neuste steht zuoberst.</p>
        <div class="bh-abgl-wrap"><table><thead><tr><th>Datum</th><th class="r">Betrag</th><th>Text der Bank</th><th>Zugeordnet</th><th></th></tr></thead><tbody>${zeilen.map(zeile).join('')}</tbody></table></div>
        ${bz.zeilen.length > 20 ? `<button class="of-mehr" data-bh="abgl-alle">${S.abglAlle ? 'Nur die letzten 20 zeigen' : `Alle ${bz.zeilen.length} zeigen`}</button>` : ''}</div>`;
    }

    function zahlPanel() {
      const z = S.zahl;
      if (!z) return '';
      const zeile = (e, i, art) => `<tr><td class="num">${fmtDate(e.datum)}</td><td class="num r">${chf(e.betrag)}</td>
        <td>${esc(e.text.replace(/^Gutschrift\s+/i, ''))}</td><td>${e.projekte.map((id) => esc(pName(id))).join('<br>')}</td>
        <td class="r">${art === 'gesetzt' ? `<button class="btn small" data-bh="z-zurueck" data-i="${i}">Rückgängig</button>` : `<button class="btn small primary" data-bh="z-setzen" data-i="${i}">Als bezahlt eintragen</button>`}</td></tr>`;
      return `<div class="bh-zahl-panel">
        <button class="x" data-bh="z-zu" title="Schliessen">×</button>
        ${z.gesetzt.length ? `<h3>${z.gesetzt.length === 1 ? 'Eine Rechnung wurde' : `${z.gesetzt.length} Rechnungen wurden`} als bezahlt eingetragen</h3>
          <p>Betrag und Zahler stimmen mit einer Gutschrift überein. Das Zahlungsdatum ist das Buchungsdatum der Bank.</p>
          <table>${z.gesetzt.map((e, i) => zeile(e, i, 'gesetzt')).join('')}</table>` : ''}
        ${z.fast.length ? `<h3>Betrag passt, Zahler nicht erkannt</h3>
          <p>Hier stimmt nur der Betrag. Der Name auf der Gutschrift kommt weder in der Rechnungsadresse noch im Kunden vor, darum ist nichts eingetragen.</p>
          <table>${z.fast.map((e, i) => zeile(e, i, 'fast')).join('')}</table>` : ''}
      </div>`;
    }

    /** Liest den CSV-Export aus dem E-Banking, erkennt Verbuchtes und legt für den Rest Vorschläge an. */
    async function bankEinlesen() {
      const r = await api.openText('Kontobewegungen aus dem E-Banking wählen', ['csv', 'txt']);
      if (!r || r.canceled) return;
      if (r.fehler) { toast(r.fehler, { fehler: true }); return; }
      const p = L.parseBankCsv(r.text);
      if (p.fehler) { toast(p.fehler, { fehler: true }); return; }
      if (!BANK_()) { toast('Im Kontenplan gibt es kein Bankkonto, gegen das die Bewegungen gebucht werden können.', { fehler: true }); return; }
      const bezahlt = PRIVAT ? 0 : rechnungenAbgleichen(p.zeilen);
      const zusatz = bezahlt ? ` ${bezahlt === 1 ? 'Eine Rechnung' : `${bezahlt} Rechnungen`} als bezahlt eingetragen.` : '';
      const z = p.zeilen.filter((x) => x.datum.startsWith(jahr() + '-'));
      if (!z.length) { if (bezahlt) persist(); render(); toast(`Die Datei enthält keine Bewegungen im Jahr ${jahr()}.${zusatz}`, { fehler: !bezahlt }); return; }
      const alle = DB().filter((b) => b.jahr === jahr());
      // Bankbewegungen des Jahres merken: Sie bestimmen dauerhaft die Reihenfolge der Buchungen.
      const gemerkt = BZ_()[bzKey(jahr())] || { mod: 0, zeilen: [] };
      const zusammen = L.bankZeilenMerge(gemerkt.zeilen, z.filter((x) => Math.abs(x.betrag) > 0.004));
      const zeilenNeu = JSON.stringify(zusammen) !== JSON.stringify(gemerkt.zeilen);
      BZ_()[bzKey(jahr())] = { mod: gemerkt.mod, zeilen: zusammen };
      const a = L.bankAbgleich(z, abgleichbar(alle), BANK_(), state.data.settings[K.ign] || []);
      // Gelernt wird nur aus bestätigten Buchungen.
      const lern = a.paare.filter((x) => x.buchungen.every((b) => !b.vorschlag));
      let pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0);
      // Welche Gutschrift gehört zu welcher Rechnung? Das bestimmt Konto und Text des Vorschlags.
      const zuRechnung = new Map();
      if (!PRIVAT) for (const x of state.data.projects) if (x.zahlungBank) { const e = zuRechnung.get(x.zahlungBank) || { ids: [], eindeutig: true }; e.ids.push(x.id); zuRechnung.set(x.zahlungBank, e); }
      if (S.zahl) for (const e of S.zahl.fast) zuRechnung.set(e.schluessel, { ids: e.projekte, eindeutig: false });
      const beispiele = zuRechnung.size ? rechnungsBeispiele(lern) : [];
      const vorschlag = (zeile) => {
        const v = L.bankVorschlag(zeile, lern, BANK_(), vorschlagOpt()), r = zuRechnung.get(zeile.schluessel);
        return r ? mitRechnung(v, r.ids, r.eindeutig, beispiele) : v;
      };
      let geaendert = 0;
      // Platz jeder Buchung im E-Banking merken, damit die Liste dieselbe Reihenfolge zeigt.
      for (const paar of a.paare) for (const b of paar.buchungen) {
        if (b.bankNr !== paar.zeile.nr || b.bankDatum !== paar.zeile.datum) { b.bankNr = paar.zeile.nr; b.bankDatum = paar.zeile.datum; geaendert++; }
      }
      for (const n of a.neu) DB().push(Object.assign({ id: uid('b'), jahr: jahr(), beleg: '', pos: ++pos, vorschlag: true }, vorschlag(n)));
      // Bestehende, von Hand noch nicht veränderte Vorschläge nachführen, sobald eine Rechnung dazu bekannt ist.
      for (const paar of a.paare) {
        const b = paar.buchungen[0];
        if (paar.buchungen.length !== 1 || !b.vorschlag || !zuRechnung.has(paar.zeile.schluessel)) continue;
        const roh = L.bankVorschlag(paar.zeile, lern, BANK_(), vorschlagOpt());
        if (b.text !== roh.text || b.soll !== roh.soll || b.haben !== roh.haben) continue;
        const neu = vorschlag(paar.zeile);
        if (neu.text !== b.text || neu.haben !== b.haben) { Object.assign(b, { text: neu.text, haben: neu.haben, sicher: neu.sicher }); geaendert++; }
      }
      const letzte = z[z.length - 1];
      S.bank = { jahr: jahr(), datum: letzte.datum, saldo: letzte.saldo };
      S.tab = 'buchungen'; S.q = '';
      if (a.neu.length || bezahlt || geaendert || zeilenNeu) persist();
      render();
      const offenV = a.paare.length - lern.length;
      toast(`${a.paare.length + a.neu.length + a.ignoriert} Bewegungen gelesen: ${lern.length} schon verbucht, ${a.neu.length} ${a.neu.length === 1 ? 'neuer Vorschlag' : 'neue Vorschläge'}${offenV ? `, ${offenV} noch unbestätigt` : ''}${a.ignoriert ? `, ${a.ignoriert} früher verworfen` : ''}.${zusatz}`);
    }

    function hinweisNeu() {
      const f = neu();
      const s = String(f.soll).trim(), h = String(f.haben).trim();
      return [kontoName(s) && `Soll: ${kontoName(s)}`, kontoName(h) && `Haben: ${kontoName(h)}`].filter(Boolean).join(', ');
    }

    function viewKonten() {
      const a = L.auswertung(plan(), buchungen());
      const q = String(S.kq || '').trim().toLowerCase();
      const sichtbar = plan().filter((z) => {
        if (S.alleKonten || !z.konto) return true;
        return a.konto.has(z.konto);
      });
      // Gruppen ohne sichtbares Konto und ohne Saldo ausblenden, wenn nur bewegte Konten gezeigt werden.
      // Beim Suchen: alle Konten und Gruppen, deren Nummer oder Beschreibung passt (auch ohne Bewegung).
      const zeilen = q
        ? plan().filter((z) => (z.konto || z.gruppe) && q.split(/\s+/).every((w) => `${z.konto || ''} ${z.gruppe || ''} ${z.text || ''}`.toLowerCase().includes(w)))
        : sichtbar.filter((z) => S.alleKonten || !z.gruppe || Math.abs(a.saldoVon(z)) > 0.004);
      const gruppen = (plan() || []).filter((z) => z.gruppe);
      const k = S.kEdit;
      return `
      <div class="bh-bar2">
        <input id="bh-ksuche" type="search" placeholder="Konto suchen (Nummer oder Name)" value="${esc(S.kq || '')}" data-bh="ksuche" class="bh-ksuche">
        <label class="check"><input type="checkbox" data-bh="alle-konten" ${S.alleKonten ? 'checked' : ''}> Auch Konten ohne Bewegung zeigen</label>
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
        }).join('') || `<tr><td colspan="8" class="dim">Kein Konto passt zu «${esc(S.kq)}».</td></tr>`}</tbody>
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
      if (!S.konto || !konten().some((z) => z.konto === S.konto)) S.konto = mit.length ? mit[0].konto : (konten()[0] || {}).konto;
      const nr = S.konto;
      const k = L.kontoauszug(nr, buchungen());
      return `
      <div class="bh-bar2"><label for="bh-konto">Konto</label>
        <select id="bh-konto" data-bh="konto-wahl">${konten().map((z) => `<option value="${esc(z.konto)}" ${z.konto === nr ? 'selected' : ''}>${esc(z.konto)} ${esc(z.text)}${a.konto.has(z.konto) ? '' : ' (ohne Bewegung)'}</option>`).join('')}</select></div>
      <div class="bh-wrap"><table class="bh-tab">
        <colgroup><col style="width:100px"><col style="width:84px"><col><col style="width:84px"><col style="width:118px"><col style="width:118px"><col style="width:126px"></colgroup>
        <thead><tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Gegenkto.</th><th class="r">Soll CHF</th><th class="r">Haben CHF</th><th class="r">Saldo CHF</th></tr></thead>
        <tbody>${k.zeilen.map((z) => `<tr><td class="num">${fmtDate(z.datum)}</td><td>${esc(z.beleg)}</td><td class="bt" title="${esc(z.text)}">${esc(z.text)}</td><td class="num" title="${esc(kontoName(z.gegenkonto))}">${esc(z.gegenkonto)}</td>
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
      const r = await api.savePdf(dossierHtml(), { ordner: PRIVAT ? 'Buchhaltung privat' : 'Buchhaltung', name, fuss: fmtDate(heute) });
      if (r.fehler) toast(r.fehler, { fehler: true }); else toast('Dossier gespeichert: ' + r.path);
    }

    /* ---------- Aktionen ---------- */

    function buche() {
      const p = pruefe(neu());
      if (p.fehler) { toast(p.fehler, { fehler: true }); const el = $('#bn-' + p.feld); if (el) el.focus(); return; }
      const pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0) + 1;
      DB().push(Object.assign({ id: uid('b'), jahr: jahr(), pos }, p.buchung));
      const datum = p.buchung.datum;
      S.neu = null;
      persist(); neu().datum = datum; render();
      const el = $('#bn-text'); if (el) el.focus();
    }

    function speichereEdit() {
      const b = DB().find((x) => x.id === S.edit);
      const p = pruefe(S.editForm);
      if (p.fehler) { toast(p.fehler, { fehler: true }); const el = $('#be-' + p.feld); if (el) el.focus(); return; }
      Object.assign(b, p.buchung);
      S.edit = null; persist(); render(); toast('Buchung gespeichert');
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
      if (!el || !state.data || state.view !== VIEW) return;
      const a = el.dataset.bh;
      if (a === 'tab') { S.tab = el.dataset.tab; S.edit = null; render(); }
      else if (a === 'bank') {
        // Privat gibt es mehrere Bankkonten: zuerst wählen, zu welchem die Datei gehört.
        if (PRIVAT && bankKonten().length > 1) { S.bankMenu = !S.bankMenu; render(); }
        else { if (PRIVAT && bankKonten().length === 1) state.data.settings.privatBank = bankKonten()[0].konto; bankEinlesen(); }
      }
      else if (a === 'bank-konto') { S.bankMenu = false; state.data.settings.privatBank = el.dataset.konto; render(); bankEinlesen(); }
      else if (a === 'abgl') { S.abgl = !S.abgl; render(); }
      else if (a === 'abgl-alle') { S.abglAlle = !S.abglAlle; render(); }
      else if (a === 'abg-neu') {
        // Bankbewegung ausdrücklich als Vorschlag anlegen; über ihren Schlüssel bleibt sie künftig dieser Buchung zugeordnet.
        const bz = BZ_()[bzKey(jahr())], z = bz.zeilen.find((x) => x.schluessel === el.dataset.key);
        if (!z) return;
        const alle = DB().filter((b) => b.jahr === jahr());
        const ign = state.data.settings[K.ign] || [];
        const k = ign.indexOf(z.schluessel); if (k >= 0) ign.splice(k, 1);
        const lern = L.bankAbgleich(bz.zeilen, abgleichbar(alle), BANK_(), []).paare.filter((x) => x.zeile.schluessel !== z.schluessel && x.buchungen.every((b) => !b.vorschlag));
        const pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0) + 1;
        DB().push(Object.assign({ id: uid('b'), jahr: jahr(), beleg: '', pos, vorschlag: true }, L.bankVorschlag(z, lern, BANK_(), vorschlagOpt())));
        S.tab = 'buchungen'; persist(); render(); toast('Als Vorschlag angelegt');
      }
      else if (a === 'z-zu') { S.zahl = null; render(); }
      else if (a === 'z-zurueck') {
        const [e] = S.zahl.gesetzt.splice(+el.dataset.i, 1);
        for (const id of e.projekte) { const x = projekt(id); if (x && x.zahlungBank === e.schluessel) { x.zahlungsdatum = null; x.zahlungBank = null; } }
        (state.data.settings.zahlungNein || (state.data.settings.zahlungNein = [])).push(e.schluessel);
        S.zahl.fast.push(e); persist(); render();
      } else if (a === 'z-setzen') {
        const [e] = S.zahl.fast.splice(+el.dataset.i, 1);
        setzeBezahlt(e); S.zahl.gesetzt.push(e); persist(); render();
      }
      else if (a === 'v-teilen') {
        const v = DB().find((x) => x.id === el.dataset.id); if (!v) return;
        const t = aufteilen(v); persist(); render();
        const f = document.getElementById(`bv-${t.id}-betrag`); if (f) { f.focus(); f.select(); }
      } else if (a === 'v-teil-weg') {
        const i = DB().findIndex((x) => x.id === el.dataset.id); if (i < 0) return;
        const [weg] = DB().splice(i, 1); restRechnen(hauptVon(weg)); persist(); render();
      }
      else if (a === 'v-ok') {
        const v = DB().find((x) => x.id === el.dataset.id);
        const f = bestaetige(v);
        if (f) { toast(f, { fehler: true }); return; }
        persist(); render(); toast('Buchung bestätigt');
      } else if (a === 'v-weg') {
        const i = DB().findIndex((x) => x.id === el.dataset.id);
        const [weg] = DB().splice(i, 1);
        // Verwerfen gilt für die ganze Bankbewegung: auch ihre Teile entfernen.
        for (let k = DB().length - 1; k >= 0; k--) if (DB()[k].vorschlag && DB()[k].teilVon === weg.id) DB().splice(k, 1);
        const ign = state.data.settings[K.ign] || (state.data.settings[K.ign] = []);
        if (weg.bankSchluessel) ign.push(weg.bankSchluessel);
        persist(); render();
        toast('Vorschlag verworfen', { actionLabel: 'Rückgängig', action: () => { DB().splice(i, 0, weg); const k = ign.indexOf(weg.bankSchluessel); if (k >= 0) ign.splice(k, 1); persist(); render(); } });
      } else if (a === 'v-alle') {
        let n = 0, rest = 0;
        // In der Reihenfolge der Bank bestätigen (älteste zuerst), damit die Belegnummern gleich laufen.
        for (const v of vorschlaege().reverse()) { if (!v.sicher || bestaetige(v)) rest++; else n++; }
        persist(); render(); toast(`${n} ${n === 1 ? 'Buchung' : 'Buchungen'} bestätigt${rest ? `, ${rest} ${rest === 1 ? 'bleibt' : 'bleiben'} zum Prüfen` : ''}`);
      }
      else if (a === 'pdf') pdf();
      else if (a === 'neu-save') buche();
      else if (a === 'edit') {
        if (ev.target.closest('input,button')) return;
        const b = DB().find((x) => x.id === el.dataset.id);
        S.edit = b.id; S.editForm = { datum: b.datum, beleg: b.beleg, text: b.text, soll: b.soll, haben: b.haben, betrag: b.betrag.toFixed(2) };
        render(); const f = $('#be-text'); if (f) f.focus();
      } else if (a === 'edit-save') speichereEdit();
      else if (a === 'edit-cancel') { S.edit = null; render(); }
      else if (a === 'del') {
        const i = DB().findIndex((x) => x.id === el.dataset.id);
        const [weg] = DB().splice(i, 1);
        S.edit = null; persist(); render();
        toast('Buchung gelöscht', { actionLabel: 'Rückgängig', action: () => { DB().splice(i, 0, weg); persist(); render(); } });
      } else if (a === 'auszug') { S.konto = el.dataset.konto; S.tab = 'auszug'; render(); }
      else if (a === 'konto-neu') { S.kEdit = { konto: '', text: '', bklasse: '3', summe_in: (plan().find((z) => z.gruppe) || {}).gruppe || '', alt: null }; render(); const f = $('#bk-konto'); if (f) f.focus(); }
      else if (a === 'konto-edit') { const z = konten().find((x) => x.konto === el.dataset.konto); S.kEdit = { konto: z.konto, text: z.text, bklasse: z.bklasse, summe_in: z.summe_in, alt: z.konto }; render(); $('.main').scrollTop = 0; const f = $('#bk-text'); if (f) f.focus(); }
      else if (a === 'konto-abbr') { S.kEdit = null; render(); }
      else if (a === 'konto-del') {
        const p = KP()[jahr()];
        p.zeilen = p.zeilen.filter((z) => z.konto !== S.kEdit.alt);
        S.kEdit = null; persist(); render(); toast('Konto gelöscht');
      } else if (a === 'eroeffnen') {
        const vor = KP()[jahr() - 1];
        // Geschäft: 2970 Gewinnvortrag. Privat: das Konto für Vortrag bzw. Eigenkapital/Vermögen im eigenen Kontenplan.
        const vortrag = vor.zeilen.some((z) => z.konto === '2970') ? '2970'
          : PRIVAT ? ((vor.zeilen.find((z) => z.konto && String(z.bklasse) === '2' && /vortrag|eigenkapital|reinverm|vermögen/i.test(z.text)) || {}).konto || null) : null;
        if (!vortrag) { toast(PRIVAT ? 'Im Kontenplan fehlt ein Passivkonto für Vortrag, Eigenkapital oder Vermögen.' : 'Im Kontenplan fehlt das Konto 2970 für den Gewinnvortrag.', { fehler: true }); return; }
        KP()[jahr()] = { zeilen: JSON.parse(JSON.stringify(vor.zeilen)), mod: 0 };
        const er = L.eroeffnung(vor.zeilen, DB().filter((b) => b.jahr === jahr() - 1 && !b.vorschlag), jahr(), vortrag);
        let pos = DB().reduce((m, b) => Math.max(m, b.pos || 0), 0);
        for (const b of er) DB().push(Object.assign(b, { id: uid('b'), pos: ++pos }));
        persist(); render(); toast(`Buchhaltung ${jahr()} eröffnet mit ${er.length} Eröffnungsbuchungen`);
      }
    });

    document.addEventListener('input', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bh;
      if (!a || !state.data || state.view !== VIEW) return;
      if (a === 'feld') {
        const f = el.dataset.form === 'neu' ? neu() : S.editForm;
        f[el.dataset.key] = el.value;
        if (el.dataset.form === 'neu') { const h = $('#bh-hinweis'); if (h) h.textContent = hinweisNeu(); }
      } else if (a === 'vfeld') {
        const v = DB().find((x) => x.id === el.dataset.id);
        const key = el.dataset.key;
        if (key === 'betrag') { const b = C.parseAmount(el.value); if (b == null || b <= 0) return; v.betrag = Math.round(b * 100) / 100; if (v.teilVon) restRechnen(hauptVon(v)); }
        else if (key === 'datum') { if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return; v.datum = el.value; }
        else v[key] = key === 'text' ? el.value : el.value.trim().split(/\s/)[0];
        v.sicher = true;   // von Hand angefasst gilt als geprüft
      } else if (a === 'suche') { S.q = el.value; render(); }
      else if (a === 'ksuche') { S.kq = el.value; render(); }
      else if (a === 'kfeld') S.kEdit[el.dataset.key] = el.value;
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bh;
      if (!a || !state.data || state.view !== VIEW) return;
      if (a === 'kurswert') {
        const alle = state.data.settings.privatKurswert || (state.data.settings.privatKurswert = {});
        const v = el.value.trim() === '' ? null : C.parseAmount(el.value);
        if (el.value.trim() !== '' && v == null) { toast('Bitte einen Betrag eingeben, zum Beispiel 72500.', { fehler: true }); return; }
        if (v == null) delete alle[jahr()]; else alle[jahr()] = { wert: v, datum: heute };
        persist(); render(); return;
      }
      if (a === 'feld' && el.dataset.key === 'text') {
        const neuForm = el.dataset.form === 'neu';
        const f = neuForm ? neu() : S.editForm;
        if (neuForm && vorschlag(f)) { render(); const b = $('#bn-betrag'); if (b) b.focus(); }
      } else if (a === 'vfeld') {
        // Kein Neuaufbau der Liste, sonst ginge beim Tabben der Fokus verloren.
        const v = DB().find((x) => x.id === el.dataset.id);
        const tr = el.closest('tr');
        if (v && tr) {
          const gegen = v.soll === BANK_() ? v.haben : v.soll;
          tr.classList.toggle('unsicher', !(gegen && v.sicher));
          const h = tr.querySelector('.bh-vhin-t'); if (h) h.textContent = vHinweis(v);
        }
        persist();
        // Datum und Betrag verschieben Reihenfolge und Bank-Saldo: neu zeichnen (der Fokus bleibt über die id erhalten).
        if (el.dataset.key === 'datum' || el.dataset.key === 'betrag') render();
      }
      else if (a === 'alle-konten') { S.alleKonten = el.checked; render(); }
      else if (a === 'konto-wahl') { S.konto = el.value; render(); }
    });

    /* ---------- Kontoauswahl: eigene, scrollbare Liste statt der Vorschlagsliste des Browsers ---------- */

    let kw = null;   // { input, box, treffer, i }
    function kwSchliessen() { if (kw) { kw.box.remove(); kw = null; } }
    function kwZeigen(input, alle) {
      const q = alle ? '' : input.value.trim().toLowerCase();
      const liste = konten().filter((z) => !q || z.konto.startsWith(q) || String(z.text).toLowerCase().includes(q));
      if (!kw || kw.input !== input) { kwSchliessen(); const box = document.createElement('div'); box.className = 'bh-kwahl'; document.body.appendChild(box); kw = { input, box }; }
      kw.treffer = liste;
      kw.i = Math.max(0, liste.findIndex((z) => z.konto === input.value.trim().split(/\s/)[0]));
      kw.box.innerHTML = liste.length ? liste.map((z, i) => `<div class="bh-kw-z ${i === kw.i ? 'on' : ''}" data-i="${i}"><b>${esc(z.konto)}</b><span>${esc(z.text)}</span></div>`).join('') : '<div class="bh-kw-leer">Kein passendes Konto</div>';
      const r = input.getBoundingClientRect(), hoehe = Math.min(320, window.innerHeight - r.bottom - 12);
      Object.assign(kw.box.style, { left: `${r.left}px`, minWidth: `${Math.max(r.width, 280)}px`, ...(hoehe >= 160 ? { top: `${r.bottom + 2}px`, maxHeight: `${hoehe}px`, bottom: '' } : { top: '', bottom: `${window.innerHeight - r.top + 2}px`, maxHeight: `${Math.min(320, r.top - 12)}px` }) });
      // Nicht über den rechten Fensterrand hinaus
      const breite = kw.box.offsetWidth;
      if (r.left + breite > window.innerWidth - 12) kw.box.style.left = `${Math.max(12, window.innerWidth - 12 - breite)}px`;
      const on = kw.box.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function kwWaehlen(i) {
      if (!kw || !kw.treffer[i]) return;
      const input = kw.input; input.value = kw.treffer[i].konto; kwSchliessen();
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.addEventListener('focusin', (ev) => { if (ev.target.dataset && ev.target.dataset.kontowahl && state.view === VIEW) kwZeigen(ev.target, true); });
    document.addEventListener('focusout', (ev) => { if (kw && ev.target === kw.input) setTimeout(() => { if (kw && document.activeElement !== kw.input) kwSchliessen(); }, 0); });
    document.addEventListener('input', (ev) => { if (ev.target.dataset && ev.target.dataset.kontowahl && ev.isTrusted && state.view === VIEW) kwZeigen(ev.target, false); });
    document.addEventListener('click', (ev) => { if (ev.target.dataset && ev.target.dataset.kontowahl && !kw && state.view === VIEW) kwZeigen(ev.target, true); });
    document.addEventListener('mousedown', (ev) => {
      const z = ev.target.closest && ev.target.closest('.bh-kwahl');
      if (!z) return;
      ev.preventDefault();   // Fokus im Feld lassen
      const zeile = ev.target.closest('.bh-kw-z'); if (zeile) kwWaehlen(+zeile.dataset.i);
    });
    document.addEventListener('keydown', (ev) => {
      if (!kw || ev.target !== kw.input) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault(); ev.stopImmediatePropagation();
        kw.i = Math.max(0, Math.min(kw.treffer.length - 1, kw.i + (ev.key === 'ArrowDown' ? 1 : -1)));
        kw.box.querySelectorAll('.bh-kw-z').forEach((n, i) => n.classList.toggle('on', i === kw.i));
        const on = kw.box.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
      } else if ((ev.key === 'Enter' || ev.key === 'Tab') && kw.treffer.length && kw.input.value.trim() !== kw.treffer[kw.i].konto) {
        if (ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); }
        kwWaehlen(kw.i);
      } else if (ev.key === 'Escape') { ev.stopImmediatePropagation(); kwSchliessen(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') kwSchliessen();
    }, true);
    window.addEventListener('resize', kwSchliessen);
    document.addEventListener('scroll', (ev) => { if (kw && !kw.box.contains(ev.target)) kwSchliessen(); }, true);

    document.addEventListener('keydown', (ev) => {
      const el = ev.target;
      if (!state.data || state.view !== VIEW) return;
      if (el.dataset && el.dataset.bh === 'feld') {
        if (ev.key === 'Enter') { ev.preventDefault(); if (el.dataset.form === 'neu') buche(); else speichereEdit(); }
        else if (ev.key === 'Escape' && el.dataset.form === 'edit') { S.edit = null; render(); }
      } else if (el.dataset && el.dataset.bh === 'vfeld' && ev.key === 'Enter') {
        ev.preventDefault();
        const v = DB().find((x) => x.id === el.dataset.id);
        const f = bestaetige(v);
        if (f) toast(f, { fehler: true }); else { persist(); render(); toast('Buchung bestätigt'); }
      } else if (ev.key === 'Enter' && el.classList && el.classList.contains('bh-row')) el.click();
    });

    document.addEventListener('submit', (ev) => {
      if (ev.target.dataset.bhForm !== 'konto' || state.view !== VIEW) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      const k = S.kEdit, p = KP()[jahr()];
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
      S.kEdit = null; persist(); render(); toast(k.alt ? 'Konto gespeichert' : 'Konto hinzugefügt');
    }, true);

    /** Fügt ein Konto vor der Zeile seiner Gruppe ein, sortiert nach Nummer unter den Konten derselben Gruppe. */
    function einfuegen(zeilen, konto) {
      const iGruppe = zeilen.findIndex((z) => z.gruppe === konto.summe_in);
      let i = iGruppe < 0 ? zeilen.length : iGruppe;
      while (i > 0 && zeilen[i - 1].konto && zeilen[i - 1].summe_in === konto.summe_in && zeilen[i - 1].konto > konto.konto) i--;
      zeilen.splice(i, 0, konto);
    }

    // Auswahl des Bankkontos schliessen: Klick daneben oder Escape
    document.addEventListener('mousedown', (ev) => { if (S.bankMenu && state.view === VIEW && !ev.target.closest('.bh-bankmenu-wrap')) { S.bankMenu = false; render(); } });
    document.addEventListener('keydown', (ev) => { if (S.bankMenu && ev.key === 'Escape' && state.view === VIEW) { S.bankMenu = false; render(); } });

    return { view, dossierHtml, ausgleichen };
  };
})();
