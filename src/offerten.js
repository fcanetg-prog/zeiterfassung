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
    const fassungen = (p) => p.versionen.slice().sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
    const pTitel = (p) => [p.kunde, p.name].filter(Boolean).join(' – ') || 'Ohne Namen';
    const vTitel = (v) => `${O.ARTEN[v.doc.art]} vom ${fmtDate(v.datum)}`;
    const kopie = (x) => JSON.parse(JSON.stringify(x));

    /** Das Dokument, das gerade im Editor offen ist (Fassung eines Projekts oder Vorlage). */
    function offen() {
      const e = state.off.edit;
      if (!e) return null;
      if (e.vorlage) { const v = vorlagen().find((x) => x.id === e.vorlage); return v ? { vorlage: v, doc: v.doc } : null; }
      const p = projekt(e.pid), v = p && p.versionen.find((x) => x.id === e.vid);
      return v ? { p, v, doc: v.doc } : null;
    }

    /* ---------- Listen ---------- */

    const ABSCHNITTE = [['offen', 'Offen'], ['zugesagt', 'Zugesagt'], ['abgesagt', 'Abgesagt'], ['abgeschlossen', 'Abgeschlossen']];
    // Projekte unter «Offen» sind von Anfang an aufgeklappt, die übrigen zu; «umgekehrt» merkt sich die Ausnahmen.
    const pOffen = (p) => (p.status === 'offen') !== state.off.umgekehrt.has(p.id);

    function fassungZeile(p, v, opts) {
      return `<tr class="of-fz">
        <td class="of-art">${esc(vTitel(v))}${opts.zugesagt ? ' <span class="pill s-bezahlt">zugesagt</span>' : ''}</td>
        <td class="of-kurz num">${esc(O.kurz(v.doc))}</td>
        <td class="r of-akt">
          ${opts.haken ? `<label class="of-haken" title="Diese Fassung wurde zugesagt. Das Projekt wandert zu den zugesagten Offerten."><input type="checkbox" data-of="zusage" data-pid="${p.id}" data-vid="${v.id}"> zugesagt</label>` : ''}
          <button class="btn small" data-of="edit" data-pid="${p.id}" data-vid="${v.id}">${opts.fest ? 'Ansehen' : 'Bearbeiten'}</button>
          <button class="btn small" data-of="pdf" data-pid="${p.id}" data-vid="${v.id}">PDF</button>
          ${opts.loeschbar ? `<button class="btn small ghost" data-of="v-del" data-pid="${p.id}" data-vid="${v.id}" title="Diese Fassung löschen">×</button>` : ''}
        </td></tr>`;
    }

    function projektZeilen(p) {
      const fs = fassungen(p), letzte = fs[fs.length - 1], st = p.status, auf = pOffen(p);
      const knoepfe = {
        offen: `<button class="btn small" data-of="v-neu" data-pid="${p.id}">Neue Fassung</button>
          <button class="btn small" data-of="status" data-status="abgesagt" data-pid="${p.id}" title="Das ganze Projekt mit allen Fassungen zu den abgesagten verschieben">✕ Abgesagt</button>`,
        zugesagt: `<button class="btn small" data-of="status" data-status="abgeschlossen" data-pid="${p.id}">Projekt abgeschlossen</button>
          <button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgesagt: `<button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgeschlossen: `<button class="btn small" data-of="status" data-status="zugesagt" data-pid="${p.id}">Zurück zu zugesagt</button>`,
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
        ${auf ? fs.map((v) => fassungZeile(p, v, { haken: st === 'offen' && v === letzte, fest: st !== 'offen', loeschbar: st === 'offen' && fs.length > 1, zugesagt: v.id === p.zugesagtId })).join('') : ''}`;
    }

    function abschnitt([key, titel]) {
      const ps = liste().filter((p) => p.status === key).sort((a, b) => (b.erstellt || 0) - (a.erstellt || 0));
      const auf = state.off.auf.has(key);
      const leerText = { offen: 'Keine offenen Offerten.', zugesagt: 'Noch keine zugesagten Offerten.', abgesagt: 'Keine abgesagten Offerten.', abgeschlossen: 'Noch keine Offerten aus abgeschlossenen Projekten.' }[key];
      return `<tbody class="of-ab">
        <tr class="of-abk" data-of="ab-auf" data-key="${key}" tabindex="0" role="button" aria-expanded="${auf}"><td colspan="3"><span class="of-pfeil2">${auf ? '▾' : '▸'}</span> <b>${titel}</b> <span class="of-zahl">${ps.length}</span></td></tr>
        ${auf ? (ps.length ? ps.map(projektZeilen).join('') : `<tr><td colspan="3" class="of-leer">${leerText}</td></tr>`) : ''}
      </tbody>`;
    }

    function neuForm() {
      const n = state.off.neu;
      if (!n) return '';
      return `<form class="pane of-neu" data-of-form="neu" autocomplete="off">
        <div><label for="on-kunde">Kunde</label><input id="on-kunde" type="text" value="${esc(n.kunde)}" data-of="n-feld" data-key="kunde"></div>
        <div><label for="on-name">Projekt</label><input id="on-name" type="text" value="${esc(n.name)}" data-of="n-feld" data-key="name"></div>
        <div><label for="on-art">Dokument</label><select id="on-art" data-of="n-feld" data-key="art">
          <option value="offerte" ${n.art === 'offerte' ? 'selected' : ''}>Offerte</option><option value="kostenvoranschlag" ${n.art === 'kostenvoranschlag' ? 'selected' : ''}>Kostenvoranschlag</option></select></div>
        <div class="of-vorl"><label>Vorlage</label>
          <button class="btn" type="button" data-of="n-hoch" title="PDF oder LaTeX-Datei einer bestehenden Offerte. Ihr Inhalt wird übernommen.">Hochladen</button>
          <button class="btn" type="button" data-of="dialog" data-art="neu" title="LaTeX-Code aus der Zwischenablage einfügen">LaTeX-Code einfügen</button>
          <span class="of-vinfo ${n.doc ? 'ok' : ''}">${n.doc ? `${esc(n.quelle || 'Vorlage')}: ${n.doc.teile.length} ${n.doc.teile.length === 1 ? 'Teil' : 'Teile'} erkannt` : 'PDF oder LaTeX. Ohne Vorlage beginnst du leer.'}</span></div>
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
          <label class="of-umbruch" title="Dieser Teil beginnt im Dokument auf einer neuen Seite"><input type="checkbox" data-of="f" data-pfad="t.${i}.umbruch" ${t.umbruch ? 'checked' : ''}> neue Seite</label>
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
              <td class="r num ${z.preis === 'inklusive' ? 'of-ink' : ''}" id="os-z${i}-${j}-${k}">${O.preisText(z)}</td><td></td>
              <td><button class="btn small ghost" data-of="z-del" data-t="${i}" data-b="${j}" data-z="${k}" title="Zeile löschen">×</button></td></tr>`).join('')}
            <tr class="of-plus"><td colspan="7"><button class="btn small" data-of="z-neu" data-t="${i}" data-b="${j}">+ Zeile</button></td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="5"><button class="btn small" data-of="b-neu" data-t="${i}">+ Block</button> <b class="of-preis">Preis</b>${einfach ? ' <span class="dim">einfache Preisliste: im Dokument nur «Was» und «Total»</span>' : ''}</td>
            <td class="r num" id="os-t${i}"><b>${O.fr(O.teilTotal(t))}</b></td><td></td></tr></tfoot>
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
          <button class="btn" data-of="tex-kopieren" title="Erzeugt den LaTeX-Code dieser Offerte und kopiert ihn. Du kannst ihn in Claude einfügen und dort ändern lassen.">LaTeX-Code kopieren</button>
          <button class="btn" data-of="dialog" data-art="ersetzen" title="Geänderten LaTeX-Code einfügen. Der Inhalt dieser Offerte wird damit ersetzt.">Durch neuen LaTeX-Code ersetzen</button>
          <button class="btn" data-of="e-hoch" title="Inhalt durch ein PDF oder eine LaTeX-Datei ersetzen">Hochladen</button>
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

    function view() { return state.off.edit ? viewEditor() : viewListe(); }

    /* ---------- Aktionen ---------- */

    function setze(doc, pfad, wert) {
      const teile = pfad.split('.');
      if (pfad === 'art') { doc.art = wert; return; }
      let ziel = doc.teile[+teile[1]];
      let i = 2;
      if (teile[i] === 'b') { ziel = ziel.bloecke[+teile[i + 1]]; i += 2; }
      if (teile[i] === 'z') { ziel = ziel.zeilen[+teile[i + 1]]; i += 2; }
      const key = teile[i];
      ziel[key] = key === 'ansatz' ? (parseFloat(String(wert).replace(/[’'\s]/g, '').replace(',', '.')) || 0) : wert;
    }
    /** Summen im Editor nachführen, ohne die Eingabefelder neu aufzubauen. */
    function summen(d) {
      d.teile.forEach((t, i) => {
        const e = $(`#os-t${i}`); if (e) e.innerHTML = `<b>${O.fr(O.teilTotal(t))}</b>`;
        t.bloecke.forEach((b, j) => {
          const eb = $(`#os-b${i}-${j}`); if (eb) eb.textContent = O.fr(O.blockTotal(b));
          b.zeilen.forEach((z, k) => { const ez = $(`#os-z${i}-${j}-${k}`); if (ez) { ez.textContent = O.preisText(z); ez.classList.toggle('of-ink', z.preis === 'inklusive'); } });
        });
      });
    }

    const sauber = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    function dateiName(p, v, endung) {
      return `${v.datum.replace(/-/g, '')}_${O.ARTEN[v.doc.art]}${p ? '_' + sauber(pTitel(p)).replace(/ /g, '_') : ''}.${endung}`;
    }
    async function pdf(doc, name, p, v) {
      const r = await api.savePdf(O.html(doc, { kunde: p && p.kunde, name: p && p.name, datum: v && v.datum }), { ordner: 'Offerten', name, roh: true, offerte: true });
      if (r && r.fehler) toast(r.fehler, { fehler: true }); else if (r && r.path) toast('PDF gespeichert und geöffnet');
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
      const p = { id: uid('of'), name: n.name.trim(), kunde: n.kunde.trim(), status: 'offen', zugesagtId: null, erstellt: Date.now(), mod: 0, versionen: [{ id: uid('ov'), datum: heute, doc }] };
      liste().push(p);
      state.off.neu = null; state.off.auf.add('offen'); state.off.edit = { pid: p.id, vid: p.versionen[0].id };
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
        case 'neu': state.off.neu = { kunde: '', name: '', art: 'offerte', doc: null, quelle: '' }; render(); { const f = $('#on-kunde'); if (f) f.focus(); } break;
        case 'n-zu': state.off.neu = null; render(); break;
        case 'edit': state.off.edit = { pid: p.id, vid: v.id }; render(); window.scrollTo(0, 0); break;
        case 'zurueck': state.off.edit = null; render(); break;
        case 'pdf': pdf(v.doc, dateiName(p, v, 'pdf'), p, v); break;
        case 'e-pdf': pdf(o.doc, dateiName(o.p, o.v, 'pdf'), o.p, o.v); break;
        case 'v-neu': {
          const fs = fassungen(p), letzte = fs[fs.length - 1];
          // Zwei Fassungen am selben Tag wären nicht zu unterscheiden: dann die bestehende öffnen.
          if (letzte && letzte.datum === heute) { state.off.edit = { pid: p.id, vid: letzte.id }; render(); toast('Die Fassung von heute ist geöffnet.'); break; }
          const nv = { id: uid('ov'), datum: heute, doc: kopie(letzte ? letzte.doc : O.leer('offerte')) };
          p.versionen.push(nv); state.off.edit = { pid: p.id, vid: nv.id }; persist(); render(); window.scrollTo(0, 0); break;
        }
        case 'v-del': {
          if (p.versionen.length < 2) break;
          const i = p.versionen.indexOf(v); p.versionen.splice(i, 1); persist(); render();
          toast('Fassung gelöscht', { actionLabel: 'Rückgängig', action: () => { p.versionen.splice(i, 0, v); persist(); render(); } }); break;
        }
        case 'zusage': {
          p.status = 'zugesagt'; p.zugesagtId = v.id; persist(); render();
          toast(`${vTitel(v)} ist zugesagt`, { actionLabel: 'Rückgängig', action: () => { p.status = 'offen'; p.zugesagtId = null; persist(); render(); } }); break;
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
      } else if (a === 'v-datum') { const o = offen(); if (o && o.v && el.value) { o.v.datum = el.value; persist(); } }
      else if (a === 'p-feld') persist();
      else if (a === 'n-feld' && el.tagName === 'SELECT') { /* nur merken */ }
    });

    return { view, beginneMit };
  };
})();
