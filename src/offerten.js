/* Reiter Offerten: Projekte mit ihren Offerten (offen, zugesagt, abgesagt, abgeschlossen), Vorlagen, Editor, PDF und LaTeX. */
(function () {
  'use strict';
  const O = window.OffertDoc;

  window.Offerten = function (ctx) {
    const { state, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;
    const $ = (sel, root) => (root || document).querySelector(sel);

    state.off = { edit: null, neu: null, dialog: null, auf: new Set(), umgekehrt: new Set() };

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

    const ABSCHNITTE = [['offen', 'Offen'], ['zugesagt', 'Bestätigt'], ['abgesagt', 'Abgesagt'], ['abgeschlossen', 'Abgeschlossen']];
    // Projekte unter «Offen» sind von Anfang an aufgeklappt, die übrigen zu; «umgekehrt» merkt sich die Ausnahmen.
    const pOffen = (p) => state.off.umgekehrt.has(p.id);   // Einträge starten zugeklappt

    function fassungZeile(p, v, opts) {
      // Alte Offerten: Das Original-PDF bleibt unverändert; der eingelesene Inhalt dient nur als Vorlage.
      if (v.original) return `<tr class="of-fz">
        <td class="of-art">${esc(O.ARTEN[v.doc.art])} vom <input type="date" class="inline of-vdat" value="${esc(v.datum)}" data-of="alt-datum" data-pid="${p.id}" data-vid="${v.id}" aria-label="Datum der Offerte"></td>
        <td class="of-kurz num">${v.lesbar ? esc(O.kurz(v.doc)) : '<span class="dim">Inhalt nicht eingelesen, nur das Original ist abgelegt</span>'}</td>
        <td class="r of-akt">
          <button class="btn small primary" data-of="original" data-pid="${p.id}" data-vid="${v.id}" title="Die ursprüngliche PDF-Datei öffnen">Original öffnen</button>
        </td></tr>`;
      return `<tr class="of-fz">
        <td class="of-art">${esc(vTitelP(p, v))}${opts.zugesagt ? ' <span class="pill s-bezahlt">bestätigt</span>' : ''}</td>
        <td class="of-kurz num">${esc(O.kurz(v.doc))}</td>
        <td class="r of-akt">
          ${opts.haken ? `<label class="of-haken" title="Diese Fassung wurde bestätigt. Das Projekt wandert zu den bestätigten Offerten."><input type="checkbox" data-of="zusage" data-pid="${p.id}" data-vid="${v.id}"> bestätigt</label>` : ''}
          <label class="of-haken of-versch${v.verschickt ? ' an' : ''}" title="${v.verschickt ? `Am ${fmtDate(v.verschickt)} als verschickt markiert` : 'Haken setzen, wenn diese Offerte an den Kunden ging'}"><input type="checkbox" data-of="verschickt" data-pid="${p.id}" data-vid="${v.id}"${v.verschickt ? ' checked' : ''}> verschickt</label>
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
    /** Beilagen zu einer Offerte (z. B. E-Mail-Austausch als PDF): anzeigen, öffnen, hinzufügen, entfernen. */
    /** Datum am Anfang eines Dateinamens: 20261011…, 2026-10-11…, 2026_10_11… oder 11.10.2026… */
    function dateiDatum(name) {
      const n = String(name || '');
      let m = /^(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/.exec(n);
      if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
      m = /^(\d{1,2})\.(\d{1,2})\.(20\d{2})(?!\d)/.exec(n);
      if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return '';
    }
    function anhangZeile(p) {
      const an = p.anhaenge || [];
      // Bei alten Offerten steht das hochgeladene Original zuoberst; das Datum lässt sich daneben korrigieren.
      const originale = fassungen(p).filter((v) => v.original);
      // Beilagen mit Datum am Anfang des Dateinamens: die neusten zuoberst, die übrigen danach in der Reihenfolge des Hochladens.
      const sortiert = an.map((a, i) => ({ a, i, d: dateiDatum(a.name) }))
        .sort((x, y) => (x.d && y.d ? (x.d < y.d ? 1 : x.d > y.d ? -1 : x.i - y.i) : x.d ? -1 : y.d ? 1 : x.i - y.i));
      return `<div class="of-raster of-drop" data-drop="beilage" data-pid="${p.id}"><span class="of-lab">Beilagen</span><div class="of-stapel">
        ${originale.map((v) => `<span class="of-chip of-datei of-orig"><button class="of-dlink" data-of="original" data-pid="${p.id}" data-vid="${v.id}" title="Die ursprüngliche PDF-Datei öffnen">${esc(vTitel(v))}</button><input type="date" class="inline of-vdat" value="${esc(v.datum)}" data-of="alt-datum" data-pid="${p.id}" data-vid="${v.id}" title="Datum der Offerte ändern" aria-label="Datum der Offerte"><button data-of="orig-weg" data-pid="${p.id}" data-vid="${v.id}" title="Dieses PDF löschen" aria-label="PDF löschen">×</button></span>`).join('')}
        ${sortiert.map(({ a, i }) => `<span class="of-chip of-datei"><button class="of-dlink" data-of="anh-auf" data-pid="${p.id}" data-i="${i}" title="Datei öffnen">${esc(a.name)}</button><button data-of="anh-weg" data-pid="${p.id}" data-i="${i}" title="Diese Beilage löschen" aria-label="Beilage löschen">×</button></span>`).join('')}
        <button class="btn small" data-of="anh-neu" data-pid="${p.id}" title="Dateien zu dieser Offerte ablegen, zum Beispiel den E-Mail-Austausch als PDF oder ein Bild. Du kannst sie auch aus dem Explorer hierher ziehen.">+ Datei hinzufügen</button></div></div>`;
    }
    async function anhangHinzu(p, pfade) {
      const r = pfade ? await api.offertAnhangAblegen(pfade) : api.offertAnhangWaehlen ? await api.offertAnhangWaehlen() : { fehler: 'Nur in der Desktop-App.' };
      if (!r || r.canceled) return;
      if (r.fehler) { toast(r.fehler, { fehler: true }); return; }
      const an = p.anhaenge || (p.anhaenge = []);
      let n = 0;
      for (const d of r.dateien || []) if (!an.some((a) => a.datei === d.datei)) { an.push({ name: d.name, datei: d.datei }); n++; }
      persist(); render(); toast(n ? `${n} ${n === 1 ? 'Beilage' : 'Beilagen'} abgelegt` : 'Diese Dateien waren schon abgelegt');
    }
    function verknuepfZeile(p) {
      const alle = kundenEintraege(), gewaehlt = p.kundeLinks || [];
      const frei = alle.filter((e) => !gewaehlt.includes(e.key));
      // Bezeichnung links, Inhalt rechts in einer Spalte; Kunden und Beilagen stehen untereinander.
      return `<tr class="of-vz"><td colspan="3">
        <div class="of-raster"><span class="of-lab">Gehört zu Kunde</span><div class="of-stapel">
          ${gewaehlt.map((key) => { const e = alle.find((x) => x.key === key) || kAusKey(key); return `<span class="of-chip">${esc(kLabel(e))}<button data-of="verk-weg" data-pid="${p.id}" data-key="${esc(key)}" title="Zuweisung entfernen" aria-label="Zuweisung entfernen">×</button></span>`; }).join('')}
          <select data-of="verk-neu" data-pid="${p.id}" aria-label="Einem Kunden zuweisen">
            <option value="">${gewaehlt.length ? 'weiteren Kunden hinzufügen …' : 'Kunde wählen …'}</option>
            ${frei.map((e) => `<option value="${esc(e.key)}">${esc(kLabel(e))}</option>`).join('')}
          </select></div></div>
        ${jahrZeile(p)}
        ${anhangZeile(p)}
        <div class="of-raster"><label for="oa-${p.id}" class="of-lab">Auftraggeber</label><div class="of-stapel">
          <textarea id="oa-${p.id}" rows="3" data-of="p-feld" data-key="auftraggeber" data-pid="${p.id}" placeholder="Firma&#10;Strasse&#10;PLZ Ort">${esc(p.auftraggeber || '')}</textarea>
          <span class="dim of-hinw">Steht im Vertrag. Bei einer bestätigten, zugewiesenen Offerte wird er als Rechnungsadresse in die Projekte des Kunden übernommen.</span></div></div></td></tr>`;
    }
    /* ---------- Beträge nach Jahr (für den Reiter Budget) ---------- */
    const BD = window.BudgetDoc;
    const fr0 = (x) => { const [g, r] = Math.abs(x).toFixed(2).split('.'); return (x < -0.004 ? '-' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + (r === '00' ? '' : '.' + r); };
    /** Total der bestätigten (sonst der neusten) Fassung, ohne MWST; null, wenn der Inhalt fehlt. */
    function offerteTotal(p) {
      const fs = fassungen(p), v = fs.find((x) => x.id === p.zugesagtId) || fs[fs.length - 1];
      if (!v || (v.original && !v.lesbar)) return null;
      const t = BD.round2(v.doc.teile.reduce((s, x) => s + O.teilEnd(x), 0));
      return t > 0 ? t : null;
    }
    const jbJahre = (p) => Object.keys(p.jahresBetraege || {}).sort();
    const jbKurz = (p) => jbJahre(p).map((j) => `${j}: ${fr0(p.jahresBetraege[j])}`).join(' · ');
    function jahrZeile(p) {
      const tot = offerteTotal(p), jb = p.jahresBetraege || {}, summe = BD.round2(Object.values(jb).reduce((s, v) => s + v, 0));
      const hinweis = tot != null ? `Offerte total ${fr0(tot)}${jbJahre(p).length && Math.abs(summe - tot) > 0.004 ? `, verteilt ${fr0(summe)}` : ''}. ` : '';
      return `<div class="of-raster"><span class="of-lab">Betrag nach Jahr</span><div class="of-stapel"><div class="of-jbreihe">
        ${jbJahre(p).map((j) => `<span class="of-chip of-jb"><label for="ojb-${p.id}-${j}">${j}</label><input id="ojb-${p.id}-${j}" class="inline num of-jbw" type="text" inputmode="decimal" value="${esc(fr0(jb[j]))}" data-of="jb" data-pid="${p.id}" data-jahr="${j}" aria-label="Betrag ${j}"><button data-of="jb-weg" data-pid="${p.id}" data-jahr="${j}" title="Jahr entfernen" aria-label="Jahr ${j} entfernen">×</button></span>`).join('')}
        <button class="btn small" data-of="jb-neu" data-pid="${p.id}" title="Einen Betrag für ein weiteres Jahr eintragen">+ Jahr</button></div>
        <span class="dim of-hinw">${hinweis}Ohne MWST. Erscheint im Reiter Budget im jeweiligen Jahr.</span></div></div>`;
    }
    function jahrNeu(p) {
      const jb = p.jahresBetraege || (p.jahresBetraege = {}), js = jbJahre(p).map(Number);
      const fs = fassungen(p), letzte = fs[fs.length - 1];
      const j = js.length ? Math.max(...js) + 1 : Math.max(+heute.slice(0, 4), letzte ? +letzte.datum.slice(0, 4) : 0);
      // Das erste Jahr bekommt das ganze Total der Offerte, weitere Jahre den Rest (falls noch etwas übrig ist).
      const tot = offerteTotal(p), rest = tot != null ? BD.round2(tot - Object.values(jb).reduce((s, v) => s + v, 0)) : 0;
      jb[j] = rest > 0 ? rest : 0;
      return j;
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
          <span>${esc(p.name || pTitel(p))}: ${esc(vTitel(v))} <span class="dim">(${p.alt ? 'alte Offerte, ' : ''}${p.status === 'zugesagt' ? 'bestätigt' : p.status}${n > 1 ? `, neuste von ${n}` : ''})</span></span>
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
      // Alte Offerte, deren Tabelle nicht eingelesen werden konnte: Daraus lässt sich kein Vertrag erzeugen.
      const ohneInhalt = p.alt || fs.some((v) => v.id === p.zugesagtId && v.original);   // alte Offerten sind längst abgemacht: kein Vertrag
      const knoepfe = {
        offen: `<button class="btn small" data-of="v-neu" data-pid="${p.id}" title="Die letzte Offerte kopieren und als neue Fassung mit heutigem Datum weiterbearbeiten">Letzte kopieren</button>
          <button class="btn small" data-of="neu" data-pid="${p.id}" title="Eine neue Offerte aus einem PDF oder einer anderen Offerte zu diesem Projekt hinzufügen">Neue hinzufügen</button>
          ${letzte ? `<button class="btn small" data-of="zusage" data-pid="${p.id}" data-vid="${letzte.id}" title="Die neuste Offerte wurde bestätigt: Der Eintrag wandert zu den bestätigten Offerten">✓ Bestätigt</button>` : ''}
          <button class="btn small" data-of="status" data-status="abgesagt" data-pid="${p.id}" title="Das ganze Projekt mit allen Fassungen zu den abgesagten verschieben">✕ Abgesagt</button>`,
        zugesagt: `${ohneInhalt ? '' : `<button class="btn small primary" data-of="ab-pdf" data-pid="${p.id}" title="Ein PDF mit Vertrag, bestätigter Offerte und AGB">Vertrag</button>`}
          <button class="btn small" data-of="status" data-status="abgeschlossen" data-pid="${p.id}">Projekt abgeschlossen</button>
          <button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgesagt: `<button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgeschlossen: `${ohneInhalt ? '' : `<button class="btn small" data-of="ab-pdf" data-pid="${p.id}" title="Ein PDF mit Vertrag, bestätigter Offerte und AGB">Vertrag</button>`}
          <button class="btn small" data-of="status" data-status="zugesagt" data-pid="${p.id}">Zurück zu bestätigt</button>`,
      }[st];
      return `<tr class="of-pz zb ${auf ? 'auf' : ''}">
          <td colspan="3"><div class="of-kopf">
            <button class="of-pfeil" data-of="p-auf" data-pid="${p.id}" aria-expanded="${auf}" title="${auf ? 'Fassungen ausblenden' : 'Fassungen zeigen'}">${auf ? '▾' : '▸'}</button>
            ${p.alt ? '<span class="pill of-altpill" title="Als PDF hochgeladen; diese Offerte gab es schon vor diesem Programm">alte Offerte</span>' : ''}
            <input class="inline of-kunde" type="text" value="${esc(p.kunde)}" placeholder="Kunde" data-of="p-feld" data-key="kunde" data-pid="${p.id}" aria-label="Kunde">
            <input class="inline of-name" type="text" value="${esc(p.name)}" placeholder="Projekt" data-of="p-feld" data-key="name" data-pid="${p.id}" aria-label="Projekt">
            <button class="of-anz" data-of="p-auf" data-pid="${p.id}">${fs.length} ${fs.length === 1 ? 'Fassung' : 'Fassungen'}${auf || !letzte ? '' : `, letzte vom ${fmtDate(letzte.datum)}`}</button>
            ${jbJahre(p).length ? `<span class="of-jbs" title="Betrag nach Jahr, ohne MWST">${esc(jbKurz(p))}</span>` : ''}
            <span class="grow"></span>
            ${knoepfe}
            <button class="btn small ghost" data-of="p-del" data-pid="${p.id}" title="Projekt mit allen Fassungen löschen">Löschen</button>
          </div></td></tr>
        ${auf ? verknuepfZeile(p) : ''}
        ${auf ? fs.filter((v) => !v.original).reverse().map((v) => fassungZeile(p, v, { haken: st === 'offen' && v === letzte, fest: st !== 'offen', loeschbar: st === 'offen' && fs.length > 1, zugesagt: v.id === p.zugesagtId })).join('') : ''}`;
    }

    function abschnitt([key, titel]) {
      // Nach dem Datum der jeweils neusten Offerte, die neusten zuoberst
      const letztes = (p) => p.versionen.reduce((m, v) => (v.datum > m ? v.datum : m), '');
      const ps = liste().filter((p) => p.status === key).sort((a, b) => (letztes(a) < letztes(b) ? 1 : letztes(a) > letztes(b) ? -1 : (b.erstellt || 0) - (a.erstellt || 0)));
      const auf = state.off.auf.has(key);
      const leerText = { offen: 'Keine offenen Offerten.', zugesagt: 'Noch keine bestätigten Offerten.', abgesagt: 'Keine abgesagten Offerten.', abgeschlossen: 'Noch keine Offerten aus abgeschlossenen Projekten.' }[key];
      return `<tbody class="of-ab" data-zebra>
        <tr class="of-abk klapp-kopf" data-of="ab-auf" data-key="${key}" tabindex="0" role="button" aria-expanded="${auf}"><td colspan="3"><span class="klapp-chev">${auf ? '▾' : '▸'}</span>${titel}<span class="klapp-zahl">${ps.length}</span></td></tr>
        ${auf ? (ps.length ? ps.map(projektZeilen).join('') : `<tr><td colspan="3" class="of-leer">${leerText || 'Noch keine alten Offerten.'}</td></tr>`) : ''}
      </tbody>`;
    }

    /* Wird das Einlesen von PDF verbessert, liest die App die abgelegten Originale einmal neu ein.
       Alte Offerten lassen sich in der App nicht bearbeiten, es geht dabei also nichts verloren. */
    const LESER = 3;
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

    /** Wird eine Datei noch von einem anderen Eintrag gebraucht? Dann bleibt sie liegen. */
    function dateiGebraucht(art, datei) {
      return liste().some((x) => (art === 'alt' ? x.versionen.some((v) => v.original === datei) : (x.anhaenge || []).some((a) => a.datei === datei)));
    }
    /** Dateien nach «Offerten/Gelöscht» verschieben (zurueck: wieder an ihren Platz). */
    async function dateienWeg(liste2, zurueck) {
      if (!api.offertDateiWeg) return;
      for (const [art, datei] of liste2) {
        if (!zurueck && dateiGebraucht(art, datei)) continue;
        const r = await api.offertDateiWeg(art, datei, zurueck);
        if (r && !r.ok) toast('Die Datei liess sich nicht verschieben: ' + r.error, { fehler: true });
      }
    }
    const dateienVon = (p) => [...p.versionen.filter((v) => v.original).map((v) => ['alt', v.original]), ...(p.anhaenge || []).map((a) => ['beilage', a.datei])];

    async function originalOeffnen(v) {
      const r = api.offertOriginal ? await api.offertOriginal(v.original) : { ok: false, error: 'Nur in der Desktop-App.' };
      if (!r.ok) toast('Das Original lässt sich nicht öffnen: ' + r.error, { fehler: true });
    }
    /** Mehrere alte Offerten als PDF übernehmen: Original ablegen, Inhalt als Vorlage einlesen. */
    async function alteHochladen(pfade) {
      const r = pfade ? await api.offertAlteAblegen(pfade) : api.offertAlteWaehlen ? await api.offertAlteWaehlen() : { fehler: 'Nur in der Desktop-App.' };
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
        const vid = uid('ov');
        liste().push({ id: uid('of'), name: titel, kunde: '', kundeLinks: [], auftraggeber: '', status: 'zugesagt', alt: true, zugesagtId: vid, erstellt: Date.now() + gelesen + nur, mod: 0,
          versionen: [{ id: vid, datum, erstellt: Date.now(), doc, original: d.datei, lesbar: !!e.doc, gelesen: LESER }] });
        if (e.doc) gelesen++; else nur++;
      }
      state.off.auf.add('zugesagt'); persist(); render();
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
          <button class="btn of-drop" data-of="alt-hoch" data-drop="alt" title="Offerten als PDF übernehmen, die es schon vor diesem Programm gab. Mehrere auf einmal wählbar oder aus dem Explorer hierher ziehen; sie landen unter «Bestätigt» und sind als alte Offerten markiert.">Alte Offerten hochladen</button>
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
              <td>${feld(`t.${i}.b.${j}.z.${k}.ansatz`, (z.ansatz || '') + (z.ansatzEinheit ? '/' + z.ansatzEinheit : ''), 'class="r" title="Zahl in Franken. Mit «/Tag» gilt der Ansatz pro Tag: 8 Stunden Aufwand sind ein Tag." aria-label="Ansatz"')}</td>
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
        ${o.p ? `<div class="pane of-eanh">${anhangZeile(o.p)}</div>` : ''}
        ${fest ? `<div class="of-fest">Diese Fassung ist ${o.p.status === 'abgesagt' ? 'abgesagt' : 'bestätigt'}. Änderungen sind weiterhin möglich, für eine neue Runde stellst du das Projekt besser zurück auf offen und legst eine neue Fassung an.</div>` : ''}
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
      if (key === 'ansatz') {
        // «700» oder «700/Tag»: Zahl und, falls angegeben, die Einheit des Ansatzes
        const m = /^([^/]*)(?:\/\s*(.*))?$/.exec(String(wert));
        ziel.ansatz = parseFloat(m[1].replace(/[’'\s]/g, '').replace(/fr\.?/i, '').replace(',', '.')) || 0;
        ziel.ansatzEinheit = m[2] == null ? '' : O.einheitNorm(m[2]);
      } else ziel[key] = wert;
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

    /* PDF aus dem Explorer hineinziehen: auf die Beilagen eines Eintrags oder auf «Alte Offerten hochladen». */
    const mitDateien = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    const dropZiel = (e) => (state.view === 'offerten' && e.target.closest ? e.target.closest('.of-drop') : null);
    const dropWeg = () => { for (const z of document.querySelectorAll('.of-drop.ueber')) z.classList.remove('ueber'); };
    document.addEventListener('dragover', (e) => {
      if (!mitDateien(e)) return;
      e.preventDefault();   // sonst öffnet das Fenster die Datei
      const z = dropZiel(e);
      dropWeg();
      if (z) { z.classList.add('ueber'); e.dataTransfer.dropEffect = 'copy'; } else e.dataTransfer.dropEffect = 'none';
    });
    document.addEventListener('dragleave', (e) => { if (mitDateien(e) && !e.relatedTarget) dropWeg(); });
    document.addEventListener('drop', (e) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      const z = dropZiel(e); dropWeg();
      if (!z) return;
      const pfade = [...e.dataTransfer.files].map((f) => (api.pfadVon ? api.pfadVon(f) : '')).filter(Boolean);
      if (!pfade.length) { toast('Bitte Dateien aus dem Explorer hineinziehen.', { fehler: true }); return; }
      if (z.dataset.drop === 'alt') {
        // Alte Offerten werden eingelesen: nur PDF.
        const pdfs = pfade.filter((f) => /\.pdf$/i.test(f));
        if (!pdfs.length) { toast('Alte Offerten bitte als PDF hineinziehen.', { fehler: true }); return; }
        if (pdfs.length < pfade.length) toast(`${pfade.length - pdfs.length} Datei(en) übersprungen: alte Offerten nur als PDF.`);
        alteHochladen(pdfs);
      } else { const p = projekt(z.dataset.pid); if (p) anhangHinzu(p, pfade); }
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
        case 'jb-neu': { const j = jahrNeu(p); persist(); render(); const f = document.getElementById(`ojb-${p.id}-${j}`); if (f) { f.focus(); f.select(); } break; }
        case 'jb-weg': { const alt = p.jahresBetraege[ds.jahr]; delete p.jahresBetraege[ds.jahr]; persist(); render();
          toast(`Betrag ${ds.jahr} entfernt`, { actionLabel: 'Rückgängig', action: () => { (p.jahresBetraege || (p.jahresBetraege = {}))[ds.jahr] = alt; persist(); render(); } }); break; }
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
        case 'verschickt': v.verschickt = el.checked ? heute : null; persist(); render(); break;
        case 'zusage': {
          p.status = 'zugesagt'; p.zugesagtId = v.id; delete p.nichtAuto; state.off.auf.add('zugesagt'); const nAdr = adresseUebernehmen(p, true); persist(); render();
          toast(`${vTitel(v)} ist bestätigt${nAdr ? `, Auftraggeber als Rechnungsadresse in ${nAdr} ${nAdr === 1 ? 'Projekt' : 'Projekte'} übernommen` : ''}`, { actionLabel: 'Rückgängig', action: () => { p.status = 'offen'; p.zugesagtId = null; persist(); render(); } }); break;
        }
        case 'status': {
          const vorher = { status: p.status, zugesagtId: p.zugesagtId, autoAbgeschlossen: p.autoAbgeschlossen, nichtAuto: p.nichtAuto };
          p.status = ds.status; delete p.autoAbgeschlossen; state.off.auf.add(ds.status);
          // Von Hand zurück zu zugesagt: nicht gleich wieder automatisch abschliessen.
          if (ds.status === 'zugesagt') p.nichtAuto = true; else delete p.nichtAuto;
          if (ds.status === 'offen' || ds.status === 'abgesagt') p.zugesagtId = null;
          persist(); render();
          toast({ offen: 'Zurück bei den offenen Offerten', abgesagt: 'Projekt mit allen Fassungen abgesagt', zugesagt: 'Zurück bei den bestätigten Offerten', abgeschlossen: 'Projekt abgeschlossen' }[ds.status],
            { actionLabel: 'Rückgängig', action: () => { Object.assign(p, vorher); persist(); render(); } }); break;
        }
        case 'p-del': {
          if (!confirm(`«${pTitel(p)}» mit ${p.versionen.length} ${p.versionen.length === 1 ? 'Fassung' : 'Fassungen'} löschen?`)) break;
          const i = liste().indexOf(p); liste().splice(i, 1); persist(); render(); dateienWeg(dateienVon(p));
          toast('Projekt gelöscht', { actionLabel: 'Rückgängig', action: () => { liste().splice(i, 0, p); persist(); render(); dateienWeg(dateienVon(p), true); } }); break;
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
        case 'anh-neu': anhangHinzu(p); break;
        case 'anh-auf': { const a = (p.anhaenge || [])[+ds.i]; if (a) api.offertAnhangOeffnen(a.datei).then((r) => { if (!r.ok) toast('Die Beilage lässt sich nicht öffnen: ' + r.error, { fehler: true }); }); break; }
        case 'anh-weg': { const a2 = (p.anhaenge || [])[+ds.i]; if (!a2) break;
          if (!confirm(`Beilage «${a2.name}» löschen?`)) break;
          const i = +ds.i; p.anhaenge.splice(i, 1); persist(); render(); dateienWeg([['beilage', a2.datei]]);
          toast('Beilage gelöscht', { actionLabel: 'Rückgängig', action: () => { p.anhaenge.splice(i, 0, a2); persist(); render(); dateienWeg([['beilage', a2.datei]], true); } }); break; }
        case 'orig-weg': {
          const ganz = p.versionen.length === 1 && !(p.anhaenge || []).length;
          if (!confirm(ganz ? `«${pTitel(p)}» mit dem hochgeladenen PDF löschen?` : `Das PDF «${vTitel(v)}» löschen?`)) break;
          if (ganz) {
            const i = liste().indexOf(p); liste().splice(i, 1); persist(); render(); dateienWeg(dateienVon(p));
            toast('Alte Offerte gelöscht', { actionLabel: 'Rückgängig', action: () => { liste().splice(i, 0, p); persist(); render(); dateienWeg(dateienVon(p), true); } }); break;
          }
          const i = p.versionen.indexOf(v), zuVorher = p.zugesagtId;
          p.versionen.splice(i, 1);
          if (p.zugesagtId === v.id) { const r2 = fassungen(p).pop(); p.zugesagtId = r2 ? r2.id : null; }
          if (!p.versionen.length) { const j = liste().indexOf(p); liste().splice(j, 1); persist(); render(); dateienWeg([['alt', v.original]]);
            toast('PDF gelöscht', { actionLabel: 'Rückgängig', action: () => { p.versionen.splice(i, 0, v); p.zugesagtId = zuVorher; liste().splice(j, 0, p); persist(); render(); dateienWeg([['alt', v.original]], true); } }); break; }
          persist(); render(); dateienWeg([['alt', v.original]]);
          toast('PDF gelöscht', { actionLabel: 'Rückgängig', action: () => { p.versionen.splice(i, 0, v); p.zugesagtId = zuVorher; persist(); render(); dateienWeg([['alt', v.original]], true); } }); break;
        }
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
      } else if (a === 'alt-datum') { const zp = projekt(el.dataset.pid), zv = zp && zp.versionen.find((x) => x.id === el.dataset.vid); if (zv && el.value) { zv.datum = el.value; persist(); render(); } }
      else if (a === 'v-datum') { const o = offen(); if (o && o.v && el.value) { o.v.datum = el.value; persist(); } }
      else if (a === 'p-feld') { const zp = projekt(el.dataset.pid); if (zp && el.dataset.key === 'auftraggeber') adresseUebernehmen(zp); persist(); }
      else if (a === 'jb') {
        const zp = projekt(el.dataset.pid); if (!zp) return;
        const v = el.value.trim() === '' ? 0 : BD.formelWert(el.value);
        if (v == null) { toast('Bitte einen Betrag eingeben, zum Beispiel 4500 oder 3*1500.', { fehler: true }); el.focus(); return; }
        (zp.jahresBetraege || (zp.jahresBetraege = {}))[el.dataset.jahr] = v; persist(); render();
      }
      else if (a === 'n-aus' && el.value && state.off.neu) {
        const [pid, vid] = el.value.split('|'); const p = projekt(pid), v = p && p.versionen.find((x) => x.id === vid);
        if (v) { Object.assign(state.off.neu, { doc: kopie(v.doc), quelle: `${pTitel(p)}, ${vTitel(v)}`, art: v.doc.art }); render(); }
      }
      else if (a === 'verk-neu' && el.value) { const zp = projekt(el.dataset.pid); if (zp) { (zp.kundeLinks || (zp.kundeLinks = [])).push(el.value); const nA = adresseUebernehmen(zp); persist(); render(); if (!nA) toast(`Zugewiesen: ${kLabel(kAusKey(el.value))}`); } }
    });

    /**
     * Zugesagte Offerten wandern zu «Abgeschlossen», sobald alle Projekte (mit Rechnung) der zugewiesenen
     * Kunden bezahlt sind – und erst dann. Fällt eine Zahlung wieder weg, kommt die Offerte zurück.
     * Gibt die Offerten zurück, die eben abgeschlossen wurden.
     */
    function autoAbschluss() {
      const neu = [];
      for (const p of liste()) {
        const auto = p.status === 'abgeschlossen' && p.autoAbgeschlossen;
        if (!(p.status === 'zugesagt' && !p.nichtAuto) && !auto) continue;
        const links = p.kundeLinks || [];
        const ps = links.length ? state.data.projects.filter((x) => x.abrechnung === 'rechnung' && links.includes(kKey(x))) : [];
        const bezahlt = ps.length > 0 && ps.every((x) => x.zahlungsdatum);
        if (!auto && bezahlt) { p.status = 'abgeschlossen'; p.autoAbgeschlossen = true; neu.push(p); }
        else if (auto && !bezahlt) { p.status = 'zugesagt'; delete p.autoAbgeschlossen; }
      }
      return neu;
    }

    return { view, beginneMit, autoAbschluss, pTitel, projektZeile, oeffneAktuelle, zeige };
  };
})();
