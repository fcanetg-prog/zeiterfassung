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

  /* ---------- Bankbewegungen aus dem E-Banking ---------- */

  function isoDatum(t) {
    t = String(t || '').trim();
    let m;
    if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }
  function zahl(t) {
    t = String(t == null ? '' : t).trim().replace(/[’'\s]/g, '');
    if (!t) return null;
    if (/,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    const v = parseFloat(t);
    return isFinite(v) ? v : null;
  }
  function csvZeile(line, trenner) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === trenner) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  /** Liest den CSV-Export der Kontobewegungen (Raiffeisen, altes und neues Format). */
  function parseBankCsv(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { fehler: 'Die Datei enthält keine Bewegungen.' };
    const trenner = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
    const kopf = csvZeile(lines[0], trenner).map((h) => h.trim().toLowerCase());
    const finde = (...namen) => kopf.findIndex((h) => namen.some((n) => h === n || h.startsWith(n)));
    const iD = finde('booked at', 'buchungsdatum', 'datum'), iT = finde('text', 'buchungstext', 'beschreibung'),
      iB = finde('credit/debit amount', 'betrag'), iS = finde('balance', 'saldo');
    if (iD < 0 || iT < 0 || iB < 0) return { fehler: 'Die Spalten Datum, Text und Betrag wurden in der Datei nicht gefunden. Erwartet wird der CSV-Export der Kontobewegungen aus dem E-Banking.' };
    const zeilen = [], zaehler = new Map();
    for (let i = 1; i < lines.length; i++) {
      const f = csvZeile(lines[i], trenner);
      const datum = isoDatum(f[iD]), betrag = zahl(f[iB]);
      if (!datum || betrag == null) continue;
      const txt = String(f[iT] || '').replace(/\s+/g, ' ').trim();
      const basis = `${datum}|${betrag.toFixed(2)}|${txt}`;
      const n = (zaehler.get(basis) || 0) + 1; zaehler.set(basis, n);
      zeilen.push({ datum, text: txt, betrag: round2(betrag), saldo: iS >= 0 ? zahl(f[iS]) : null, schluessel: `${basis}|${n}`, nr: zeilen.length });
    }
    return { zeilen };
  }

  /** Kern des Banktexts ohne Daten, Kartennummern, Kurse und Codes: dient zum Wiedererkennen gleicher Zahlungen. */
  function bankKern(text) {
    return String(text || '').toLowerCase()
      .replace(/,?\s*debit mastercard-nr\.?.*$/, '').replace(/\d{2}\.\d{2}\.\d{4}(,\s*\d{2}:\d{2})?/g, ' ')
      .replace(/\*\S+/g, ' ').replace(/\b(von|bis)\b/g, ' ').replace(/[0-9]+([.,][0-9]+)?/g, ' ').replace(/[^a-zäöüéèàç&\- ]/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  }

  const tage = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  /**
   * Gleicht Bankbewegungen mit den Buchungen auf dem Bankkonto ab.
   * Liefert die schon verbuchten Paare (zum Lernen) und die Bewegungen, die noch fehlen.
   */
  function bankAbgleich(zeilen, buchungen, konto, ignoriert) {
    const ign = new Set(ignoriert || []);
    const frei = buchungen.filter((b) => (b.soll === konto) !== (b.haben === konto))
      .map((b) => ({ b, betrag: round2(b.soll === konto ? b.betrag : -b.betrag), weg: false }));
    const offen = zeilen.filter((z) => Math.abs(z.betrag) > 0.004).map((z) => ({ z, weg: false }));
    const paare = [];
    const nimm = (o, liste) => { o.weg = true; for (const f of liste) f.weg = true; paare.push({ zeile: o.z, buchungen: liste.map((f) => f.b) }); };

    // 1. Schon einmal eingelesen (gleicher Schlüssel)
    const nachSchluessel = new Map(frei.filter((f) => f.b.bankSchluessel).map((f) => [f.b.bankSchluessel, f]));
    for (const o of offen) { const f = nachSchluessel.get(o.z.schluessel); if (f && !f.weg) nimm(o, [f]); }
    // 2. Gleicher Betrag, Datum gleich oder wenige Tage daneben (nächstes zuerst)
    for (const fenster of [0, 2, 6]) {
      for (const o of offen) {
        if (o.weg) continue;
        let best = null;
        for (const f of frei) {
          if (f.weg || f.betrag !== o.z.betrag) continue;
          const d = Math.abs(tage(f.b.datum, o.z.datum));
          if (d <= fenster && (!best || d < best.d)) best = { f, d };
        }
        if (best) nimm(o, [best.f]);
      }
    }
    // 3. Eine Bankbewegung, in der Buchhaltung auf zwei oder drei Buchungen aufgeteilt
    for (const o of offen) {
      if (o.weg) continue;
      const kand = frei.filter((f) => !f.weg && Math.sign(f.betrag) === Math.sign(o.z.betrag) && Math.abs(tage(f.b.datum, o.z.datum)) <= 6);
      let gefunden = null;
      for (let i = 0; i < kand.length && !gefunden; i++) for (let j = i + 1; j < kand.length && !gefunden; j++) {
        if (round2(kand[i].betrag + kand[j].betrag) === o.z.betrag) gefunden = [kand[i], kand[j]];
        for (let k = j + 1; k < kand.length && !gefunden; k++) if (round2(kand[i].betrag + kand[j].betrag + kand[k].betrag) === o.z.betrag) gefunden = [kand[i], kand[j], kand[k]];
      }
      if (gefunden) nimm(o, gefunden);
    }
    // 4. Betrag kommt auf beiden Seiten genau einmal vor: auch bei abweichendem Datum (bis 45 Tage) dieselbe Zahlung
    const zaehle = (liste, wert) => liste.filter((x) => !x.weg && wert(x)).length;
    for (const o of offen) {
      if (o.weg) continue;
      const kand = frei.filter((f) => !f.weg && f.betrag === o.z.betrag);
      if (kand.length === 1 && zaehle(offen, (x) => x.z.betrag === o.z.betrag) === 1 && Math.abs(tage(kand[0].b.datum, o.z.datum)) <= 45) nimm(o, [kand[0]]);
    }
    return { paare, neu: offen.filter((o) => !o.weg && !ign.has(o.z.schluessel)).map((o) => o.z), ignoriert: offen.filter((o) => !o.weg && ign.has(o.z.schluessel)).length };
  }

  /** Buchungsvorschlag für eine neue Bankbewegung, gelernt aus früheren gleichartigen Zahlungen. */
  function bankVorschlag(zeile, paare, konto) {
    const kern = bankKern(zeile.text);
    const bsp = [];
    for (const p of paare) {
      if (p.buchungen.length !== 1 || bankKern(p.zeile.text) !== kern || Math.sign(p.zeile.betrag) !== Math.sign(zeile.betrag)) continue;
      const b = p.buchungen[0];
      bsp.push({ text: b.text, gegen: b.soll === konto ? b.haben : b.soll, datum: b.datum, betrag: p.zeile.betrag });
    }
    const basis = { datum: zeile.datum, betrag: Math.abs(zeile.betrag), bankText: zeile.text, bankSchluessel: zeile.schluessel };
    const fertig = (text, gegen, sicher) => Object.assign(basis, { text, soll: zeile.betrag > 0 ? konto : gegen, haben: zeile.betrag > 0 ? gegen : konto, sicher });
    if (!bsp.length) return fertig(zeile.text.replace(/,?\s*Debit Mastercard-Nr\.?.*$/i, '').slice(0, 90), '', false);
    // Gleicher Betrag wie früher schlägt alles; sonst die häufigste Kombination, bei Gleichstand die jüngste.
    const gleich = bsp.filter((x) => x.betrag === zeile.betrag).sort((a, b) => (a.datum < b.datum ? 1 : -1))[0];
    if (gleich) return fertig(gleich.text, gleich.gegen, true);
    const gruppen = new Map();
    for (const x of bsp) {
      const k = `${x.gegen}|${x.text}`;
      const g = gruppen.get(k) || { n: 0, letzt: '', x };
      g.n++; if (x.datum > g.letzt) { g.letzt = x.datum; g.x = x; }
      gruppen.set(k, g);
    }
    const konten = new Set(bsp.map((x) => x.gegen));
    const beste = [...gruppen.values()].sort((a, b) => b.n - a.n || (a.letzt < b.letzt ? 1 : -1))[0];
    return fertig(beste.x.text, beste.x.gegen, konten.size === 1);
  }

  return { round2, sortiert, saldi, auswertung, totalsummen, kontoauszug, eroeffnung, naechsterBeleg, abschnitte, parseBankCsv, bankKern, bankAbgleich, bankVorschlag };
});
