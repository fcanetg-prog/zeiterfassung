/* Offerten und Kostenvoranschläge: Datenformat, Summen, PDF-Vorlage (HTML) und LaTeX-Code. Läuft im Fenster und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OffertDoc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ARTEN = { offerte: 'Offerte', kostenvoranschlag: 'Kostenvoranschlag' };
  const PREIS = ['auto', 'inklusive', 'null'];   // berechnet, «inklusive» (nicht verrechnet), 0.00 (Position entfällt)
  const round2 = (x) => Math.round(x * 100 + 1e-6) / 100;
  const zahl = (x) => {
    if (typeof x === 'number') return isFinite(x) ? x : 0;
    const n = parseFloat(String(x == null ? '' : x).replace(/[’'\s]/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  const text = (x) => (x == null ? '' : String(x));

  /** Bringt beliebige Eingaben (auch von Hand oder von Claude geschriebenes JSON) in die feste Form. */
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const teile = Array.isArray(d.teile) ? d.teile : [];
    return {
      art: ARTEN[d.art] ? d.art : 'offerte',
      teile: teile.map((t) => ({
        nummer: text(t && t.nummer).trim(),
        titel: text(t && t.titel),
        text: text(t && t.text),
        umbruch: !!(t && t.umbruch),
        bloecke: (Array.isArray(t && t.bloecke) ? t.bloecke : []).map((b) => ({
          titel: text(b && b.titel),
          zeilen: (Array.isArray(b && b.zeilen) ? b.zeilen : []).map((z) => ({
            was: text(z && z.was),
            aufwand: text(z && z.aufwand).trim(),
            ansatz: zahl(z && z.ansatz),
            preis: PREIS.includes(z && z.preis) ? z.preis : 'auto',
          })),
        })),
      })),
    };
  }

  /** «2h» → { menge: 2, einheit: 'h' }, «pauschal» → { menge: null, einheit: '' } */
  function aufwandTeile(a) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(text(a));
    return m ? { menge: zahl(m[1]), einheit: m[2].trim() } : { menge: null, einheit: '' };
  }
  function zeilenPreis(z) {
    if (z.preis !== 'auto') return 0;
    const a = aufwandTeile(z.aufwand);
    return round2(a.menge == null ? z.ansatz : a.menge * z.ansatz);
  }
  const blockTotal = (b) => round2(b.zeilen.reduce((s, z) => s + zeilenPreis(z), 0));
  const teilTotal = (t) => round2(t.bloecke.reduce((s, b) => s + blockTotal(b), 0));
  /** Ein Teil ohne Aufwand und ohne Blocktitel ist eine einfache Preisliste (nur «Was» und «Total»). */
  const istEinfach = (t) => t.bloecke.every((b) => !b.titel.trim() && b.zeilen.every((z) => !z.aufwand));

  const fr = (x) => `${round2(x).toFixed(2)} Fr.`;
  function ansatzText(z) {
    const a = aufwandTeile(z.aufwand);
    // Ansätze ohne Nachkommastellen, solange es ganze Franken sind.
    const n = Number.isInteger(z.ansatz) ? String(z.ansatz) : z.ansatz.toFixed(2);
    if (a.menge == null || !a.einheit) return `${n} Fr.`;
    return `${n} Fr./${a.einheit}`;
  }
  const preisText = (z) => (z.preis === 'inklusive' ? 'inklusive' : fr(zeilenPreis(z)));
  const kopf = (d, t) => `${ARTEN[d.art]}${t.nummer ? ' ' + t.nummer : ''}:`;
  /** Kurzfassung für Listen: «1a 3750.00 · 1b 3320.00» */
  const kurz = (d) => d.teile.map((t) => `${t.nummer ? t.nummer + ' ' : ''}${round2(teilTotal(t)).toFixed(2)}`).join(' · ');

  /* ---------- PDF (HTML) ---------- */

  const esc = (s) => text(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** *kursiv* im Fliesstext */
  const mitKursiv = (s) => esc(s).replace(/\*([^*\n]+)\*/g, '<i>$1</i>');

  // Folienformat 16:9. Alles steht auf einer Zeile: Die Schriftgrösse richtet sich nach dem längsten Eintrag und der Zeilenzahl.
  const SEITE = { b: 338.67, h: 190.5, rand: 13, kopf: 27, fuss: 12 };
  const PT = 0.3528;          // mm pro Punkt
  const ZEICHEN = 0.54;       // mittlere Zeichenbreite in em (vorsichtig geschätzt)

  function schriftFuer(t, einfach) {
    const breite = SEITE.b - 2 * SEITE.rand;
    const fest = einfach ? 34 : 112;                      // Spalten rechts von «Was», in mm
    let laengste = 12, zeilen = 2;                        // Kopf- und Preiszeile
    for (const b of t.bloecke) {
      if (b.titel.trim()) { zeilen++; laengste = Math.max(laengste, b.titel.length * 1.08); }
      for (const z of b.zeilen) { zeilen++; laengste = Math.max(laengste, z.was.length); }
    }
    const nachBreite = (breite - fest - 6) / (laengste * ZEICHEN * PT);
    const nachHoehe = (SEITE.h - SEITE.kopf - SEITE.fuss - 16) / (zeilen * 1.95 * PT);
    return Math.max(5, Math.min(10.5, nachBreite * 0.94, nachHoehe * 0.94));
  }

  function teilHtml(d, t) {
    const einfach = istEinfach(t);
    const spalten = einfach ? 2 : 5;
    const pt = schriftFuer(t, einfach);
    let zeilen = '';
    t.bloecke.forEach((b) => {
      if (!b.zeilen.length && !b.titel.trim()) return;
      if (b.titel.trim()) zeilen += `<tr class="bt"><td colspan="${spalten - 1}">${esc(b.titel)}</td><td class="r">${einfach ? '' : fr(blockTotal(b))}</td></tr>`;
      b.zeilen.forEach((z) => {
        zeilen += einfach
          ? `<tr><td>${esc(z.was)}</td><td class="r">${preisText(z)}</td></tr>`
          : `<tr class="${z.preis === 'null' ? 'entf' : ''}"><td>${esc(z.was)}</td><td>${esc(z.aufwand)}</td><td class="r">${esc(ansatzText(z))}</td>
              <td class="r ${z.preis === 'inklusive' ? 'ink' : ''}">${preisText(z)}</td><td></td></tr>`;
      });
    });
    const titel = `${ARTEN[d.art]}${t.nummer ? ' ' + t.nummer : ''}`;
    // Titel im Kopfband ebenfalls einzeilig halten
    const platz = SEITE.b - 2 * SEITE.rand - 92;
    const tpt = Math.max(6, Math.min(11, platz / ((t.titel.length + 2) * 0.56 * PT)));
    return `<section class="folie">
      <header><div class="logo"></div>
        <h2><b>${esc(titel)}</b>${t.titel.trim() ? `<span style="font-size:${tpt.toFixed(2)}pt">${esc(t.titel)}</span>` : ''}</h2></header>
      <main style="font-size:${pt.toFixed(2)}pt">
      <table class="${einfach ? 'einfach' : ''}">
        <thead><tr>${einfach ? '<th>Was</th><th class="r">Total</th>' : '<th>Was</th><th>Aufwand</th><th class="r">Ansatz</th><th class="r">Preis</th><th class="r">Total</th>'}</tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr><td colspan="${spalten - 1}">Preis</td><td class="r">${fr(teilTotal(t))}</td></tr></tfoot>
      </table></main>
      <footer>Alle Preise exkl. Mehrwertsteuer</footer></section>`;
  }

  const NAVY = '#18334e', TEAL = '#27b9bf', TEAL_DUNKEL = '#1a8f96';
  const CSS = `
    @page { size: ${SEITE.b}mm ${SEITE.h}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif; color: #16242f; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .folie { position: relative; width: ${SEITE.b}mm; height: ${SEITE.h}mm; overflow: hidden; break-after: page; background: #fff; }
    .folie:last-child { break-after: auto; }
    /* Titelfolie */
    .titel { background: ${NAVY} __OFFERTE_TITELBILD__ center / cover no-repeat; color: #fff; }
    .titel .block { position: absolute; left: 6.4mm; top: 70mm; width: 80mm; }
    .titel .art { font-size: 17pt; font-weight: 700; letter-spacing: .02em; margin: 0 0 3mm; }
    .titel .strich { width: 16mm; height: .9mm; background: ${TEAL}; margin: 0 0 4mm; }
    .titel .kunde { font-size: 11.5pt; font-weight: 700; margin: 0 0 1.2mm; }
    .titel .projekt { font-size: 10.5pt; margin: 0 0 5mm; line-height: 1.3; }
    .titel .datum { font-size: 8.5pt; color: #b9c7d4; }
    /* Inhaltsfolien */
    header { position: absolute; left: 0; top: 0; width: 100%; height: ${SEITE.kopf}mm; background: ${NAVY}; color: #fff; display: flex; align-items: center; padding: 0 ${SEITE.rand}mm 0 ${SEITE.rand - 3}mm; border-bottom: 1.1mm solid ${TEAL}; }
    .logo { flex: none; width: 82mm; height: 14mm; background: __OFFERTE_LOGO__ left center / contain no-repeat; }
    h2 { margin: 0 0 0 auto; font-weight: 400; white-space: nowrap; text-align: right; line-height: 1.25; }
    h2 b { display: block; font-weight: 700; font-size: 16pt; }
    h2 span { display: block; color: #cfe9ea; margin-top: .8mm; }
    /* Tabelle mittig zwischen Kopfband und Fusszeile */
    main { position: absolute; left: ${SEITE.rand}mm; right: ${SEITE.rand}mm; top: ${SEITE.kopf + 1.1}mm; bottom: ${SEITE.fuss}mm; display: flex; align-items: center; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .42em .9em .42em 0; text-align: left; white-space: nowrap; line-height: 1.1; }
    th:last-child, td:last-child { padding-right: 0; }
    th { font-size: .8em; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #fff; background: ${TEAL_DUNKEL}; padding-top: .7em; padding-bottom: .7em; }
    th:first-child { padding-left: .75em; } th:last-child { padding-right: .75em; }
    td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
    td:first-child, th:first-child { width: 100%; }
    table:not(.einfach) th:nth-child(n+2), table:not(.einfach) td:nth-child(n+2) { padding-left: 1.4em; }
    tbody td { border-bottom: .15mm solid #dfe5ea; }
    tbody tr:not(.bt) td:first-child { padding-left: 1.1em; }
    tr.bt td { font-weight: 700; color: ${NAVY}; background: #eef3f6; padding-left: .6em; padding-top: .55em; padding-bottom: .55em; border-bottom: 0; }
    tr.bt td:last-child { padding-right: .6em; }
    table.einfach tbody td:first-child { padding-left: 0; }
    tr.entf td { color: #9aa6b0; }
    td.ink { color: #1b9aa0; font-style: italic; }
    tfoot td { font-weight: 700; font-size: 1.12em; color: #fff; background: ${NAVY}; padding: .6em .55em; }
    tfoot td:last-child { padding-right: .55em; }
    tbody tr:not(.bt) td:last-child { padding-right: .6em; }
    footer { position: absolute; right: ${SEITE.rand}mm; bottom: 4.6mm; font-size: 9pt; color: #55656f; }
  `;

  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function datumLang(iso) { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(text(iso)); return m ? `${+m[3]}. ${MONATE[+m[2] - 1]} ${m[1]}` : ''; }

  /**
   * meta: { kunde, name, datum } für die Titelfolie. Die Platzhalter __OFFERTE_…__ ersetzt die App beim Erzeugen des PDF
   * durch das Titelbild und das Logo aus dem Ordner «Vorlagen» (oder durch nichts, wenn sie fehlen).
   */
  function html(doc, meta) {
    const d = normalize(doc), m = meta || {};
    const titel = `<section class="folie titel"><div class="block">
        <p class="art">${ARTEN[d.art]}</p><div class="strich"></div>
        ${m.kunde ? `<p class="kunde">${esc(m.kunde)}</p>` : ''}${m.name ? `<p class="projekt">${esc(m.name)}</p>` : ''}
        ${m.datum ? `<p class="datum">${esc(datumLang(m.datum))}</p>` : ''}</div></section>`;
    return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${ARTEN[d.art]}</title><style>${CSS}</style></head><body>
      ${titel}
      ${d.teile.map((t) => teilHtml(d, t)).join('\n')}</body></html>`;
  }

  /* ---------- LaTeX ---------- */

  const tex = (s) => text(s)
    .replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}')
    .replace(/«/g, '\\guillemotleft{}').replace(/»/g, '\\guillemotright{}');
  const texKursiv = (s) => tex(s).replace(/\*([^*\n]+)\*/g, '\\textit{$1}');

  function teilLatex(d, t) {
    const einfach = istEinfach(t);
    const out = [];
    if (t.umbruch) out.push('\\newpage');
    out.push(`\\noindent{\\large\\textbf{${tex(kopf(d, t))}}} {\\footnotesize\\textbf{${tex(t.titel)}}}`, '', '\\medskip');
    if (t.text.trim()) out.push(`\\noindent ${texKursiv(t.text)}`, '', '\\medskip');
    out.push(einfach ? '\\noindent\\begin{tabularx}{\\textwidth}{|X|r|}' : '\\noindent\\begin{tabularx}{\\textwidth}{|X|llr|r|}', '\\hline');
    out.push(einfach ? '\\textbf{Was} & \\textbf{Total} \\\\ \\hline\\hline'
      : '\\textbf{Was} & \\textbf{Aufwand} & \\textbf{Ansatz} & \\textbf{Preis} & \\textbf{Total} \\\\ \\hline\\hline');
    t.bloecke.forEach((b) => {
      if (!b.zeilen.length && !b.titel.trim()) return;
      if (b.titel.trim()) out.push(einfach ? `\\textbf{${tex(b.titel)}} & \\\\` : `\\textbf{${tex(b.titel)}} & & & & \\\\`);
      b.zeilen.forEach((z, i) => {
        const letzte = i === b.zeilen.length - 1;
        const preis = z.preis === 'inklusive' ? '\\textcolor{inklusive}{inklusive}' : tex(preisText(z));
        out.push(einfach ? `${tex(z.was)} & ${preis} \\\\`
          : `${tex(z.was)} & ${tex(z.aufwand)} & ${tex(ansatzText(z))} & ${preis} & ${letzte ? tex(fr(blockTotal(b))) : ''} \\\\`);
      });
      out.push('\\hline');
    });
    out.push('\\hline', einfach ? `\\textbf{Preis} & \\textbf{${tex(fr(teilTotal(t)))}} \\\\ \\hline`
      : `\\textbf{Preis} & & & & \\textbf{${tex(fr(teilTotal(t)))}} \\\\ \\hline`, '\\end{tabularx}', '', '\\bigskip\\bigskip', '');
    return out.join('\n');
  }

  function latex(doc) {
    const d = normalize(doc);
    return `\\documentclass[9pt,a4paper,landscape]{extarticle}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[ngerman]{babel}
\\usepackage{mathpazo}
\\usepackage[left=15mm,right=15mm,top=22mm,bottom=18mm]{geometry}
\\usepackage{tabularx}
\\usepackage{xcolor}
\\definecolor{inklusive}{RGB}{232,116,44}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}

\\begin{document}

${d.teile.map((t) => teilLatex(d, t)).join('\n')}
\\end{document}
`;
  }

  /* ---------- Austausch mit Claude ---------- */

  const FORMAT = `Format (JSON):
{
  "art": "offerte" oder "kostenvoranschlag",
  "teile": [                       // jede Variante oder jedes Angebot ist ein Teil mit eigener Tabelle
    {
      "nummer": "1a",              // steht nach «Offerte» bzw. «Kostenvoranschlag»; darf leer sein
      "titel": "Panel-Moderation (rund 45 Minuten) mit drei Gästen, plus Q&A",
      "text": "Einleitung. *Sternchen* setzen Wörter kursiv.",
      "umbruch": false,            // true = dieser Teil beginnt auf einer neuen Seite
      "bloecke": [
        {
          "titel": "Projektmanagement und Recherchearbeiten",
          "zeilen": [
            { "was": "Recherche, Faktencheck", "aufwand": "10h", "ansatz": 215, "preis": "auto" },
            { "was": "Pauschale für Veranstaltung am Abend", "aufwand": "pauschal", "ansatz": 500, "preis": "null" }
          ]
        }
      ]
    }
  ]
}
Regeln:
- "aufwand": Zahl mit Einheit («10h») oder «pauschal». "ansatz": Zahl in Franken (pro Einheit oder pauschal).
- "preis": "auto" = Aufwand mal Ansatz (bei pauschal: der Ansatz); "inklusive" = wird als «inklusive» gezeigt und nicht verrechnet; "null" = 0.00, Position entfällt.
- Preise und Summen NICHT ins JSON schreiben, die App rechnet sie selbst.
- Für eine einfache Preisliste ohne Aufwand: einen Block ohne Titel, Zeilen mit leerem "aufwand" und dem Betrag in "ansatz".`;

  function promptAnpassen(doc) {
    return `Unten steht eine Offerte aus meiner Zeiterfassungs-App als JSON. Ich sage dir gleich, was ich daran ändern will. Antworte dann nur mit dem vollständigen, angepassten JSON in einem Codeblock, ohne weitere Erklärungen. Ändere nichts, was ich nicht verlange. Schweizer Rechtschreibung (kein ß).

${FORMAT}

Aktuelle Offerte:
\`\`\`json
${JSON.stringify(normalize(doc), null, 1)}
\`\`\`

Meine Änderungen:
`;
  }
  function promptVorlage() {
    return `Ich lade dir eine Offerte oder einen Kostenvoranschlag hoch (PDF oder LaTeX-Code). Übertrage den Inhalt vollständig und wortgetreu in das folgende JSON-Format meiner Zeiterfassungs-App. Antworte nur mit dem JSON in einem Codeblock. Schweizer Rechtschreibung (kein ß).

${FORMAT}
`;
  }
  /** Holt das JSON aus einer eingefügten Antwort (mit oder ohne Codeblock). */
  function ausAntwort(roh) {
    const s = text(roh);
    const block = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
    let kern = (block ? block[1] : s).trim();
    const a = kern.indexOf('{'), b = kern.lastIndexOf('}');
    if (a < 0 || b <= a) return { fehler: 'Im eingefügten Text ist kein JSON zu finden.' };
    kern = kern.slice(a, b + 1);
    let d;
    try { d = JSON.parse(kern); } catch (e) { return { fehler: 'Das JSON ist nicht lesbar: ' + e.message }; }
    const ziel = d && Array.isArray(d.teile) ? d : d && d.doc && Array.isArray(d.doc.teile) ? d.doc : null;
    if (!ziel) return { fehler: 'Das JSON enthält keine «teile».' };
    return { doc: normalize(ziel) };
  }

  /* ---------- Einlesen: LaTeX-Code ---------- */

  const betragAus = (t) => { const m = /-?\d[\d’']*(?:[.,]\d+)?/.exec(text(t)); return m ? zahl(m[0]) : null; };
  const KOPF_RE = /(Offerte|Kostenvoranschlag)\b[ \t]*([^:\n]{0,14}?)[ \t]*:[ \t]*/i;

  /** LaTeX-Schnipsel → Klartext; Kursives wird zu *…*. */
  function texKlar(t) {
    let s = text(t);
    s = s.replace(/\\(?:textit|emph)\s*\{([^{}]*)\}/g, '*$1*').replace(/\{\\(?:it|em|itshape)\s+([^{}]*)\}/g, '*$1*');
    s = s.replace(/\\guillemot(?:left|right)\s*(?:\{\})?/g, (m) => (m.includes('left') ? '«' : '»')).replace(/\\(?:flqq|glqq)\s*(?:\{\})?/g, '«').replace(/\\(?:frqq|grqq)\s*(?:\{\})?/g, '»');
    s = s.replace(/\\textbackslash\s*(?:\{\})?/g, '\u0001').replace(/\\textasciitilde\s*(?:\{\})?/g, '~').replace(/\\textasciicircum\s*(?:\{\})?/g, '^');
    s = s.replace(/\\"([aouAOU])/g, (_, c) => ({ a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' }[c])).replace(/"([aouAOU])/g, (_, c) => ({ a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' }[c]));
    s = s.replace(/\\textcolor\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '').replace(/\\color\s*\{[^{}]*\}/g, '');
    s = s.replace(/\\(?:hspace|vspace|setlength|addtolength)\*?\s*(?:\{[^{}]*\})+/g, ' ');
    s = s.replace(/\\multicolumn\s*\{[^{}]*\}\s*\{[^{}]*\}/g, '');
    s = s.replace(/\\([&%$#_{}])/g, '\u0002$1');                       // maskierte Sonderzeichen merken
    for (let i = 0; i < 6; i++) s = s.replace(/\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?/g, ' ');   // übrige Befehle weg, ihr Inhalt bleibt
    s = s.replace(/(?<!\u0002)[{}]/g, '').replace(/~/g, ' ').replace(/\u0002/g, '').replace(/\u0001/g, '\\');
    return s.replace(/``|''/g, '"').replace(/\s+/g, ' ').trim();
  }

  function zeileAus(zellen, einfach) {
    const was = zellen[0] || '';
    if (einfach || zellen.length < 4) {
      const b = betragAus(zellen[zellen.length - 1]);
      return { was, aufwand: '', ansatz: b || 0, preis: 'auto' };
    }
    const aufwand = zellen[1] || '', ansatz = betragAus(zellen[2]), preisZ = zellen[3] || '';
    const z = { was, aufwand, ansatz: ansatz || 0, preis: 'auto' };
    if (/inkl/i.test(preisZ)) z.preis = 'inklusive';
    else {
      const p = betragAus(preisZ);
      if (ansatz == null && p != null) { z.ansatz = p; }
      else if (p === 0 && zeilenPreis(z) !== 0) z.preis = 'null';
    }
    return z;
  }
  const istSumme = (was) => /^(preis|total|gesamt(preis|total)?|summe)\b/i.test(text(was).trim());

  /** Liest LaTeX-Code (aus der App oder eigene Vorlagen mit Tabellen) in die feste Form ein. */
  function ausLatex(roh) {
    let s = text(roh).replace(/\r/g, '').replace(/(^|[^\\])%.*$/gm, '$1');
    const a = s.indexOf('\\begin{document}'), e = s.lastIndexOf('\\end{document}');
    if (a >= 0) s = s.slice(a + 16, e > a ? e : undefined);
    const re = /\\begin\{(tabularx|tabular\*?|longtable|tabulary)\}([\s\S]*?)\\end\{\1\}/g;
    const teile = []; let art = null, pos = 0, m;
    while ((m = re.exec(s))) {
      const davor = s.slice(pos, m.index); pos = re.lastIndex;
      const umbruch = /\\(newpage|clearpage|pagebreak)\b/.test(davor);
      const abs = davor.split(/\n\s*\n|\\\\|\\(?:par|medskip|bigskip|smallskip|newpage|clearpage|pagebreak)\b/).map(texKlar).filter(Boolean);
      const t = { nummer: '', titel: '', text: '', umbruch, bloecke: [] };
      const ki = abs.findIndex((x) => KOPF_RE.test(x));
      if (ki >= 0) {
        const k = KOPF_RE.exec(abs[ki]);
        if (!art) art = k[1].toLowerCase();
        t.nummer = k[2].trim(); t.titel = abs[ki].slice(k.index + k[0].length).replace(/\*/g, '').trim();
        t.text = abs.slice(ki + 1).join(' ');
      } else if (abs.length) { t.titel = abs[0].replace(/\*/g, ''); t.text = abs.slice(1).join(' '); }
      // Tabelle: Spaltenangaben am Anfang überspringen, dann Zeile für Zeile
      let inhalt = m[2];
      for (let i = 0; i < 3; i++) { const g = /^\s*(\[[^\]]*\]|\{(?:[^{}]|\{[^{}]*\})*\})/.exec(inhalt); if (!g) break; inhalt = inhalt.slice(g[0].length); }
      let block = null;
      for (const rz of inhalt.split(/\\\\(?:\[[^\]]*\])?|\\tabularnewline\b/)) {
        const fett = /\\textbf|\\bfseries|\\bf\b/.test(rz);
        const zellen = rz.replace(/\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\}|endhead|endfoot|endlastfoot|endfirsthead)/g, '').split(/(?<!\\)&/).map(texKlar);
        if (!zellen.some(Boolean)) continue;
        const rest = zellen.slice(1).filter(Boolean);
        if (/^was$/i.test(zellen[0]) || (fett && istSumme(zellen[0]))) continue;
        if (!rest.length && fett) { block = { titel: zellen[0], zeilen: [] }; t.bloecke.push(block); continue; }
        if (!block) { block = { titel: '', zeilen: [] }; t.bloecke.push(block); }
        block.zeilen.push(zeileAus(zellen, zellen.length < 4));
      }
      if (t.bloecke.length) teile.push(t);
    }
    if (!teile.length) return { fehler: 'Im LaTeX-Code ist keine Tabelle mit Positionen zu finden.' };
    return { doc: normalize({ art: art || 'offerte', teile }) };
  }

  /* ---------- Einlesen: PDF ---------- */

  /**
   * seiten: [{ items: [{ s, x, y, w, fett, kursiv }] }] mit Koordinaten von links oben (aus pdf.js).
   * Erkennt Überschriften «Offerte/Kostenvoranschlag …:», die Einleitung und Tabellen mit der Kopfzeile «Was … Total».
   */
  /** Textstücke einer Zeile zusammensetzen: Leerschlag nur, wo wirklich eine Lücke ist (Ligaturen wie «ff» kommen als eigene Stücke). */
  function verbinde(items, mitKursiv) {
    let out = '', letzter = null, kursivOffen = false;
    for (const it of items) {
      const s = it.s.trim(); if (!s) continue;
      const luecke = letzter ? it.x - (letzter.x + letzter.w) > 1.2 : false;
      const k = !!(mitKursiv && it.kursiv);
      if (kursivOffen && !k) { out += '*'; kursivOffen = false; }
      if (luecke) out += ' ';
      if (k && !kursivOffen) { out += '*'; kursivOffen = true; }
      out += s; letzter = it;
    }
    return out + (kursivOffen ? '*' : '');
  }

  function ausPdf(seiten) {
    const teile = []; let art = null, t = null, tab = null, block = null;
    (seiten || []).forEach((seite, si) => {
      let ersteAufSeite = true;
      const items = (seite.items || []).filter((i) => text(i.s).trim());
      // Zeilen bilden: gleiche Grundlinie (± 2.5)
      const zeilen = [];
      for (const it of items.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
        const z = zeilen.find((q) => Math.abs(q.y - it.y) <= 2.5);
        if (z) z.items.push(it); else zeilen.push({ y: it.y, items: [it] });
      }
      for (const z of zeilen) {
        z.items.sort((a, b) => a.x - b.x);
        const ganz = verbinde(z.items);
        const kopf = !tab && z.items[0].fett && KOPF_RE.exec(ganz);
        if (kopf && kopf.index === 0) {
          if (!art) art = kopf[1].toLowerCase();
          t = { nummer: kopf[2].trim(), titel: ganz.slice(kopf[0].length).trim(), text: '', umbruch: si > 0 && ersteAufSeite, bloecke: [], _zeilen: [] };
          teile.push(t); tab = null; block = null; ersteAufSeite = false; continue;
        }
        if (!t) continue;
        ersteAufSeite = false;
        if (!tab && /^was$/i.test(z.items[0].s.trim())) {
          const sp = (name) => z.items.find((i) => i.s.trim().toLowerCase() === name);
          const total = sp('total'), preis = sp('preis'), aufwand = sp('aufwand'), ansatz = sp('ansatz');
          tab = { einfach: !(aufwand && ansatz && preis), xAufwand: aufwand && aufwand.x, xAnsatz: ansatz && ansatz.x, rPreis: preis && preis.x + preis.w, rTotal: total ? total.x + total.w : null };
          t.text = t._zeilen.reduce((acc, l) => (/[a-zäöü]-$/.test(acc) && /^[a-zäöü]/.test(l) ? acc.slice(0, -1) + l : acc ? acc + ' ' + l : l), '');
          block = null; continue;
        }
        if (!tab) { t._zeilen.push(verbinde(z.items, true)); continue; }
        // Tabellenzeile: Stücke den Spalten zuordnen
        const stuecke = [[], [], [], [], []];
        let vorher = -1;
        for (const it of z.items) {
          const s = it.s.trim(), r = it.x + it.w;
          let k;
          if (tab.einfach) k = tab.rTotal != null && Math.abs(r - tab.rTotal) < 4 && betragAus(s) != null && it !== z.items[0] ? 4 : 0;
          else if (it.x < tab.xAufwand - 3) k = 0;
          else if (it.x < tab.xAnsatz - 3) k = 1;
          else if (Math.abs(it.x - tab.xAnsatz) < 3) k = 2;
          else if (r <= tab.rPreis + 4) k = 3;
          else k = 4;
          // Ein Stück, das lückenlos an das vorige anschliesst, gehört in dieselbe Spalte.
          const letzter = vorher >= 0 ? stuecke[vorher][stuecke[vorher].length - 1] : null;
          if (letzter && it.x - (letzter.x + letzter.w) <= 1.2) k = vorher;
          stuecke[k].push(it); vorher = k;
        }
        const zellen = stuecke.map((l) => verbinde(l));
        if (istSumme(zellen[0]) && !zellen[1] && !zellen[2] && !zellen[3]) { tab = null; block = null; t._fertig = true; continue; }
        if (zellen[0] && !zellen[1] && !zellen[2] && !zellen[3] && !zellen[4]) { block = { titel: zellen[0], zeilen: [] }; t.bloecke.push(block); continue; }
        if (!block) { block = { titel: '', zeilen: [] }; t.bloecke.push(block); }
        block.zeilen.push(tab.einfach ? zeileAus([zellen[0], zellen[4]], true) : zeileAus(zellen, false));
      }
    });
    const gut = teile.filter((x) => x.bloecke.length);
    if (!gut.length) return { fehler: 'Im PDF ist keine Offerte mit einer Tabelle «Was … Total» zu erkennen. Versuch es mit dem LaTeX-Code.' };
    return { doc: normalize({ art: art || 'offerte', teile: gut }) };
  }

  /** Datei oder eingefügter Text → Dokument. Erkennt JSON, LaTeX und die Seiten eines PDF. */
  function ausDatei(r) {
    if (r && r.seiten) return ausPdf(r.seiten);
    const t = text(r && r.text).trim();
    if (!t) return { fehler: 'Die Datei ist leer.' };
    if (/\\begin\{|\\\\/.test(t)) return ausLatex(t);
    return ausAntwort(t);
  }

  const leer = (art) => normalize({ art, teile: [{ nummer: '', titel: '', text: 'Alle Preise verstehen sich exkl. Mwst.', bloecke: [{ titel: '', zeilen: [{ was: '', aufwand: '', ansatz: 0, preis: 'auto' }] }] }] });

  return { ARTEN, normalize, aufwandTeile, zeilenPreis, blockTotal, teilTotal, istEinfach, ansatzText, preisText, fr, kopf, kurz, html, latex, promptAnpassen, promptVorlage, ausAntwort, ausLatex, ausPdf, ausDatei, leer };
});
