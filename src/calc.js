/* Rechenlogik der Zeiterfassung. Läuft im Fenster (window.Calc) und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    mwstSatz: 8.1,        // Prozent
    lohnFaktor: 0.65,     // Anpassung Franken pro Stunde
    stundenZuschlag: 1.1, // Zuschlag auf erfasste Stunden in der Monatsbilanz
    pensum: 80,           // Prozent
    stundenProTag: 8.5,
    ferientage: 25,
    zahlungsfrist: 30,
  };

  const round2 = (x) => Math.round(x * 100 + 1e-6) / 100;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  function settings(data) {
    return Object.assign({}, DEFAULTS, (data && data.settings) || {});
  }

  function emptyData() {
    return { version: 1, settings: Object.assign({}, DEFAULTS), projects: [], entries: [], history: {}, buchungen: [], kontenplaene: {} };
  }

  /** Stunden pro Projekt: Map projectId -> Summe */
  function hoursByProject(entries) {
    const m = new Map();
    for (const e of entries) m.set(e.projectId, (m.get(e.projectId) || 0) + (e.stunden || 0));
    return m;
  }

  /** Alle Kennzahlen eines Projekts (entspricht den Kopfzeilen im Excel). */
  function projectFigures(p, stundenEff, s, heute) {
    const satz = (s.mwstSatz || 0) / 100;
    const hat = isNum(p.betrag);
    const netto = !hat ? null : p.mwst === 'inkl' ? p.betrag / (1 + satz) : p.betrag;
    const kosten = isNum(p.kosten) ? p.kosten : 0;
    const meinTeil = hat ? netto - kosten : null;
    const mwstBetrag = !hat ? null : p.mwst === 'keine' ? 0 : round2(netto * satz);
    const rechnungsbetrag = !hat ? null
      : p.mwst === 'drauf' ? round2(round2(p.betrag) + mwstBetrag)
      : round2(p.betrag);
    const eff = stundenEff || 0;
    const lohnZiel = hat && isNum(p.stundenZiel) && p.stundenZiel > 0 ? (meinTeil / p.stundenZiel) * s.lohnFaktor : null;
    const lohnEff = hat && eff > 0 ? (meinTeil / eff) * s.lohnFaktor : null;
    return {
      netto, kosten, meinTeil, mwstBetrag, rechnungsbetrag,
      stundenEff: eff, lohnZiel, lohnEff,
      status: status(p, eff, s, heute),
    };
  }

  /** Abrechnungsstatus eines Projekts. */
  function status(p, stundenEff, s, heute) {
    if (p.abrechnung === 'intern') return { code: 'intern', label: 'keine Abrechnung' };
    if (p.zahlungsdatum) return { code: 'bezahlt', label: 'bezahlt' };
    if (p.abrechnung === 'ohne') return { code: 'pruefen', label: 'Zahlung prüfen' };
    if (p.rechnungsdatum) {
      const tage = heute ? daysBetween(p.rechnungsdatum, heute) : 0;
      if (tage > (s.zahlungsfrist || 30)) return { code: 'ueberfaellig', label: 'überfällig', tage };
      return { code: 'gestellt', label: 'Rechnung gestellt', tage };
    }
    if (p.rechnungGeplant && heute && p.rechnungGeplant <= heute) return { code: 'faellig', label: 'Rechnung stellen', tage: daysBetween(p.rechnungGeplant, heute) };
    if (stundenEff > 0) return { code: 'offen', label: 'noch nicht verrechnet' };
    return { code: 'geplant', label: 'noch nicht begonnen' };
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  /** Tagessummen eines Jahres: Array mit einem Wert pro Kalendertag. Greift auf Vorjahresdaten zurück, wenn keine Einträge vorhanden sind. */
  function dailyTotals(data, year) {
    const n = daysInYear(year);
    const arr = new Array(n).fill(0);
    let any = false;
    const pre = year + '-';
    for (const e of data.entries) {
      if (e.datum.startsWith(pre)) { arr[dayOfYear(e.datum)] += e.stunden || 0; any = true; }
    }
    if (!any && data.history && data.history[year]) {
      const h = data.history[year];
      for (let i = 0; i < n; i++) arr[i] = h[Math.min(i, h.length - 1)] || 0;
      if (h.length < n) arr[n - 1] = 0;
      return { values: arr, quelle: 'historie' };
    }
    return { values: arr, quelle: any ? 'eintraege' : 'leer' };
  }

  function daysInYear(y) { return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365; }
  function dayOfYear(iso) {
    const y = +iso.slice(0, 4);
    return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(y, 0, 1)) / 86400000);
  }
  function isoFromDayOfYear(y, i) { return new Date(Date.UTC(y, 0, 1 + i)).toISOString().slice(0, 10); }

  /** Monatliches Soll gemäss Excel: ((365 - 2*52 - Ferientage) / 12) * Stunden pro Tag * Pensum */
  function monthlyTarget(s) {
    return ((365 - 2 * 52 - s.ferientage) / 12) * s.stundenProTag * (s.pensum / 100);
  }

  /** Monatsbilanz: effektive Stunden, Ist (mit Zuschlag), Soll, Differenz, kumulierte Überzeit. */
  function monthly(data, year, heute) {
    const s = settings(data);
    const soll = monthlyTarget(s);
    const eff = new Array(12).fill(0);
    const pre = year + '-';
    for (const e of data.entries) if (e.datum.startsWith(pre)) eff[+e.datum.slice(5, 7) - 1] += e.stunden || 0;
    const aktMonat = heute && heute.startsWith(pre) ? +heute.slice(5, 7) - 1 : (heute && heute.slice(0, 4) > String(year) ? 11 : -1);
    let kum = 0;
    return eff.map((h, m) => {
      const ist = h * s.stundenZuschlag;
      const zukunft = m > aktMonat;
      if (!zukunft) kum += ist - soll;
      return { monat: m, effektiv: h, ist, soll, diff: ist - soll, ueberzeit: zukunft ? null : kum, zukunft, laufend: m === aktMonat };
    });
  }

  /** Kumulierte Stunden (mit Zuschlag) pro Tag. */
  function cumulative(values, zuschlag, bis) {
    const out = []; let k = 0;
    const n = bis == null ? values.length : Math.min(values.length, bis + 1);
    for (let i = 0; i < n; i++) { k += values[i] * zuschlag; out.push(k); }
    return out;
  }

  /** Gleitender 7-Tage-Schnitt, hochgerechnet auf Arbeitstage (x 7/5), mit Zuschlag. */
  function movingAverage(values, zuschlag, bis) {
    const out = [];
    const n = bis == null ? values.length : Math.min(values.length, bis + 1);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) sum += values[j];
      out.push(zuschlag * (sum / 7) * 7 / 5);
    }
    return out;
  }

  /** Stunden als Zahl aus «1.5», «1,5», «1:30» oder «90m». */
  function parseHours(txt) {
    if (txt == null) return null;
    const t = String(txt).trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    let m;
    if ((m = t.match(/^(\d{1,2}):(\d{1,2})$/))) return +m[1] + (+m[2]) / 60;
    if ((m = t.match(/^(\d+)(m|min)$/))) return +m[1] / 60;
    if ((m = t.match(/^(\d+(?:[.,]\d+)?)(h|std)?$/))) return parseFloat(m[1].replace(',', '.'));
    if ((m = t.match(/^[.,]\d+$/))) return parseFloat(t.replace(',', '.'));
    return null;
  }

  /** Geldbetrag aus «3'820.00», «3’820», «3820,5». Erlaubt auch einfache Summen wie «3390+430». */
  function parseAmount(txt) {
    if (txt == null) return null;
    let t = String(txt).trim().replace(/[’'`\s]/g, '').replace(/chf/ig, '');
    if (!t) return null;
    if (/^[\d.,]+([+\-][\d.,]+)+$/.test(t)) {
      let sum = 0;
      for (const part of t.match(/[+\-]?[\d.,]+/g)) {
        const v = parseFloat(part.replace(',', '.'));
        if (!isFinite(v)) return null;
        sum += v;
      }
      return sum;
    }
    if (!/^-?[\d]+([.,]\d+)?$/.test(t)) return null;
    return parseFloat(t.replace(',', '.'));
  }

  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  /** «2026-09-18» -> «18. September 2026» */
  function dateLong(iso) {
    if (!iso) return '';
    return `${+iso.slice(8, 10)}. ${MONATE[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
  }

  /** Einleitungssatz der Rechnung, je nachdem, worauf sie sich stützt. */
  function invoiceIntro(p) {
    const teile = [];
    if (p.offerteVom) teile.push(`meiner Offerte vom ${dateLong(p.offerteVom)}`);
    if (p.emailVom) teile.push(`unseres E-Mail-Austauschs vom ${dateLong(p.emailVom)}`);
    const basis = teile.length ? teile.join(' und ') : 'unserer Vereinbarungen';
    return `Auf Basis ${basis} stelle ich hiermit folgende Arbeiten in Rechnung.`;
  }

  /** Positionen aus dem Textfeld: eine pro Zeile, Betrag optional nach dem letzten Strichpunkt. */
  function parsePositions(txt) {
    const out = [];
    for (const raw of String(txt || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const i = line.lastIndexOf(';');
      if (i >= 0) {
        const betrag = parseAmount(line.slice(i + 1));
        if (betrag != null) { out.push({ text: line.slice(0, i).trim(), betrag }); continue; }
      }
      out.push({ text: line, betrag: null });
    }
    return out;
  }

  /**
   * Alles, was auf der Rechnung steht. Gibt { fehler: [...] } zurück, wenn etwas fehlt oder nicht aufgeht.
   * Die Beträge der Positionen verstehen sich wie der offerierte Betrag (ohne MwSt., ausser bei «im Betrag enthalten»).
   */
  function invoiceModel(p, s, heute) {
    const fehler = [];
    const f = projectFigures(p, 0, s, heute);
    if (p.abrechnung !== 'rechnung') fehler.push('Für dieses Projekt ist keine Rechnung vorgesehen.');
    if (!isNum(p.betrag) || p.betrag <= 0) fehler.push('Der offerierte Betrag fehlt.');
    if (!String(p.rechnungsadresse || '').trim()) fehler.push('Die Rechnungsadresse fehlt.');
    if (fehler.length) return { fehler };

    let pos = parsePositions(p.rechnungstext);
    if (!pos.length) pos = [{ text: [p.kunde, p.name].filter(Boolean).join(' – '), betrag: null }];
    if (pos.length === 1 && pos[0].betrag == null) pos[0].betrag = p.betrag;
    if (pos.some((x) => x.betrag == null)) fehler.push('Bei mehreren Rechnungspositionen braucht jede Zeile einen Betrag nach einem Strichpunkt, zum Beispiel «Moderation; 3390».');
    else {
      const summe = round2(pos.reduce((a, x) => a + x.betrag, 0));
      if (Math.abs(summe - round2(p.betrag)) > 0.005) fehler.push(`Die Rechnungspositionen ergeben ${summe.toFixed(2)}, der offerierte Betrag ist ${round2(p.betrag).toFixed(2)}.`);
    }
    if (fehler.length) return { fehler };

    const total = f.rechnungsbetrag;
    const mwst = p.mwst === 'keine' ? 0 : f.mwstBetrag;
    const zwischentotal = round2(total - mwst);
    let positionen = pos.map((x) => ({ text: x.text, betrag: round2(x.betrag) }));
    if (p.mwst === 'inkl') {
      // Positionen sind inklusive MwSt. erfasst: anteilig auf netto umrechnen, die letzte gleicht Rundungen aus.
      const faktor = zwischentotal / total;
      let rest = zwischentotal;
      positionen = positionen.map((x, i) => {
        const netto = i === positionen.length - 1 ? round2(rest) : round2(x.betrag * faktor);
        rest -= netto;
        return { text: x.text, betrag: netto };
      });
    }
    const datum = p.rechnungGeplant || heute;
    return {
      fehler: [],
      datum, datumLang: dateLong(datum),
      empfaenger: String(p.rechnungsadresse).split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      referenz: String(p.referenz || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      einleitung: invoiceIntro(p),
      positionen, zwischentotal, mwst, mwstSatz: s.mwstSatz, mitMwst: p.mwst !== 'keine', total,
      zahlungsfrist: s.zahlungsfrist || 30,
      email: p.rechnungsEmail || '',
    };
  }

  /* ---------- Sammelrechnungen ---------- */

  const zeilen = (t) => String(t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  /** Projekte desselben Bereichs mit gleichem Rechnungsdatum, gleicher Rechnungsadresse und gleicher E-Mail kommen auf eine Rechnung. */
  function groupKey(p) {
    if (p.abrechnung !== 'rechnung' || !p.rechnungGeplant) return null;
    const adr = zeilen(p.rechnungsadresse).join('\n');
    if (!adr) return null;
    return [p.rechnungGeplant, adr.toLowerCase(), String(p.rechnungsEmail || '').trim().toLowerCase(), p.jahr, String(p.bereich || '').trim().toLowerCase()].join('|');
  }

  /** Alle Projekte, die mit p auf derselben Rechnung stehen (p eingeschlossen), in Listenreihenfolge. */
  function invoiceGroup(p, projects) {
    let m;
    if (p.rechnungGruppe) m = projects.filter((x) => x.rechnungGruppe === p.rechnungGruppe);
    else if (!p.rechnungsdatum && groupKey(p)) {
      const k = groupKey(p);
      m = projects.filter((x) => !x.rechnungsdatum && !x.rechnungGruppe && groupKey(x) === k);
    } else m = [p];
    if (!m.includes(p)) m.push(p);
    return m.slice().sort((a, b) => a.sort - b.sort);
  }

  /** Rechnung für eine Gruppe von Projekten. Bei einem einzelnen Projekt identisch mit invoiceModel. */
  function invoiceModelGroup(members, s, heute) {
    const einzel = members.map((p) => invoiceModel(p, s, heute));
    const label = (p) => [p.kunde, p.name].filter(Boolean).join(' – ');
    const projekte = members.map((p) => ({ id: p.id, kunde: p.kunde, name: p.name }));
    if (members.length === 1) return Object.assign({ projekte }, einzel[0]);

    const fehler = [];
    einzel.forEach((m, i) => m.fehler.forEach((f) => fehler.push(`${label(members[i])}: ${f}`)));
    if (new Set(members.map((p) => p.mwst === 'keine')).size > 1) fehler.push('Projekte mit und ohne Mehrwertsteuer können nicht auf derselben Rechnung stehen. Gib einem davon ein anderes Rechnungsdatum.');
    if (fehler.length) return { fehler, projekte };

    const positionen = [].concat(...einzel.map((m) => m.positionen));
    const zwischentotal = round2(positionen.reduce((a, x) => a + x.betrag, 0));
    const mitMwst = einzel[0].mitMwst;
    const mwst = mitMwst ? round2(zwischentotal * s.mwstSatz / 100) : 0;
    const einleitungen = new Set(einzel.map((m) => m.einleitung));
    const referenz = [];
    for (const m of einzel) for (const l of m.referenz) if (!referenz.includes(l)) referenz.push(l);
    return Object.assign({}, einzel[0], {
      fehler: [], projekte, positionen, zwischentotal, mwst, mitMwst, total: round2(zwischentotal + mwst), referenz,
      einleitung: einleitungen.size === 1 ? einzel[0].einleitung : invoiceIntro({}),
    });
  }

  /* ---------- Zusammenführen zweier Datenstände (Synchronisation zwischen Rechnern) ---------- */

  /**
   * Führt zwei Stände zusammen. Pro Projekt und pro Zeiteintrag gewinnt die jüngere Änderung («mod»).
   * Gelöschtes bleibt gelöscht, solange es danach nicht wieder geändert wurde.
   */
  function mergeData(a, b) {
    if (!a) return b;
    if (!b) return a;
    const geloescht = Object.assign({}, a.geloescht || {});
    for (const [id, t] of Object.entries(b.geloescht || {})) if (!(geloescht[id] >= t)) geloescht[id] = t;
    const mergeList = (x, y) => {
      const map = new Map();
      for (const r of x || []) map.set(r.id, r);
      for (const r of y || []) {
        const v = map.get(r.id);
        if (!v || (r.mod || 0) > (v.mod || 0)) map.set(r.id, r);
      }
      return [...map.values()].filter((r) => !(geloescht[r.id] >= (r.mod || 0)));
    };
    const projects = mergeList(a.projects, b.projects);
    const ids = new Set(projects.map((p) => p.id));
    const entries = mergeList(a.entries, b.entries).filter((e) => ids.has(e.projectId))
      .sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : x.id < y.id ? -1 : 1));
    projects.sort((x, y) => (x.jahr - y.jahr) || (x.sort - y.sort) || (x.id < y.id ? -1 : 1));
    const neuer = (b.settingsMod || 0) > (a.settingsMod || 0) ? b : a;
    // Buchhaltung: Buchungen einzeln zusammenführen, Kontenplan pro Jahr als Ganzes (jüngere Fassung gewinnt).
    const buchungen = mergeList(a.buchungen, b.buchungen)
      .sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : (x.pos || 0) - (y.pos || 0)));
    const kontenplaene = {};
    for (const quelle of [a.kontenplaene || {}, b.kontenplaene || {}]) {
      for (const [jahr, plan] of Object.entries(quelle)) {
        if (!kontenplaene[jahr] || (plan.mod || 0) > (kontenplaene[jahr].mod || 0)) kontenplaene[jahr] = plan;
      }
    }
    return {
      version: 1,
      settings: neuer.settings || a.settings || b.settings,
      settingsMod: neuer.settingsMod || 0,
      projects, entries, geloescht, buchungen, kontenplaene,
      history: Object.assign({}, b.history || {}, a.history || {}),
    };
  }

  return {
    groupKey, invoiceGroup, invoiceModelGroup, mergeData,
    dateLong, invoiceIntro, parsePositions, invoiceModel,
    DEFAULTS, settings, emptyData, hoursByProject, projectFigures, status, daysBetween,
    dailyTotals, daysInYear, dayOfYear, isoFromDayOfYear, monthlyTarget, monthly,
    cumulative, movingAverage, parseHours, parseAmount, round2, isNum,
  };
});
