/* Budget: Posten pro Jahr (wie das Excel «Aufträge»), Beträge aus den Offerten, Rechnung. Läuft im Fenster und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetDoc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  /** Bereiche des Budgets in der Reihenfolge des Excels. */
  const BEREICHE = [['ausgaben', 'Ausgaben'], ['einnahmen', 'Einnahmen'], ['lohn', 'Lohnauszahlungen']];
  /** Status der Offerten (intern «zugesagt» = bestätigt) in der Reihenfolge der Übersicht. */
  const STATUS = [['offen', 'Offeriert'], ['zugesagt', 'Bestätigt'], ['abgeschlossen', 'Abgeschlossen'], ['abgesagt', 'Abgesagt']];

  /**
   * Betrag aus einer Eingabe wie im Excel: «4500», «4’500.50», «12*24», «=2585*4+2237.5*5», «(654+319+99)».
   * Nur Zahlen und + - * / ( ); sonst null.
   */
  function formelWert(eingabe) {
    let s = String(eingabe == null ? '' : eingabe).trim().replace(/^=/, '').replace(/[’'`\s]/g, '').replace(/(\d),(\d)/g, '$1.$2');
    if (!s) return null;
    if (!/^[\d.+\-*/()]+$/.test(s)) return null;
    let i = 0;
    const zahl = () => { const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
    const faktor = () => {
      if (s[i] === '-') { i++; return -faktor(); }
      if (s[i] === '+') { i++; return faktor(); }
      if (s[i] === '(') { i++; const v = summe(); if (s[i] !== ')') throw 0; i++; return v; }
      return zahl();
    };
    const produkt = () => { let v = faktor(); while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const w = faktor(); v = op === '*' ? v * w : v / w; } return v; };
    const summe = () => { let v = produkt(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const w = produkt(); v = op === '+' ? v + w : v - w; } return v; };
    try { const v = summe(); return i === s.length && isFinite(v) ? round2(v) : null; } catch (_) { return null; }
  }
  /** Enthält die Eingabe eine Rechnung (dann zeigt die App das Ergebnis daneben)? */
  const istFormel = (s) => /\d\s*[-+*/(]|\(/.test(String(s || '').replace(/^\s*[-+]/, '').replace(/^=/, ''));

  function normalize(p) {
    if (!p || !p.id || !+p.jahr) return null;
    const bereich = BEREICHE.some(([k]) => k === p.bereich) ? p.bereich : 'ausgaben';
    const o = {
      id: String(p.id), jahr: +p.jahr, bereich, gruppe: String(p.gruppe || ''), text: String(p.text || ''),
      formel: String(p.formel == null ? '' : p.formel), betrag: isNum(p.betrag) ? p.betrag : (formelWert(p.formel) || 0),
      notiz: String(p.notiz || ''), pos: isNum(p.pos) ? p.pos : 0, mod: p.mod || 0,
    };
    // Prozent vom Umsatz (Mehrwertsteuer) statt fester Betrag
    if (isNum(p.satz)) o.satz = p.satz;
    // Offerierter Betrag (zählt nicht ins Total), z. B. «offeriert» oder «noch zu offerieren» aus dem Excel
    if (String(p.offeriertFormel || '').trim()) { o.offeriertFormel = String(p.offeriertFormel); o.offeriert = formelWert(p.offeriertFormel) || 0; }
    if (p.ohneMwst) o.ohneMwst = true;             // z. B. Abo-Beiträge: nicht mehrwertsteuerpflichtig
    if (p.offerteId) o.offerteId = String(p.offerteId);
    return o;
  }

  /** Jahresbeträge einer Offerte bereinigen: { "2026": 4500 }, ohne leere und ungültige. */
  function jahresBetraege(x) {
    const o = {};
    for (const [j, v] of Object.entries(x || {})) if (/^\d{4}$/.test(j) && isNum(v)) o[j] = round2(v);
    return o;
  }

  /** Summe der Offerten pro Jahr und Status: { 2026: { offen, zugesagt, abgeschlossen, abgesagt } }. */
  function offertenNachJahr(offerten) {
    const out = {};
    for (const p of offerten || []) for (const [j, v] of Object.entries(jahresBetraege(p.jahresBetraege))) {
      const z = out[j] || (out[j] = { offen: 0, zugesagt: 0, abgeschlossen: 0, abgesagt: 0 });
      if (z[p.status] != null) z[p.status] = round2(z[p.status] + v);
    }
    return out;
  }

  /**
   * Budget eines Jahres rechnen.
   * - Posten mit «satz» sind Prozent vom Umsatz (ohne die Posten «ohne MWST»).
   * - Bestätigte und abgeschlossene Offerten mit Betrag für dieses Jahr zählen als Einnahmen,
   *   offene erscheinen unter «Offeriert» (zählt nicht), abgesagte gar nicht.
   * - Ist ein Posten mit einer Offerte verknüpft, kommt deren Betrag in diesen Posten (keine Doppelzählung).
   */
  function rechne(posten, offerten, jahr) {
    const J = String(jahr);
    const alle = (posten || []).filter((p) => p.jahr === +jahr).slice().sort((a, b) => (a.pos || 0) - (b.pos || 0));
    const offById = new Map((offerten || []).map((o) => [o.id, o]));
    const betragVon = (o) => (o && o.jahresBetraege && isNum(o.jahresBetraege[J]) ? o.jahresBetraege[J] : 0);
    const verknuepft = new Set(alle.filter((p) => p.offerteId && offById.has(p.offerteId)).map((p) => p.offerteId));

    const zeilen = alle.map((p) => {
      const o = p.offerteId ? offById.get(p.offerteId) : null;
      let wert = p.betrag || 0, offeriert = p.offeriert || 0;
      if (o) {
        if (o.status === 'offen') offeriert = betragVon(o);
        else if (o.status === 'abgesagt') { wert = 0; offeriert = 0; }
        else { wert = betragVon(o); offeriert = 0; }
      }
      return { posten: p, offerte: o || null, wert, offeriert, satz: isNum(p.satz) ? p.satz : null };
    });
    // Offerten ohne verknüpften Posten als eigene Zeilen
    const auto = [];
    for (const o of offerten || []) {
      if (verknuepft.has(o.id) || !betragVon(o) || o.status === 'abgesagt') continue;
      const best = o.status === 'zugesagt' || o.status === 'abgeschlossen';
      auto.push({ offerte: o, wert: best ? betragVon(o) : 0, offeriert: best ? 0 : betragVon(o) });
    }

    const nachBereich = (b) => zeilen.filter((z) => z.posten.bereich === b);
    const ein = nachBereich('einnahmen');
    const umsatz = round2(ein.filter((z) => z.satz == null).reduce((s, z) => s + z.wert, 0) + auto.reduce((s, z) => s + z.wert, 0));
    const basis = round2(umsatz - ein.filter((z) => z.satz == null && z.posten.ohneMwst).reduce((s, z) => s + z.wert, 0));
    const basisOff = round2(ein.filter((z) => z.satz == null && !z.posten.ohneMwst).reduce((s, z) => s + z.offeriert, 0) + auto.reduce((s, z) => s + z.offeriert, 0));
    for (const z of zeilen) if (z.satz != null) { z.wert = round2(basis * z.satz / 100); z.offeriert = 0; }

    const summe = (l, k) => round2(l.reduce((s, z) => s + (z[k] || 0), 0));
    const ausgaben = summe(nachBereich('ausgaben'), 'wert');
    const mwstEin = summe(ein.filter((z) => z.satz != null), 'wert');
    const einnahmen = round2(umsatz + mwstEin);
    const gmbhLohn = round2(einnahmen - ausgaben);
    const anstellungen = summe(nachBereich('lohn'), 'wert');
    const satzEin = ein.filter((z) => z.satz != null).reduce((s, z) => s + z.satz, 0);
    const offeriert = round2(summe(ein.filter((z) => z.satz == null), 'offeriert') + auto.reduce((s, z) => s + z.offeriert, 0));

    // Gruppen in der Reihenfolge ihres ersten Postens
    const gruppen = {};
    for (const [b] of BEREICHE) {
      const m = new Map();
      for (const z of nachBereich(b)) { const g = z.posten.gruppe; if (!m.has(g)) m.set(g, []); m.get(g).push(z); }
      gruppen[b] = [...m.entries()].map(([name, zs]) => ({ name, zeilen: zs, summe: summe(zs, 'wert'), offeriert: summe(zs, 'offeriert') }));
    }
    return {
      zeilen, auto, gruppen, umsatz, basis, mwstEin, einnahmen, ausgaben, gmbhLohn, anstellungen,
      lohnTotal: round2(gmbhLohn + anstellungen),
      offeriert,                                           // ohne MWST
      offeriertMitMwst: round2(offeriert + basisOff * satzEin / 100),
      bestaetigt: round2(auto.reduce((s, z) => s + z.wert, 0) + zeilen.filter((z) => z.offerte).reduce((s, z) => s + z.wert, 0)),
    };
  }

  /** Posten eines Jahres als Kopie für ein anderes Jahr (ohne Verknüpfung mit Offerten und ohne «offeriert»). */
  function kopieFuer(posten, vonJahr, nachJahr, uid) {
    return (posten || []).filter((p) => p.jahr === +vonJahr).map((p) => {
      const n = Object.assign({}, p, { id: uid(), jahr: +nachJahr, mod: 0 });
      delete n.offerteId; delete n.offeriert; delete n.offeriertFormel;
      return n;
    });
  }

  return { BEREICHE, STATUS, formelWert, istFormel, normalize, jahresBetraege, offertenNachJahr, rechne, kopieFuer, round2 };
});
