/* Reiter Pendenzen: Aufgaben mit Fälligkeit, Tags, «Was tun», Anfragen und Notizen (Ersatz für Asana). */
(function () {
  'use strict';
  const P = window.PendenzDoc;

  window.Pendenzen = function (ctx) {
    const { state, esc, fmtDate, heute, persist, render, toast, api, uid } = ctx;

    state.pd = { auf: new Set(), offen: null, q: '', tag: '' };

    const liste = () => state.data.pendenzen || (state.data.pendenzen = []);
    const finde = (id) => liste().find((p) => p.id === id);
    /** Tags zur Auswahl: alle Bereiche aus den Projekten (in deren Reihenfolge), danach die übrigen vorhandenen Tags. */
    function alleTags() {
      const nachJahr = (j) => state.data.projects.filter((x) => x.jahr === j).sort((a, b) => a.sort - b.sort).map((x) => x.bereich);
      const jahre = [...new Set(state.data.projects.map((x) => x.jahr))].sort((a, b) => b - a);   // unabhängig vom gewählten Jahr: zuerst das neuste
      const bereich = [...new Set(jahre.flatMap(nachJahr).filter(Boolean))];
      const rest = [...new Set(liste().flatMap((p) => p.tags))].filter((t) => !bereich.includes(t)).sort((a, b) => a.localeCompare(b, 'de'));
      return [...bereich, ...rest];
    }

    const ABSCHNITTE = [['offen', 'Offene Pendenzen'], ['erledigt', 'Erledigte Pendenzen']];

    let speichernTimer = null;
    const spaeterSpeichern = () => { clearTimeout(speichernTimer); speichernTimer = setTimeout(() => persist(), 600); };
    const jetztSpeichern = () => { clearTimeout(speichernTimer); persist(); };

    function passt(p) {
      if (state.pd.tag && !p.tags.includes(state.pd.tag)) return false;
      const q = state.pd.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (q.length) { const t = `${p.titel} ${p.notiz} ${p.tags.join(' ')}`.toLowerCase(); if (!q.every((w) => t.includes(w))) return false; }
      return true;
    }

    /** Anzahl fälliger Pendenzen (heute und überfällig) für die Zahl in der Seitenleiste. */
    function faelligAnzahl() {
      return liste().filter((p) => !p.erledigt && p.faellig && p.faellig <= heute).length;
    }

    /** Farbgruppen der Tags: Journalismus-Bereiche, Intern, Auftritte, Medien, Teaching; übrige neutral. */
    const FARBEN = {
      Texte: 'journ', Geldcast: 'journ', 'Börsenstrasse Fünfzehn': 'journ', 'Schweizer Wirtschaft Daily': 'journ', 'Angebot und Nachgefragt': 'journ',
      Intern: 'intern', 'Moderationen | Referate | Panel': 'auftritt', Expertenauftritte: 'auftritt', Medienauftritte: 'medien', Teaching: 'teaching',
    };
    const farbe = (t) => 'pd-f-' + (FARBEN[t] || 'andere');
    const tagChips = (p) => p.tags.map((t) => `<button class="pd-tag ${farbe(t)} ${state.pd.tag === t ? 'filter' : ''}" data-pd="tag-filter" data-tag="${esc(t)}" title="Nur Pendenzen mit diesem Tag zeigen">${esc(t)}</button>`).join('');

    function zeile(p) {
      const ueber = !p.erledigt && p.faellig && p.faellig < heute;
      return `<tr class="zb pd-z ${p.erledigt ? 'pd-erl' : ''}" data-pd="oeffnen" data-id="${p.id}">
        <td class="pd-dat">${p.erledigt ? `<span class="dim pd-erldat">${fmtDate(p.erledigt)}</span>` : `<input type="date" class="inline ${ueber ? 'pd-ueber' : ''}" value="${esc(p.faellig)}" data-pd="faellig" data-id="${p.id}" aria-label="Fällig am">`}</td>
        <td class="pd-titel">${tagChips(p)}<b>${esc(p.titel || 'Ohne Titel')}</b></td>
        ${p.erledigt ? '' : `<td class="pd-was"><select class="inline pd-wsel ${p.wasTun ? 'pd-w-' + p.wasTun : ''}" data-pd="wasTun" data-id="${p.id}" aria-label="Was tun">${P.WAS_TUN.map(([k, l]) => `<option value="${k}" ${p.wasTun === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`}
        <td class="pd-anf"><button class="pd-anfrage ${p.anfrage}" data-pd="anfrage" data-id="${p.id}" title="Klicken zum Wechseln: offen → bestätigt → abgesagt">${({ offen: 'Offen', bestaetigt: 'Bestätigt', abgesagt: 'Abgesagt' })[p.anfrage]}</button></td>
        <td class="pd-chk"><input type="checkbox" data-pd="erledigt" data-id="${p.id}" ${p.erledigt ? 'checked' : ''} title="${p.erledigt ? `Erledigt am ${fmtDate(p.erledigt)} – Haken entfernen, um sie wieder zu öffnen` : 'Als erledigt abhaken'}" aria-label="Erledigt"></td>
      </tr>`;
    }

    /** Sonntag der laufenden Kalenderwoche (Montag bis Sonntag). */
    function sonntag() { const d = new Date(heute + 'T12:00:00'); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return d.toISOString().slice(0, 10); }
    /** Offene Pendenzen in zwei Teilen: diese Kalenderwoche (inkl. überfällige) und alles danach. */
    /** Offene Pendenzen in Teilen: heute (inkl. überfällige), morgen, Rest dieser Kalenderwoche, ab nächster Woche. Leere Teile entfallen. */
    function wochenTeile(ps) {
      const so = sonntag(), morgen = P.addTage(heute, 1);
      const tag = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('de-CH', { weekday: 'long' });
      const teile = [
        ['pd-heute', `Heute · ${tag(heute)} ${fmtDate(heute)}`, ps.filter((p) => p.faellig && p.faellig <= heute)],
        ['pd-morgen', `Morgen · ${tag(morgen)} ${fmtDate(morgen)}`, ps.filter((p) => p.faellig === morgen)],
        ['pd-diese', `Rest dieser Woche · bis Sonntag ${fmtDate(so)}`, ps.filter((p) => p.faellig > morgen && p.faellig <= so)],
        ['pd-danach', 'Ab nächster Woche', ps.filter((p) => !p.faellig || (p.faellig > so && p.faellig !== morgen))],
      ];
      const kopf = (cls, text, n) => `<tr class="pd-trenn ${cls}"><td colspan="5"><span>${text}</span><span class="pd-trenn-n">${n}</span></td></tr>`;
      return teile.filter(([, , l]) => l.length).map(([cls, text, l]) => `<tbody data-zebra>${kopf(cls, text, l.length)}${l.map(zeile).join('')}</tbody>`).join('');
    }

    function abschnittHtml([key, titel], gruppen) {
      const ps = gruppen[key] || [];
      const auf = state.pd.auf.has(key) || (state.pd.q.trim() && ps.length);
      const ueber = key === 'offen' ? ps.filter((p) => p.faellig && p.faellig < heute).length : 0;
      const hHeute = key === 'offen' ? ps.filter((p) => p.faellig === heute).length : 0;
      const hinweis = [ueber ? `<span class="pd-rot">${ueber} überfällig</span>` : '', hHeute ? `${hHeute} heute fällig` : ''].filter(Boolean).join(' · ');
      return `<div class="re-ab ${auf ? 'auf' : ''}"><div class="klapp-kopf" data-pd="ab-auf" data-key="${key}" role="button" tabindex="0" aria-expanded="${!!auf}">
        <span class="klapp-chev">${auf ? '▾' : '▸'}</span>${titel}<span class="klapp-zahl">${ps.length}</span>${hinweis ? `<span class="klapp-hinweis">${hinweis}</span>` : ''}</div>
        ${auf ? `<div class="re-inhalt">${ps.length ? `<div class="table-flat"><table class="list pd" ${key === 'offen' ? '' : 'data-zebra'}>
          <colgroup><col class="c-dat"><col class="c-titel">${key === 'erledigt' ? '' : '<col class="c-was">'}<col class="c-anf"><col class="c-chk"></colgroup>
          <thead><tr><th>${key === 'erledigt' ? 'Erledigt' : 'Fällig'}</th><th>Aufgabe</th>${key === 'erledigt' ? '' : '<th>Was tun</th>'}<th>Anfrage</th><th class="c">Erledigt</th></tr></thead>
          ${key === 'offen' ? wochenTeile(ps) : `<tbody>${ps.map(zeile).join('')}</tbody>`}</table></div>` : '<div class="empty">Keine Pendenzen.</div>'}</div>` : ''}</div>`;
    }

    function view() {
      const gruppen = {};
      for (const p of liste().filter(passt)) (gruppen[P.abschnitt(p)] = gruppen[P.abschnitt(p)] || []).push(p);
      const nachDatum = (a, b) => ((a.faellig || '9999') < (b.faellig || '9999') ? -1 : (a.faellig || '9999') > (b.faellig || '9999') ? 1 : a.titel.localeCompare(b.titel, 'de'));
      for (const [k, l] of Object.entries(gruppen)) l.sort(k === 'erledigt' ? (a, b) => (a.erledigt < b.erledigt ? 1 : -1) : nachDatum);
      const tags = alleTags();
      const ohneAsana = !liste().some((p) => p.asanaId);
      return `
      <header class="head"><h1>Pendenzen</h1>
        <div class="tools">
          <input id="pd-suche" type="search" placeholder="Suchen" value="${esc(state.pd.q)}" data-pd="suche">
          <select id="pd-tag" data-pd="tag-wahl" aria-label="Nach Tag filtern"><option value="">Alle Tags</option>${tags.map((t) => `<option ${state.pd.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <button class="btn" data-pd="asana" title="Offene Aufgaben aus einem Asana-Export (CSV) übernehmen. Bereits übernommene werden übersprungen.">${ohneAsana ? 'Aus Asana übernehmen' : 'Asana-Export nachladen'}</button>
          <button class="btn primary" data-pd="neu">Neue Pendenz</button>
        </div>
      </header>
      <div class="pane klapp-box">${ABSCHNITTE.map((a) => abschnittHtml(a, gruppen)).join('')}</div>`;
    }

    /* ---------- Bearbeitungsfenster ---------- */

    const istOffen = () => !!(state.pd.offen && finde(state.pd.offen));

    function drawerHtml() {
      const p = finde(state.pd.offen);
      if (!p) return '';
      const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" class="${p[key] === v ? 'on' : ''}" data-pd="seg" data-key="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;
      return `
      <div class="scrim" data-pd="zu"></div>
      <aside class="drawer pd-drawer" role="dialog" aria-label="Pendenz bearbeiten">
        <header><h2>${esc(p.titel || 'Neue Pendenz')}</h2><button class="btn icon ghost" data-pd="zu" aria-label="Schliessen">×</button></header>
        <div class="dbody">
          <div class="fld"><label for="pd-f-titel">Aufgabe</label><input id="pd-f-titel" type="text" value="${esc(p.titel)}" data-pd="feld" data-key="titel" placeholder="z. B. Moderation: Kunde / Ansprechperson"></div>
          <div class="cols2">
            <div class="fld"><label for="pd-f-faellig">Fällig am</label><input id="pd-f-faellig" type="date" value="${esc(p.faellig)}" data-pd="feld" data-key="faellig"></div>
            <div class="fld"><label>Anfrage</label>${seg('anfrage', P.ANFRAGE)}</div>
          </div>
          <div class="fld"><label>Was tun</label>${seg('wasTun', P.WAS_TUN)}</div>
          <div class="fld"><label>Tags</label><div class="pd-tagwahl">
            ${[...new Set([...alleTags(), ...p.tags])].map((t) => `<button type="button" class="pd-tag ${farbe(t)} ${p.tags.includes(t) ? '' : 'aus'}" data-pd="tag-toggle" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
            <input id="pd-f-tag" type="text" placeholder="Neues Tag …" data-pd="tag-neu" autocomplete="off"></div></div>
          <div class="fld"><label for="pd-f-todos">To-Dos</label><textarea id="pd-f-todos" class="pd-notiz pd-todos" rows="8" data-pd="feld" data-key="todos" spellcheck="true">${esc(p.todos)}</textarea></div>
          <div class="fld"><label for="pd-f-notiz">Notizen</label><textarea id="pd-f-notiz" class="pd-notiz" rows="16" data-pd="feld" data-key="notiz" spellcheck="true">${esc(p.notiz)}</textarea></div>
          <p class="hint">${p.erstellt ? `Erstellt am ${fmtDate(p.erstellt)}.` : ''}${p.asanaId ? ' Aus Asana übernommen.' : ''}${p.erledigt ? ` Erledigt am ${fmtDate(p.erledigt)}.` : ''}</p>
        </div>
        <footer>
          <button type="button" class="btn danger" data-pd="loeschen">Löschen</button>
          <span class="grow"></span>
          <button type="button" class="btn" data-pd="erledigt-knopf">${p.erledigt ? 'Wieder öffnen' : 'Erledigt'}</button>
          <button type="button" class="btn primary" data-pd="zu">Fertig</button>
        </footer>
      </aside>`;
    }

    function schliessen() {
      const p = finde(state.pd.offen);
      state.pd.offen = null;
      // Eine leer gebliebene neue Pendenz nicht aufbewahren.
      if (p && !p.titel.trim() && !p.notiz.trim()) { liste().splice(liste().indexOf(p), 1); }
      jetztSpeichern(); render();
    }

    function erledigen(p, an) {
      const vorher = { erledigt: p.erledigt, faellig: p.faellig, faelligVorher: p.faelligVorher };
      // Erledigte Pendenzen haben kein Fälligkeitsdatum mehr; beim Wiederöffnen kommt das alte zurück.
      if (an) { p.erledigt = heute; if (p.faellig) p.faelligVorher = p.faellig; p.faellig = ''; }
      else { p.erledigt = null; p.faellig = p.faelligVorher || heute; delete p.faelligVorher; }
      jetztSpeichern(); render();
      toast(an ? `«${p.titel || 'Pendenz'}» erledigt` : `«${p.titel || 'Pendenz'}» wieder offen`, { actionLabel: 'Rückgängig', action: () => { Object.assign(p, vorher); if (!vorher.faelligVorher) delete p.faelligVorher; jetztSpeichern(); render(); } });
    }

    async function asanaUebernehmen() {
      const r = api.openText ? await api.openText('Asana-Export (CSV) wählen', ['csv']) : { fehler: 'Nur in der Desktop-App.' };
      if (!r || r.canceled) return;
      if (r.fehler) { toast(r.fehler, { fehler: true }); return; }
      const e = P.ausAsanaCsv(r.text, () => uid('pd'));
      if (e.fehler) { toast(e.fehler, { fehler: true }); return; }
      const da = new Set(liste().filter((p) => p.asanaId).map((p) => p.asanaId));
      const neu = e.pendenzen.filter((p) => !p.asanaId || !da.has(p.asanaId));
      liste().push(...neu);
      state.pd.auf.add('offen');
      jetztSpeichern(); render();
      toast(`${neu.length} offene Pendenzen übernommen${e.pendenzen.length - neu.length ? `, ${e.pendenzen.length - neu.length} waren schon da` : ''}. ${e.erledigt} erledigte Aufgaben aus Asana habe ich ausgelassen.`, { dauer: 12000 });
    }

    /* ---------- Ereignisse ---------- */

    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-pd]');
      if (!el || !state.data || (state.view !== 'pendenzen' && !istOffen())) return;
      const a = el.dataset.pd, p = el.dataset.id ? finde(el.dataset.id) : finde(state.pd.offen);
      switch (a) {
        case 'ab-auf': if (state.pd.auf.has(el.dataset.key)) state.pd.auf.delete(el.dataset.key); else state.pd.auf.add(el.dataset.key); render(); break;
        case 'oeffnen': if (ev.target.closest('input, select, button')) break; state.pd.offen = el.dataset.id; render(); break;
        case 'erledigt': if (p) erledigen(p, el.checked); break;
        case 'erledigt-knopf': if (p) { const an = !p.erledigt; state.pd.offen = null; erledigen(p, an); } break;
        case 'anfrage': if (p) { p.anfrage = ({ offen: 'bestaetigt', bestaetigt: 'abgesagt', abgesagt: 'offen' })[p.anfrage] || 'offen'; jetztSpeichern(); render(); } break;
        case 'tag-toggle': if (p) { const t = el.dataset.tag; p.tags = p.tags.includes(t) ? p.tags.filter((x) => x !== t) : [...p.tags, t]; jetztSpeichern(); render(); } break;
        case 'tag-filter': ev.stopPropagation(); state.pd.tag = state.pd.tag === el.dataset.tag ? '' : el.dataset.tag; render(); break;
        case 'neu': {
          const n = P.normalize({ id: uid('pd'), titel: '', faellig: heute, anfrage: 'bestaetigt', wasTun: 'umsetzen', erstellt: heute });
          state.pd.auf.add('offen');
          liste().push(n); state.pd.offen = n.id; render();
          const f = document.getElementById('pd-f-titel'); if (f) f.focus();
          break;
        }
        case 'asana': asanaUebernehmen(); break;
        case 'zu': schliessen(); break;
        case 'seg': if (p) { p[el.dataset.key] = el.dataset.val; jetztSpeichern(); render(); } break;
        case 'tag-weg': if (p) { p.tags = p.tags.filter((t) => t !== el.dataset.tag); jetztSpeichern(); render(); } break;
        case 'loeschen': {
          if (!p || !confirm(`«${p.titel || 'Pendenz'}» löschen?`)) break;
          const i = liste().indexOf(p); liste().splice(i, 1); state.pd.offen = null; jetztSpeichern(); render();
          toast('Pendenz gelöscht', { actionLabel: 'Rückgängig', action: () => { liste().splice(i, 0, p); jetztSpeichern(); render(); } }); break;
        }
      }
    });

    document.addEventListener('input', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.pd;
      if (!a || !state.data) return;
      if (a === 'suche') { state.pd.q = el.value; render(); return; }
      if (a === 'feld') {
        const p = finde(state.pd.offen); if (!p) return;
        p[el.dataset.key] = el.value;
        if (el.dataset.key === 'titel') { const h = document.querySelector('.pd-drawer header h2'); if (h) h.textContent = el.value || 'Neue Pendenz'; }
        spaeterSpeichern();
      }
    });

    document.addEventListener('change', (ev) => {
      const el = ev.target, a = el.dataset && el.dataset.pd;
      if (!a || !state.data) return;
      const p = el.dataset.id ? finde(el.dataset.id) : finde(state.pd.offen);
      if (a === 'tag-wahl') { state.pd.tag = el.value; render(); }
      else if (a === 'faellig' && p) { p.faellig = el.value || ''; jetztSpeichern(); render(); }
      else if (a === 'wasTun' && p) { p.wasTun = el.value; jetztSpeichern(); render(); }
      else if (a === 'feld' && p) { if (el.dataset.key === 'faellig') p.faellig = el.value || ''; jetztSpeichern(); }
      else if (a === 'tag-neu' && p) tagHinzu(el, p);
    });

    function tagHinzu(el, p) {
      const t = el.value.trim();
      if (!t) return;
      if (t.toLowerCase() === 'offen') { p.anfrage = 'offen'; toast('«offen» ist kein Tag mehr: Die Pendenz ist jetzt eine offene Anfrage.'); }
      else if (!p.tags.includes(t)) p.tags.push(t);
      el.value = '';
      jetztSpeichern(); render();
      const f = document.getElementById('pd-f-tag'); if (f) f.focus();
    }

    document.addEventListener('keydown', (ev) => {
      const el = ev.target;
      if (ev.key === 'Enter' && el.dataset && el.dataset.pd === 'tag-neu') { ev.preventDefault(); const p = finde(state.pd.offen); if (p) tagHinzu(el, p); }
      else if (ev.key === 'Enter' && el.closest && el.closest('tr.pd-z') && !el.closest('input, select, button')) { state.pd.offen = el.closest('tr.pd-z').dataset.id; render(); }
    });

    return { view, drawerHtml, istOffen, schliessen, faelligAnzahl };
  };
})();
