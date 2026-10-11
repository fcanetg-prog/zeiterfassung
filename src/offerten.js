/* Reiter Offerten: Projekte mit ihren Offerten (offen, zugesagt, abgesagt, abgeschlossen), Vorlagen, Editor, PDF und LaTeX. */
(function () {
  'use strict';
  const O = window.OffertDoc;

  window.Offerten = function (ctx) {
    const { state, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;
    const $ = (sel, root) => (root || document).querySelector(sel);

    state.off = { tab: 'offen', edit: null, neu: null, dialog: null, alle: new Set() };

    const TABS = [['offen', 'Offen'], ['zugesagt', 'Zugesagt'], ['abgesagt', 'Abgesagt'], ['abgeschlossen', 'Abgeschlossen'], ['vorlagen', 'Vorlagen']];
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

    function fassungZeile(p, v, opts) {
      return `<tr>
        <td class="of-art">${esc(vTitel(v))}</td>
        <td class="of-kurz num">${esc(O.kurz(v.doc))}</td>
        <td class="r of-akt">
          ${opts.haken ? `<label class="of-haken" title="Diese Fassung wurde zugesagt. Sie wandert zu den zugesagten Offerten."><input type="checkbox" data-of="zusage" data-pid="${p.id}" data-vid="${v.id}"> zugesagt</label>` : ''}
          <button class="btn small" data-of="edit" data-pid="${p.id}" data-vid="${v.id}">${opts.fest ? 'Ansehen' : 'Bearbeiten'}</button>
          <button class="btn small" data-of="pdf" data-pid="${p.id}" data-vid="${v.id}">PDF</button>
          <button class="btn small" data-of="tex" data-pid="${p.id}" data-vid="${v.id}">LaTeX</button>
          ${opts.loeschbar ? `<button class="btn small ghost" data-of="v-del" data-pid="${p.id}" data-vid="${v.id}" title="Diese Fassung löschen">×</button>` : ''}
        </td></tr>`;
    }

    function karte(p) {
      const fs = fassungen(p), letzte = fs[fs.length - 1];
      const zugesagt = p.zugesagtId && p.versionen.find((v) => v.id === p.zugesagtId);
      const st = p.status;
      // Zugesagt und abgeschlossen zeigen nur die zugesagte Fassung; die früheren lassen sich einblenden.
      const nurEine = (st === 'zugesagt' || st === 'abgeschlossen') && zugesagt && !state.off.alle.has(p.id);
      const sicht = nurEine ? [zugesagt] : fs;
      const fruehere = (st === 'zugesagt' || st === 'abgeschlossen') && zugesagt ? fs.length - 1 : 0;
      const knoepfe = {
        offen: `<button class="btn small" data-of="v-neu" data-pid="${p.id}">Neue Fassung</button>
          <button class="btn small" data-of="status" data-status="abgesagt" data-pid="${p.id}" title="Das ganze Projekt mit allen Fassungen zu den abgesagten verschieben">✕ Abgesagt</button>`,
        zugesagt: `<button class="btn small" data-of="status" data-status="abgeschlossen" data-pid="${p.id}">Projekt abgeschlossen</button>
          <button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgesagt: `<button class="btn small" data-of="status" data-status="offen" data-pid="${p.id}">Zurück zu offen</button>`,
        abgeschlossen: `<button class="btn small" data-of="status" data-status="zugesagt" data-pid="${p.id}">Zurück zu zugesagt</button>`,
      }[st];
      return `<section class="pane of-karte">
        <div class="of-kopf">
          <input class="inline of-kunde" type="text" value="${esc(p.kunde)}" placeholder="Kunde" data-of="p-feld" data-key="kunde" data-pid="${p.id}" aria-label="Kunde">
          <input class="inline of-name" type="text" value="${esc(p.name)}" placeholder="Projekt" data-of="p-feld" data-key="name" data-pid="${p.id}" aria-label="Projekt">
          <span class="grow"></span>
          ${knoepfe}
          <button class="btn small ghost" data-of="p-del" data-pid="${p.id}" title="Projekt mit allen Fassungen löschen">Löschen</button>
        </div>
        <table class="of-liste"><tbody>
          ${sicht.map((v) => fassungZeile(p, v, { haken: st === 'offen' && v === letzte, fest: st !== 'offen', loeschbar: st === 'offen' && fs.length > 1 })).join('')}
        </tbody></table>
        ${fruehere > 0 ? `<button class="of-mehr" data-of="alle" data-pid="${p.id}">${state.off.alle.has(p.id) ? 'Nur die zugesagte Fassung zeigen' : `${fruehere} frühere ${fruehere === 1 ? 'Fassung' : 'Fassungen'} zeigen`}</button>` : ''}
      </section>`;
    }

    function neuForm() {
      const n = state.off.neu;
      if (!n) return '';
      return `<form class="pane of-neu" data-of-form="neu" autocomplete="off">
        <div><label for="on-kunde">Kunde</label><input id="on-kunde" type="text" value="${esc(n.kunde)}" data-of="n-feld" data-key="kunde"></div>
        <div><label for="on-name">Projekt</label><input id="on-name" type="text" value="${esc(n.name)}" data-of="n-feld" data-key="name"></div>
        <div><label for="on-art">Dokument</label><select id="on-art" data-of="n-feld" data-key="art">
          <option value="offerte" ${n.art === 'offerte' ? 'selected' : ''}>Offerte</option><option value="kostenvoranschlag" ${n.art === 'kostenvoranschlag' ? 'selected' : ''}>Kostenvoranschlag</option>
          <option value="" ${n.art === '' ? 'selected' : ''}>wie in der Vorlage</option></select></div>
        <div><label for="on-vorlage">Vorlage</label><select id="on-vorlage" data-of="n-feld" data-key="vorlage">
          <option value="">Leer beginnen</option>${vorlagen().map((v) => `<option value="${v.id}" ${n.vorlage === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
        <button class="btn primary" type="submit">Anlegen und bearbeiten</button>
        <button class="btn" type="button" data-of="n-zu">Abbrechen</button>
      </form>`;
    }

    function viewVorlagen() {
      return `<section class="pane of-hilfe">
          <h2>Vorlagen</h2>
          <p>Eine Vorlage ist eine fertige Offerte, aus der du neue Offerten ableitest. So kommt eine bestehende Offerte (PDF oder LaTeX-Code) hinein:</p>
          <ol><li>«Anleitung für Claude kopieren» klicken.</li><li>Im Claude-Chat einfügen und das PDF oder den LaTeX-Code dazugeben.</li><li>Claudes Antwort kopieren und hier mit «Vorlage einfügen» übernehmen.</li></ol>
          <div class="row"><button class="btn" data-of="vp-kopieren">Anleitung für Claude kopieren</button>
            <button class="btn primary" data-of="dialog" data-art="vorlage">Vorlage einfügen</button>
            <button class="btn" data-of="vo-leer">Leere Vorlage</button></div>
        </section>
        ${vorlagen().length ? `<section class="pane of-karte"><table class="of-liste"><tbody>${vorlagen().map((v) => `<tr>
            <td><input class="inline of-vname" type="text" value="${esc(v.name)}" data-of="vo-name" data-id="${v.id}" aria-label="Name der Vorlage"></td>
            <td class="of-kurz num">${esc(O.ARTEN[v.doc.art])}: ${esc(O.kurz(v.doc))}</td>
            <td class="r of-akt"><button class="btn small primary" data-of="neu" data-vorlage="${v.id}">Neue Offerte daraus</button>
              <button class="btn small" data-of="vo-edit" data-id="${v.id}">Bearbeiten</button>
              <button class="btn small" data-of="vo-pdf" data-id="${v.id}">PDF</button>
              <button class="btn small ghost" data-of="vo-del" data-id="${v.id}" title="Vorlage löschen">×</button></td></tr>`).join('')}</tbody></table></section>`
        : '<div class="empty">Noch keine Vorlagen.</div>'}`;
    }

    function viewListe() {
      const tab = state.off.tab;
      const anz = (s) => liste().filter((p) => p.status === s).length;
      const ps = liste().filter((p) => p.status === tab).sort((a, b) => (b.erstellt || 0) - (a.erstellt || 0));
      const leerText = { offen: 'Keine offenen Offerten.', zugesagt: 'Noch keine zugesagten Offerten.', abgesagt: 'Keine abgesagten Offerten.', abgeschlossen: 'Noch keine Offerten aus abgeschlossenen Projekten.' }[tab];
      return `<header class="head"><h1>Offerten</h1>
          <button class="btn primary" data-of="neu">Neue Offerte</button></header>
        <div class="bh-bar"><div class="seg">${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-of="tab" data-tab="${k}">${l}${k !== 'vorlagen' && anz(k) ? ` <span class="of-zahl">${anz(k)}</span>` : ''}</button>`).join('')}</div></div>
        ${neuForm()}
        ${tab === 'vorlagen' ? viewVorlagen() : ps.length ? ps.map(karte).join('') : `<div class="empty">${leerText}</div>`}
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
        <textarea data-of="f" data-pfad="t.${i}.text" rows="2" placeholder="Einleitung. *Sternchen* setzen Wörter kursiv." aria-label="Einleitung">${esc(t.text)}</textarea>
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
          <button class="btn" data-of="kopieren" title="Kopiert die Offerte samt Anleitung. Im Claude-Chat einfügen und sagen oder diktieren, was sich ändern soll.">Für Claude kopieren</button>
          <button class="btn" data-of="dialog" data-art="antwort" title="Claudes Antwort hier einfügen. Die Offerte wird damit ersetzt.">Antwort einfügen</button>
          ${o.vorlage ? '' : '<button class="btn" data-of="als-vorlage">Als Vorlage speichern</button>'}
          <button class="btn" data-of="e-tex">LaTeX</button>
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
      const vorlage = g.art === 'vorlage';
      return `<div class="of-schleier" data-of="dialog-zu-aussen"><div class="of-dialog" role="dialog" aria-label="${vorlage ? 'Vorlage einfügen' : 'Antwort einfügen'}">
        <h2>${vorlage ? 'Vorlage einfügen' : 'Antwort von Claude einfügen'}</h2>
        <p>${vorlage ? 'Füge hier Claudes Antwort (das JSON) ein. Daraus entsteht eine neue Vorlage.' : 'Füge hier Claudes Antwort (das JSON) ein. Die offene Offerte wird damit ersetzt; das lässt sich rückgängig machen.'}</p>
        ${vorlage ? `<label>Name der Vorlage <input type="text" id="od-name" value="${esc(g.name || '')}" data-of="d-name"></label>` : ''}
        <textarea id="od-text" rows="12" data-of="d-text" placeholder='{ "art": "offerte", "teile": [ … ] }'>${esc(g.text || '')}</textarea>
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
    async function pdf(doc, name) {
      const r = await api.savePdf(O.html(doc), { ordner: 'Offerten', name, roh: true });
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
      const vorlage = vorlagen().find((v) => v.id === n.vorlage);
      const doc = vorlage ? kopie(vorlage.doc) : O.leer(n.art || 'offerte');
      if (n.art) doc.art = n.art;
      const p = { id: uid('of'), name: n.name.trim(), kunde: n.kunde.trim(), status: 'offen', zugesagtId: null, erstellt: Date.now(), mod: 0, versionen: [{ id: uid('ov'), datum: heute, doc }] };
      liste().push(p);
      state.off.neu = null; state.off.tab = 'offen'; state.off.edit = { pid: p.id, vid: p.versionen[0].id };
      persist(); render();
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
        case 'tab': state.off.tab = ds.tab; state.off.neu = null; render(); break;
        case 'neu': state.off.neu = { kunde: '', name: '', art: ds.vorlage ? '' : 'offerte', vorlage: ds.vorlage || '' }; if (state.off.tab === 'vorlagen') state.off.tab = 'offen'; render(); { const f = $('#on-kunde'); if (f) f.focus(); } break;
        case 'n-zu': state.off.neu = null; render(); break;
        case 'edit': state.off.edit = { pid: p.id, vid: v.id }; render(); window.scrollTo(0, 0); break;
        case 'zurueck': state.off.edit = null; render(); break;
        case 'pdf': pdf(v.doc, dateiName(p, v, 'pdf')); break;
        case 'tex': texDatei(v.doc, dateiName(p, v, 'tex')); break;
        case 'e-pdf': pdf(o.doc, o.vorlage ? `Vorlage_${sauber(o.vorlage.name).replace(/ /g, '_')}.pdf` : dateiName(o.p, o.v, 'pdf')); break;
        case 'e-tex': texDatei(o.doc, o.vorlage ? `Vorlage_${sauber(o.vorlage.name).replace(/ /g, '_')}.tex` : dateiName(o.p, o.v, 'tex')); break;
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
        case 'alle': if (state.off.alle.has(ds.pid)) state.off.alle.delete(ds.pid); else state.off.alle.add(ds.pid); render(); break;

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

        // Austausch mit Claude
        case 'kopieren': zwischenablage(O.promptAnpassen(o.doc), 'Kopiert. Füge es im Claude-Chat ein und sag, was sich ändern soll.'); break;
        case 'vp-kopieren': zwischenablage(O.promptVorlage(), 'Kopiert. Füge es im Claude-Chat ein und gib das PDF oder den LaTeX-Code dazu.'); break;
        case 'dialog': state.off.dialog = { art: ds.art, text: '', name: '' }; render(); { const t = $('#od-text'); if (t) t.focus(); } break;
        case 'dialog-zu': state.off.dialog = null; render(); break;
        case 'dialog-zu-aussen': if (ev.target === el) { state.off.dialog = null; render(); } break;
        case 'dialog-ok': {
          const g = state.off.dialog, r = O.ausAntwort(g.text);
          if (r.fehler) { toast(r.fehler, { fehler: true }); break; }
          if (g.art === 'vorlage') {
            vorlagen().push({ id: uid('ovl'), name: (g.name || '').trim() || (r.doc.teile[0] && r.doc.teile[0].titel) || 'Vorlage', doc: r.doc, mod: 0 });
            state.off.dialog = null; persist(); render(); toast('Vorlage gespeichert');
          } else if (o) {
            const ziel = o.vorlage || o.v, alt = ziel.doc;
            ziel.doc = r.doc; state.off.dialog = null; persist(); render();
            toast('Offerte ersetzt', { actionLabel: 'Rückgängig', action: () => { ziel.doc = alt; persist(); render(); } });
          }
          break;
        }
        case 'als-vorlage': {
          vorlagen().push({ id: uid('ovl'), name: pTitel(o.p), doc: kopie(o.doc), mod: 0 }); persist();
          toast('Als Vorlage gespeichert. Den Namen änderst du im Abschnitt Vorlagen.'); break;
        }
        case 'vo-leer': { const nv = { id: uid('ovl'), name: 'Neue Vorlage', doc: O.leer('offerte'), mod: 0 }; vorlagen().push(nv); state.off.edit = { vorlage: nv.id }; persist(); render(); break; }
        case 'vo-edit': state.off.edit = { vorlage: ds.id }; render(); window.scrollTo(0, 0); break;
        case 'vo-pdf': { const vl = vorlagen().find((x) => x.id === ds.id); pdf(vl.doc, `Vorlage_${sauber(vl.name).replace(/ /g, '_')}.pdf`); break; }
        case 'vo-del': {
          const i = vorlagen().findIndex((x) => x.id === ds.id); const [weg] = vorlagen().splice(i, 1); persist(); render();
          toast('Vorlage gelöscht', { actionLabel: 'Rückgängig', action: () => { vorlagen().splice(i, 0, weg); persist(); render(); } }); break;
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
      else if (a === 'd-name') state.off.dialog.name = el.value;
      else if (a === 'p-feld') { const p = projekt(el.dataset.pid); if (p) p[el.dataset.key] = el.value; }
      else if (a === 'vo-name') { const v = vorlagen().find((x) => x.id === el.dataset.id); if (v) v.name = el.value; }
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
      else if (a === 'p-feld' || a === 'vo-name') persist();
    });

    return { view };
  };
})();
