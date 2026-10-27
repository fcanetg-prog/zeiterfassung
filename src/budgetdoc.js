/* Budget: Posten pro Jahr (wie das Excel «Aufträge»), Beträge aus den Offerten, Rechnung. Läuft im Fenster und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetDoc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const isNum = (x) => typeof x === 'number' && isFinite(x);

  /** Bereiche des Budgets in der Reihenfolge des Excels. */
  const BEREICHE = [['ausgaben', 'Ausgaben GmbH'], ['einnahmen', 'Einnahmen GmbH'], ['lohn', 'Lohneinnahmen (netto)'], ['privat', 'Private Ausgaben']];
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
    if (p.saldo) o.saldo = true;                   // Saldosteuersatz des Jahres (Einstellungen) vom Umsatz
    // Offerierter Betrag (zählt nicht ins Total), z. B. «offeriert» oder «noch zu offerieren» aus dem Excel
    if (String(p.offeriertFormel || '').trim()) { o.offeriertFormel = String(p.offeriertFormel); o.offeriert = formelWert(p.offeriertFormel) || 0; }
    if (p.offerteId) o.offerteId = String(p.offerteId);
    if (p.konto) o.konto = String(p.konto);         // privates Budget: Konto der Buchhaltung privat (für «Ist»)
    if (p.serie) o.serie = String(p.serie);         // derselbe Posten in allen Jahren (Änderungen gelten für die folgenden Jahre)
    if (p.jahresausgabe) o.jahresausgabe = true;
    if (p.ohneMwst) o.ohneMwst = true;               // Einnahme mit 0 % MWST: inkl. MWST = ohne MWST
    // Stand einer Einnahme: bestätigt (Standard, zählt), offeriert oder noch zu offerieren (zählen nicht). Früher: «offen» = offeriert.
    const st = ['offeriert', 'offerieren'].includes(p.status) ? p.status : p.offen ? 'offeriert' : '';
    if (st) o.status = st;     // privates Budget: einmalig oder jährlich fällig (kein Vergleich mit der Zeit)
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
   * MWST-Satz und Saldosteuersatz eines Jahres aus den Einstellungen ({ mwstJahre: { 2026: { mwst, saldo } } }).
   * Fehlt das Jahr, gilt das nächstfrühere (sonst das nächstspätere) erfasste Jahr; ohne Angaben der allgemeine MWST-Satz.
   */
  function saetzeFuer(settings, jahr) {
    const m = (settings && settings.mwstJahre) || {}, js = Object.keys(m).map(Number).sort((a, b) => a - b);
    const j = js.filter((x) => x <= +jahr).pop() || js.find((x) => x > +jahr);
    const z = j ? m[j] : {};
    return { mwst: isNum(z.mwst) ? z.mwst : isNum(settings && settings.mwstSatz) ? settings.mwstSatz : 8.1, saldo: isNum(z.saldo) ? z.saldo : 0, erfasst: !!m[jahr] };
  }

  /**
   * Budget eines Jahres rechnen. Beträge der Posten sind ohne MWST.
   * - Einnahmen: «inkl. MWST» = Betrag plus MWST-Satz des Jahres (Posten «ohne MWST» ausgenommen).
   * - Posten mit «saldo» rechnen den Saldosteuersatz des Jahres vom Umsatz (ohne Posten «ohne MWST»), Posten mit «satz» einen eigenen Prozentsatz.
   * - Bestätigte und abgeschlossene Offerten mit Betrag für dieses Jahr zählen als Einnahmen; offene erscheinen,
   *   zählen aber nicht; abgesagte gar nicht.
   * - Ist ein Posten mit einer Offerte verknüpft, kommt deren Betrag in diesen Posten (keine Doppelzählung).
   */
  function rechne(posten, offerten, jahr, saetze) {
    const J = String(jahr), S = saetze || { mwst: 8.1, saldo: 0 };
    const alle = (posten || []).filter((p) => p.jahr === +jahr).slice().sort((a, b) => (a.pos || 0) - (b.pos || 0));
    const offById = new Map((offerten || []).map((o) => [o.id, o]));
    const betragVon = (o) => (o && o.jahresBetraege && isNum(o.jahresBetraege[J]) ? o.jahresBetraege[J] : 0);
    const verknuepft = new Set(alle.filter((p) => p.offerteId && offById.has(p.offerteId)).map((p) => p.offerteId));
    const satzVon = (p) => (p.saldo ? S.saldo : isNum(p.satz) ? p.satz : null);

    const zeilen = alle.map((p) => {
      const o = p.offerteId ? offById.get(p.offerteId) : null;
      let wert = p.betrag || 0;
      if (o && (o.status === 'zugesagt' || o.status === 'abgeschlossen')) wert = betragVon(o);
      else if (o && o.status === 'abgesagt') wert = 0;
      // Noch nicht bestätigt: zählt nicht (ausser die verknüpfte Offerte ist bestätigt)
      const zaehlt = !(p.status && p.bereich === 'einnahmen' && !(o && (o.status === 'zugesagt' || o.status === 'abgeschlossen')));
      return { posten: p, offerte: o || null, wert, satz: satzVon(p), zaehlt };
    });
    // Offerten ohne verknüpften Posten als eigene Zeilen; offene zählen nicht
    const auto = [];
    for (const o of offerten || []) {
      if (verknuepft.has(o.id) || !betragVon(o) || o.status === 'abgesagt') continue;
      auto.push({ offerte: o, wert: betragVon(o), zaehlt: o.status === 'zugesagt' || o.status === 'abgeschlossen' });
    }

    const inklVon = (z) => (z.satz != null || (z.posten && z.posten.ohneMwst) ? z.wert : round2(z.wert * (1 + S.mwst / 100)));   // 0 % MWST: kein Zuschlag
    const ein = zeilen.filter((z) => z.posten.bereich === 'einnahmen');
    const zaehlend = [...ein.filter((z) => z.satz == null && z.zaehlt), ...auto.filter((z) => z.zaehlt)];
    const umsatz = round2(zaehlend.reduce((s, z) => s + z.wert, 0));
    const basis = umsatz;
    const mwstEin0 = round2(zaehlend.filter((z) => !(z.posten && z.posten.ohneMwst)).reduce((s, z) => s + z.wert, 0) * S.mwst / 100);
    // Saldosteuersatz auf dem Umsatz inklusive MWST (wie die ESTV rechnet); eigene Prozentsätze auf dem Umsatz ohne MWST
    const basisSaldo = round2(umsatz + mwstEin0);
    for (const z of zeilen) if (z.satz != null) z.wert = round2((z.posten.saldo ? basisSaldo : basis) * z.satz / 100);
    for (const z of [...zeilen, ...auto]) z.inkl = z.posten && z.posten.bereich !== 'einnahmen' ? null : inklVon(z);

    const summe = (l, k) => round2(l.reduce((s, z) => s + (z[k] || 0), 0));
    const nachBereich = (b) => zeilen.filter((z) => z.posten.bereich === b);
    const ausgaben = summe(nachBereich('ausgaben'), 'wert');
    const mwstEin = mwstEin0;
    const satzEin = summe(ein.filter((z) => z.satz != null), 'wert');
    const einnahmen = round2(umsatz + mwstEin + satzEin);
    const gmbhLohn = round2(einnahmen - ausgaben);
    const anstellungen = summe(nachBereich('lohn'), 'wert');
    const offen = [...ein.filter((z) => !z.zaehlt), ...auto.filter((z) => !z.zaehlt)];
    const nichtGezaehlt = ein.filter((z) => !z.zaehlt);
    const privat = summe(nachBereich('privat'), 'wert');

    // Gruppen in der Reihenfolge ihres ersten Postens
    const gruppen = {};
    for (const [b] of BEREICHE) {
      const m = new Map();
      for (const z of nachBereich(b)) { const g = z.posten.gruppe; if (!m.has(g)) m.set(g, []); m.get(g).push(z); }
      gruppen[b] = [...m.entries()].map(([name, zs]) => { const z2 = zs.filter((z) => z.zaehlt); return { name, zeilen: zs, summe: summe(z2, 'wert'), inkl: b === 'einnahmen' ? summe(z2, 'inkl') : null }; });
    }
    return {
      zeilen, auto, gruppen, umsatz, basis, basisSaldo, mwstEin, einnahmen, ausgaben, gmbhLohn, anstellungen, saetze: S,
      lohnTotal: round2(gmbhLohn + anstellungen),
      privat, spielraum: round2(gmbhLohn + anstellungen - privat),   // Lohneinnahmen minus privater Budgetrahmen
      autoSumme: summe(auto.filter((z) => z.zaehlt), 'wert'), autoInkl: summe(auto.filter((z) => z.zaehlt), 'inkl'),
      offeriertNach: { offeriert: summe([...nichtGezaehlt.filter((z) => z.posten.status === 'offeriert'), ...auto.filter((z) => !z.zaehlt)], 'inkl'), offerieren: summe(nichtGezaehlt.filter((z) => z.posten.status === 'offerieren'), 'inkl') },
      offeriert: summe(offen, 'wert'), offeriertInkl: summe(offen, 'inkl'),
    };
  }

  /**
   * Frühere Form des Budgets (wie das Excel) in die heutige bringen:
   * Gruppe «Aufträge ohne MWST» heisst «Aufträge»; die MWST-Zeile der Einnahmen entfällt (Spalte «inkl. MWST»),
   * die MWST-Zeile der Ausgaben rechnet mit dem Saldosteuersatz aus den Einstellungen; Sätze wandern in die Einstellungen;
   * «offeriert» steht in der Notiz. Gibt true zurück, wenn sich etwas geändert hat.
   */
  function neueForm(posten, settings, uid) {
    let anders = false;
    const sj = settings.mwstJahre || (settings.mwstJahre = {});
    for (let i = posten.length - 1; i >= 0; i--) {
      const p = posten[i], j = String(p.jahr);
      if (p.gruppe === 'Aufträge ohne MWST') { p.gruppe = 'Aufträge'; anders = true; }
      if (isNum(p.satz) && p.bereich === 'einnahmen') {
        sj[j] = Object.assign({}, sj[j]); if (!isNum(sj[j].mwst)) sj[j].mwst = p.satz;
        posten.splice(i, 1); anders = true; continue;
      }
      if (isNum(p.satz) && p.bereich === 'ausgaben' && /mehrwertsteuer|mwst/i.test(p.text)) {
        sj[j] = Object.assign({}, sj[j]); if (!isNum(sj[j].saldo)) sj[j].saldo = p.satz;
        delete p.satz; p.saldo = true; p.betrag = 0; p.formel = ''; anders = true;
      }
      if (p.offeriertFormel != null || p.offeriert != null) {
        const art = /^noch zu offerieren/i.test(String(p.notiz || '').trim()) ? 'Möglich' : 'Offeriert';
        const t = isNum(p.offeriert) && p.offeriert ? `${art} ${p.offeriert.toFixed(2).replace(/\.00$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '’')}` : '';
        const rest = String(p.notiz || '').replace(/^offeriert\b\s*/i, '');
        p.notiz = [t, rest].filter(Boolean).join(' · ');
        delete p.offeriert; delete p.offeriertFormel; anders = true;
      }
    }
    // Umbau Oktober 2026: Gruppen der Ausgaben umbenannt, Buchhaltung zu den Subcontracts; Einnahmen und Lohneinnahmen ohne Untergruppen
    const UMB = { Angestellte: 'Subcontracts', Buchhaltung: 'Subcontracts', Anderes: 'Übrige Ausgaben' };
    const jahre = new Set(), letzteAngestellte = {};
    for (const x of posten) if (x.bereich === 'ausgaben' && x.gruppe === 'Angestellte') letzteAngestellte[x.jahr] = Math.max(letzteAngestellte[x.jahr] || -Infinity, x.pos || 0);
    for (const p of posten) {
      if (p.bereich === 'ausgaben' && UMB[p.gruppe]) {
        // Buchhaltung hinter die Lohnkosten (früher «Angestellte») stellen
        if (p.gruppe === 'Buchhaltung' && isFinite(letzteAngestellte[p.jahr])) p.pos = letzteAngestellte[p.jahr] + 0.5;
        p.gruppe = UMB[p.gruppe]; anders = true; jahre.add(p.jahr);
      }
      if ((p.bereich === 'einnahmen' && p.gruppe === 'Aufträge') || (p.bereich === 'lohn' && p.gruppe === 'Aus Anstellungen')) { p.gruppe = ''; anders = true; jahre.add(p.jahr); }
    }
    // Lohneinnahmen: Universität Neuchâtel, Universität Bern, SRF und Texte SWI gibt es in jedem Jahr
    if (uid) for (const j of new Set(posten.filter((x) => x.bereich === 'lohn').map((x) => x.jahr))) {
      const lohn = posten.filter((x) => x.jahr === j && x.bereich === 'lohn');
      if (lohn.length && !lohn.some((x) => /texte swi/i.test(x.text))) {
        posten.push(normalize({ id: uid(), jahr: j, bereich: 'lohn', gruppe: '', text: 'Texte SWI', formel: '', betrag: 0, pos: Math.max(...lohn.map((x) => x.pos || 0)) + 0.5 }));
        anders = true; jahre.add(j);
      }
    }
    for (const j of jahre) posten.filter((x) => x.jahr === j).sort((a, b) => (a.pos || 0) - (b.pos || 0)).forEach((x, i) => { x.pos = i + 1; });
    return anders;
  }

  /** Posten eines Jahres als Kopie für ein anderes Jahr (ohne Verknüpfung mit Offerten und ohne «offeriert»). */
  function kopieFuer(posten, vonJahr, nachJahr, uid) {
    return (posten || []).filter((p) => p.jahr === +vonJahr).map((p) => {
      const n = Object.assign({}, p, { id: uid(), jahr: +nachJahr, mod: 0 });
      delete n.offerteId; delete n.offeriert; delete n.offeriertFormel;
      return n;
    });
  }

  /** Private Budgetposten, die einmalig oder einmal im Jahr fällig sind. */
  const JAHRESAUSGABEN = /^(gönner|sbb|auto|zeitschriften|multimedia|reisen|gurten|ausserordentliches|krankenkasse|arztkosten|linsen|steuern)/i;
  function jahresausgabenMarkieren(posten) {
    let n = 0;
    for (const p of posten) if (p.bereich === 'privat' && !p.jahresausgabe && JAHRESAUSGABEN.test(String(p.text).trim())) { p.jahresausgabe = true; n++; }
    return n > 0;
  }

  /**
   * Verbindet gleiche Posten über die Jahre (Bereich, Gruppe und Name gleich) mit einer gemeinsamen «serie».
   * Posten, die schon eine haben, behalten sie. Gibt true zurück, wenn etwas vergeben wurde.
   */
  function serienVergeben(posten, uid) {
    const key = (p) => `${p.bereich}|${String(p.gruppe).trim().toLowerCase()}|${String(p.text).trim().toLowerCase()}`;
    const map = new Map();
    for (const p of posten) if (p.serie && !map.has(key(p))) map.set(key(p), p.serie);
    let n = 0;
    for (const p of posten.slice().sort((a, b) => a.jahr - b.jahr || (a.pos || 0) - (b.pos || 0))) {
      if (p.serie) continue;
      const k = key(p);
      // Leere Namen nicht zusammenhängen
      if (!String(p.text).trim() || !map.has(k)) { p.serie = uid(); if (String(p.text).trim()) map.set(k, p.serie); } else p.serie = map.get(k);
      n++;
    }
    return n > 0;
  }

  /**
   * Offerierte Beträge aus den Notizen der Einnahmen («Offeriert 15’463 …», «Möglich 3’895 …») als Betrag übernehmen,
   * markiert als «noch nicht bestätigt». Hat der Posten schon einen Betrag, entsteht daneben ein eigener Posten.
   */
  function offerierteUebernehmen(posten, uid) {
    let anders = false;
    for (const p of posten.slice()) {
      if (p.bereich !== 'einnahmen') continue;
      const m = /^\s*(offeriert|möglich)\s+([\d’'.,]+)/i.exec(String(p.notiz || ''));
      if (!m) continue;
      const v = formelWert(m[2]);
      if (v == null) continue;
      const status = /^m/i.test(m[1]) ? 'offerieren' : 'offeriert';   // «Möglich» = noch zu offerieren
      if (Math.abs(p.betrag || 0) < 0.005 && !p.offerteId) { p.betrag = v; p.formel = ''; p.status = status; }
      else posten.push(normalize({ id: uid(), jahr: p.jahr, bereich: p.bereich, gruppe: p.gruppe, text: `${p.text} (${status === 'offeriert' ? 'offeriert' : 'noch zu offerieren'})`, formel: '', betrag: v, pos: (p.pos || 0) + 0.5, status }));
      p.notiz = ''; anders = true;
    }
    if (anders) for (const j of new Set(posten.map((x) => x.jahr))) posten.filter((x) => x.jahr === j).sort((a, b) => (a.pos || 0) - (b.pos || 0)).forEach((x, i) => { x.pos = i + 1; });
    return anders;
  }

  return { offerierteUebernehmen, serienVergeben, jahresausgabenMarkieren, BEREICHE, STATUS, formelWert, istFormel, normalize, jahresBetraege, offertenNachJahr, saetzeFuer, rechne, neueForm, kopieFuer, round2 };
});
