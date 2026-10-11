/* Reiter Offerten: Projekte mit ihren Offerten (offen, zugesagt, abgesagt, abgeschlossen), Vorlagen, Editor, PDF und LaTeX. */
(function () {
  'use strict';
  const O = window.OffertDoc;

  window.Offerten = function (ctx) {
    const { state, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;
    const $ = (sel, root) => (root || document).querySelector(sel);

    state.off = { edit: null, neu: null, dialog: null, auf: new Set(['offen']), umgekehrt: new Set() };

    const liste = () => state.data.offerten;
    const vorlagen = () => state.data.offertVorlagen;
    const projekt = (id) => liste().find((p) => p.id === id);
    const fassungen = (p) => p.versionen.slice().sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.erstellt || 0) - (b.erstellt || 0)));
    const pTitel = (p) => [p.kunde, p.name].filter(Boolean).join(' – ') || 'Ohne Namen';
    const vTitel = (v) => `${O.ARTEN[v.doc.art]} vom ${fmtDate(v.datum)}`;
    const kopie = (x) => JSON.parse(JSON.stringify(x));
    /** Titel einer Fassung in der Liste; bei mehreren am selben Tag mit laufender Nummer. */
    function vTitelP(p, v) {
      const gleich = fassungen(p).filter((x) => x.datum === v.datum);
      return vTitel(v) + (gleich.length > 1 ? ` (${gleich.indexOf(v) + 1})` : '');
    }

    /** Das Dokument, das gerade im Editor offen ist (Fassung eines Projekts oder Vorlage). */
    function offen() {
      const e = state.off.edit;
      if (!e) return null;
      if (e.vorlage) { const v = vorlagen().find((x) => x.id === e.vorlage); return v ? { vorlage: v, doc: v.doc } : null; }
      const p = projekt(e.pid), v = p && p.versionen.find((x) => x.id === e.vid);
      return v ? { p, v, doc: v.doc } : null;
    }

    /* ---------- Listen ---------- */

    const ABSCHNITTE = [['offen', 'Offen'], ['zugesagt', 'Zugesagt'], ['abgesagt', 'Abgesagt'], ['abgeschlossen', 'Abgeschlossen'], ['alt', 'Alte Offerten']];
    // Projekte unter «Offen» sind von Anfang an aufgeklappt, die übrigen zu; «umgekehrt» merkt sich die Ausnahmen.
    const pOffen = (p) => (p.status === 'offen') !== state.off.umgekehrt.has(p.id);

    function fassungZeile(p, v, opts) {
      // Alte Offerten: Das Original-PDF bleibt unverändert; der eingelesene Inhalt dient nur als Vorlage.
      if (v.original) return `<tr class="of-fz">
        <td class="of-art">${esc(O.ARTEN[v.doc.art])} vom <input type="date" class="inline of-vdat" value="${esc(v.datum)}" data-of="alt-datum" data-pid="${p.id}" data-vid="${v.id}" aria-label="Datum der Offerte"></td>
        <td class="of-kurz num">${v.lesbar ? esc(O.kurz(v.doc)) : '<span class="dim">Inhalt nicht eingelesen, nur das Original ist abgelegt</span>'}</td>
        <td class="r of-akt">
          <button class="btn small primary" data-of="original" data-pid="${p.id}" data-vid="${v.id}" title="Die ursprüngliche PDF-Datei öffnen">Original öffnen</button>
          ${v.lesbar ? `<button class="btn small" data-of="pdf" data-pid="${p.id}" data-vid="${v.id}" title="Dieselbe Offerte im neuen Layout erzeugen">Neues Layout</button>` : ''}
        </td></tr>`;
      return `<tr class="of-fz">
        <td class="of-art">${esc(vTitelP(p, v))}${opts.zugesagt ? ' <span class="pill s-bezahlt">zugesagt</span>' : ''}</td>
        <td class="of-kurz num">${esc(O.kurz(v.doc))}</td>
        <td class="r of-akt">
          ${opts.haken ? `<label class="of-haken" title="Diese Fassung wurde zugesagt. Das Projekt wandert zu den zugesagten Offerten."><input type="checkbox" data-of="zusage" data-pid="${p.id}" data-vid="${v.id}"> zugesagt</label>` : ''}
          <button class="btn small" data-of="edit" data-pid="${p.id}" data-vid="${v.id}">${opts.fest ? 'Ansehen' : 'Bearbeiten'}</button>
          <button class="btn small" data-of="pdf" data-pid="${p.id}" data-vid="${v.id}">PDF</button>
          ${opts.loeschbar ? `<button class="btn small ghost" data-of="v-del" data-pid="${p.id}" data-vid="${v.id}" title="Diese Fassung löschen">×</button>` : ''}
        </td></tr>`;
    }

    /* Zuweisung zu Kunden aus dem Reiter Projekte. Ein Kunde zählt pro Jahr und Bereich einzeln
       (z. B. «Bank WIR · Moderationen · 2027»); eine Offerte kann zu mehreren gehören. */
    const kKey = (x) => `${x.jahr}\t${x.bereich}\t${x.kunde}`;
    function kundenEintraege() {
      const m = new Map();
      for (const x of state.data.projects) if (x.abrechnung !== 'intern' && x.kunde && !m.has(kKey(x))) m.set(kKey(x), { key: kKey(x), jahr: x.jahr, bereich: x.bereich, kunde: x.kunde });
      return [...m.values()].sort((a, b) => a.kunde.localeCompare(b.kunde, 'de') || b.jahr - a.jahr || a.bereich.localeCompare(b.bereich, 'de'));
    }
    const kLabel = (e) => [e.kunde, e.bereich, e.jahr].filter(Boolean).join(' · ');
    const kAusKey = (key) => { const [jahr, bereich, ...rest] = key.split('\t'); return { key, jahr: +jahr, bereich, kunde: rest.join(' ') }; };
    const kunden = () => [...new Set(state.data.projects.filter((x) => x.abrechnung !== 'intern' && x.kunde).map((x) => x.kunde))].sort((a, b) => a.localeCompare(b, 'de'));
    function verknuepfZeile(p) {
      const alle = kundenEintraege(), gewaehlt = p.kundeLinks || [];
      const frei = alle.filter((e) => !gewaehlt.includes(e.key));
      return `<tr class="of-vz"><td colspan="3"><div class="of-verk">
        <span class="dim">Gehört zu Kunde:</span>
        ${gewaehlt.map((key) => { const e = alle.find((x) => x.key === key) || kAusKey(key); return `<span class="of-chip">${esc(kLabel(e))}<button data-of="verk-weg" data-pid="${p.id}" data-key="${esc(key)}" title="Zuweisung entfernen" aria-label="Zuweisung entfernen">×</button></span>`; }).join('')}
        <select data-of="verk-neu" data-pid="${p.id}" aria-label="Einem Kunden zuweisen">
          <option value="">${gewaehlt.length ? 'weiteren Kunden hinzufügen …' : 'Kunde wählen …'}</option>
          ${frei.map((e) => `<option value="${esc(e.key)}">${esc(kLabel(e))}</option>`).join('')}
        </select></div>
        <div class="of-verk of-ag"><label for="oa-${p.id}" class="dim">Auftraggeber:</label>
          <textarea id="oa-${p.id}" rows="3" data-of="p-feld" data-key="auftraggeber" data-pid="${p.id}" placeholder="Firma&#10;Strasse&#10;PLZ Ort">${esc(p.auftraggeber || '')}</textarea>
          <span class="dim">Steht im Vertrag. Bei einer zugesagten, zugewiesenen Offerte wird er als Rechnungsadresse in die Projekte des Kunden übernommen.</span></div></td></tr>`;
    }
    /** Projekte der Zeiterfassung, die zu den zugewiesenen Kunden (Jahr, Bereich) gehören. */
    const zugehoerige = (p) => state.data.projects.filter((x) => (p.kundeLinks || []).includes(kKey(x)));
    /**
     * Zugesagte Offerte: Auftraggeber als Rechnungsadresse in die zugehörigen Projekte schreiben.
     * Projekte mit bereits gestellter Rechnung bleiben unberührt.
     */
    function adresseUebernehmen(p, leise) {
      const adr = String(p.auftraggeber || '').split(/\r?\n/).map((z) => z.trim()).filter(Boolean).join('\n');
      if (!adr || (p.status !== 'zugesagt' && p.status !== 'abgeschlossen')) return 0;
      const ziel = zugehoerige(p).filter((x) => !x.rechnungsdatum && (x.rechnungsadresse || '').trim() !== adr);
      if (!ziel.length) return 0;
      const vorher = ziel.map((x) => [x, x.rechnungsadresse]);
      for (const x of ziel) x.rechnungsadresse = adr;
      if (!leise) setTimeout(() => toast(`Auftraggeber als Rechnungsadresse in ${ziel.length} ${ziel.length === 1 ? 'Projekt' : 'Projekte'} übernommen`, { actionLabel: 'Rückgängig', action: () => { for (const [x, alt] of vorher) x.rechnungsadresse = alt; persist(); render(); } }), 50);
      return ziel.length;
    }
    /** Auftragsbestätigung, zugesagte Offerte und AGB in einem PDF. */
    async function auftragsbestaetigung(p) {
      const v = p.versionen.find((x) => x.id === p.zugesagtId) || fassungen(p).pop();
      if (!String(p.auftraggeber || '').trim()) { toast('Trag zuerst den Auftraggeber ein (im aufgeklappten Eintrag).', { fehler: true }); return; }
      const r = api.offertAgb ? await api.offertAgb() : null;
      if (!r || !r.text) { toast('Die Vorlage für Vertrag und AGB fehlt: Einstellungen → Offerten.', { fehler: true, dauer: 9000 }); return; }
      const b = O.bestaetigung(r.text, { offerteVom: v.datum, auftraggeber: p.auftraggeber, heute });
      const name = `${heute.replace(/-/g, '')}_Vertrag_${sauber(pTitel(p)).replace(/ /g, '_')}.pdf`;
      const e = await api.savePdf(O.html(v.doc, { kunde: p.kunde, name: p.name, datum: v.datum, bestaetigung: b }), { ordner: 'Offerten', name, roh: true, offerte: true });
      if (e && e.fehler) toast(e.fehler, { fehler: true }); else if (e && e.path) toast('Vertrag mit Offerte und AGB gespeichert und geöffnet');
    }
    /** Zeilen im Projektfenster: die neuste Offerte jedes Offerten-Eintrags, der diesem Kunden (Jahr, Bereich) zugewiesen ist. */
    function projektZeile(d) {
      const key = d && d.kunde ? kKey(d) : null;
      const ps = key ? liste().filter((p) => (p.kundeLinks || []).includes(key) && p.versionen.length) : [];
      if (!ps.length) return '';
      const neuste = (p) => fassungen(p).pop();
      ps.sort((a, b) => (neuste(a).datum < neuste(b).datum ? 1 : -1));
      return `<div class="fld of-pfld">
        ${ps.map((p) => { const v = neuste(p), n = p.versionen.length; return `<div class="row">
          <span>${esc(p.name || pTitel(p))}: ${esc(vTitel(v))} <span class="dim">(${p.status === 'alt' ? 'alte Offerte' : p.status}${n > 1 ? `, neuste von ${n}` : ''})</span></span>
          <button class="btn small primary" type="button" data-action="offerte-oeffnen" data-id="${p.id}">Öffnen</button></div>`; }).join('')}</div>`;
    }
    function oeffneAktuelle(id) {
      const p = projekt(id); if (!p) { toast('Die verknüpfte Offerte gibt es nicht mehr.', { fehler: true }); return; }
      const fs = fassungen(p), v = fs[fs.length - 1];
      if (v.original) originalOeffnen(v); else pdf(v.doc, dateiName(p, v, 'pdf'), p, v);
    }
    function zeige(id) {
      const p = projekt(id); if (!p) return;
      state.off.edit = null; state.off.auf.add(p.status);
      if (!pOffen(p)) { if (state.off.umgekehrt.has(p.id)) state.off.umgekehrt.delete(p.id); else state.off.umgekehrt.add(p.id); }
    }

    function projektZeilen(p) {
      const fs = fassungen(p), letzte = fs[fs.length - 1], st = p.status, auf = pOffen(p);
      const knoepfe = {
        offen: `<button class="btn small" data-of="v-neu" data-pid="${p.id}" title="Die letzte Offerte kopieren und als neue Fassung mit heutigem Datum weiterbearbeiten">Letzte kopieren</button>
          <button class="btn small" data-of="neu" data-pid="${p.id}" title="Eine neue Offerte aus einem PDF oder einer anderen Offerte zu diesem Projekt hinzufügen">Neue hinzufügen</button>
          <button class="btn small" data-of="status" data-status="abgesagt" data-pid="${p.id}" title="Das ganze Projekt mit allen Fassungen zu den abgesagten verschieben">✕ Abgesagt</button>`,
        zugesagt: `<button class="btn small primary" data-of="ab-pdf" data-pid="${p.id}" title="Ein PDF mit Vertrag, zugesagter Offerte und AGB">Vertrag</button>
          <button class="btn small" data-of="status" data-status="abgeschlossen" data-pid="${p.id}">Projekt abgeschlossen</button>
          <button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgesagt: `<button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgeschlossen: `<button class="btn small" data-of="ab-pdf" data-pid="${p.id}" title="Ein PDF mit Vertrag, zugesagter Offerte und AGB">Vertrag</button>
          <button class="btn small" data-of="status" data-status="zugesagt" data-pid="${p.id}">Zurück zu zugesagt</button>`,
        alt: '',
      }[st];
      return `<tr class="of-pz ${auf ? 'auf' : ''}">
          <td colspan="3"><div class="of-kopf">
            <button class="of-pfeil" data-of="p-auf" data-pid="${p.id}" aria-expanded="${auf}" title="${auf ? 'Fassungen ausblenden' : 'Fassungen zeigen'}">${auf ? '▾' : '▸'}</button>
            <input class="inline of-kunde" type="text" value="${esc(p.kunde)}" placeholder="Kunde" data-of="p-feld" data-key="kunde" data-pid="${p.id}" aria-label="Kunde">
            <input class="inline of-name" type="text" value="${esc(p.name)}" placeholder="Projekt" data-of="p-feld" data-key="name" data-pid="${p.id}" aria-label="Projekt">
            <button class="of-anz" data-of="p-auf" data-pid="${p.id}">${fs.length} ${fs.length === 1 ? 'Fassung' : 'Fassungen'}${auf || !letzte ? '' : `, letzte vom ${fmtDate(letzte.datum)}`}</button>
            <span class="grow"></span>
            ${knoepfe}
            <button class="btn small ghost" data-of="p-del" data-pid="${p.id}" title="Projekt mit allen Fassungen löschen">Löschen</button>
          </div></td></tr>
        ${auf ? verknuepfZeile(p) : ''}
        ${auf ? fs.map((v) => fassungZeile(p, v, { haken: st === 'offen' && v === letzte, fest: st !== 'offen', loeschbar: st === 'offen' && fs.length > 1, zugesagt: v.id === p.zugesagtId })).join('') : ''}`;
    }

    function abschnitt([key, titel]) {
      const ps = liste().filter((p) => p.status === key).sort((a, b) => (b.erstellt || 0) - (a.erstellt || 0));
      const auf = state.off.auf.has(key);
      const leerText = { offen: 'Keine offenen Offerten.', zugesagt: 'Noch keine zugesagten Offerten.', abgesagt: 'Keine abgesagten Offerten.', abgeschlossen: 'Noch keine Offerten aus abgeschlossenen Projekten.' }[key];
      const extra = key === 'alt' && auf ? `<tr><td colspan="3" class="of-althoch"><button class="btn small" data-of="alt-hoch">Alte Offerten hochladen</button>
          <span class="dim">Mehrere PDF auf einmal wählbar. Die Originale werden unverändert abgelegt und stehen bei «Neue Offerte» als Vorlage bereit.</span></td></tr>` : '';
      return `<tbody class="of-ab">
        <tr class="of-abk" data-of="ab-auf" data-key="${key}" tabindex="0" role="button" aria-expanded="${auf}"><td colspan="3"><span class="of-pfeil2">${auf ? '▾' : '▸'}</span> <b>${titel}</b> <span class="of-zahl">${ps.length}</span></td></tr>
        ${extra}${auf ? (ps.length ? ps.map(projektZeilen).join('') : `<tr><td colspan="3" class="of-leer">${leerText || 'Noch keine alten Offerten.'}</td></tr>`) : ''}
      </tbody>`;
    }

    /* Wird das Einlesen von PDF verbessert, liest die App die abgelegten Originale einmal neu ein.
       Alte Offerten lassen sich in der App nicht bearbeiten, es geht dabei also nichts verloren. */
    const LESER = 2;
    let liestNeu = false;
    async function alteNeuLesen() {
      if (liestNeu || !api.offertOriginalLesen) return;
      const offen2 = []; for (const p of liste()) for (const v of p.versionen) if (v.original && (v.gelesen || 1) < LESER) offen2.push(v);
      if (!offen2.length) return;
      liestNeu = true;
      try {
        for (const v of offen2) {
          const r = await api.offertOriginalLesen(v.original);
          const e = r && r.seiten ? O.ausPdf(r.seiten) : null;
          if (e && e.doc) { v.doc = e.doc; v.lesbar = true; }
          v.gelesen = LESER;
        }
        persist(); render();
      } finally { liestNeu = false; }
    }

    async function originalOeffnen(v) {
      const r = api.offertOriginal ? await api.offertOriginal(v.original) : { ok: false, error: 'Nur in der Desktop-App.' };
      if (!r.ok) toast('Das Original lässt sich nicht öffnen: ' + r.error, { fehler: true });
    }
    /** Mehrere alte Offerten als PDF übernehmen: Original ablegen, Inhalt als Vorlage einlesen. */
    async function alteHochladen() {
      const r = api.offertAlteWaehlen ? await api.offertAlteWaehlen() : { fehler: 'Nur in der Desktop-App.' };
      if (!r || r.canceled) return;
      if (r.fehler) { toast(r.fehler, { fehler: true }); return; }
      let gelesen = 0, nur = 0, schonDa = 0;
      const vorhanden = new Set(); for (const p of liste()) for (const v of p.versionen) if (v.original) vorhanden.add(v.original);
      for (const d of r.dateien || []) {
        if (vorhanden.has(d.datei)) { schonDa++; continue; }   // dieselbe Datei wurde schon einmal abgelegt
        const e = d.seiten ? O.ausPdf(d.seiten) : { fehler: 'x' };
        const basis = d.name.replace(/\.pdf$/i, '');
        const m = /^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[\s_-]*(.*)$/.exec(basis);
        const datum = m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : (d.datum || heute);
        const titel = (m ? m[4] : basis).replace(/[_]+/g, ' ').trim() || basis;
        const doc = e.doc || O.leer(/kostenvoranschlag/i.test(basis) ? 'kostenvoranschlag' : 'offerte');
        liste().push({ id: uid('of'), name: titel, kunde: '', kundeLinks: [], auftraggeber: '', status: 'alt', zugesagtId: null, erstellt: Date.now() + gelesen + nur, mod: 0,
          versionen: [{ id: uid('ov'), datum, erstellt: Date.now(), doc, original: d.datei, lesbar: !!e.doc, gelesen: LESER }] });
        if (e.doc) gelesen++; else nur++;
      }
      state.off.auf.add('alt'); persist(); render();
      toast(`${gelesen + nur} ${gelesen + nur === 1 ? 'Offerte' : 'Offerten'} abgelegt${nur ? `, davon ${nur} nur als Original (Tabelle nicht erkannt)` : ''}${schonDa ? `; ${schonDa} waren schon vorhanden` : ''}. Trag jetzt Kunde und Projekt ein und weise sie zu.`, { dauer: 9000 });
    }

    /** Alle Fassungen aller Offerten-Projekte, die neusten zuerst. */
    function bestehende() {
      const out = [];
      for (const p of liste()) for (const v of p.versionen) if (!v.original || v.lesbar) out.push({ p, v });
      return out.sort((a, b) => (a.v.datum < b.v.datum ? 1 : a.v.datum > b.v.datum ? -1 : (b.p.erstellt || 0) - (a.p.erstellt || 0)));
    }

    function neuForm() {
      const n = state.off.neu;
      if (!n) return '';
      const zu = n.pid && projekt(n.pid);
      return `<form class="pane of-neu" data-of-form="neu" autocomplete="off">
        <div><label for="on-kunde">Kunde</label><input id="on-kunde" type="text" value="${esc(zu ? zu.kunde : n.kunde)}" data-of="n-feld" data-key="kunde" list="on-kunden" ${zu ? 'disabled' : ''}><datalist id="on-kunden">${kunden().map((k) => `<option value="${esc(k)}">`).join('')}</datalist></div>
        <div><label for="on-name">Projekt</label><input id="on-name" type="text" value="${esc(zu ? zu.name : n.name)}" data-of="n-feld" data-key="name" ${zu ? 'disabled' : ''}></div>
        <div><label for="on-datum">Datum</label><input id="on-datum" type="date" value="${esc(n.datum)}" data-of="n-feld" data-key="datum"></div>
        <div><label for="on-art">Dokument</label><select id="on-art" data-of="n-feld" data-key="art">
          <option value="offerte" ${n.art === 'offerte' ? 'selected' : ''}>Offerte</option><option value="kostenvoranschlag" ${n.art === 'kostenvoranschlag' ? 'selected' : ''}>Kostenvoranschlag</option></select></div>
        <div><label for="on-ag">Auftraggeber (Firma, Strasse, PLZ Ort)</label><textarea id="on-ag" rows="3" data-of="n-feld" data-key="auftraggeber" placeholder="Firma&#10;Strasse&#10;PLZ Ort" ${zu ? 'disabled' : ''}>${esc(zu ? zu.auftraggeber || '' : n.auftraggeber || '')}</textarea></div>
        <div class="of-vorl"><label>Vorlage</label>
          <button class="btn" type="button" data-of="n-hoch" title="PDF einer bestehenden Offerte wählen. Die Tabellen darin werden übernommen.">PDF hochladen</button>
          <select class="of-aus" data-of="n-aus" aria-label="Bestehende Offerte als Vorlage übernehmen" title="Eine Offerte aus diesem Programm als Vorlage übernehmen" ${bestehende().length ? '' : 'disabled'}>
            <option value="">${bestehende().length ? 'Bestehende Offerte übernehmen …' : 'Noch keine bestehenden Offerten'}</option>
            ${bestehende().map((x) => `<option value="${x.p.id}|${x.v.id}">${esc(pTitel(x.p))} · ${esc(vTitel(x.v))}</option>`).join('')}</select>
          <span class="of-vinfo ${n.doc ? 'ok' : ''}">${n.doc ? `${esc(n.quelle || 'Vorlage')}: ${n.doc.teile.length} ${n.doc.teile.length === 1 ? 'Teil' : 'Teile'} übernommen` : 'Ohne Vorlage beginnst du leer.'}</span></div>
        <div class="of-nakt"><button class="btn primary" type="submit">Anlegen und bearbeiten</button>
          <button class="btn" type="button" data-of="n-zu">Abbrechen</button></div>
      </form>`;
    }

    function viewListe() {
      return `<header class="head"><h1>Offerten</h1>
          <button class="btn primary" data-of="neu">Neue Offerte</button></header>
        ${neuForm()}
        <div class="pane of-box"><table class="of-liste">${ABSCHNITTE.map(abschnitt).join('')}</table></div>
        ${dialogHtml()}`;
    }

    /* ---------- Editor ---------- */

    const feld = (pfad, wert, extra) => `<input type="text" data-of="f" data-pfad="${pfad}" value="${esc(wert)}" ${extra || ''}>`;

    function teilEditor(d, t, i) {
      const einfach = O.istEinfach(t);
      return `<section class="pane of-teil">
        <div class="of-tkopf">
          <b>${esc(O.ARTEN[d.art])}</b>
          ${feld(`t.${i}.nummer`, t.nummer, 'class="of-nr" placeholder="Nr." aria-label="Nummer"')}
          ${feld(`t.${i}.titel`, t.titel, 'class="of-titel" placeholder="Titel" aria-label="Titel"')}
          <button class="btn small" data-of="t-dup" data-t="${i}" title="Diesen Teil verdoppeln, z. B. für eine Variante">Verdoppeln</button>
          <button class="btn small ghost" data-of="t-del" data-t="${i}" title="Diesen Teil löschen">×</button>
        </div>
        <table class="of-tab">
          <colgroup><col><col style="width:92px"><col style="width:84px"><col style="width:104px"><col style="width:104px"><col style="width:96px"><col style="width:30px"></colgroup>
          <thead><tr><th>Was</th><th>Aufwand</th><th class="r">Ansatz Fr.</th><th>Verrechnung</th><th class="r">Preis</th><th class="r">Total</th><th></th></tr></thead>
          <tbody>${t.bloecke.map((b, j) => `
            <tr class="of-bt"><td colspan="5">${feld(`t.${i}.b.${j}.titel`, b.titel, 'placeholder="Blocktitel (leer lassen für eine einfache Preisliste)" aria-label="Blocktitel"')}</td>
              <td class="r num" id="os-b${i}-${j}">${O.fr(O.blockTotal(b))}</td>
              <td><button class="btn small ghost" data-of="b-del" data-t="${i}" data-b="${j}" title="Block löschen">×</button></td></tr>
            ${b.zeilen.map((z, k) => `<tr>
              <td>${feld(`t.${i}.b.${j}.z.${k}.was`, z.was, 'aria-label="Was"')}</td>
              <td>${feld(`t.${i}.b.${j}.z.${k}.aufwand`, z.aufwand, 'placeholder="2h, pauschal" aria-label="Aufwand"')}</td>
              <td>${feld(`t.${i}.b.${j}.z.${k}.ansatz`, z.ansatz || '', 'class="r" inputmode="decimal" aria-label="Ansatz"')}</td>
              <td><select data-of="f" data-pfad="t.${i}.b.${j}.z.${k}.preis" aria-label="Preisart">
                <option value="auto" ${z.preis === 'auto' ? 'selected' : ''}>berechnet</option><option value="inklusive" ${z.preis === 'inklusive' ? 'selected' : ''}>inklusive</option><option value="null" ${z.preis === 'null' ? 'selected' : ''}>0.00</option></select></td>
              <td class="r num ${(z.preis === 'inklusive' || z.preis === 'offeriert') ? 'of-ink' : ''}" id="os-z${i}-${j}-${k}">${O.preisText(z)}</td><td></td>
              <td><button class="btn small ghost" data-of="z-del" data-t="${i}" data-b="${j}" data-z="${k}" title="Zeile löschen">×</button></td></tr>`).join('')}
            <tr class="of-plus"><td colspan="7"><button class="btn small" data-of="z-neu" data-t="${i}" data-b="${j}">+ Zeile</button></td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="5"><div class="of-pzeile"><button class="btn small" data-of="b-neu" data-t="${i}">+ Block</button>
              ${feld(`t.${i}.preisLabel`, t.preisLabel, 'class="of-plabel" placeholder="Preis" aria-label="Bezeichnung der Preiszeile"')}
              ${einfach ? '<span class="dim">einfache Preisliste: im Dokument nur «Was» und «Total»</span>' : ''}</div></td>
            <td class="r num" id="os-t${i}"><b>${O.fr(O.teilTotal(t))}</b></td><td></td></tr>
            ${t.rabatt ? `<tr><td colspan="5"><div class="of-pzeile"><span class="of-platz"></span>${feld(`t.${i}.rabatt.label`, t.rabatt.label, 'class="of-plabel" placeholder="Rabatt" aria-label="Bezeichnung des Rabatts"')}<span class="dim">wird vom Preis abgezogen</span></div></td>
              <td>${feld(`t.${i}.rabatt.betrag`, t.rabatt.betrag || '', 'class="r" inputmode="decimal" placeholder="Betrag" aria-label="Betrag des Rabatts"')}</td>
              <td><button class="btn small ghost" data-of="rab-del" data-t="${i}" title="Rabatt entfernen">×</button></td></tr>` : ''}
            ${t.preis2 ? `<tr><td colspan="5"><div class="of-pzeile"><span class="of-platz"></span>${feld(`t.${i}.preis2.label`, t.preis2.label, 'class="of-plabel" placeholder="Preis pro Folge" aria-label="Bezeichnung der zweiten Preiszeile"')}${t.rabatt ? '<span class="dim">Preis minus Rabatt</span>' : ''}</div></td>
              <td class="r num">${t.rabatt ? `<b id="os-e${i}">${O.fr(O.preis2Betrag(t))}</b>` : feld(`t.${i}.preis2.betrag`, t.preis2.betrag || '', 'class="r" inputmode="decimal" placeholder="Betrag" aria-label="Betrag der zweiten Preiszeile"')}</td>
              <td><button class="btn small ghost" data-of="p2-del" data-t="${i}" title="Zweite Preiszeile entfernen">×</button></td></tr>` : ''}
            ${t.rabatt && t.preis2 ? '' : `<tr><td colspan="7">${t.rabatt ? '' : `<button class="btn small" data-of="rab-neu" data-t="${i}" title="Eine Zeile, deren Betrag vom Preis abgezogen wird, zum Beispiel «Beitrag Fabio Canetg GmbH»">+ Rabatt</button> `}${t.preis2 ? '' : `<button class="btn small" data-of="p2-neu" data-t="${i}" title="Zum Beispiel «Preis pro Folge»">+ zweite Preiszeile</button>`}</td></tr>`}</tfoot>
        </table>
      </section>`;
    }

    function viewEditor() {
      const o = offen();
      if (!o) { state.off.edit = null; return viewListe(); }
      const d = o.doc;
      const fest = o.p && o.p.status !== 'offen';
      return `<header class="head of-ehead">
          <button class="btn" data-of="zurueck">‹ Zurück</button>
          <h1>${o.vorlage ? 'Vorlage' : esc(pTitel(o.p))}</h1>
        </header>
        <div class="bh-bar of-ebar">
          ${o.vorlage ? `<label>Name <input type="text" class="of-vname2" value="${esc(o.vorlage.name)}" data-of="vo-name" data-id="${o.vorlage.id}"></label>` : `<label>Datum <input type="date" value="${esc(o.v.datum)}" data-of="v-datum"></label>`}
          <label>Dokument <select data-of="f" data-pfad="art"><option value="offerte" ${d.art === 'offerte' ? 'selected' : ''}>Offerte</option><option value="kostenvoranschlag" ${d.art === 'kostenvoranschlag' ? 'selected' : ''}>Kostenvoranschlag</option></select></label>
          <span class="grow"></span>
          <button class="btn" data-of="e-hoch" title="Den Inhalt dieser Offerte durch die Tabellen aus einem PDF ersetzen">PDF hochladen</button>
          <button class="btn primary" data-of="e-pdf">PDF</button>
        </div>
        ${fest ? `<div class="of-fest">Diese Fassung ist ${o.p.status === 'abgesagt' ? 'abgesagt' : 'zugesagt'}. Änderungen sind weiterhin möglich, für eine neue Runde stellst du das Projekt besser zurück auf offen und legst eine neue Fassung an.</div>` : ''}
        ${d.teile.map((t, i) => teilEditor(d, t, i)).join('')}
        <div class="row of-unten"><button class="btn" data-of="t-neu">+ Teil</button></div>
        ${dialogHtml()}`;
    }

    function dialogHtml() {
      const g = state.off.dialog;
      if (!g) return '';
      const ersetzen = g.art === 'ersetzen';
      return `<div class="of-schleier" data-of="dialog-zu-aussen"><div class="of-dialog" role="dialog" aria-label="LaTeX-Code einfügen">
        <h2>${ersetzen ? 'Durch neuen LaTeX-Code ersetzen' : 'LaTeX-Code als Vorlage einfügen'}</h2>
        <p>${ersetzen ? 'Füge hier den geänderten LaTeX-Code ein. Der Inhalt dieser Offerte wird damit ersetzt; das lässt sich rückgängig machen.' : 'Füge hier den LaTeX-Code einer bestehenden Offerte ein. Ihr Inhalt wird in die neue Offerte übernommen.'}</p>
        <textarea id="od-text" rows="14" data-of="d-text" placeholder="\\begin{document} … \\end{document}">${esc(g.text || '')}</textarea>
        <div class="row"><button class="btn primary" data-of="dialog-ok">Übernehmen</button><button class="btn" data-of="dialog-zu">Abbrechen</button></div>
      </div></div>`;
    }

    function view() { setTimeout(alteNeuLesen, 0); return state.off.edit ? viewEditor() : viewListe(); }

    /* ---------- Aktionen ---------- */

    function setze(doc, pfad, wert) {
      const teile = pfad.split('.');
      if (pfad === 'art') { doc.art = wert; return; }
      let ziel = doc.teile[+teile[1]];
      let i = 2;
      if (teile[2] === 'rabatt') { if (!ziel.rabatt) return; ziel.rabatt[teile[3]] = teile[3] === 'betrag' ? Math.abs(parseFloat(String(wert).replace(/[’'\s]/g, '').replace(',', '.')) || 0) : wert; return; }
      if (teile[2] === 'preis2') { if (!ziel.preis2) return; ziel.preis2[teile[3]] = teile[3] === 'betrag' ? (parseFloat(String(wert).replace(/[’'\s]/g, '').replace(',', '.')) || 0) : wert; return; }
      if (teile[i] === 'b') { ziel = ziel.bloecke[+teile[i + 1]]; i += 2; }
      if (teile[i] === 'z') { ziel = ziel.zeilen[+teile[i + 1]]; i += 2; }
      const key = teile[i];
      ziel[key] = key === 'ansatz' ? (parseFloat(String(wert).replace(/[’'\s]/g, '').replace(',', '.')) || 0) : wert;
    }
    /** Summen im Editor nachführen, ohne die Eingabefelder neu aufzubauen. */
    function summen(d) {
      d.teile.forEach((t, i) => {
        const e = $(`#os-t${i}`); if (e) e.innerHTML = `<b>${O.fr(O.teilTotal(t))}</b>`;
        const ee = $(`#os-e${i}`); if (ee) ee.textContent = O.fr(O.preis2Betrag(t));
        t.bloecke.forEach((b, j) => {
          const eb = $(`#os-b${i}-${j}`); if (eb) eb.textContent = O.fr(O.blockTotal(b));
          b.zeilen.forEach((z, k) => { const ez = $(`#os-z${i}-${j}-${k}`); if (ez) { ez.textContent = O.preisText(z); ez.classList.toggle('of-ink', z.preis === 'inklusive' || z.preis === 'offeriert'); } });
        });
      });
    }

    const sauber = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    function dateiName(p, v, endung) {
      return `${v.datum.replace(/-/g, '')}_${O.ARTEN[v.doc.art]}${p ? '_' + sauber(pTitel(p)).replace(/ /g, '_') : ''}.${endung}`;
    }
    async function pdf(doc, name, p, v) {
      const r = await api.savePdf(O.html(doc, { kunde: p && p.kunde, name: p && p.name, datum: v && v.datum }), { ordner: 'Offerten', name, roh: true, offerte: true });
      if (r && r.fehler) toast(r.fehler, { fehler: true }); else if (r && r.path) toast(r.ohneTitelbild ? 'PDF gespeichert. Das Titelbild fehlt noch: Einstellungen → Offerten → Titelbild wählen.' : 'PDF gespeichert und geöffnet', r.ohneTitelbild ? { dauer: 9000 } : undefined);
    }
    async function texDatei(doc, name) {
      const r = await api.saveText(O.latex(doc), { ordner: 'Offerten', name });
      if (r && r.fehler) toast(r.fehler, { fehler: true }); else if (r && r.path) toast('LaTeX-Code gespeichert, der Ordner ist geöffnet');
    }
    async function zwischenablage(text, meldung) {
      try { await navigator.clipboard.writeText(text); toast(meldung); }
      catch (_) {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
        const ok = document.execCommand('copy'); t.remove();
        toast(ok ? meldung : 'Kopieren hat nicht geklappt.', ok ? undefined : { fehler: true });
      }
    }

    function anlegen() {
      const n = state.off.neu;
      const doc = n.doc ? kopie(n.doc) : O.leer(n.art);
      doc.art = n.art;
      const v = { id: uid('ov'), datum: n.datum || heute, erstellt: Date.now(), doc };
      let p = n.pid && projekt(n.pid);
      if (p) p.versionen.push(v);
      else { p = { id: uid('of'), name: n.name.trim(), kunde: n.kunde.trim(), kundeLinks: [], auftraggeber: (n.auftraggeber || '').trim(), status: 'offen', zugesagtId: null, erstellt: Date.now(), mod: 0, versionen: [v] }; liste().push(p); }
      state.off.neu = null; state.off.auf.add('offen'); state.off.edit = { pid: p.id, vid: v.id };
      persist(); render();
    }

    /** PDF, LaTeX-Datei oder JSON wählen und einlesen. */
    async function hochladen() {
      const r = await api.openOfferte();
      if (!r || r.canceled) return null;
      if (r.fehler) { toast(r.fehler, { fehler: true }); return null; }
      const e = O.ausDatei(r);
      if (e.fehler) { toast(e.fehler, { fehler: true }); return null; }
      return { doc: e.doc, name: r.name || 'Datei' };
    }
    /** Von aussen (Import einer Vorlagendatei): neue Offerte mit diesem Inhalt beginnen. */
    function beginneMit(doc, quelle) {
      const d = O.normalize(doc);
      state.off.edit = null; state.off.neu = { kunde: '', name: '', art: d.art, doc: d, quelle };
    }

    document.addEventListener('submit', (ev) => {
      if (ev.target.dataset && ev.target.dataset.ofForm === 'neu') { ev.preventDefault(); anlegen(); }
    });

    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-of]');
      if (!el || !state.data || state.view !== 'offerten') return;
      const a = el.dataset.of, ds = el.dataset;
      const p = ds.pid ? projekt(ds.pid) : null;
      const v = p && ds.vid ? p.versionen.find((x) => x.id === ds.vid) : null;
      const o = offen();
      switch (a) {
        case 'ab-auf': if (state.off.auf.has(ds.key)) state.off.auf.delete(ds.key); else state.off.auf.add(ds.key); render(); break;
        case 'p-auf': if (state.off.umgekehrt.has(ds.pid)) state.off.umgekehrt.delete(ds.pid); else state.off.umgekehrt.add(ds.pid); render(); break;
        case 'n-hoch': { hochladen().then((h) => { if (!h || !state.off.neu) return; Object.assign(state.off.neu, { doc: h.doc, quelle: h.name, art: h.doc.art }); render(); toast(`${h.name} eingelesen`); }); break; }
        case 'e-hoch': { hochladen().then((h) => { const o2 = offen(); if (!h || !o2) return; const ziel = o2.v, alt = ziel.doc; h.doc.art = alt.art; ziel.doc = h.doc; persist(); render();
          toast(`Inhalt durch ${h.name} ersetzt`, { actionLabel: 'Rückgängig', action: () => { ziel.doc = alt; persist(); render(); } }); }); break; }
        case 'tex-kopieren': zwischenablage(O.latex(o.doc), 'LaTeX-Code kopiert'); break;
        case 'neu': { const zp = ds.pid && projekt(ds.pid); const lz = zp && fassungen(zp).pop();
          state.off.neu = { kunde: '', name: '', art: lz ? lz.doc.art : 'offerte', doc: null, quelle: '', datum: heute, pid: ds.pid || '' }; render(); window.scrollTo(0, 0); { const f = $(zp ? '#on-datum' : '#on-kunde'); if (f) f.focus(); } break; }
        case 'n-zu': state.off.neu = null; render(); break;
        case 'edit': state.off.edit = { pid: p.id, vid: v.id }; render(); window.scrollTo(0, 0); break;
        case 'zurueck': state.off.edit = null; render(); break;
        case 'pdf': pdf(v.doc, dateiName(p, v, 'pdf'), p, v); break;
        case 'e-pdf': pdf(o.doc, dateiName(o.p, o.v, 'pdf'), o.p, o.v); break;
        case 'v-neu': {
          const fs = fassungen(p), letzte = fs[fs.length - 1];
          const nv = { id: uid('ov'), datum: heute, erstellt: Date.now(), doc: kopie(letzte ? letzte.doc : O.leer('offerte')) };
          p.versionen.push(nv); state.off.edit = { pid: p.id, vid: nv.id }; persist(); render(); window.scrollTo(0, 0); break;
        }
        case 'v-del': {
          if (p.versionen.length < 2) break;
          const i = p.versionen.indexOf(v); p.versionen.splice(i, 1); persist(); render();
          toast('Fassung gelöscht', { actionLabel: 'Rückgängig', action: () => { p.versionen.splice(i, 0, v); persist(); render(); } }); break;
        }
        case 'zusage': {
          p.status = 'zugesagt'; p.zugesagtId = v.id; const nAdr = adresseUebernehmen(p, true); persist(); render();
          toast(`${vTitel(v)} ist zugesagt${nAdr ? `, Auftraggeber als Rechnungsadresse in ${nAdr} ${nAdr === 1 ? 'Projekt' : 'Projekte'} übernommen` : ''}`, { actionLabel: 'Rückgängig', action: () => { p.status = 'offen'; p.zugesagtId = null; persist(); render(); } }); break;
        }
        case 'status': {
          const vorher = { status: p.status, zugesagtId: p.zugesagtId };
          p.status = ds.status;
          if (ds.status === 'offen' || ds.status === 'abgesagt') p.zugesagtId = null;
          persist(); render();
          toast({ offen: 'Zurück bei den offenen Offerten', abgesagt: 'Projekt mit allen Fassungen abgesagt', zugesagt: 'Zurück bei den zugesagten Offerten', abgeschlossen: 'Projekt abgeschlossen' }[ds.status],
            { actionLabel: 'Rückgängig', action: () => { Object.assign(p, vorher); persist(); render(); } }); break;
        }
        case 'p-del': {
          if (!confirm(`«${pTitel(p)}» mit ${p.versionen.length} ${p.versionen.length === 1 ? 'Fassung' : 'Fassungen'} löschen?`)) break;
          const i = liste().indexOf(p); liste().splice(i, 1); persist(); render();
          toast('Projekt gelöscht', { actionLabel: 'Rückgängig', action: () => { liste().splice(i, 0, p); persist(); render(); } }); break;
        }

        // Editor: Aufbau ändern
        case 't-neu': o.doc.teile.push(O.leer(o.doc.art).teile[0]); persist(); render(); break;
        case 't-dup': o.doc.teile.splice(+ds.t + 1, 0, kopie(o.doc.teile[+ds.t])); persist(); render(); break;
        case 't-del': {
          const [weg] = o.doc.teile.splice(+ds.t, 1); persist(); render();
          toast('Teil gelöscht', { actionLabel: 'Rückgängig', action: () => { o.doc.teile.splice(+ds.t, 0, weg); persist(); render(); } }); break;
        }
        case 'b-neu': o.doc.teile[+ds.t].bloecke.push({ titel: '', zeilen: [{ was: '', aufwand: '', ansatz: 0, preis: 'auto' }] }); persist(); render(); break;
        case 'b-del': {
          const bl = o.doc.teile[+ds.t].bloecke; const [weg] = bl.splice(+ds.b, 1); persist(); render();
          toast('Block gelöscht', { actionLabel: 'Rückgängig', action: () => { bl.splice(+ds.b, 0, weg); persist(); render(); } }); break;
        }
        case 'z-neu': {
          const z = o.doc.teile[+ds.t].bloecke[+ds.b].zeilen; z.push({ was: '', aufwand: '', ansatz: 0, preis: 'auto' }); persist(); render();
          const f = $(`[data-pfad="t.${ds.t}.b.${ds.b}.z.${z.length - 1}.was"]`); if (f) f.focus(); break;
        }
        case 'p2-neu': { o.doc.teile[+ds.t].preis2 = { label: 'Preis pro Folge', betrag: 0 }; persist(); render(); const f = $(`[data-pfad="t.${ds.t}.preis2.betrag"]`); if (f) f.focus(); break; }
        case 'rab-neu': { const tt = o.doc.teile[+ds.t]; tt.rabatt = { label: 'Rabatt', betrag: 0 };
          // Der Preis nach Abzug braucht eine eigene Zeile.
          if (!tt.preis2) tt.preis2 = { label: 'Preis nach Abzug', betrag: 0 };
          persist(); render(); const f = $(`[data-pfad="t.${ds.t}.rabatt.label"]`); if (f) { f.focus(); f.select(); } break; }
        case 'rab-del': o.doc.teile[+ds.t].rabatt = null; persist(); render(); break;
        case 'p2-del': o.doc.teile[+ds.t].preis2 = null; persist(); render(); break;
        case 'verk-weg': { p.kundeLinks = (p.kundeLinks || []).filter((k) => k !== ds.key); persist(); render(); break; }
        case 'ab-pdf': auftragsbestaetigung(p); break;
        case 'alt-hoch': alteHochladen(); break;
        case 'original': originalOeffnen(v); break;
        case 'z-del': o.doc.teile[+ds.t].bloecke[+ds.b].zeilen.splice(+ds.z, 1); persist(); render(); break;

        // LaTeX-Code einfügen
        case 'dialog': state.off.dialog = { art: ds.art, text: '' }; render(); { const t = $('#od-text'); if (t) t.focus(); } break;
        case 'dialog-zu': state.off.dialog = null; render(); break;
        case 'dialog-zu-aussen': if (ev.target === el) { state.off.dialog = null; render(); } break;
        case 'dialog-ok': {
          const g = state.off.dialog, r = O.ausDatei({ text: g.text });
          if (r.fehler) { toast(r.fehler, { fehler: true }); break; }
          if (g.art === 'neu' && state.off.neu) {
            Object.assign(state.off.neu, { doc: r.doc, quelle: 'Eingefügter Code', art: r.doc.art });
            state.off.dialog = null; render();
          } else if (o) {
            const ziel = o.v, alt = ziel.doc;
            ziel.doc = r.doc; state.off.dialog = null; persist(); render();
            toast('Offerte durch den neuen Code ersetzt', { actionLabel: 'Rückgängig', action: () => { ziel.doc = alt; persist(); render(); } });
          }
          break;
        }
        default:
      }
    });

    document.addEventListener('input', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.of;
      if (!a || !state.data || state.view !== 'offerten') return;
      if (a === 'f') {
        const o = offen(); if (!o) return;
        if (el.type === 'checkbox') return;
        setze(o.doc, el.dataset.pfad, el.value); summen(o.doc);
      } else if (a === 'n-feld') state.off.neu[el.dataset.key] = el.value;
      else if (a === 'd-text') state.off.dialog.text = el.value;
      else if (a === 'p-feld') { const p = projekt(el.dataset.pid); if (p) p[el.dataset.key] = el.value; }
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.of;
      if (!a || !state.data || state.view !== 'offerten') return;
      if (a === 'f') {
        const o = offen(); if (!o) return;
        if (el.type === 'checkbox') setze(o.doc, el.dataset.pfad, el.checked);
        persist();
        // Art und Preisart ändern Beschriftungen an mehreren Stellen.
        if (el.tagName === 'SELECT') render();
      } else if (a === 'alt-datum') { const zp = projekt(el.dataset.pid), zv = zp && zp.versionen.find((x) => x.id === el.dataset.vid); if (zv && el.value) { zv.datum = el.value; persist(); } }
      else if (a === 'v-datum') { const o = offen(); if (o && o.v && el.value) { o.v.datum = el.value; persist(); } }
      else if (a === 'p-feld') { const zp = projekt(el.dataset.pid); if (zp && el.dataset.key === 'auftraggeber') adresseUebernehmen(zp); persist(); }
      else if (a === 'n-aus' && el.value && state.off.neu) {
        const [pid, vid] = el.value.split('|'); const p = projekt(pid), v = p && p.versionen.find((x) => x.id === vid);
        if (v) { Object.assign(state.off.neu, { doc: kopie(v.doc), quelle: `${pTitel(p)}, ${vTitel(v)}`, art: v.doc.art }); render(); }
      }
      else if (a === 'verk-neu' && el.value) { const zp = projekt(el.dataset.pid); if (zp) { (zp.kundeLinks || (zp.kundeLinks = [])).push(el.value); const nA = adresseUebernehmen(zp); persist(); render(); if (!nA) toast(`Zugewiesen: ${kLabel(kAusKey(el.value))}`); } }
      else if (a === 'n-aus' && el.value && state.off.neu) {
        const [pid, vid] = el.value.split('|'); const p = projekt(pid), v = p && p.versionen.find((x) => x.id === vid);
        if (v) { Object.assign(state.off.neu, { doc: kopie(v.doc), quelle: `${pTitel(p)}, ${vTitel(v)}`, art: v.doc.art }); render(); }
      }
      else if (a === 'verk-kunde') { const zp = projekt(el.dataset.pid); if (zp) { zp.kundeLink = el.value; persist(); toast(el.value ? `Dem Kunden ${el.value} zugewiesen` : 'Zuweisung entfernt'); } }
      else if (a === 'n-aus' && el.value && state.off.neu) {
        const [pid, vid] = el.value.split('|'); const p = projekt(pid), v = p && p.versionen.find((x) => x.id === vid);
        if (v) { Object.assign(state.off.neu, { doc: kopie(v.doc), quelle: `${pTitel(p)}, ${vTitel(v)}`, art: v.doc.art }); render(); }
      }
      else if (a === 'verk-neu') {
        const x = state.data.projects.find((q) => q.id === el.value);
        if (x) { x.offerteId = el.dataset.pid; persist(); render(); toast(`Verknüpft mit ${zLabel(x)}`); }
      }
    });

    return { view, beginneMit, projektZeile, oeffneAktuelle, zeige };
  };
})();
