/* Reiter Budget: Übersicht der Offerten nach Jahr und Budget pro Jahr (aufgebaut wie das Excel «Aufträge»). */
(function () {
  'use strict';
  const BD = window.BudgetDoc;

  window.Budget = function (ctx) {
    const { state, esc, persist, render, toast, uid, zeigeOfferte } = ctx;

    state.bu = { zu: new Set(), gAuf: new Set(), notiz: new Set() };   // Gruppen starten zugeklappt

    const posten = () => state.data.budgetPosten || (state.data.budgetPosten = []);
    const jahr = () => state.year;
    const imJahr = () => posten().filter((p) => p.jahr === jahr()).sort((a, b) => a.pos - b.pos);
    const finde = (id) => posten().find((p) => p.id === id);
    const offerten = () => state.data.offerten || [];
    const oTitel = (o) => [o.kunde, o.name].filter(Boolean).join(' – ') || 'Offerte ohne Namen';
    const STATUS_TEXT = Object.fromEntries(BD.STATUS);
    const STATUS_KL = { offen: 's-offen', zugesagt: 's-bezahlt', abgeschlossen: 's-gestellt', abgesagt: 's-intern' };
    const pill = (o) => `<span class="pill ${STATUS_KL[o.status] || ''}">${esc(STATUS_TEXT[o.status] || o.status)}</span>`;

    /** Franken mit Hochkomma; ganze Beträge ohne Rappen (wie im Excel). */
    function fr(x, leerBeiNull) {
      if (x == null || !isFinite(x) || (leerBeiNull && Math.abs(x) < 0.005)) return '';
      const [g, r] = Math.abs(x).toFixed(2).split('.');
      return (x < -0.004 ? '-' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + (r === '00' ? '' : '.' + r);
    }
    const nummerieren = () => imJahr().forEach((p, i) => { p.pos = i + 1; });

    /* ---------- Übersicht: Offerten nach Jahr und Status ---------- */

    function uebersicht() {
      const m = BD.offertenNachJahr(offerten());
      const jahre = [...new Set([...Object.keys(m).map(Number), jahr()])].sort((a, b) => a - b);
      const wert = (j, k) => (m[j] ? m[j][k] : 0);
      const ohne = offerten().filter((o) => (o.status === 'offen' || o.status === 'zugesagt') && !Object.keys(o.jahresBetraege || {}).length);
      const zu = state.bu.zu.has('uebersicht');
      return `<section class="pane klapp-box bu-box">
        <div class="klapp-kopf" data-bu="auf" data-key="uebersicht" tabindex="0" role="button" aria-expanded="${!zu}"><span class="klapp-chev">${zu ? '▸' : '▾'}</span>Offerten nach Jahr<span class="bu-kh">ohne MWST</span></div>
        ${zu ? '' : `<div class="bu-scroll"><table class="list bu-mx" data-zebra>
          <thead><tr><th></th>${jahre.map((j) => `<th class="r ${j === jahr() ? 'bu-jetzt' : ''}">${j}</th>`).join('')}</tr></thead>
          <tbody>${BD.STATUS.map(([k, l]) => `<tr class="zb"><td>${l}</td>${jahre.map((j) => `<td class="num r ${j === jahr() ? 'bu-jetzt' : ''}">${fr(wert(j, k), true)}</td>`).join('')}</tr>`).join('')}
          <tr class="bu-sum"><td>Bestätigt und abgeschlossen</td>${jahre.map((j) => `<td class="num r ${j === jahr() ? 'bu-jetzt' : ''}">${fr(wert(j, 'zugesagt') + wert(j, 'abgeschlossen'), true)}</td>`).join('')}</tr></tbody>
        </table></div>
        ${ohne.length ? `<p class="bu-hinw dim">${ohne.length} offene oder bestätigte ${ohne.length === 1 ? 'Offerte hat' : 'Offerten haben'} noch keinen Betrag nach Jahr: ${ohne.slice(0, 6).map((o) => `<button class="link" data-bu="offerte" data-id="${o.id}">${esc(oTitel(o))}</button>`).join(', ')}${ohne.length > 6 ? ` und ${ohne.length - 6} weitere` : ''}. Eintragen im Reiter Offerten im aufgeklappten Eintrag.</p>` : ''}`}
      </section>`;
    }

    /* ---------- Budget eines Jahres ---------- */

    const saetze = () => BD.saetzeFuer(state.data.settings, jahr());
    const gKey = (bereich, gruppe) => `${jahr()}|${bereich}|${gruppe}`;
    const gOffen = (bereich, gruppe) => state.bu.gAuf.has(gKey(bereich, gruppe));
    const gId = (bereich, gruppe) => `bu-g-${bereich}-${String(gruppe).replace(/[^A-Za-z0-9]/g, '_')}`;
    /** Eingabe für den Betrag: zeigt das Ergebnis; beim Bearbeiten erscheint die Rechnung dahinter (z. B. 12*24). */
    function betragFeld(p, wert) {
      const roh = p.satz != null ? `${String(p.satz)} %` : p.formel || fr(p.betrag);
      return `<input id="bu-${p.id}-formel" class="inline num r bu-betrag" type="text" inputmode="decimal" placeholder="0" value="${esc(fr(wert))}" data-anzeige="${esc(fr(wert))}" data-roh="${esc(roh)}" data-bu="feld" data-id="${p.id}" data-key="formel" title="Betrag ohne MWST. Auch eine Rechnung ist möglich, z. B. 12*24.">`;
    }
    const textFeld = (p) => `<input id="bu-${p.id}-text" class="inline" type="text" value="${esc(p.text)}" placeholder="Posten" data-bu="feld" data-id="${p.id}" data-key="text">`;

    /* ---------- Privates Budget: Ist aus der Buchhaltung privat ---------- */
    const privatPlan = () => { const pl = (state.data.privatKontenplaene || {})[jahr()]; return pl ? pl.zeilen : []; };
    const aufwandKonten = () => privatPlan().filter((z) => z.konto && String(z.bklasse) === '3');
    /** Konto eines privaten Budgetpostens: gewählt, sonst das Aufwandkonto mit gleichem Namen. */
    function kontoVon(p) {
      if (p.konto && aufwandKonten().some((z) => z.konto === p.konto)) return p.konto;
      const t = String(p.text || '').trim().toLowerCase();
      const k = aufwandKonten().find((z) => z.text.trim().toLowerCase() === t || z.text.trim().toLowerCase().replace(/\s*\(.*\)$/, '') === t);
      return k ? k.konto : '';
    }
    let istMemo = { sig: '', map: new Map() };
    function istVon(konto) {
      if (!konto) return null;
      const pb = state.data.privatBuchungen || [];
      const sig = `${jahr()}|${pb.length}|${pb.reduce((m, b) => Math.max(m, b.mod || 0), 0)}`;
      if (istMemo.sig !== sig) istMemo = { sig, map: window.Ledger.saldi(pb.filter((b) => b.jahr === jahr() && !b.vorschlag)) };
      const x = istMemo.map.get(konto);
      return x ? x.saldo : 0;
    }
    /** Hochrechnung aufs ganze Jahr (nur im laufenden Jahr). */
    function hochrechnung(ist) {
      const h = new Date(), j = jahr();
      if (h.getFullYear() !== j) return null;
      const tag = Math.floor((h - new Date(j, 0, 1)) / 864e5) + 1, tage = (j % 4 === 0 && (j % 100 !== 0 || j % 400 === 0)) ? 366 : 365;
      return Math.round(ist * tage / tag);
    }
    function istZelle(budget, ist, mitTitel) {
      if (ist == null) return '<span class="dim" title="Kein Konto in der Buchhaltung privat verknüpft">–</span>';
      const hr = hochrechnung(ist), ueber = ist > budget + 0.004, knapp = !ueber && hr != null && hr > budget + 0.004;
      return `<span class="bu-ist ${ueber ? 'ueber' : knapp ? 'knapp' : ''}" title="${mitTitel !== false ? `${budget ? Math.round(ist / budget * 100) + ' % des Budgetrahmens' : ''}${hr != null ? `${budget ? ' · ' : ''}Hochrechnung aufs Jahr: ${fr(hr)}` : ''}` : ''}">${fr(ist)}</span>`;
    }
    function kontoWahl(p) {
      const k = kontoVon(p), ks = aufwandKonten();
      if (!ks.length) return '';
      return `<select class="bu-wahl bu-kwahl ${k ? 'gesetzt' : ''}" data-bu="konto" data-id="${p.id}" aria-label="Konto der Buchhaltung privat" title="Konto der Buchhaltung privat, aus dem «Ist bisher» kommt">
        <option value="">Konto …</option>${ks.map((z) => `<option value="${esc(z.konto)}" ${z.konto === k ? 'selected' : ''}>${esc(z.konto)} ${esc(z.text)}</option>`).join('')}</select>`;
    }

    /** Bereiche mit nur einem Betrag (Ausgaben, Lohneinnahmen) zeigen ihn in der rechten Spalte, bündig mit «inkl. MWST». */
    const EINSPALTIG = new Set(['ausgaben', 'lohn']);
    const zwei = (bereich, a, b, klA, klB) => (EINSPALTIG.has(bereich)
      ? `<td></td><td class="${klA || 'num r'}">${a}</td>`
      : `<td class="${klA || 'num r'}">${a}</td><td class="${klB || 'num r'}">${b}</td>`);
    const zahl = (x) => (x == null ? '' : typeof x === 'string' ? x : fr(x));

    function postenZeilen(z) {
      const p = z.posten, o = z.offerte, ein = p.bereich === 'einnahmen', S = saetze();
      const fest = p.saldo || (o && (o.status === 'zugesagt' || o.status === 'abgeschlossen' || o.status === 'abgesagt'));
      const titel = p.saldo ? `${S.saldo} % Saldosteuersatz ${jahr()} (Einstellungen) von ${fr(z.wert && S.saldo ? z.wert * 100 / S.saldo : 0)}` : o ? 'Betrag aus der verknüpften Offerte' : '';
      const betrag = fest ? `<span class="bu-fest" title="${esc(titel)}">${fr(z.wert)}</span>` : betragFeld(p, z.wert);
      const notizAuf = state.bu.notiz.has(p.id);
      const priv = p.bereich === 'privat', ist = priv ? istVon(kontoVon(p)) : null;
      const akt = `${priv ? kontoWahl(p) : ''}${ein && !p.saldo && p.satz == null ? offerteWahl(p, o) : ''}
        ${ein && p.satz == null && !o ? `<label class="bu-om ${p.ohneMwst ? 'an' : ''}" title="Ohne MWST: nicht mehrwertsteuerpflichtig (z. B. Abo-Beiträge). Zählt zum Umsatz, aber ohne MWST-Zuschlag."><input type="checkbox" data-bu="ohneMwst" data-id="${p.id}"${p.ohneMwst ? ' checked' : ''}>o. MWST</label>` : ''}
        <button class="bu-nz ${p.notiz ? 'hat' : ''} ${notizAuf ? 'auf' : ''}" data-bu="notiz" data-id="${p.id}" title="${p.notiz ? esc(p.notiz) : 'Notiz hinzufügen'}" aria-label="Notiz" aria-expanded="${notizAuf}">${p.notiz ? 'Notiz' : '+ Notiz'}</button>
        <button class="btn small ghost" data-bu="weg" data-id="${p.id}" title="Posten löschen" aria-label="Posten löschen">×</button>`;
      return `<tr class="zb bu-z ${o && o.status === 'abgesagt' ? 'bu-weg' : ''}" data-id="${p.id}">
        <td class="bu-po">${textFeld(p)}</td>
        ${zwei(p.bereich, betrag, ein ? fr(z.inkl) : priv ? istZelle(z.wert, ist) : '', 'bu-wert', 'num r bu-inkl')}
        <td class="r bu-akt">${akt}</td></tr>
        ${notizAuf ? `<tr class="bu-nzz"><td colspan="4"><input id="bu-${p.id}-notiz" class="inline bu-notiz" type="text" value="${esc(p.notiz)}" placeholder="Notiz zu diesem Posten" data-bu="feld" data-id="${p.id}" data-key="notiz"></td></tr>` : ''}`;
    }

    /** Verknüpfung eines Einnahmen-Postens mit einer Offerte: dann zählt deren Betrag für dieses Jahr. */
    function offerteWahl(p, o) {
      if (o) return `<span class="of-chip bu-link" title="Verknüpft: ${esc(oTitel(o))} (${esc(STATUS_TEXT[o.status] || o.status)}). Bestätigte und abgeschlossene Offerten bestimmen den Betrag.">${pill(o)}<button class="link" data-bu="offerte" data-id="${o.id}">${esc(oTitel(o))}</button><button data-bu="link-weg" data-id="${p.id}" title="Verknüpfung lösen" aria-label="Verknüpfung lösen">×</button></span>`;
      const J = String(jahr());
      const belegt = new Set(imJahr().filter((x) => x.offerteId).map((x) => x.offerteId));
      const frei = offerten().filter((x) => !belegt.has(x.id) && x.jahresBetraege && x.jahresBetraege[J] != null);
      if (!frei.length) return '';
      return `<select class="bu-wahl" data-bu="link" data-id="${p.id}" aria-label="Mit Offerte verknüpfen" title="Mit einer Offerte verknüpfen: Der Posten übernimmt deren Betrag für ${J}, die Offerte erscheint nicht doppelt">
        <option value="">Offerte …</option>${frei.map((x) => `<option value="${x.id}">${esc(oTitel(x))} (${esc(STATUS_TEXT[x.status] || x.status)}, ${fr(x.jahresBetraege[J])})</option>`).join('')}</select>`;
    }

    function gruppeKopf(bereich, name, summe, inkl, anzahl, fest) {
      const auf = gOffen(bereich, name);
      return `<tr class="bu-g ${auf ? 'auf' : ''}" data-bu="g-auf" data-bereich="${bereich}" data-gruppe="${esc(name)}" tabindex="0" role="button" aria-expanded="${auf}">
        <td class="bu-gt"><span class="klapp-chev">${auf ? '▾' : '▸'}</span>${fest ? `<span class="bu-gname-fix">${esc(name)}</span>` : `<input class="inline bu-gname" id="${gId(bereich, name)}" type="text" size="${Math.max(8, name.length + 2)}" value="${esc(name)}" placeholder="Gruppe" data-bu="gruppe" data-bereich="${bereich}" data-alt="${esc(name)}" title="Name der Gruppe ändern">`}<span class="klapp-zahl">${anzahl}</span></td>
        ${zwei(bereich, fr(summe), zahl(inkl))}<td></td></tr>`;
    }

    function gruppenZeilen(bereich, r) {
      let html = '';
      for (const g of r.gruppen[bereich]) {
        if (!g.name) {   // Posten ohne Gruppe: direkt im Bereich, ohne Zwischenzeile
          for (const z of g.zeilen) html += postenZeilen(z);
          html += `<tr class="bu-add"><td colspan="4"><button class="link" data-bu="neu" data-bereich="${bereich}" data-gruppe="">+ Posten</button></td></tr>`;
          continue;
        }
        const istG = bereich === 'privat' ? g.zeilen.reduce((s, z) => { const i = istVon(kontoVon(z.posten)); return i == null ? s : (s || 0) + i; }, null) : null;
        html += gruppeKopf(bereich, g.name, g.summe, bereich === 'privat' ? istZelle(g.summe, istG) : g.inkl, g.zeilen.length);
        if (!gOffen(bereich, g.name)) continue;
        for (const z of g.zeilen) html += postenZeilen(z);
        html += `<tr class="bu-add"><td colspan="4"><button class="link" data-bu="neu" data-bereich="${bereich}" data-gruppe="${esc(g.name)}">+ Posten${g.name ? ' in ' + esc(g.name) : ''}</button></td></tr>`;
      }
      return html;
    }

    const summeZeile = (bereich, text, a, b, kl) => `<tr class="bu-sum ${kl || ''}"><td>${text}</td>${zwei(bereich, zahl(a), zahl(b))}<td></td></tr>`;

    function bereich([key, titel], r) {
      const S = r.saetze;
      const zu = state.bu.zu.has(key);
      const istP = key === 'privat' ? r.gruppen.privat.reduce((s, g) => g.zeilen.reduce((t, z) => { const i = istVon(kontoVon(z.posten)); return i == null ? t : (t || 0) + i; }, s), null) : null;
      const kopfSumme = { ausgaben: [r.ausgaben, null], einnahmen: [r.umsatz, r.einnahmen], lohn: [r.lohnTotal, null], privat: [r.privat, istZelle(r.privat, istP)] }[key];
      let inhalt = '';
      if (EINSPALTIG.has(key)) inhalt += `<tr class="bu-sub"><td></td><td></td><td class="r">Betrag</td><td></td></tr>`;
      if (key === 'einnahmen') inhalt += `<tr class="bu-sub"><td></td><td class="r">Betrag ohne MWST</td><td class="r" title="Plus ${S.mwst} % MWST (Satz ${jahr()} in den Einstellungen)">inkl. MWST ${S.mwst} %</td><td class="r"><span class="bu-saetze">${S.erfasst ? '' : 'Sätze für ' + jahr() + ' noch nicht erfasst · '}<button class="link" data-action="nav" data-view="einstellungen">MWST-Sätze</button></span></td></tr>`;
      if (key === 'privat') inhalt += `<tr class="bu-sub"><td>Budgetrahmen, den du dir selber gibst</td><td class="r">Budgetrahmen</td><td class="r" title="Saldo der Konten in der Buchhaltung privat ${jahr()}">Ist bisher</td><td></td></tr>`;
      if (key === 'lohn') inhalt += `<tr class="zb bu-z bu-auto"><td class="bu-po"><span class="bu-gname-fix" title="Total Einnahmen inkl. MWST minus Total Ausgaben der GmbH">Fabio Canetg GmbH</span> <span class="dim bu-zn">Einnahmen minus Ausgaben</span></td><td></td><td class="num r"><span class="bu-fest">${fr(r.gmbhLohn)}</span></td><td></td></tr>`;
      inhalt += gruppenZeilen(key, r);
      if (key === 'einnahmen' && r.auto.length) {
        const name = 'Aus den Offerten';
        inhalt += gruppeKopf('einnahmen', name, r.autoSumme, r.autoInkl, r.auto.length, true);
        if (gOffen('einnahmen', name)) for (const z of [...r.auto.filter((x) => x.zaehlt), ...r.auto.filter((x) => !x.zaehlt)]) {
          inhalt += `<tr class="zb bu-z bu-auto ${z.zaehlt ? '' : 'bu-nicht'}"><td class="bu-po"><button class="link bu-otitel" data-bu="offerte" data-id="${z.offerte.id}" title="Im Reiter Offerten zeigen">${esc(oTitel(z.offerte))}</button> ${pill(z.offerte)}${z.zaehlt ? '' : ' <span class="dim bu-zn">zählt noch nicht</span>'}</td>
            <td class="num r"><span class="bu-fest">${fr(z.wert)}</span></td><td class="num r bu-inkl">${fr(z.inkl)}</td><td></td></tr>`;
        }
      }
      inhalt += `<tr class="bu-add"><td colspan="4"><button class="link" data-bu="neu-gruppe" data-bereich="${key}">+ Gruppe</button></td></tr>`;
      if (key === 'ausgaben') inhalt += summeZeile(key, 'Total Ausgaben', r.ausgaben, null, 'bu-total');
      if (key === 'einnahmen') {
        inhalt += summeZeile(key, 'Total Einnahmen', r.umsatz, r.einnahmen, 'bu-total');
        if (r.offeriert) inhalt += summeZeile(key, 'Offene Offerten (zählen noch nicht)', r.offeriert, r.offeriertInkl, 'bu-offen');
      }
      if (key === 'lohn') inhalt += summeZeile(key, 'Total Lohneinnahmen', r.lohnTotal, null, 'bu-total');
      if (key === 'privat') {
        inhalt += `<tr class="bu-sum bu-total"><td>Total private Ausgaben</td><td class="num r">${fr(r.privat)}</td><td class="num r">${istZelle(r.privat, istP)}</td><td></td></tr>`;
        inhalt += summeZeile(key, 'Total Lohneinnahmen (oben)', r.lohnTotal, null, 'bu-mwst');
        inhalt += `<tr class="bu-sum bu-total bu-spiel ${r.spielraum < 0 ? 'neg' : 'pos'}"><td title="Lohneinnahmen minus private Ausgaben gemäss Budgetrahmen">${r.spielraum < 0 ? 'Fehlbetrag' : 'Spielraum (Sparen)'}</td><td class="num r">${fr(r.spielraum)}</td><td></td><td></td></tr>`;
      }
      return `<tbody class="bu-ab" data-zebra>
        <tr class="klapp-kopf" data-bu="auf" data-key="${key}" tabindex="0" role="button" aria-expanded="${!zu}"><td><span class="klapp-chev">${zu ? '▸' : '▾'}</span>${titel}</td>${zwei(key, fr(kopfSumme[0]), zahl(kopfSumme[1]))}<td></td></tr>
        ${zu ? '' : inhalt}</tbody>`;
    }

    /** Die Rechnung des Jahres auf einen Blick: GmbH → Lohn → privates Budget → Spielraum. */
    function fluss(r) {
      const k = (titel, wert, kl, ziel) => `<button class="bu-fk ${kl || ''}" data-bu="springe" data-key="${ziel}" title="Zum Abschnitt ${esc(titel)}"><span>${titel}</span><b>${fr(wert)}</b></button>`;
      const op = (z) => `<span class="bu-op" aria-hidden="true">${z}</span>`;
      return `<section class="bu-fluss" aria-label="Rechnung ${jahr()}">
        <div class="bu-fg"><div class="bu-fgt">GmbH</div><div class="bu-fz">${k('Einnahmen inkl. MWST', r.einnahmen, '', 'einnahmen')}${op('−')}${k('Ausgaben', r.ausgaben, '', 'ausgaben')}${op('=')}${k('Netto-Lohn aus GmbH', r.gmbhLohn, 'zw', 'lohn')}</div></div>
        <div class="bu-fg"><div class="bu-fgt">Ich</div><div class="bu-fz">${op('+')}${k('Anstellungen', r.anstellungen, '', 'lohn')}${op('=')}${k('Lohneinnahmen', r.lohnTotal, 'zw', 'lohn')}${op('−')}${k('Private Ausgaben (Budget)', r.privat, '', 'privat')}${op('=')}${k(r.spielraum < 0 ? 'Fehlbetrag' : 'Spielraum', r.spielraum, r.spielraum < 0 ? 'end neg' : 'end pos', 'privat')}</div></div>
      </section>`;
    }

    function view() {
      const j = jahr();
      const r = BD.rechne(posten(), offerten(), j, saetze());
      const leer = !imJahr().length;
      const vorjahre = [...new Set(posten().map((p) => p.jahr))].filter((x) => x < j).sort((a, b) => b - a);
      return `
      <header class="head"><h1>Budget ${j}</h1>
        <div class="bignum"><b class="${r.spielraum < 0 ? 'neg' : 'pos'}">${fr(r.spielraum)}</b><span>${r.spielraum < 0 ? 'Fehlbetrag' : 'Spielraum'} nach privatem Budget</span></div>
      </header>
      ${fluss(r)}
      ${uebersicht()}
      ${leer ? `<div class="pane bu-leer"><p>Für ${j} gibt es noch kein Budget.${vorjahre.length ? ` Du kannst die Posten von ${vorjahre[0]} übernehmen (ohne Verknüpfungen mit Offerten) oder unten Gruppen und Posten von Hand anlegen.` : ' Lege unten Gruppen und Posten an.'}</p>
        <div class="row">${vorjahre.length ? `<button class="btn primary" data-bu="kopie" data-von="${vorjahre[0]}">Posten von ${vorjahre[0]} übernehmen</button>` : ''}
        <button class="btn" data-action="import">Budget aus Datei importieren</button></div></div>` : ''}
      <section class="pane klapp-box bu-box">
        <table class="list bu">
          <colgroup><col class="c-po"><col class="c-be"><col class="c-in"><col class="c-ak"></colgroup>
          ${BD.BEREICHE.map((b) => bereich(b, r)).join('')}
        </table>
      </section>`;
    }

    /* ---------- Bearbeiten ---------- */

    function neuerPosten(bereich, gruppe) {
      const l = imJahr();
      const inGruppe = l.filter((p) => p.bereich === bereich && p.gruppe === gruppe);
      const imBereich = l.filter((p) => p.bereich === bereich);
      const BER = BD.BEREICHE.map(([k]) => k);
      const nach = inGruppe.length ? inGruppe[inGruppe.length - 1].pos
        : imBereich.length ? imBereich[imBereich.length - 1].pos
          : Math.max(0, ...l.filter((p) => BER.indexOf(p.bereich) < BER.indexOf(bereich)).map((p) => p.pos));
      const p = BD.normalize({ id: uid('bu'), jahr: jahr(), bereich, gruppe, text: '', formel: '', betrag: 0, pos: nach + 0.5 });
      posten().push(p); nummerieren();
      return p;
    }

    function setzeBetrag(p, key, eingabe) {
      const s = String(eingabe || '').trim();
      if (key === 'formel' && /%\s*$/.test(s) && p.bereich !== 'lohn') {
        const v = BD.formelWert(s.replace(/%\s*$/, ''));
        if (v == null) return 'Bitte einen Prozentsatz eingeben, zum Beispiel 8.1 %.';
        p.satz = v; p.formel = ''; p.betrag = 0; delete p.ohneMwst; return null;
      }
      const v = s === '' ? 0 : BD.formelWert(s);
      if (v == null) return 'Bitte einen Betrag oder eine Rechnung eingeben, zum Beispiel 4500 oder 12*24.';
      delete p.satz; p.betrag = v; p.formel = BD.istFormel(s) ? s.replace(/^=/, '') : '';
      return null;
    }

    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-bu]');
      if (!el || !state.data || state.view !== 'budget') return;
      const a = el.dataset.bu, p = el.dataset.id ? finde(el.dataset.id) : null;
      switch (a) {
        case 'auf': { const k = el.dataset.key; if (state.bu.zu.has(k)) state.bu.zu.delete(k); else state.bu.zu.add(k); render(); break; }
        case 'offerte': zeigeOfferte(el.dataset.id); break;
        case 'springe': { state.bu.zu.delete(el.dataset.key); render(); const t = document.querySelector(`tr.klapp-kopf[data-key="${el.dataset.key}"]`); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
        case 'neu': { const n = neuerPosten(el.dataset.bereich, el.dataset.gruppe); persist(); render(); const f = document.getElementById(`bu-${n.id}-text`); if (f) f.focus(); break; }
        case 'neu-gruppe': {
          let name = 'Neue Gruppe', k = 2; while (imJahr().some((x) => x.bereich === el.dataset.bereich && x.gruppe === name)) name = `Neue Gruppe ${k++}`;
          neuerPosten(el.dataset.bereich, name); state.bu.gAuf.add(gKey(el.dataset.bereich, name)); persist(); render();
          const f = document.getElementById(gId(el.dataset.bereich, name)); if (f) { f.focus(); f.select(); } break;
        }
        case 'g-auf': { if (ev.target.closest('input')) break; const k = gKey(el.dataset.bereich, el.dataset.gruppe); if (state.bu.gAuf.has(k)) state.bu.gAuf.delete(k); else state.bu.gAuf.add(k); render(); break; }
        case 'notiz': if (p) { if (state.bu.notiz.has(p.id)) state.bu.notiz.delete(p.id); else state.bu.notiz.add(p.id); render(); const f = document.getElementById(`bu-${p.id}-notiz`); if (f) f.focus(); } break;
        case 'weg': if (p) {
          const i = posten().indexOf(p); posten().splice(i, 1); persist(); render();
          toast(`Posten «${p.text || 'ohne Namen'}» gelöscht`, { actionLabel: 'Rückgängig', action: () => { posten().splice(i, 0, p); persist(); render(); } });
        } break;
        case 'link-weg': if (p) { delete p.offerteId; persist(); render(); } break;
        case 'kopie': {
          const von = +el.dataset.von, neu = BD.kopieFuer(posten(), von, jahr(), () => uid('bu'));
          posten().push(...neu); persist(); render();
          toast(`${neu.length} Posten von ${von} übernommen`, { actionLabel: 'Rückgängig', action: () => { for (const n of neu) { const i = posten().indexOf(n); if (i >= 0) posten().splice(i, 1); } persist(); render(); } });
          break;
        }
        default:
      }
    });

    document.addEventListener('keydown', (ev) => {
      const el = ev.target;
      if (state.view !== 'budget' || !el.dataset) return;
      if ((ev.key === 'Enter' || ev.key === ' ') && (el.dataset.bu === 'auf' || el.dataset.bu === 'g-auf')) { ev.preventDefault(); el.click(); }
      else if (ev.key === 'Enter' && (el.dataset.bu === 'feld' || el.dataset.bu === 'gruppe')) { ev.preventDefault(); el.blur(); }
    });
    // Beim Bearbeiten eines Betrags die Rechnung dahinter zeigen, sonst nur das Ergebnis.
    document.addEventListener('focusin', (ev) => {
      const el = ev.target;
      if (state.view !== 'budget' || !el.classList || !el.classList.contains('bu-betrag')) return;
      if (el.value === el.dataset.anzeige && el.dataset.roh !== el.dataset.anzeige) { el.value = el.dataset.roh; }
      el.select();
    });
    document.addEventListener('focusout', (ev) => {
      const el = ev.target;
      if (state.view !== 'budget' || !el.classList || !el.classList.contains('bu-betrag')) return;
      if (el.value === el.dataset.roh) el.value = el.dataset.anzeige;
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bu;
      if (!a || !state.data || state.view !== 'budget') return;
      if (a === 'gruppe') {
        const alt = el.dataset.alt, neu = el.value.trim(), b = el.dataset.bereich;
        for (const x of imJahr()) if (x.bereich === b && x.gruppe === alt) x.gruppe = neu;
        if (state.bu.gAuf.delete(gKey(b, alt))) state.bu.gAuf.add(gKey(b, neu));
        persist(); render(); return;
      }
      const p = finde(el.dataset.id); if (!p) return;
      if (a === 'feld') {
        const key = el.dataset.key;
        if (key === 'formel') {
          const f = setzeBetrag(p, key, el.value);
          if (f) { toast(f, { fehler: true }); return; }
        } else p[key] = el.value;
        persist(); render();
      } else if (a === 'ohneMwst') { if (el.checked) p.ohneMwst = true; else delete p.ohneMwst; persist(); render(); }
      else if (a === 'link' && el.value) { p.offerteId = el.value; persist(); render(); }
      else if (a === 'konto') { if (el.value) p.konto = el.value; else delete p.konto; persist(); render(); }
    });

    return { view };
  };
})();
