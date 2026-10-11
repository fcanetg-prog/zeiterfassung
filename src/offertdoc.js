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
    if (a.menge == null || !a.einheit) return fr(z.ansatz);
    const n = Number.isInteger(z.ansatz) ? String(z.ansatz) : z.ansatz.toFixed(2);
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

  function teilHtml(d, t) {
    const einfach = istEinfach(t);
    const spalten = einfach ? 2 : 5;
    let zeilen = '';
    t.bloecke.forEach((b) => {
      if (!b.zeilen.length && !b.titel.trim()) return;
      if (b.titel.trim()) zeilen += `<tr class="bt"><td colspan="${spalten}">${esc(b.titel)}</td></tr>`;
      b.zeilen.forEach((z, i) => {
        const letzte = i === b.zeilen.length - 1;
        zeilen += einfach
          ? `<tr class="${letzte ? 'bl' : ''}"><td>${esc(z.was)}</td><td class="r">${preisText(z)}</td></tr>`
          : `<tr class="${letzte ? 'bl' : ''}"><td>${esc(z.was)}</td><td>${esc(z.aufwand)}</td><td>${esc(ansatzText(z))}</td>
              <td class="r ${z.preis === 'inklusive' ? 'ink' : ''}">${preisText(z)}</td><td class="r">${letzte ? fr(blockTotal(b)) : ''}</td></tr>`;
      });
      if (!b.zeilen.length) zeilen += `<tr class="bl"><td colspan="${spalten}"></td></tr>`;
    });
    return `<section class="teil ${t.umbruch ? 'umbruch' : ''}">
      <h2>${esc(kopf(d, t))} <small>${esc(t.titel)}</small></h2>
      ${t.text.trim() ? `<p>${mitKursiv(t.text)}</p>` : ''}
      <table class="${einfach ? 'einfach' : ''}">
        <thead><tr>${einfach ? '<th>Was</th><th class="r">Total</th>' : '<th>Was</th><th>Aufwand</th><th>Ansatz</th><th class="r">Preis</th><th class="r">Total</th>'}</tr></thead>
        <tbody>${zeilen}</tbody>
        <tfoot><tr><td colspan="${spalten - 1}">Preis</td><td class="r">${fr(teilTotal(t))}</td></tr></tfoot>
      </table></section>`;
  }

  const CSS = `
    @page { size: A4 landscape; margin: 22mm 15mm 18mm 15mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Palatino Linotype", "Book Antiqua", Palatino, "TeX Gyre Pagella", "URW Palladio L", "P052", serif; font-size: 9.2pt; line-height: 1.32; color: #000; }
    .teil { break-inside: avoid; margin: 0 0 9mm; }
    .teil.umbruch { break-before: page; }
    h2 { font-size: 12.5pt; margin: 0 0 3.6mm; font-weight: 700; }
    h2 small { font-size: 8pt; font-weight: 700; }
    p { margin: 0 0 3.6mm; text-align: justify; }
    table { width: 100%; border-collapse: collapse; border: 0.5pt solid #000; }
    th, td { padding: 0.25mm 1.6mm; text-align: left; vertical-align: top; }
    th { font-weight: 700; border-bottom: 2.2pt double #000; }
    td.r, th.r { text-align: right; white-space: nowrap; }
    th:nth-child(1), td:nth-child(1) { border-right: 0.5pt solid #000; }
    table:not(.einfach) th:nth-child(1) { width: 65%; }
    table:not(.einfach) th:nth-child(2) { width: 8%; }
    table:not(.einfach) th:nth-child(3) { width: 9%; }
    table:not(.einfach) th:nth-child(4) { width: 9%; }
    table:not(.einfach) th:nth-child(4), table:not(.einfach) td:nth-child(4) { border-right: 0.5pt solid #000; }
    tr.bt td { font-weight: 700; border-right: 0; }
    tr.bt td:first-child { border-right: 0.5pt solid transparent; }
    tr.bl td { border-bottom: 0.5pt solid #000; }
    td.ink { color: #e8742c; }
    tfoot td { font-weight: 700; border-top: 2.2pt double #000; }
    tbody tr:last-child td { border-bottom: 0; }
  `;

  function html(doc) {
    const d = normalize(doc);
    return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${ARTEN[d.art]}</title><style>${CSS}</style></head><body>
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

  const leer = (art) => normalize({ art, teile: [{ nummer: '', titel: '', text: 'Alle Preise verstehen sich exkl. Mwst.', bloecke: [{ titel: '', zeilen: [{ was: '', aufwand: '', ansatz: 0, preis: 'auto' }] }] }] });

  return { ARTEN, normalize, aufwandTeile, zeilenPreis, blockTotal, teilTotal, istEinfach, ansatzText, preisText, fr, kopf, kurz, html, latex, promptAnpassen, promptVorlage, ausAntwort, leer };
});
