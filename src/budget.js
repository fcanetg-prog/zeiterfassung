/* Reiter Budget: Übersicht der Offerten nach Jahr und Budget pro Jahr (aufgebaut wie das Excel «Aufträge»). */
(function () {
  'use strict';
  const BD = window.BudgetDoc;

  window.Budget = function (ctx) {
    const { state, esc, persist, render, toast, uid, zeigeOfferte } = ctx;

    state.bu = { zu: new Set() };

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

    const feld = (p, key, wert, extra) => `<input id="bu-${p.id}-${key}" class="inline ${extra && extra.cls ? extra.cls : ''}" type="text" value="${esc(wert)}" data-bu="feld" data-id="${p.id}" data-key="${key}" ${extra && extra.attr ? extra.attr : ''}>`;
    const betragText = (p) => (p.satz != null ? `${String(p.satz)} %` : p.formel || fr(p.betrag));

    function postenZeile(z, r, istErste, gruppeSumme) {
      const p = z.posten, o = z.offerte, ein = p.bereich === 'einnahmen';
      const betrag = o && o.status !== 'offen'
        ? `<span class="bu-fest" title="Betrag aus der Offerte">${fr(z.wert)}</span>`
        : `${feld(p, 'formel', betragText(p), { cls: `num r bu-betrag${p.satz != null || BD.istFormel(p.formel) ? ' mit-erg' : ''}`, attr: `inputmode="decimal" placeholder="0" title="Betrag oder Rechnung wie im Excel (z. B. 12*24); «6.2 %» rechnet Prozent vom Umsatz"` })}${p.satz != null || BD.istFormel(p.formel) ? `<span class="bu-erg">${p.satz != null ? 'von ' + fr(r.basis) + ' ' : ''}= ${fr(z.wert)}</span>` : ''}`;
      const offeriert = !ein || p.satz != null ? '' : o && o.status === 'offen'
        ? `<span class="bu-fest" title="Betrag aus der offenen Offerte">${fr(z.offeriert)}</span>`
        : `${feld(p, 'offeriertFormel', BD.istFormel(p.offeriertFormel) ? p.offeriertFormel : p.offeriertFormel ? fr(p.offeriert) : '', { cls: `num r bu-betrag${BD.istFormel(p.offeriertFormel) ? ' mit-erg' : ''}`, attr: 'inputmode="decimal" title="Offerierter oder möglicher Betrag; zählt nicht ins Total"' })}${BD.istFormel(p.offeriertFormel) ? `<span class="bu-erg">= ${fr(z.offeriert)}</span>` : ''}`;
      const wahl = ein && p.satz == null ? offerteWahl(p, o) : '';
      return `<tr class="zb bu-z ${o && o.status === 'abgesagt' ? 'bu-weg' : ''}" data-id="${p.id}">
        <td class="bu-gr">${istErste ? feld(p, 'gruppe', p.gruppe, { cls: 'bu-gname', attr: 'placeholder="Gruppe" title="Name der Gruppe (gilt für alle Posten darin)"' }) : ''}</td>
        <td>${feld(p, 'text', p.text, { attr: 'placeholder="Posten"' })}</td>
        <td class="bu-wert">${betrag}</td>
        <td class="bu-wert">${offeriert}</td>
        <td class="num r bu-gs">${gruppeSumme == null ? '' : fr(gruppeSumme)}</td>
        <td>${feld(p, 'notiz', p.notiz, { cls: 'bu-notiz', attr: 'placeholder="Notiz"' })}</td>
        <td class="r bu-akt">${wahl}${ein && p.satz == null && !o ? `<label class="bu-om ${p.ohneMwst ? 'an' : ''}" title="Ohne MWST: nicht mehrwertsteuerpflichtig (z. B. Abo-Beiträge). Zählt zum Umsatz, aber nicht zur Basis der MWST."><input type="checkbox" data-bu="ohneMwst" data-id="${p.id}"${p.ohneMwst ? ' checked' : ''}>o. MWST</label>` : ''}<button class="btn small ghost" data-bu="weg" data-id="${p.id}" title="Posten löschen" aria-label="Posten löschen">×</button></td>
      </tr>`;
    }

    /** Verknüpfung eines Einnahmen-Postens mit einer Offerte: dann zählt deren Betrag für dieses Jahr. */
    function offerteWahl(p, o) {
      if (o) return `<span class="of-chip bu-link" title="Verknüpft: Der Betrag kommt aus dieser Offerte">${pill(o)}<button class="link" data-bu="offerte" data-id="${o.id}">${esc(oTitel(o))}</button><button data-bu="link-weg" data-id="${p.id}" title="Verknüpfung lösen" aria-label="Verknüpfung lösen">×</button></span>`;
      const J = String(jahr());
      const belegt = new Set(imJahr().filter((x) => x.offerteId).map((x) => x.offerteId));
      const frei = offerten().filter((x) => !belegt.has(x.id) && x.jahresBetraege && x.jahresBetraege[J] != null);
      if (!frei.length) return '';
      return `<select class="bu-wahl" data-bu="link" data-id="${p.id}" aria-label="Mit Offerte verknüpfen" title="Mit einer Offerte verknüpfen: Der Posten übernimmt deren Betrag für ${J}, die Offerte erscheint nicht doppelt">
        <option value="">Offerte …</option>${frei.map((x) => `<option value="${x.id}">${esc(oTitel(x))} (${esc(STATUS_TEXT[x.status] || x.status)}, ${fr(x.jahresBetraege[J])})</option>`).join('')}</select>`;
    }

    function gruppenZeilen(bereich, r) {
      let html = '';
      for (const g of r.gruppen[bereich]) {
        g.zeilen.forEach((z, i) => { html += postenZeile(z, r, i === 0, i === g.zeilen.length - 1 ? g.summe : null); });
        html += `<tr class="bu-add"><td></td><td colspan="6"><button class="link" data-bu="neu" data-bereich="${bereich}" data-gruppe="${esc(g.name)}">+ Posten${g.name ? ' in ' + esc(g.name) : ''}</button></td></tr>`;
      }
      return html;
    }

    function summeZeile(text, wert, kl, offeriert) {
      return `<tr class="bu-sum ${kl || ''}"><td colspan="2">${text}</td><td class="num r">${fr(wert)}</td><td class="num r dim">${offeriert != null ? fr(offeriert, true) : ''}</td><td></td><td colspan="2"></td></tr>`;
    }

    function bereich([key, titel], r) {
      const zu = state.bu.zu.has(key);
      const total = { ausgaben: r.ausgaben, einnahmen: r.einnahmen, lohn: r.lohnTotal }[key];
      let inhalt = '';
      if (key === 'lohn') {
        inhalt += `<tr class="zb bu-z bu-auto"><td class="bu-gr"><span class="bu-gname-fix" title="Netto-Lohnauszahlungen aus der GmbH">Aus der GmbH</span></td><td>Total Einnahmen minus Total Ausgaben</td><td class="num r"><span class="bu-fest">${fr(r.gmbhLohn)}</span></td><td></td><td class="num r bu-gs">${fr(r.gmbhLohn)}</td><td></td><td></td></tr>`;
      }
      inhalt += gruppenZeilen(key, r);
      if (key === 'einnahmen' && r.auto.length) {
        const best = r.auto.filter((z) => z.wert), off = r.auto.filter((z) => !z.wert);
        [...best, ...off].forEach((z, i, l) => {
          inhalt += `<tr class="zb bu-z bu-auto"><td class="bu-gr">${i === 0 ? '<span class="bu-gname-fix" title="Offerten mit Betrag für dieses Jahr, die mit keinem Posten verknüpft sind">Aus den Offerten</span>' : ''}</td>
            <td><button class="link bu-otitel" data-bu="offerte" data-id="${z.offerte.id}" title="Im Reiter Offerten zeigen">${esc(oTitel(z.offerte))}</button> ${pill(z.offerte)}</td>
            <td class="num r"><span class="bu-fest">${fr(z.wert, true)}</span></td><td class="num r"><span class="bu-fest">${fr(z.offeriert, true)}</span></td>
            <td class="num r bu-gs">${i === l.length - 1 ? fr(best.reduce((s, x) => s + x.wert, 0)) : ''}</td><td></td><td></td></tr>`;
        });
      }
      inhalt += `<tr class="bu-add"><td colspan="7"><button class="link" data-bu="neu-gruppe" data-bereich="${key}">+ Gruppe</button></td></tr>`;
      if (key === 'ausgaben') inhalt += summeZeile('Total Ausgaben', r.ausgaben, 'bu-total');
      if (key === 'einnahmen') {
        inhalt += summeZeile('Umsatz ohne MWST', r.umsatz, '', r.offeriert);
        inhalt += summeZeile('MWST-Einnahmen', r.mwstEin, '');
        inhalt += summeZeile('Total Einnahmen', r.einnahmen, 'bu-total', r.offeriertMitMwst);
      }
      if (key === 'lohn') inhalt += summeZeile('Total Lohneinnahmen', r.lohnTotal, 'bu-total');
      return `<tbody class="bu-ab" data-zebra>
        <tr class="klapp-kopf" data-bu="auf" data-key="${key}" tabindex="0" role="button" aria-expanded="${!zu}"><td colspan="7"><div class="bu-kopf"><span class="klapp-chev">${zu ? '▸' : '▾'}</span>${titel}<span class="klapp-summe">${fr(total)}</span></div></td></tr>
        ${zu ? '' : inhalt}</tbody>`;
    }

    function view() {
      const j = jahr();
      const r = BD.rechne(posten(), offerten(), j);
      const leer = !imJahr().length;
      const vorjahre = [...new Set(posten().map((p) => p.jahr))].filter((x) => x < j).sort((a, b) => b - a);
      return `
      <header class="head"><h1>Budget ${j}</h1>
        <div class="bignum"><b>${fr(r.einnahmen)}</b><span>Total Einnahmen</span></div>
        <div class="bignum"><b>${fr(r.ausgaben)}</b><span>Total Ausgaben</span></div>
        <div class="bignum"><b class="${r.gmbhLohn < 0 ? 'neg' : ''}">${fr(r.gmbhLohn)}</b><span>Netto-Lohn aus GmbH</span></div>
      </header>
      ${uebersicht()}
      ${leer ? `<div class="pane bu-leer"><p>Für ${j} gibt es noch kein Budget.${vorjahre.length ? ` Du kannst die Posten von ${vorjahre[0]} übernehmen (ohne Verknüpfungen mit Offerten und ohne «offeriert») oder unten Gruppen und Posten von Hand anlegen.` : ' Lege unten Gruppen und Posten an.'}</p>
        <div class="row">${vorjahre.length ? `<button class="btn primary" data-bu="kopie" data-von="${vorjahre[0]}">Posten von ${vorjahre[0]} übernehmen</button>` : ''}
        <button class="btn" data-action="import">Budget aus Datei importieren</button></div></div>` : ''}
      <section class="pane klapp-box bu-box">
        <table class="list bu">
          <colgroup><col class="c-gr"><col class="c-po"><col class="c-be"><col class="c-of"><col class="c-gs"><col class="c-no"><col class="c-ak"></colgroup>
          <thead><tr><th>Gruppe</th><th>Posten</th><th class="r">Budget</th><th class="r" title="Offeriert oder möglich, zählt nicht ins Total">Offeriert</th><th class="r">Gruppe</th><th>Notiz</th><th></th></tr></thead>
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
        p.satz = v; p.formel = ''; p.betrag = 0; delete p.ohneMwst; delete p.offeriert; delete p.offeriertFormel; return null;
      }
      const v = s === '' ? 0 : BD.formelWert(s);
      if (v == null) return 'Bitte einen Betrag oder eine Rechnung eingeben, zum Beispiel 4500 oder 12*24.';
      if (key === 'formel') { delete p.satz; p.betrag = v; p.formel = BD.istFormel(s) ? s.replace(/^=/, '') : ''; }
      else if (s === '') { delete p.offeriert; delete p.offeriertFormel; }
      else { p.offeriert = v; p.offeriertFormel = BD.istFormel(s) ? s.replace(/^=/, '') : fr(v); }
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
        case 'neu-gruppe': { const n = neuerPosten(el.dataset.bereich, 'Neue Gruppe'); persist(); render(); const f = document.getElementById(`bu-${n.id}-gruppe`); if (f) { f.focus(); f.select(); } break; }
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
      if ((ev.key === 'Enter' || ev.key === ' ') && el.dataset.bu === 'auf') { ev.preventDefault(); el.click(); }
      else if (ev.key === 'Enter' && el.dataset.bu === 'feld') { ev.preventDefault(); el.blur(); }
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.bu;
      if (!a || !state.data || state.view !== 'budget') return;
      const p = finde(el.dataset.id); if (!p) return;
      if (a === 'feld') {
        const key = el.dataset.key;
        if (key === 'formel' || key === 'offeriertFormel') {
          const f = setzeBetrag(p, key, el.value);
          if (f) { toast(f, { fehler: true }); return; }
        } else if (key === 'gruppe') {
          const alt = p.gruppe, neu = el.value.trim();
          for (const x of imJahr()) if (x.bereich === p.bereich && x.gruppe === alt) x.gruppe = neu;
        } else p[key] = el.value;
        persist(); render();
      } else if (a === 'ohneMwst') { if (el.checked) p.ohneMwst = true; else delete p.ohneMwst; persist(); render(); }
      else if (a === 'link' && el.value) { p.offerteId = el.value; persist(); render(); }
    });

    return { view };
  };
})();
