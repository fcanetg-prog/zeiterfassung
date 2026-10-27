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

    function postenZeilen(z) {
      const p = z.posten, o = z.offerte, ein = p.bereich === 'einnahmen', S = saetze();
      const fest = p.saldo || (o && (o.status === 'zugesagt' || o.status === 'abgeschlossen' || o.status === 'abgesagt'));
      const titel = p.saldo ? `${S.saldo} % Saldosteuersatz ${jahr()} (Einstellungen) von ${fr(z.wert && S.saldo ? z.wert * 100 / S.saldo : 0)}` : o ? 'Betrag aus der verknüpften Offerte' : '';
      const betrag = fest ? `<span class="bu-fest" title="${esc(titel)}">${fr(z.wert)}</span>` : betragFeld(p, z.wert);
      const notizAuf = state.bu.notiz.has(p.id);
      const akt = `${ein && !p.saldo && p.satz == null ? offerteWahl(p, o) : ''}
        ${ein && p.satz == null && !o ? `<label class="bu-om ${p.ohneMwst ? 'an' : ''}" title="Ohne MWST: nicht mehrwertsteuerpflichtig (z. B. Abo-Beiträge). Zählt zum Umsatz, aber ohne MWST-Zuschlag."><input type="checkbox" data-bu="ohneMwst" data-id="${p.id}"${p.ohneMwst ? ' checked' : ''}>o. MWST</label>` : ''}
        <button class="bu-nz ${p.notiz ? 'hat' : ''} ${notizAuf ? 'auf' : ''}" data-bu="notiz" data-id="${p.id}" title="${p.notiz ? esc(p.notiz) : 'Notiz hinzufügen'}" aria-label="Notiz" aria-expanded="${notizAuf}">${p.notiz ? 'Notiz' : '+ Notiz'}</button>
        <button class="btn small ghost" data-bu="weg" data-id="${p.id}" title="Posten löschen" aria-label="Posten löschen">×</button>`;
      return `<tr class="zb bu-z ${o && o.status === 'abgesagt' ? 'bu-weg' : ''}" data-id="${p.id}">
        <td class="bu-po">${textFeld(p)}</td>
        <td class="bu-wert">${betrag}</td>
        <td class="num r bu-inkl">${ein ? fr(z.inkl) : ''}</td>
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
        <td class="num r">${fr(summe)}</td><td class="num r">${inkl == null ? '' : fr(inkl)}</td><td></td></tr>`;
    }

    function gruppenZeilen(bereich, r) {
      let html = '';
      for (const g of r.gruppen[bereich]) {
        html += gruppeKopf(bereich, g.name, g.summe, g.inkl, g.zeilen.length);
        if (!gOffen(bereich, g.name)) continue;
        for (const z of g.zeilen) html += postenZeilen(z);
        html += `<tr class="bu-add"><td colspan="4"><button class="link" data-bu="neu" data-bereich="${bereich}" data-gruppe="${esc(g.name)}">+ Posten${g.name ? ' in ' + esc(g.name) : ''}</button></td></tr>`;
      }
      return html;
    }

    const summeZeile = (text, a, b, kl) => `<tr class="bu-sum ${kl || ''}"><td>${text}</td><td class="num r">${a == null ? '' : fr(a)}</td><td class="num r">${b == null ? '' : fr(b)}</td><td></td></tr>`;

    function bereich([key, titel], r) {
      const zu = state.bu.zu.has(key);
      const kopfSumme = { ausgaben: [r.ausgaben, null], einnahmen: [r.umsatz, r.einnahmen], lohn: [r.lohnTotal, null] }[key];
      let inhalt = '';
      if (key === 'lohn') inhalt += `<tr class="bu-g bu-fix"><td class="bu-gt"><span class="klapp-chev"></span><span class="bu-gname-fix" title="Total Einnahmen inkl. MWST minus Total Ausgaben">Aus der GmbH (netto)</span></td><td class="num r">${fr(r.gmbhLohn)}</td><td></td><td></td></tr>`;
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
      if (key === 'ausgaben') inhalt += summeZeile('Total Ausgaben', r.ausgaben, null, 'bu-total');
      if (key === 'einnahmen') {
        inhalt += summeZeile(`MWST ${r.saetze.mwst} %`, null, r.mwstEin, 'bu-mwst');
        inhalt += summeZeile('Total Einnahmen', r.umsatz, r.einnahmen, 'bu-total');
        if (r.offeriert) inhalt += summeZeile('Offene Offerten (zählen noch nicht)', r.offeriert, r.offeriertInkl, 'bu-offen');
      }
      if (key === 'lohn') inhalt += summeZeile('Total Lohneinnahmen', r.lohnTotal, null, 'bu-total');
      return `<tbody class="bu-ab" data-zebra>
        <tr class="klapp-kopf" data-bu="auf" data-key="${key}" tabindex="0" role="button" aria-expanded="${!zu}"><td><span class="klapp-chev">${zu ? '▸' : '▾'}</span>${titel}</td><td class="num r">${fr(kopfSumme[0])}</td><td class="num r">${kopfSumme[1] == null ? '' : fr(kopfSumme[1])}</td><td></td></tr>
        ${zu ? '' : inhalt}</tbody>`;
    }

    function view() {
      const j = jahr(), S = saetze();
      const r = BD.rechne(posten(), offerten(), j, S);
      const leer = !imJahr().length;
      const vorjahre = [...new Set(posten().map((p) => p.jahr))].filter((x) => x < j).sort((a, b) => b - a);
      return `
      <header class="head"><h1>Budget ${j}</h1>
        <div class="bignum"><b>${fr(r.einnahmen)}</b><span>Total Einnahmen inkl. MWST</span></div>
        <div class="bignum"><b>${fr(r.ausgaben)}</b><span>Total Ausgaben</span></div>
        <div class="bignum"><b class="${r.gmbhLohn < 0 ? 'neg' : ''}">${fr(r.gmbhLohn)}</b><span>Netto-Lohn aus GmbH</span></div>
      </header>
      ${uebersicht()}
      ${leer ? `<div class="pane bu-leer"><p>Für ${j} gibt es noch kein Budget.${vorjahre.length ? ` Du kannst die Posten von ${vorjahre[0]} übernehmen (ohne Verknüpfungen mit Offerten) oder unten Gruppen und Posten von Hand anlegen.` : ' Lege unten Gruppen und Posten an.'}</p>
        <div class="row">${vorjahre.length ? `<button class="btn primary" data-bu="kopie" data-von="${vorjahre[0]}">Posten von ${vorjahre[0]} übernehmen</button>` : ''}
        <button class="btn" data-action="import">Budget aus Datei importieren</button></div></div>` : ''}
      <section class="pane klapp-box bu-box">
        <table class="list bu">
          <colgroup><col class="c-po"><col class="c-be"><col class="c-in"><col class="c-ak"></colgroup>
          <thead><tr><th>Posten</th><th class="r">Betrag ohne MWST</th><th class="r" title="Einnahmen plus ${S.mwst} % MWST (Satz ${j} in den Einstellungen)">inkl. MWST ${S.mwst} %</th><th class="r"><span class="bu-saetze">${S.erfasst ? '' : 'Sätze für ' + j + ' noch nicht erfasst · '}<button class="link" data-action="nav" data-view="einstellungen">MWST-Sätze</button></span></th></tr></thead>
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
    });

    return { view };
  };
})();
