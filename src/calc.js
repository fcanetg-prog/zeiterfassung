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
    return { version: 1, settings: Object.assign({}, DEFAULTS), projects: [], entries: [], history: {} };
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
    if (p.rechnungGeplant && heute && p.rechnungGeplant <= heute) return { code: 'faellig', label: 'Rechnung stellen' };
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

  return {
    DEFAULTS, settings, emptyData, hoursByProject, projectFigures, status, daysBetween,
    dailyTotals, daysInYear, dayOfYear, isoFromDayOfYear, monthlyTarget, monthly,
    cumulative, movingAverage, parseHours, parseAmount, round2, isNum,
  };
});
