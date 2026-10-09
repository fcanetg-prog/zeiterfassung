/* Rechenlogik der doppelten Buchhaltung. Läuft im Fenster (window.Ledger) und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ledger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round2 = (x) => Math.round(x * 100 + (x < 0 ? -1e-6 : 1e-6)) / 100;

  /** Buchungen in Journal-Reihenfolge: nach Datum, innerhalb des Tages in der Reihenfolge der Erfassung. */
  function sortiert(buchungen) {
    return buchungen.slice().sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.pos || 0) - (b.pos || 0)));
  }

  /** Soll, Haben und Saldo (Soll minus Haben) pro Konto. */
  function saldi(buchungen) {
    const m = new Map();
    const get = (k) => { if (!m.has(k)) m.set(k, { soll: 0, haben: 0, saldo: 0, anzahl: 0 }); return m.get(k); };
    for (const b of buchungen) {
      const s = get(b.soll), h = get(b.haben);
      s.soll += b.betrag; s.anzahl++;
      h.haben += b.betrag; h.anzahl++;
    }
    for (const v of m.values()) { v.soll = round2(v.soll); v.haben = round2(v.haben); v.saldo = round2(v.soll - v.haben); }
    return m;
  }

  /**
   * Saldi aller Konten und Gruppen des Kontenplans. Jede Zeile summiert in die Gruppe «summe_in»,
   * Gruppen wiederum in ihre Obergruppe (so fliesst der Jahresgewinn E7 über 29A in die Passiven).
   */
  function auswertung(zeilen, buchungen) {
    const sal = saldi(buchungen);
    const elternVon = new Map();
    for (const z of zeilen) if (z.gruppe) elternVon.set(z.gruppe, z.summe_in || '');
    const gruppe = new Map();
    const add = (g, v) => {
      const gesehen = new Set();
      while (g && !gesehen.has(g)) {
        gesehen.add(g);
        gruppe.set(g, (gruppe.get(g) || 0) + v);
        g = elternVon.get(g);
      }
    };
    for (const z of zeilen) if (z.konto) add(z.summe_in, sal.has(z.konto) ? sal.get(z.konto).saldo : 0);
    for (const [g, v] of gruppe) gruppe.set(g, round2(v));
    const saldoVon = (z) => (z.konto ? (sal.has(z.konto) ? sal.get(z.konto).saldo : 0) : z.gruppe ? (gruppe.get(z.gruppe) || 0) : null);
    return { konto: sal, gruppe, saldoVon };
  }

  /** Totalsummen nach Bilanzklasse wie in Banana: 1 Aktiven, 2 Passiven, 3 Aufwand, 4 Ertrag. */
  function totalsummen(zeilen, buchungen) {
    const sal = saldi(buchungen);
    const t = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const z of zeilen) if (z.konto && t[z.bklasse] != null && sal.has(z.konto)) t[z.bklasse] += sal.get(z.konto).saldo;
    for (const k of Object.keys(t)) t[k] = round2(t[k]);
    return { aktiven: t[1], passiven: t[2], bilanz: round2(t[1] + t[2]), aufwand: t[3], ertrag: t[4], erfolg: round2(t[3] + t[4]), differenz: round2(t[1] + t[2] + t[3] + t[4]) };
  }

  /** Bewegungen eines Kontos mit laufendem Saldo. */
  function kontoauszug(konto, buchungen) {
    let saldo = 0, soll = 0, haben = 0;
    const zeilen = [];
    for (const b of sortiert(buchungen)) {
      if (b.soll !== konto && b.haben !== konto) continue;
      const istSoll = b.soll === konto;
      // Soll und Haben auf demselben Konto heben sich auf, erscheinen aber als zwei Bewegungen.
      const teile = b.soll === b.haben ? [true, false] : [istSoll];
      for (const s of teile) {
        if (s) { saldo += b.betrag; soll += b.betrag; } else { saldo -= b.betrag; haben += b.betrag; }
        zeilen.push({ id: b.id, datum: b.datum, beleg: b.beleg, text: b.text, gegenkonto: s ? b.haben : b.soll, soll: s ? b.betrag : null, haben: s ? null : b.betrag, saldo: round2(saldo) });
      }
    }
    return { zeilen, soll: round2(soll), haben: round2(haben), saldo: round2(saldo) };
  }

  /**
   * Eröffnungsbuchungen für das Folgejahr: jedes Bilanzkonto mit Saldo wird gegen das Vortragskonto eröffnet.
   * Das Vortragskonto erhält damit von selbst seinen alten Saldo plus den Jahreserfolg.
   */
  function eroeffnung(zeilen, buchungenVorjahr, jahr, vortragKonto) {
    const sal = saldi(buchungenVorjahr);
    const out = [];
    let pos = 0;
    for (const z of zeilen) {
      if (!z.konto || z.konto === vortragKonto || (z.bklasse !== '1' && z.bklasse !== '2')) continue;
      const s = sal.has(z.konto) ? sal.get(z.konto).saldo : 0;
      if (!s) continue;
      out.push({ jahr, datum: `${jahr}-01-01`, beleg: '1', text: `Eröffnung: ${z.text}`, soll: s > 0 ? z.konto : vortragKonto, haben: s > 0 ? vortragKonto : z.konto, betrag: Math.abs(s), pos: ++pos });
    }
    return out;
  }

  /** Nächste freie Belegnummer: höchste vorkommende Zahl plus eins. */
  function naechsterBeleg(buchungen) {
    let max = 0;
    for (const b of buchungen) { const m = String(b.beleg || '').match(/^\d+/); if (m) max = Math.max(max, +m[0]); }
    return String(max + 1);
  }

  /** Abschnitte des Kontenplans: Aktiven, Passiven, Erfolgsrechnung (anhand der Titelzeilen). */
  function abschnitte(zeilen) {
    const out = { aktiven: [], passiven: [], erfolg: [] };
    let akt = null;
    for (const z of zeilen) {
      if (z.sektion && !z.konto && !z.gruppe) {
        const t = String(z.text || '').toUpperCase();
        if (t.startsWith('AKTIV')) akt = 'aktiven';
        else if (t.startsWith('PASSIV')) akt = 'passiven';
        else if (t.startsWith('ERFOLG')) akt = 'erfolg';
        else if (t.startsWith('KOSTENSTELLEN')) akt = null;
        continue;
      }
      if (akt) out[akt].push(z);
    }
    return out;
  }

  return { round2, sortiert, saldi, auswertung, totalsummen, kontoauszug, eroeffnung, naechsterBeleg, abschnitte };
});
