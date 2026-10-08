/* Zeiterfassung – Oberfläche */
(function () {
  'use strict';
  const C = window.Calc;

  /* ============ Hilfen ============ */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');

  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  function todayIso() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseIso(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function toIso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function addDays(iso, n) { const d = parseIso(iso); d.setDate(d.getDate() + n); return toIso(d); }
  function fmtDate(iso) { return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ''; }
  function fmtDateLong(iso) { const d = parseIso(iso); return `${TAGE[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`; }

  function fmtCHF(x, dec) {
    if (!C.isNum(x)) return '–';
    const d = dec == null ? 2 : dec;
    const neg = x < 0;
    const [g, r] = Math.abs(x).toFixed(d).split('.');
    return (neg ? '−' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + (r ? '.' + r : '');
  }
  function fmtH(x) {
    if (!C.isNum(x)) return '–';
    const neg = x < 0;
    const t = (Math.round(Math.abs(x) * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
    const [g, r] = t.split('.');
    return (neg ? '−' : '') + g.replace(/\B(?=(\d{3})+(?!\d))/g, '’') + (r ? '.' + r : '');
  }
  const fmtH1 = (x) => (C.isNum(x) ? fmtCHF(x, 1) : '–');

  /* ============ Speicher-Schnittstelle (Desktop-App oder Browser-Vorschau) ============ */

  const api = window.api || {
    async load() { const t = localStorage.getItem('zeiterfassung'); return { data: t ? JSON.parse(t) : null, path: 'Browser-Vorschau' }; },
    async save(d) { localStorage.setItem('zeiterfassung', JSON.stringify(d)); return { ok: true }; },
    importFile() {
      return new Promise((res) => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
        inp.onchange = async () => { try { res({ data: JSON.parse(await inp.files[0].text()) }); } catch (e) { res({ error: e.message }); } };
        inp.click();
      });
    },
    async exportFile() { return { canceled: true }; },
    async exportCsv() { return { canceled: true }; },
    async openFolder() {}, async chooseFolder() { return { canceled: true }; },
    async info() { return { version: 'Vorschau', dataPath: 'Browser-Vorschau' }; },
  };

  /* ============ Zustand ============ */

  const heute = todayIso();
  const state = {
    data: null,
    geladen: false,
    fehler: null,
    info: { version: '', dataPath: '' },
    view: 'erfassen',
    date: heute,
    calMonth: heute.slice(0, 7),
    year: +heute.slice(0, 4),
    filter: { q: '', status: 'alle', archiv: false },
    zu: new Set(),
    drawer: null,
    combo: { q: '', projectId: null, open: false, idx: 0 },
    form: { stunden: '', notiz: '' },
    zeigeLeere: false,
  };

  let hrs = new Map();
  function recompute() { hrs = C.hoursByProject(state.data.entries); }
  const S = () => C.settings(state.data);
  const figs = (p) => C.projectFigures(p, hrs.get(p.id) || 0, S(), heute);
  const projById = (id) => state.data.projects.find((p) => p.id === id);
  const projLabel = (p) => (p ? [p.kunde, p.name].filter(Boolean).join(' – ') : 'Gelöschtes Projekt');

  async function persist() {
    recompute();
    const r = await api.save(state.data);
    if (!r || r.ok === false) toast('Speichern fehlgeschlagen: ' + ((r && r.error) || 'unbekannter Fehler'), { fehler: true });
  }

  /* ============ Toast ============ */

  let toastTimer = null, toastAction = null;
  function toast(text, opts) {
    const el = $('#toast');
    toastAction = (opts && opts.action) || null;
    el.className = 'show' + (opts && opts.fehler ? ' fehler' : '');
    el.innerHTML = `<span>${esc(text)}</span>` + (toastAction ? `<button data-action="toast-action">${esc(opts.actionLabel)}</button>` : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; toastAction = null; }, opts && opts.action ? 7000 : 3200);
  }

  /* ============ Normalisieren importierter Daten ============ */

  function normalize(d) {
    if (!d || !Array.isArray(d.projects) || !Array.isArray(d.entries)) throw new Error('Die Datei enthält keine Zeiterfassungs-Daten.');
    const out = C.emptyData();
    out.settings = Object.assign({}, C.DEFAULTS, d.settings || {});
    out.history = d.history || {};
    out.projects = d.projects.map((p, i) => ({
      id: p.id || uid('p'), jahr: +p.jahr || state.year, sort: C.isNum(p.sort) ? p.sort : i,
      bereich: p.bereich || '', kategorie: p.kategorie || '', kunde: p.kunde || '', name: p.name || '',
      mwst: ['drauf', 'inkl', 'keine'].includes(p.mwst) ? p.mwst : 'drauf',
      betrag: C.isNum(p.betrag) ? p.betrag : null, kosten: C.isNum(p.kosten) ? p.kosten : 0,
      stundenOfferte: C.isNum(p.stundenOfferte) ? p.stundenOfferte : null,
      stundenZiel: C.isNum(p.stundenZiel) ? p.stundenZiel : null,
      effort: C.isNum(p.effort) ? p.effort : null,
      abrechnung: ['rechnung', 'ohne', 'intern'].includes(p.abrechnung) ? p.abrechnung : 'rechnung',
      rechnungGeplant: p.rechnungGeplant || null, rechnungsdatum: p.rechnungsdatum || null, zahlungsdatum: p.zahlungsdatum || null,
      rechnungsadresse: p.rechnungsadresse || '', referenz: p.referenz || '', rechnungsEmail: p.rechnungsEmail || '',
      rechnungstext: p.rechnungstext || '', notiz: p.notiz || '', archiviert: !!p.archiviert,
    }));
    const ids = new Set(out.projects.map((p) => p.id));
    out.entries = d.entries.filter((e) => e && e.datum && ids.has(e.projectId) && C.isNum(e.stunden))
      .map((e) => ({ id: e.id || uid('e'), datum: e.datum, projectId: e.projectId, stunden: e.stunden, notiz: e.notiz || '' }));
    return out;
  }

  /* ============ Rahmen ============ */

  const NAV = [
    ['erfassen', 'Erfassen'],
    ['projekte', 'Projekte'],
    ['rechnungen', 'Rechnungen'],
    ['auswertung', 'Auswertung'],
    ['einstellungen', 'Einstellungen'],
  ];

  function years() {
    const ys = new Set([+heute.slice(0, 4), state.year]);
    for (const p of state.data.projects) ys.add(p.jahr);
    for (const e of state.data.entries) ys.add(+e.datum.slice(0, 4));
    return [...ys].sort((a, b) => b - a);
  }

  function dayTotal(iso) { let t = 0; for (const e of state.data.entries) if (e.datum === iso) t += e.stunden; return t; }

  function render() {
    const act = document.activeElement;
    const keep = act && act.id ? { id: act.id, a: act.selectionStart, b: act.selectionEnd } : null;
    const main = $('.main');
    const scroll = main ? main.scrollTop : 0;
    const tw = $('.table-wrap');
    const tscroll = tw ? [tw.scrollLeft, tw.scrollTop] : null;
    const db = $('.dbody');
    const dscroll = db ? db.scrollTop : 0;

    if (!state.geladen) { $('#app').innerHTML = '<div class="leer"><p>Daten werden geladen …</p></div>'; return; }
    if (!state.data) { $('#app').innerHTML = viewStart(); return; }

    const views = { erfassen: viewErfassen, projekte: viewProjekte, rechnungen: viewRechnungen, auswertung: viewAuswertung, einstellungen: viewEinstellungen };
    const wocheH = weekTotal(heute);
    $('#app').innerHTML = `
      <nav class="side">
        <div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16 8.5V16l5 3.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div><strong>Zeiterfassung</strong><span>Fabio Canetg GmbH</span></div></div>
        <div class="navlist">${NAV.map(([k, l]) => `<button class="nav ${state.view === k ? 'on' : ''}" data-action="nav" data-view="${k}">${l}</button>`).join('')}</div>
        <label class="yearpick">Jahr
          <select id="year-select" data-action="year">${years().map((y) => `<option ${y === state.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </label>
        <div class="side-foot">
          <div><span>Heute</span><b>${fmtH(dayTotal(heute))} h</b></div>
          <div><span>Diese Woche</span><b>${fmtH(wocheH)} h</b></div>
        </div>
      </nav>
      <main class="main view-${state.view}">${views[state.view]()}</main>`;

    $('#drawer-root').innerHTML = state.drawer ? drawerHtml() : '';
    const m2 = $('.main'); if (m2) m2.scrollTop = scroll;
    const db2 = $('.dbody'); if (db2) db2.scrollTop = dscroll;
    const tw2 = $('.table-wrap'); if (tw2 && tscroll) { tw2.scrollLeft = tscroll[0]; tw2.scrollTop = tscroll[1]; }
    if (keep) {
      const el = document.getElementById(keep.id);
      if (el) { el.focus(); try { if (keep.a != null) el.setSelectionRange(keep.a, keep.b); } catch (_) { /* nicht jedes Feld kann das */ } }
    }
  }

  function weekStart(iso) { const d = parseIso(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return toIso(d); }
  function weekTotal(iso) { const a = weekStart(iso), b = addDays(a, 6); let t = 0; for (const e of state.data.entries) if (e.datum >= a && e.datum <= b) t += e.stunden; return t; }

  /* ============ Start ohne Daten ============ */

  function viewStart() {
    return `<div class="leer"><div class="leer-box">
      <h1>Zeiterfassung</h1>
      ${state.fehler ? `<p class="warn">${esc(state.fehler)}</p>` : ''}
      <p>Es sind noch keine Daten vorhanden. Importiere die Datei mit deinen bisherigen Stunden und Projekten aus dem Excel, oder starte mit einer leeren Erfassung.</p>
      <div class="row"><button class="btn primary" data-action="import">Daten importieren</button>
      <button class="btn" data-action="start-empty">Leer starten</button></div>
    </div></div>`;
  }

  /* ============ Erfassen ============ */

  function activeProjects(year) {
    return state.data.projects.filter((p) => p.jahr === year && !p.archiviert).sort((a, b) => a.sort - b.sort);
  }

  function recentProjects(year, n) {
    const seen = new Map();
    for (const e of state.data.entries) {
      const prev = seen.get(e.projectId);
      if (!prev || e.datum > prev) seen.set(e.projectId, e.datum);
    }
    return activeProjects(year).filter((p) => seen.has(p.id)).sort((a, b) => (seen.get(b.id) < seen.get(a.id) ? -1 : 1)).slice(0, n);
  }

  function comboMatches() {
    const year = +state.date.slice(0, 4);
    const all = activeProjects(year);
    const q = state.combo.q.trim().toLowerCase();
    if (!q) {
      const rec = recentProjects(year, 6);
      const ids = new Set(rec.map((p) => p.id));
      return rec.map((p) => ({ p, zuletzt: true })).concat(all.filter((p) => !ids.has(p.id)).map((p) => ({ p })));
    }
    const tokens = q.split(/\s+/);
    return all.filter((p) => {
      const hay = `${p.kunde} ${p.name} ${p.bereich} ${p.kategorie}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    }).map((p) => ({ p }));
  }

  function comboListHtml() {
    const list = comboMatches();
    if (!list.length) return '<div class="combo-empty">Kein Projekt gefunden. Lege es unter «Projekte» an.</div>';
    state.combo.idx = Math.max(0, Math.min(state.combo.idx, list.length - 1));
    let lastGroup = null;
    return list.map(({ p, zuletzt }, i) => {
      const group = zuletzt ? 'Zuletzt verwendet' : p.bereich;
      const head = group !== lastGroup ? `<div class="combo-group">${esc(group)}</div>` : '';
      lastGroup = group;
      const eff = hrs.get(p.id) || 0;
      return `${head}<div class="combo-item ${i === state.combo.idx ? 'on' : ''}" data-action="combo-pick" data-id="${p.id}" data-idx="${i}">
        <span><b>${esc(p.kunde)}</b> ${esc(p.name)}</span>
        <span class="num dim">${fmtH(eff)}${C.isNum(p.stundenZiel) ? ' / ' + fmtH(p.stundenZiel) : ''} h</span></div>`;
    }).join('');
  }

  function progress(p) {
    const eff = hrs.get(p.id) || 0;
    if (!C.isNum(p.stundenZiel) || p.stundenZiel <= 0) return `<span class="dim">${fmtH(eff)} h insgesamt</span>`;
    const pct = Math.min(100, (eff / p.stundenZiel) * 100);
    const over = eff > p.stundenZiel;
    return `<span class="prog ${over ? 'over' : ''}"><i style="width:${pct.toFixed(0)}%"></i></span>
      <span class="${over ? 'over-text' : 'dim'}">${fmtH(eff)} von ${fmtH(p.stundenZiel)} h Ziel</span>`;
  }

  function viewErfassen() {
    const d = state.date;
    const entries = state.data.entries.filter((e) => e.datum === d);
    const total = entries.reduce((s, e) => s + e.stunden, 0);
    const sel = state.combo.projectId ? projById(state.combo.projectId) : null;

    return `
    <header class="head">
      <div class="daynav">
        <button class="btn icon" data-action="day" data-step="-1" title="Vorheriger Tag" aria-label="Vorheriger Tag">‹</button>
        <button class="btn" data-action="today" ${d === heute ? 'disabled' : ''}>Heute</button>
        <button class="btn icon" data-action="day" data-step="1" title="Nächster Tag" aria-label="Nächster Tag">›</button>
      </div>
      <h1>${fmtDateLong(d)}</h1>
      <div class="bignum"><b>${fmtH(total)}</b><span>Stunden</span></div>
    </header>
    <div class="erfassen">
      <section class="pane">
        <form class="addform" data-action="add-entry" autocomplete="off">
          <div class="combo">
            <label for="combo-input">Projekt</label>
            <input id="combo-input" type="text" placeholder="Kunde oder Projekt suchen" value="${esc(sel ? projLabel(sel) : state.combo.q)}" data-action="combo-input" role="combobox" aria-expanded="${state.combo.open}">
            <div id="combo-list" class="combo-list ${state.combo.open ? 'open' : ''}">${state.combo.open ? comboListHtml() : ''}</div>
          </div>
          <div class="f-std"><label for="f-stunden">Stunden</label>
            <input id="f-stunden" type="text" inputmode="decimal" placeholder="1.5" value="${esc(state.form.stunden)}" data-action="form-stunden"></div>
          <div class="f-notiz"><label for="f-notiz">Notiz</label>
            <input id="f-notiz" type="text" placeholder="optional" value="${esc(state.form.notiz)}" data-action="form-notiz"></div>
          <button class="btn primary" type="submit">Eintragen</button>
        </form>
        <p class="hint">Stunden als 1.5, 1,5 oder 1:30. Mit Enter eintragen.</p>

        ${entries.length ? `<table class="entries">
          <thead><tr><th>Projekt</th><th>Notiz</th><th class="r">Stunden</th><th></th></tr></thead>
          <tbody>${entries.map((e) => {
            const p = projById(e.projectId);
            return `<tr>
              <td><div class="e-proj"><b>${esc(p ? p.kunde : '')}</b> ${esc(p ? p.name : 'Gelöschtes Projekt')}</div>
                  <div class="e-prog">${p ? progress(p) : ''}</div></td>
              <td><input class="inline" type="text" value="${esc(e.notiz)}" placeholder="–" data-action="entry-note" data-id="${e.id}" id="en-${e.id}" aria-label="Notiz"></td>
              <td class="r"><input class="inline num w-h" type="text" inputmode="decimal" value="${fmtH(e.stunden).replace('’', '')}" data-action="entry-hours" data-id="${e.id}" id="eh-${e.id}" aria-label="Stunden"></td>
              <td class="r"><button class="btn icon ghost" data-action="entry-del" data-id="${e.id}" title="Eintrag löschen" aria-label="Eintrag löschen">×</button></td>
            </tr>`;
          }).join('')}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="r num"><b>${fmtH(total)}</b></td><td></td></tr></tfoot>
        </table>` : `<div class="empty">Für diesen Tag ist noch nichts erfasst.</div>`}
      </section>
      <aside class="pane cal">${calendarHtml()}</aside>
    </div>`;
  }

  function calendarHtml() {
    const [y, m] = state.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const byDay = new Map();
    for (const e of state.data.entries) byDay.set(e.datum, (byDay.get(e.datum) || 0) + e.stunden);
    let rows = '';
    let monthSum = 0;
    const cur = new Date(start);
    for (let w = 0; w < 6; w++) {
      if (w > 3 && cur.getMonth() !== m - 1) break;
      let cells = '', wsum = 0;
      for (let i = 0; i < 7; i++) {
        const iso = toIso(cur);
        const inMonth = cur.getMonth() === m - 1;
        const h = byDay.get(iso) || 0;
        wsum += h;
        if (inMonth) monthSum += h;
        const a = h > 0 ? Math.min(1, 0.12 + (h / 11) * 0.88) : 0;
        cells += `<button class="day ${inMonth ? '' : 'out'} ${iso === state.date ? 'sel' : ''} ${iso === heute ? 'today' : ''} ${i > 4 ? 'we' : ''}"
          data-action="pick-day" data-date="${iso}" style="--a:${a.toFixed(2)}" title="${fmtDate(iso)}: ${fmtH(h)} h">
          <span class="dn">${cur.getDate()}</span><span class="dh ${a > 0.55 ? 'inv' : ''}">${h ? fmtH(h) : ''}</span></button>`;
        cur.setDate(cur.getDate() + 1);
      }
      rows += `<div class="week">${cells}<span class="wsum num">${wsum ? fmtH(wsum) : ''}</span></div>`;
    }
    const s = S();
    const soll = C.monthlyTarget(s);
    const ist = monthSum * s.stundenZuschlag;
    return `
      <div class="cal-head">
        <button class="btn icon" data-action="cal" data-step="-1" aria-label="Vorheriger Monat">‹</button>
        <h2>${MONATE[m - 1]} ${y}</h2>
        <button class="btn icon" data-action="cal" data-step="1" aria-label="Nächster Monat">›</button>
      </div>
      <div class="week wd"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span><span class="wsum">Woche</span></div>
      ${rows}
      <dl class="cal-sum">
        <div><dt>Erfasst</dt><dd>${fmtH(monthSum)} h</dd></div>
        <div><dt>Ist mit Zuschlag</dt><dd>${fmtH1(ist)} h</dd></div>
        <div><dt>Soll</dt><dd>${fmtH1(soll)} h</dd></div>
        <div><dt>Differenz</dt><dd class="${ist - soll < 0 ? 'neg' : 'pos'}">${ist - soll > 0 ? '+' : ''}${fmtH1(ist - soll)} h</dd></div>
      </dl>`;
  }

  /* ============ Projekte ============ */

  const STATUS_FILTER = [
    ['alle', 'Alle Projekte'],
    ['offen', 'Noch nicht verrechnet'],
    ['gestellt', 'Rechnung gestellt, offen'],
    ['ueberfaellig', 'Überfällig'],
    ['bezahlt', 'Bezahlt'],
    ['pruefen', 'Zahlung prüfen'],
    ['geplant', 'Noch nicht begonnen'],
    ['intern', 'Keine Abrechnung'],
  ];

  function yearProjects() {
    return state.data.projects.filter((p) => p.jahr === state.year).sort((a, b) => a.sort - b.sort);
  }

  function filteredProjects() {
    const q = state.filter.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return yearProjects().filter((p) => {
      if (p.archiviert && !state.filter.archiv) return false;
      if (q.length && !q.every((t) => `${p.kunde} ${p.name} ${p.bereich} ${p.kategorie}`.toLowerCase().includes(t))) return false;
      if (state.filter.status !== 'alle') {
        const c = figs(p).status.code;
        if (state.filter.status === 'offen') return c === 'offen' || c === 'faellig';
        if (c !== state.filter.status) return false;
      }
      return true;
    });
  }

  /** Farbskala wie im Excel: tiefe Stundenlöhne rötlich, hohe grünlich. */
  function wageScale(list) {
    const vals = [];
    for (const p of list) { const f = figs(p); if (C.isNum(f.lohnZiel) && f.lohnZiel > 0) vals.push(f.lohnZiel); if (C.isNum(f.lohnEff) && f.lohnEff > 0) vals.push(f.lohnEff); }
    vals.sort((a, b) => a - b);
    if (vals.length < 3) return () => '';
    const q = (f) => vals[Math.min(vals.length - 1, Math.floor(f * (vals.length - 1)))];
    const lo = q(0.05), mid = q(0.5), hi = q(0.95);
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const R = [246, 196, 184], Y = [250, 238, 190], G = [176, 222, 196];
    return (v) => {
      if (!C.isNum(v) || v <= 0) return '';
      let c;
      if (v <= mid) c = mix(R, Y, Math.max(0, Math.min(1, (v - lo) / (mid - lo || 1))));
      else c = mix(Y, G, Math.max(0, Math.min(1, (v - mid) / (hi - mid || 1))));
      return `background:rgb(${c.join(',')})`;
    };
  }

  function effortDots(n) {
    if (!C.isNum(n)) return '<span class="dim">–</span>';
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<i class="${i <= n ? 'on' : ''}"></i>`;
    return `<span class="effort" title="Effort ${n} von 5">${s}</span>`;
  }

  const MWST_KURZ = { drauf: 'kommt dazu', inkl: 'inklusive', keine: 'keine' };

  function statusPill(st) {
    const extra = st.code === 'gestellt' || st.code === 'ueberfaellig' ? ` · ${st.tage} T.` : '';
    return `<span class="pill s-${st.code}">${esc(st.label)}${extra}</span>`;
  }

  function sums(list) {
    let betrag = 0, teil = 0, eff = 0, ziel = 0, rech = 0, teilMitStd = 0, effMitBetrag = 0;
    for (const p of list) {
      const f = figs(p);
      if (C.isNum(f.netto)) betrag += f.netto;
      if (C.isNum(f.meinTeil)) teil += f.meinTeil;
      eff += f.stundenEff;
      if (C.isNum(p.stundenZiel)) ziel += p.stundenZiel;
      if (p.abrechnung === 'rechnung' && C.isNum(f.rechnungsbetrag)) rech += f.rechnungsbetrag;
      if (C.isNum(f.meinTeil) && f.stundenEff > 0) { teilMitStd += f.meinTeil; effMitBetrag += f.stundenEff; }
    }
    return { betrag, teil, eff, ziel, rech, lohn: effMitBetrag > 0 ? (teilMitStd / effMitBetrag) * S().lohnFaktor : null };
  }

  function viewProjekte() {
    const list = filteredProjects();
    const scale = wageScale(yearProjects());
    const groups = [];
    for (const p of list) {
      let g = groups[groups.length - 1];
      if (!g || g.name !== p.bereich) { g = { name: p.bereich, items: [] }; groups.push(g); }
      g.items.push(p);
    }
    let body = '';
    for (const g of groups) {
      const zu = state.zu.has(g.name);
      const sg = sums(g.items);
      body += `<tr class="grp" data-action="toggle-group" data-group="${esc(g.name)}">
        <td colspan="2"><span class="chev">${zu ? '▸' : '▾'}</span> ${esc(g.name || 'Ohne Bereich')} <span class="dim">${g.items.length}</span></td>
        <td colspan="6"></td><td class="r num">${fmtH(sg.eff)}</td>
        <td></td><td class="r num">${C.isNum(sg.lohn) ? fmtCHF(sg.lohn, 0) : ''}</td><td></td><td class="r num">${sg.rech ? fmtCHF(sg.rech) : ''}</td><td colspan="4"></td></tr>`;
      if (zu) continue;
      let lastKunde = null;
      for (const p of g.items) {
        const f = figs(p);
        const neuKunde = p.kunde !== lastKunde; lastKunde = p.kunde;
        const over = C.isNum(p.stundenZiel) && f.stundenEff > p.stundenZiel;
        body += `<tr class="prow ${neuKunde ? 'first' : ''} ${p.archiviert ? 'arch' : ''}" data-action="open-project" data-id="${p.id}" tabindex="0">
          <td class="kunde">${neuKunde ? esc(p.kunde) : ''}</td>
          <td class="pname">${esc(p.name)}${p.notiz ? ' <span class="note-dot" title="' + esc(p.notiz) + '">Notiz</span>' : ''}</td>
          <td>${effortDots(p.effort)}</td>
          <td class="r num">${fmtCHF(f.netto)}</td>
          <td class="r num ${f.kosten ? '' : 'dim'}">${f.kosten ? fmtCHF(f.kosten) : '–'}</td>
          <td class="r num">${fmtCHF(f.meinTeil)}</td>
          <td class="r num">${fmtH(p.stundenOfferte)}</td>
          <td class="r num">${fmtH(p.stundenZiel)}</td>
          <td class="r num ${over ? 'over-text' : ''}">${f.stundenEff ? fmtH(f.stundenEff) : '<span class="dim">0</span>'}</td>
          <td class="r num cs" style="${scale(f.lohnZiel)}">${C.isNum(f.lohnZiel) ? fmtCHF(f.lohnZiel, 0) : '–'}</td>
          <td class="r num cs" style="${scale(f.lohnEff)}">${C.isNum(f.lohnEff) ? fmtCHF(f.lohnEff, 0) : '–'}</td>
          <td class="dim">${p.abrechnung === 'intern' ? '' : MWST_KURZ[p.mwst]}</td>
          <td class="r num">${p.abrechnung === 'rechnung' ? fmtCHF(f.rechnungsbetrag) : '<span class="dim">–</span>'}</td>
          <td class="datecell">${p.abrechnung === 'rechnung' ? `<input type="date" class="inline" value="${p.rechnungGeplant || ''}" data-action="p-date" data-key="rechnungGeplant" data-id="${p.id}" id="pg-${p.id}" aria-label="Rechnungsdatum">` : ''}</td>
          <td class="num">${fmtDate(p.rechnungsdatum)}</td>
          <td class="num">${fmtDate(p.zahlungsdatum)}</td>
          <td>${statusPill(f.status)}</td></tr>`;
      }
    }
    const st = sums(list);
    return `
    <header class="head">
      <h1>Projekte ${state.year}</h1>
      <div class="tools">
        <input id="proj-search" type="search" placeholder="Suchen" value="${esc(state.filter.q)}" data-action="filter-q">
        <select id="proj-status" data-action="filter-status">${STATUS_FILTER.map(([k, l]) => `<option value="${k}" ${state.filter.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" data-action="filter-archiv" ${state.filter.archiv ? 'checked' : ''}> Archivierte zeigen</label>
        <button class="btn" data-action="export-csv">Als CSV exportieren</button>
        <button class="btn primary" data-action="new-project">Neues Projekt</button>
      </div>
    </header>
    ${list.length ? `<div class="table-wrap"><table class="grid">
      <thead><tr>
        <th>Kunde</th><th>Projekt</th><th>Effort</th>
        <th class="r" title="Offerierter Betrag ohne Mehrwertsteuer">Ansatz</th><th class="r" title="Kosten für Dritte">Kosten</th><th class="r" title="Ansatz minus Kosten">Mein Teil</th>
        <th class="r">Std. Offerte</th><th class="r">Std. Ziel</th><th class="r">Std. effektiv</th>
        <th class="r" title="Mein Teil ÷ Zielstunden × ${S().lohnFaktor}">CHF/h Ziel</th><th class="r" title="Mein Teil ÷ effektive Stunden × ${S().lohnFaktor}">CHF/h effektiv</th>
        <th>MwSt.</th><th class="r">Rechnungsbetrag</th><th title="Datum, an dem oder ab dem du die Rechnung stellen willst">Rechnungsdatum</th><th>Rechnung gestellt</th><th>Zahlung erhalten</th><th>Status</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="2">Total ${list.length} Projekte</td><td></td>
        <td colspan="5"></td><td class="r num">${fmtH(st.eff)}</td><td></td>
        <td class="r num">${C.isNum(st.lohn) ? fmtCHF(st.lohn, 0) : ''}</td><td></td><td class="r num">${fmtCHF(st.rech)}</td><td colspan="4"></td></tr></tfoot>
    </table></div>` : `<div class="empty">${yearProjects().length ? 'Kein Projekt passt zu diesem Filter.' : `Für ${state.year} gibt es noch keine Projekte. Lege das erste mit «Neues Projekt» an.`}</div>`}`;
  }

  function projectsCsv() {
    const head = ['Bereich', 'Unterbereich', 'Kunde', 'Projekt', 'Effort', 'MwSt.', 'Ansatz', 'Kosten', 'Mein Teil', 'Stunden Offerte', 'Stunden Ziel', 'Stunden effektiv', 'CHF/h Ziel', 'CHF/h effektiv', 'Rechnungsbetrag', 'Rechnungsdatum', 'Rechnung gestellt', 'Zahlung erhalten', 'Status', 'Notiz'];
    const n = (v, d) => (C.isNum(v) ? v.toFixed(d == null ? 2 : d) : '');
    const rows = filteredProjects().map((p) => {
      const f = figs(p);
      return [p.bereich, p.kategorie, p.kunde, p.name, p.effort == null ? '' : p.effort, MWST_KURZ[p.mwst], n(f.netto), n(f.kosten), n(f.meinTeil), n(p.stundenOfferte), n(p.stundenZiel), n(f.stundenEff), n(f.lohnZiel), n(f.lohnEff),
        p.abrechnung === 'rechnung' ? n(f.rechnungsbetrag) : '', fmtDate(p.rechnungGeplant), fmtDate(p.rechnungsdatum), fmtDate(p.zahlungsdatum), f.status.label, p.notiz.replace(/\n/g, ' | ')];
    });
    return [head].concat(rows).map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  }

  /* ============ Projekt bearbeiten ============ */

  function newProject() {
    const maxSort = state.data.projects.reduce((m, p) => Math.max(m, p.sort), 0);
    return {
      id: null, jahr: state.year, sort: maxSort + 1, bereich: '', kategorie: '', kunde: '', name: '',
      mwst: 'drauf', betrag: null, kosten: 0, stundenOfferte: null, stundenZiel: null, effort: 3,
      abrechnung: 'rechnung', rechnungGeplant: null, rechnungsdatum: null, zahlungsdatum: null,
      rechnungsadresse: '', referenz: '', rechnungsEmail: '', rechnungstext: '', notiz: '', archiviert: false,
    };
  }

  function openDrawer(p) {
    const d = Object.assign({}, p);
    state.drawer = {
      id: p.id, draft: d,
      txt: { betrag: C.isNum(d.betrag) ? String(d.betrag) : '', kosten: d.kosten ? String(d.kosten) : '', stundenOfferte: C.isNum(d.stundenOfferte) ? String(d.stundenOfferte) : '', stundenZiel: C.isNum(d.stundenZiel) ? String(d.stundenZiel) : '' },
    };
    render();
    const f = $('#d-kunde'); if (f && !p.id) f.focus();
  }

  function drawerDraft() {
    const dr = state.drawer, d = Object.assign({}, dr.draft);
    d.betrag = C.parseAmount(dr.txt.betrag);
    d.kosten = C.parseAmount(dr.txt.kosten) || 0;
    d.stundenOfferte = C.parseHours(dr.txt.stundenOfferte);
    d.stundenZiel = C.parseHours(dr.txt.stundenZiel);
    return d;
  }

  function drawerCalcHtml() {
    const d = drawerDraft();
    const f = C.projectFigures(d, state.drawer.id ? hrs.get(state.drawer.id) || 0 : 0, S(), heute);
    const s = S();
    return `
      <div><dt>Mein Teil</dt><dd>${fmtCHF(f.meinTeil)}</dd></div>
      <div><dt>Mehrwertsteuer ${d.mwst === 'keine' ? '' : s.mwstSatz + '%'}</dt><dd>${d.mwst === 'keine' ? 'keine' : fmtCHF(f.mwstBetrag)}</dd></div>
      <div><dt>Rechnungsbetrag</dt><dd><b>${fmtCHF(f.rechnungsbetrag)}</b></dd></div>
      <div><dt>CHF/h Ziel</dt><dd>${C.isNum(f.lohnZiel) ? fmtCHF(f.lohnZiel) : '–'}</dd></div>
      <div><dt>CHF/h effektiv</dt><dd>${C.isNum(f.lohnEff) ? fmtCHF(f.lohnEff) : '–'}</dd></div>
      <div><dt>Stunden effektiv</dt><dd>${fmtH(f.stundenEff)}</dd></div>`;
  }

  function datalist(id, key) {
    const vals = [...new Set(state.data.projects.map((p) => p[key]).filter(Boolean))].sort();
    return `<datalist id="${id}">${vals.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
  }

  function drawerHtml() {
    const dr = state.drawer, d = dr.draft, neu = !dr.id;
    const fld = (id, label, key, attrs) => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="text" value="${esc(d[key])}" data-action="d-field" data-key="${key}" ${attrs || ''}></div>`;
    const txt = (id, label, key, ph) => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="text" inputmode="decimal" class="num" value="${esc(dr.txt[key])}" placeholder="${ph || ''}" data-action="d-txt" data-key="${key}"></div>`;
    const dat = (id, label, key) => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="date" value="${esc(d[key] || '')}" data-action="d-field" data-key="${key}"></div>`;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" class="${String(d[key]) === String(v) ? 'on' : ''}" data-action="d-seg" data-key="${key}" data-val="${v}">${l}</button>`).join('')}</div>`;
    const nEntries = dr.id ? state.data.entries.filter((e) => e.projectId === dr.id).length : 0;
    return `
    <div class="scrim" data-action="drawer-close"></div>
    <aside class="drawer" role="dialog" aria-label="Projekt bearbeiten">
      <header><h2>${neu ? 'Neues Projekt' : esc(projLabel(d))}</h2><button class="btn icon ghost" data-action="drawer-close" aria-label="Schliessen">×</button></header>
      <form data-action="drawer-save" autocomplete="off">
        <div class="dbody">
          <h3>Projekt</h3>
          <div class="cols2">
            ${fld('d-kunde', 'Kunde', 'kunde', 'list="dl-kunde"')}${fld('d-name', 'Projekt', 'name')}
            ${fld('d-bereich', 'Bereich', 'bereich', 'list="dl-bereich"')}${fld('d-kategorie', 'Unterbereich', 'kategorie', 'list="dl-kategorie"')}
          </div>
          ${datalist('dl-kunde', 'kunde')}${datalist('dl-bereich', 'bereich')}${datalist('dl-kategorie', 'kategorie')}
          <div class="fld"><label>Effort</label>${seg('effort', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])}</div>

          <h3>Honorar und Stunden</h3>
          <div class="fld"><label>Mehrwertsteuer</label>${seg('mwst', [['drauf', 'kommt zum Betrag dazu'], ['inkl', 'im Betrag enthalten'], ['keine', 'keine MwSt.']])}</div>
          <div class="cols2">
            ${txt('d-betrag', d.mwst === 'inkl' ? 'Offerierter Betrag inkl. MwSt.' : 'Offerierter Betrag', 'betrag', 'z. B. 3390+430')}
            ${txt('d-kosten', 'Kosten für Dritte', 'kosten', '0')}
            ${txt('d-so', 'Stunden gemäss Offerte', 'stundenOfferte')}
            ${txt('d-sz', 'Stunden Ziel', 'stundenZiel')}
          </div>
          <dl class="calc" id="drawer-calc">${drawerCalcHtml()}</dl>

          <h3>Abrechnung</h3>
          <div class="fld">${seg('abrechnung', [['rechnung', 'Ich stelle eine Rechnung'], ['ohne', 'Zahlung ohne Rechnung'], ['intern', 'Keine Abrechnung']])}</div>
          ${d.abrechnung === 'intern' ? '' : `<div class="cols3">
            ${d.abrechnung === 'rechnung' ? dat('d-rg', 'Rechnungsdatum', 'rechnungGeplant') + dat('d-rd', 'Rechnung gestellt am', 'rechnungsdatum') : ''}
            ${dat('d-zd', 'Zahlung erhalten am', 'zahlungsdatum')}
          </div>`}
          ${d.abrechnung !== 'rechnung' ? '' : `
          <div class="fld"><label for="d-adr">Rechnungsadresse</label><textarea id="d-adr" rows="4" placeholder="Firma&#10;Strasse&#10;PLZ Ort" data-action="d-field" data-key="rechnungsadresse">${esc(d.rechnungsadresse)}</textarea></div>
          <div class="cols2">
            <div class="fld"><label for="d-ref">Referenz des Kunden</label><textarea id="d-ref" rows="2" data-action="d-field" data-key="referenz">${esc(d.referenz)}</textarea></div>
            <div class="fld"><label for="d-mail">E-Mail für die Rechnung</label><input id="d-mail" type="text" value="${esc(d.rechnungsEmail)}" data-action="d-field" data-key="rechnungsEmail"></div>
          </div>
          <div class="fld"><label for="d-rt">Text der Rechnungsposition</label><input id="d-rt" type="text" value="${esc(d.rechnungstext)}" placeholder="z. B. Moderation gemäss Offerte vom 15.01.2026" data-action="d-field" data-key="rechnungstext"></div>`}

          <h3>Notiz</h3>
          <div class="fld"><textarea id="d-notiz" rows="3" aria-label="Notiz" data-action="d-field" data-key="notiz">${esc(d.notiz)}</textarea></div>
          <label class="check"><input type="checkbox" data-action="d-check" data-key="archiviert" ${d.archiviert ? 'checked' : ''}> Archiviert: nicht mehr bei der Erfassung anbieten</label>
        </div>
        <footer>
          ${neu ? '' : `<button type="button" class="btn danger" data-action="project-delete">Löschen${nEntries ? ` (${nEntries} Einträge)` : ''}</button>
          <button type="button" class="btn" data-action="project-dup">Duplizieren</button>`}
          <span class="grow"></span>
          <button type="button" class="btn" data-action="drawer-close">Abbrechen</button>
          <button type="submit" class="btn primary">${neu ? 'Projekt anlegen' : 'Speichern'}</button>
        </footer>
      </form>
    </aside>`;
  }

  function saveDrawer() {
    const d = drawerDraft();
    const dr = state.drawer;
    if (!d.name.trim() && !d.kunde.trim()) { toast('Gib mindestens einen Kunden oder einen Projektnamen ein.', { fehler: true }); return false; }
    if (dr.txt.betrag.trim() && d.betrag == null) { toast('Der offerierte Betrag ist keine gültige Zahl.', { fehler: true }); return false; }
    for (const k of ['kunde', 'name', 'bereich', 'kategorie']) d[k] = d[k].trim();
    for (const k of ['rechnungGeplant', 'rechnungsdatum', 'zahlungsdatum']) d[k] = d[k] || null;
    d.effort = d.effort == null ? null : +d.effort;
    if (dr.id) {
      const i = state.data.projects.findIndex((p) => p.id === dr.id);
      state.data.projects[i] = d;
    } else {
      d.id = uid('p');
      state.data.projects.push(d);
    }
    state.drawer = null;
    persist(); render();
    toast(dr.id ? 'Projekt gespeichert' : 'Projekt angelegt');
    return true;
  }

  /* ============ Rechnungen ============ */

  function viewRechnungen() {
    const by = { faellig: [], offen: [], geplant: [], gestellt: [], ueberfaellig: [], pruefen: [], bezahlt: [] };
    for (const p of yearProjects()) { const c = figs(p).status.code; if (by[c]) by[c].push(p); }
    const sum = (l) => l.reduce((s, p) => s + (figs(p).rechnungsbetrag || 0), 0);
    const zuStellen = by.faellig.concat(by.offen).sort((a, b) => (a.rechnungGeplant || '9') < (b.rechnungGeplant || '9') ? -1 : 1);
    const offen = by.ueberfaellig.concat(by.gestellt).sort((a, b) => (a.rechnungsdatum < b.rechnungsdatum ? -1 : 1));
    const bezahlt = by.bezahlt.slice().sort((a, b) => (a.zahlungsdatum < b.zahlungsdatum ? 1 : -1));

    const row = (p, cols) => {
      const f = figs(p);
      return `<tr>
        <td><button class="link" data-action="open-project" data-id="${p.id}"><b>${esc(p.kunde)}</b> ${esc(p.name)}</button></td>
        <td class="r num">${fmtH(f.stundenEff)}</td>
        <td class="r num">${p.abrechnung === 'ohne' ? fmtCHF(f.netto) : fmtCHF(f.rechnungsbetrag)}</td>
        ${cols.includes('geplant') ? `<td><input type="date" class="inline" value="${p.rechnungGeplant || ''}" data-action="p-date" data-key="rechnungGeplant" data-id="${p.id}" id="rg-${p.id}" aria-label="Rechnungsdatum"></td>` : ''}
        ${cols.includes('gestellt') ? `<td><input type="date" class="inline" value="${p.rechnungsdatum || ''}" data-action="p-date" data-key="rechnungsdatum" data-id="${p.id}" id="rd-${p.id}" aria-label="Rechnung gestellt am"></td>` : ''}
        ${cols.includes('bezahlt') ? `<td><input type="date" class="inline" value="${p.zahlungsdatum || ''}" data-action="p-date" data-key="zahlungsdatum" data-id="${p.id}" id="zd-${p.id}" aria-label="Zahlung erhalten am"></td>` : ''}
        <td>${statusPill(f.status)}</td>
        <td class="r">${cols.includes('btn-gestellt') ? `<button class="btn small" data-action="p-today" data-key="rechnungsdatum" data-id="${p.id}">Heute gestellt</button>` : ''}
          ${cols.includes('btn-bezahlt') ? `<button class="btn small" data-action="p-today" data-key="zahlungsdatum" data-id="${p.id}">Heute bezahlt</button>` : ''}</td>
      </tr>`;
    };
    const table = (list, cols, heads) => `<div class="table-flat"><table class="list"><thead><tr><th>Projekt</th><th class="r">Stunden</th><th class="r">Betrag</th>${heads.map((h) => `<th>${h}</th>`).join('')}<th>Status</th><th></th></tr></thead><tbody>${list.map((p) => row(p, cols)).join('')}</tbody></table></div>`;

    return `
    <header class="head"><h1>Rechnungen ${state.year}</h1></header>
    <div class="tiles">
      <div class="tile"><span>Noch zu stellen</span><b>${fmtCHF(sum(zuStellen))}</b><i>${zuStellen.length} Projekte mit erfassten Stunden</i></div>
      <div class="tile"><span>Gestellt, noch nicht bezahlt</span><b>${fmtCHF(sum(offen))}</b><i>${offen.length} Rechnungen${by.ueberfaellig.length ? `, davon ${by.ueberfaellig.length} überfällig` : ''}</i></div>
      <div class="tile"><span>Bezahlt</span><b>${fmtCHF(bezahlt.reduce((s, p) => s + ((p.abrechnung === 'ohne' ? figs(p).netto : figs(p).rechnungsbetrag) || 0), 0))}</b><i>${bezahlt.length} Zahlungen</i></div>
    </div>

    <section class="sec"><h2>Rechnung stellen <span class="dim">${zuStellen.length}</span></h2>
      ${zuStellen.length ? table(zuStellen, ['geplant', 'gestellt', 'btn-gestellt'], ['Rechnungsdatum', 'Gestellt am']) : '<div class="empty">Alles verrechnet, wofür Stunden erfasst sind.</div>'}
      ${by.geplant.length ? `<button class="link more" data-action="toggle-leere">${state.zeigeLeere ? 'Ausblenden' : `${by.geplant.length} weitere Projekte ohne erfasste Stunden zeigen`}</button>
        ${state.zeigeLeere ? table(by.geplant, ['geplant', 'gestellt'], ['Rechnungsdatum', 'Gestellt am']) : ''}` : ''}
    </section>

    <section class="sec"><h2>Warten auf Zahlung <span class="dim">${offen.length}</span></h2>
      ${offen.length ? table(offen, ['gestellt', 'bezahlt', 'btn-bezahlt'], ['Gestellt am', 'Bezahlt am']) : '<div class="empty">Keine offenen Rechnungen.</div>'}
    </section>

    ${by.pruefen.length ? `<section class="sec"><h2>Zahlung ohne Rechnung prüfen <span class="dim">${by.pruefen.length}</span></h2>
      ${table(by.pruefen, ['bezahlt', 'btn-bezahlt'], ['Bezahlt am'])}</section>` : ''}

    <section class="sec"><h2>Bezahlt <span class="dim">${bezahlt.length}</span></h2>
      ${bezahlt.length ? table(bezahlt, ['gestellt', 'bezahlt'], ['Gestellt am', 'Bezahlt am']) : '<div class="empty">Noch keine Zahlungen erfasst.</div>'}
    </section>`;
  }

  /* ============ Auswertung ============ */

  function lineChart(series, opts) {
    const W = 920, H = 300, L = 46, R = 74, T = 14, B = 26;
    const n = 366;
    let max = 0;
    for (const s of series) for (const v of s.values) if (v > max) max = v;
    const step = niceStep(max / 5);
    max = Math.ceil(max / step) * step || 1;
    const x = (i) => L + (i / (n - 1)) * (W - L - R);
    const y = (v) => T + (1 - v / max) * (H - T - B);
    let grid = '';
    for (let v = 0; v <= max + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="gl"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" class="ax" text-anchor="end">${fmtH(v)}</text>`;
    let months = '';
    for (let m = 0; m < 12; m++) {
      const i = C.dayOfYear(`${opts.year}-${pad(m + 1)}-01`);
      months += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${H - B}" y2="${H - B + 4}" class="tk"/><text x="${(x(i + 15)).toFixed(1)}" y="${H - 7}" class="ax" text-anchor="middle">${MONATE_KURZ[m]}</text>`;
    }
    const ends = [];
    const paths = series.map((s) => {
      if (!s.values.length) return '';
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      const last = s.values.length - 1;
      ends.push({ s, x: x(last), y: y(s.values[last]) });
      return `<path d="${d}" class="ln ${s.cls}"/>`;
    }).join('');
    // Endbeschriftungen entzerren
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    const labels = ends.map((e) => `<text x="${(e.x + 6).toFixed(1)}" y="${(e.y + 4).toFixed(1)}" class="el ${e.s.cls}">${esc(e.s.name)}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title)}">${grid}${months}${paths}${labels}</svg>`;
  }
  function niceStep(raw) {
    if (raw <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function viewAuswertung() {
    const y = state.year, s = S();
    const mo = C.monthly(state.data, y, heute);
    const tot = mo.reduce((a, m) => ({ eff: a.eff + m.effektiv, ist: a.ist + m.ist, soll: a.soll + (m.zukunft ? 0 : m.soll) }), { eff: 0, ist: 0, soll: 0 });
    const letzte = mo.filter((m) => !m.zukunft).pop();
    const bis = y === +heute.slice(0, 4) ? C.dayOfYear(heute) : null;

    const jahre = [y - 2, y - 1, y].map((yy) => ({ yy, d: C.dailyTotals(state.data, yy) })).filter((o) => o.d.quelle !== 'leer' || o.yy === y);
    const cls = (yy) => (yy === y ? 'cur' : yy === y - 1 ? 'prev1' : 'prev2');
    const kum = jahre.map((o) => ({ name: String(o.yy), cls: cls(o.yy), values: C.cumulative(o.d.values, s.stundenZuschlag, o.yy === y ? bis : null) }));
    const sollTag = (C.monthlyTarget(s) * 12) / 365;
    kum.push({ name: `Soll ${s.pensum}%`, cls: 'soll', values: Array.from({ length: 365 }, (_, i) => sollTag * (i + 1)) });
    const gl = jahre.map((o) => ({ name: String(o.yy), cls: cls(o.yy), values: C.movingAverage(o.d.values, s.stundenZuschlag, o.yy === y ? bis : null) }));

    const groups = new Map();
    for (const p of yearProjects()) {
      const f = figs(p);
      const g = groups.get(p.bereich) || { h: 0, teil: 0, teilStd: 0, hBetrag: 0, n: 0 };
      g.h += f.stundenEff; g.n++;
      if (C.isNum(f.meinTeil)) { g.teil += f.meinTeil; if (f.stundenEff > 0) { g.teilStd += f.meinTeil; g.hBetrag += f.stundenEff; } }
      groups.set(p.bereich, g);
    }
    const totalH = [...groups.values()].reduce((a, g) => a + g.h, 0) || 1;

    return `
    <header class="head"><h1>Auswertung ${y}</h1>
      <div class="bignum"><b class="${letzte && letzte.ueberzeit < 0 ? 'neg' : ''}">${letzte ? (letzte.ueberzeit > 0 ? '+' : '') + fmtH1(letzte.ueberzeit) : '–'}</b><span>Überzeit kumuliert</span></div>
    </header>
    <div class="aus">
      <section class="sec">
        <h2>Monate</h2>
        <table class="list months">
          <thead><tr><th>Monat</th><th class="r">Erfasst</th><th class="r" title="Erfasste Stunden × ${s.stundenZuschlag}">Ist mit Zuschlag</th><th class="r">Soll</th><th class="r">Differenz</th><th class="r">Überzeit kumuliert</th></tr></thead>
          <tbody>${mo.map((m) => `<tr class="${m.zukunft ? 'future' : ''}">
            <td>${MONATE[m.monat]}${m.laufend ? ' <span class="dim">laufend</span>' : ''}</td>
            <td class="r num">${fmtH(m.effektiv)}</td><td class="r num">${fmtH1(m.ist)}</td><td class="r num">${fmtH1(m.soll)}</td>
            <td class="r num ${m.zukunft ? '' : m.diff < 0 ? 'neg' : 'pos'}">${m.zukunft ? '' : (m.diff > 0 ? '+' : '') + fmtH1(m.diff)}</td>
            <td class="r num ${m.ueberzeit == null ? '' : m.ueberzeit < 0 ? 'neg' : 'pos'}">${m.ueberzeit == null ? '' : (m.ueberzeit > 0 ? '+' : '') + fmtH1(m.ueberzeit)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="r num">${fmtH(tot.eff)}</td><td class="r num">${fmtH1(tot.ist)}</td><td class="r num">${fmtH1(tot.soll)}</td><td class="r num">${(tot.ist - tot.soll > 0 ? '+' : '') + fmtH1(tot.ist - tot.soll)}</td><td></td></tr></tfoot>
        </table>
        <p class="hint">Soll pro Monat: (365 − 104 Wochenendtage − ${s.ferientage} Ferientage) ÷ 12 × ${s.stundenProTag} h × ${s.pensum}%. Der laufende Monat zählt mit dem vollen Soll.</p>
      </section>
      <section class="sec">
        <h2>Nach Bereich</h2>
        <table class="list">
          <thead><tr><th>Bereich</th><th class="r">Stunden</th><th class="r">Anteil</th></tr></thead>
          <tbody>${[...groups.entries()].map(([name, g]) => `<tr><td>${esc(name || 'Ohne Bereich')}</td><td class="r num">${fmtH(g.h)}</td>
            <td class="r num"><span class="bar"><i style="width:${((g.h / totalH) * 100).toFixed(1)}%"></i></span>${((g.h / totalH) * 100).toFixed(0)}%</td></tr>`).join('')}</tbody>
        </table>
      </section>
      <section class="sec wide">
        <h2>Kumulierte Stunden im Jahresvergleich</h2>
        ${lineChart(kum, { year: y, title: 'Kumulierte Stunden im Jahresvergleich' })}
        <p class="hint">Erfasste Stunden mit Zuschlag ${s.stundenZuschlag}, verglichen mit dem Soll bei ${s.pensum}%.</p>
      </section>
      <section class="sec wide">
        <h2>Stunden pro Arbeitstag, Schnitt über 7 Tage</h2>
        ${lineChart(gl, { year: y, title: 'Stunden pro Arbeitstag im 7-Tage-Schnitt' })}
        <p class="hint">Gleitender Schnitt der letzten 7 Tage, hochgerechnet auf 5 Arbeitstage, mit Zuschlag ${s.stundenZuschlag}.</p>
      </section>
    </div>`;
  }

  /* ============ Einstellungen ============ */

  function viewEinstellungen() {
    const s = S();
    const num = (key, label, hint, step) => `<div class="fld"><label for="s-${key}">${label}</label>
      <input id="s-${key}" type="number" step="${step || 'any'}" value="${s[key]}" data-action="setting" data-key="${key}"><small>${hint}</small></div>`;
    return `
    <header class="head"><h1>Einstellungen</h1></header>
    <div class="settings">
      <section class="sec"><h2>Rechengrössen</h2>
        <div class="cols2">
          ${num('mwstSatz', 'Mehrwertsteuersatz in %', 'Wird auf den offerierten Betrag geschlagen oder herausgerechnet.', '0.1')}
          ${num('lohnFaktor', 'Anpassungsfaktor Franken pro Stunde', 'CHF/h = Mein Teil ÷ Stunden × Faktor.', '0.01')}
          ${num('stundenZuschlag', 'Zuschlag auf erfasste Stunden', 'Faktor für «Ist mit Zuschlag» in der Monatsbilanz.', '0.01')}
          ${num('zahlungsfrist', 'Zahlungsfrist in Tagen', 'Danach gilt eine gestellte Rechnung als überfällig.', '1')}
        </div>
      </section>
      <section class="sec"><h2>Monatliches Soll</h2>
        <div class="cols3">
          ${num('pensum', 'Pensum in %', '', '5')}
          ${num('stundenProTag', 'Stunden pro Tag bei 100%', '', '0.25')}
          ${num('ferientage', 'Ferientage pro Jahr', '', '1')}
        </div>
        <p class="hint">Ergibt ein Soll von ${fmtH1(C.monthlyTarget(s))} Stunden pro Monat.</p>
      </section>
      <section class="sec"><h2>Daten</h2>
        <p>Gespeichert in <code>${esc(state.info.dataPath)}</code>. Jede Änderung wird sofort gesichert; im Unterordner «Sicherungen» liegt pro Tag eine Kopie des Vortagsstands.</p>
        <div class="row">
          <button class="btn" data-action="open-folder">Ordner öffnen</button>
          <button class="btn" data-action="choose-folder">Speicherort ändern</button>
          <button class="btn" data-action="export">Daten exportieren</button>
          <button class="btn" data-action="import">Daten importieren</button>
        </div>
        <p class="hint">${state.data.projects.length} Projekte, ${state.data.entries.length} Einträge. Version ${esc(state.info.version)}.</p>
      </section>
    </div>`;
  }

  /* ============ Aktionen ============ */

  function setDate(iso) {
    state.date = iso; state.calMonth = iso.slice(0, 7); state.year = +iso.slice(0, 4);
    state.combo = { q: '', projectId: null, open: false, idx: 0 };
  }

  function addEntry() {
    const std = C.parseHours(state.form.stunden);
    if (!state.combo.projectId) { toast('Wähle zuerst ein Projekt.', { fehler: true }); $('#combo-input').focus(); return; }
    if (std == null || std <= 0 || std > 24) { toast('Gib die Stunden als Zahl ein, zum Beispiel 1.5 oder 1:30.', { fehler: true }); $('#f-stunden').focus(); return; }
    state.data.entries.push({ id: uid('e'), datum: state.date, projectId: state.combo.projectId, stunden: Math.round(std * 100) / 100, notiz: state.form.notiz.trim() });
    state.combo = { q: '', projectId: null, open: false, idx: 0 };
    state.form = { stunden: '', notiz: '' };
    persist(); render();
    $('#combo-input').focus();
  }

  function pickCombo(id) {
    state.combo.projectId = id; state.combo.open = false; state.combo.q = '';
    render();
    $('#f-stunden').focus();
  }

  async function doImport() {
    const r = await api.importFile();
    if (!r || r.canceled) return;
    if (r.error) { toast(r.error, { fehler: true }); return; }
    let neu;
    try { neu = normalize(r.data); } catch (e) { toast(e.message, { fehler: true }); return; }
    if (state.data && (state.data.projects.length || state.data.entries.length)) {
      if (!confirm(`Der Import ersetzt alle vorhandenen Daten (${state.data.projects.length} Projekte, ${state.data.entries.length} Einträge) durch ${neu.projects.length} Projekte und ${neu.entries.length} Einträge aus der Datei. Der bisherige Stand wird vorher gesichert. Fortfahren?`)) return;
      await api.save(state.data, { sicherungErzwingen: true });
    }
    state.data = neu; state.fehler = null;
    await persist();
    render();
    toast(`${neu.projects.length} Projekte und ${neu.entries.length} Einträge importiert`);
  }

  document.addEventListener('click', async (ev) => {
    if (state.combo.open && ev.detail !== 0 && !ev.target.closest('.combo')) {
      state.combo.open = false;
      const box = $('#combo-list'); if (box) box.classList.remove('open');
    }
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    switch (a) {
      case 'nav': state.view = el.dataset.view; state.drawer = null; render(); if (state.view === 'erfassen') $('#combo-input').focus(); break;
      case 'day': setDate(addDays(state.date, +el.dataset.step)); render(); break;
      case 'today': setDate(heute); render(); break;
      case 'pick-day': setDate(el.dataset.date); render(); break;
      case 'cal': { const [y, m] = state.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + (+el.dataset.step), 1); state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); break; }
      case 'combo-pick': pickCombo(el.dataset.id); break;
      case 'combo-input': if (!state.combo.open) { state.combo.open = true; if (state.combo.projectId) { state.combo.projectId = null; state.combo.q = ''; } render(); $('#combo-input').select(); } break;
      case 'entry-del': {
        const i = state.data.entries.findIndex((e) => e.id === el.dataset.id);
        if (i < 0) break;
        const [weg] = state.data.entries.splice(i, 1);
        persist(); render();
        toast('Eintrag gelöscht', { actionLabel: 'Rückgängig', action: () => { state.data.entries.splice(i, 0, weg); persist(); render(); } });
        break;
      }
      case 'toast-action': if (toastAction) { const f = toastAction; toastAction = null; $('#toast').className = ''; f(); } break;
      case 'toggle-group': if (state.zu.has(el.dataset.group)) state.zu.delete(el.dataset.group); else state.zu.add(el.dataset.group); render(); break;
      case 'open-project': openDrawer(projById(el.dataset.id)); break;
      case 'new-project': openDrawer(newProject()); break;
      case 'drawer-close': state.drawer = null; render(); break;
      case 'd-seg': {
        const k = el.dataset.key; let v = el.dataset.val;
        if (k === 'effort') v = +v;
        state.drawer.draft[k] = v; render(); break;
      }
      case 'project-dup': {
        const src = drawerDraft();
        const kopie = Object.assign({}, src, { id: null, sort: src.sort + 0.5, name: src.name + ' (Kopie)', rechnungGeplant: null, rechnungsdatum: null, zahlungsdatum: null });
        openDrawer(kopie); toast('Kopie geöffnet. Sie wird erst mit «Projekt anlegen» gespeichert.'); break;
      }
      case 'project-delete': {
        const id = state.drawer.id, p = projById(id);
        const n = state.data.entries.filter((e) => e.projectId === id).length;
        if (!confirm(n ? `«${projLabel(p)}» mit ${n} Zeiteinträgen (${fmtH(hrs.get(id) || 0)} Stunden) endgültig löschen? Wenn du die Stunden behalten willst, archiviere das Projekt stattdessen.` : `«${projLabel(p)}» löschen?`)) break;
        state.data.projects = state.data.projects.filter((x) => x.id !== id);
        state.data.entries = state.data.entries.filter((e) => e.projectId !== id);
        state.drawer = null; persist(); render(); toast('Projekt gelöscht'); break;
      }
      case 'p-today': { const p = projById(el.dataset.id); p[el.dataset.key] = heute; persist(); render(); toast(el.dataset.key === 'zahlungsdatum' ? 'Zahlung eingetragen' : 'Rechnungsdatum eingetragen'); break; }
      case 'toggle-leere': state.zeigeLeere = !state.zeigeLeere; render(); break;
      case 'import': await doImport(); break;
      case 'start-empty': state.data = C.emptyData(); await persist(); render(); break;
      case 'export': { const r = await api.exportFile(state.data); if (r && r.path) toast('Exportiert nach ' + r.path); break; }
      case 'export-csv': { const r = await api.exportCsv(`Projekte-${state.year}.csv`, projectsCsv()); if (r && r.path) toast('Exportiert nach ' + r.path); break; }
      case 'open-folder': api.openFolder(); break;
      case 'choose-folder': {
        const r = await api.chooseFolder();
        if (!r || r.canceled) break;
        if (r.vorhanden) { const l = await api.load(); if (l.data) state.data = normalize(l.data); recompute(); }
        else await persist();
        state.info = await api.info(); render();
        toast(r.vorhanden ? 'Vorhandene Daten am neuen Speicherort geladen' : 'Speicherort geändert');
        break;
      }
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target, a = el.dataset && el.dataset.action;
    if (!a) return;
    if (a === 'combo-input') {
      state.combo.q = el.value; state.combo.projectId = null; state.combo.open = true; state.combo.idx = 0;
      const list = $('#combo-list'); list.classList.add('open'); list.innerHTML = comboListHtml();
    } else if (a === 'form-stunden') state.form.stunden = el.value;
    else if (a === 'form-notiz') state.form.notiz = el.value;
    else if (a === 'filter-q') { state.filter.q = el.value; render(); }
    else if (a === 'd-field') state.drawer.draft[el.dataset.key] = el.value;
    else if (a === 'd-txt') { state.drawer.txt[el.dataset.key] = el.value; $('#drawer-calc').innerHTML = drawerCalcHtml(); }
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target, a = el.dataset && el.dataset.action;
    if (!a) return;
    if (a === 'year') { state.year = +el.value; if (+state.date.slice(0, 4) !== state.year) { state.date = state.year === +heute.slice(0, 4) ? heute : `${state.year}-01-01`; state.calMonth = state.date.slice(0, 7); } render(); }
    else if (a === 'filter-status') { state.filter.status = el.value; render(); }
    else if (a === 'filter-archiv') { state.filter.archiv = el.checked; render(); }
    else if (a === 'd-check') state.drawer.draft[el.dataset.key] = el.checked;
    else if (a === 'entry-hours') {
      const e = state.data.entries.find((x) => x.id === el.dataset.id), v = C.parseHours(el.value);
      if (v == null || v <= 0 || v > 24) { toast('Gib die Stunden als Zahl ein, zum Beispiel 1.5 oder 1:30.', { fehler: true }); render(); return; }
      e.stunden = Math.round(v * 100) / 100; persist(); render();
    } else if (a === 'entry-note') { const e = state.data.entries.find((x) => x.id === el.dataset.id); e.notiz = el.value.trim(); persist(); }
    else if (a === 'p-date') { const p = projById(el.dataset.id); p[el.dataset.key] = el.value || null; persist(); render(); }
    else if (a === 'setting') {
      const v = parseFloat(el.value);
      if (!isFinite(v) || v < 0) { toast('Bitte eine Zahl eingeben.', { fehler: true }); render(); return; }
      state.data.settings[el.dataset.key] = v; persist(); render();
    }
  });

  document.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const a = ev.target.dataset.action;
    if (a === 'add-entry') {
      if (!state.combo.projectId && (state.combo.open || state.combo.q.trim())) { const l = comboMatches(); if (l.length) { pickCombo(l[Math.min(state.combo.idx, l.length - 1)].p.id); return; } }
      addEntry();
    } else if (a === 'drawer-save') saveDrawer();
  });

  document.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (el.id === 'combo-input') {
      const list = state.combo.open ? comboMatches() : [];
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!state.combo.open) { state.combo.open = true; state.combo.projectId = null; }
        else state.combo.idx = Math.max(0, Math.min(list.length - 1, state.combo.idx + (ev.key === 'ArrowDown' ? 1 : -1)));
        const box = $('#combo-list'); box.classList.add('open'); box.innerHTML = comboListHtml();
        const on = $('.combo-item.on', box); if (on) on.scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Escape' && state.combo.open) { state.combo.open = false; render(); }
      else if (ev.key === 'Tab' && state.combo.open && !state.combo.projectId && state.combo.q && list.length) { ev.preventDefault(); pickCombo(list[state.combo.idx].p.id); }
      return;
    }
    if (ev.key === 'Escape' && state.drawer) { state.drawer = null; render(); return; }
    if (ev.key === 'Enter' && el.classList && el.classList.contains('prow')) { openDrawer(projById(el.dataset.id)); }
  });

  /* ============ Start ============ */

  async function start() {
    render();
    try {
      state.info = await api.info();
      const r = await api.load();
      if (r.error) state.fehler = r.error;
      if (r.data) { state.data = normalize(r.data); recompute(); }
    } catch (e) {
      state.fehler = 'Die Daten konnten nicht geladen werden: ' + e.message;
    }
    state.geladen = true;
    render();
    const ci = $('#combo-input'); if (ci) ci.focus();
  }

  window.__zeit = { state, render };
  start();
})();
