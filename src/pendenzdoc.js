/* Pendenzen: Datenformat, Einteilung nach Fälligkeit und Übernahme aus einem Asana-CSV-Export. Läuft im Fenster und in Node (Tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PendenzDoc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** «Was tun» ersetzt die Priorität aus Asana: Low → Rückmeldung überwachen, Medium → kurz nachfragen. */
  const WAS_TUN = [['rueckmeldung', 'Rückmeldung überwachen'], ['nachfragen', 'Kurzes E-Mail schreiben'], ['umsetzen', 'Umsetzen']];
  const WAS_TUN_TEXT = Object.fromEntries(WAS_TUN);
  /** Anfrage: «offen» ist erst eine Anfrage an mich, «bestaetigt» eine richtige Aufgabe. */
  const ANFRAGE = [['offen', 'Offen'], ['bestaetigt', 'Bestätigt'], ['abgesagt', 'Abgesagt']];

  /** Feste Tags zur Auswahl (in dieser Reihenfolge); dazu kommen die übrigen, die auf Pendenzen vorkommen. */
  const TAGS = ['Intern', 'Texte', 'Podcasts', 'Moderationen', 'Referate', 'Panels', 'Expertenauftritte', 'Medienauftritte', 'Teaching'];
  /** Frühere Tags → heutige: Admin → Intern, die vier Podcasts → Podcasts, der kombinierte Auftritte-Tag → Moderationen. */
  const TAG_NEU = {
    Admin: 'Intern', Geldcast: 'Podcasts', 'Schweizer Wirtschaft Daily': 'Podcasts', 'Börsenstrasse Fünfzehn': 'Podcasts', 'Angebot und Nachgefragt': 'Podcasts',
    'Moderationen | Referate | Panel': 'Moderationen', 'Moderationen | Referate | Panels': 'Moderationen',
  };

  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  /**
   * Einmalig: Die datierten Zeilen am Anfang der Notizen («23.11. bei Marco melden») sind die To-Dos.
   * Sie wandern ins Feld To-Dos, alles danach bleibt in den Notizen.
   */
  const DATUMZEILE = /^\s*(\d{1,2}|xx)\.(\d{1,2}|xx)\.(\d{2,4})?\s/i;
  function todosAusNotiz(notiz) {
    const z = String(notiz || '').split('\n');
    let ende = 0, i = 0;
    while (i < z.length) {
      if (DATUMZEILE.test(z[i])) { ende = i + 1; i++; continue; }
      if (!z[i].trim()) { i++; continue; }
      break;
    }
    if (!ende) return { todos: '', notiz: String(notiz || '') };
    return { todos: z.slice(0, ende).filter((l) => l.trim()).join('\n'), notiz: z.slice(ende).join('\n').replace(/^\s*\n/, '') };
  }
  function todosUndNotiz(p) {
    if (p.todosVerschoben || String(p.todos || '').trim()) return { todos: String(p.todos || ''), notiz: String(p.notiz || ''), todosVerschoben: true };
    return { ...todosAusNotiz(p.notiz), todosVerschoben: true };
  }

  function normalize(p) {
    if (!p || !p.id) return null;
    return {
      id: String(p.id),
      titel: String(p.titel || ''),
      ...todosUndNotiz(p),
      // Notizen und To-Dos mit Formatierung (fett, kursiv) sind als bereinigtes HTML gespeichert.
      ...(p.notizHtml ? { notizHtml: true } : {}), ...(p.todosHtml ? { todosHtml: true } : {}),
      faellig: isoOk(p.faellig) ? p.faellig : '',
      // Das frühere Asana-Tag «Admin» heisst jetzt wie der Bereich in den Projekten: «Intern».
      tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).map((t) => String(t).trim()).filter(Boolean).map((t) => TAG_NEU[t] || t))],
      // «Nichts» gibt es nicht mehr: ohne Angabe heisst es «Umsetzen».
      wasTun: WAS_TUN_TEXT[p.wasTun] ? p.wasTun : 'umsetzen',
      anfrage: ['offen', 'abgesagt'].includes(p.anfrage) ? p.anfrage : 'bestaetigt',
      erledigt: isoOk(p.erledigt) ? p.erledigt : null,
      ...(isoOk(p.faelligVorher) ? { faelligVorher: p.faelligVorher } : {}),
      erstellt: p.erstellt || '',
      ...(p.asanaId ? { asanaId: String(p.asanaId) } : {}),
      mod: p.mod || 0,
    };
  }

  /** CSV lesen: Komma oder Semikolon, Felder in Anführungszeichen dürfen Zeilenumbrüche und "" enthalten. */
  function csvParse(text) {
    const t = String(text || '').replace(/^﻿/, '');
    const ersteZeile = t.slice(0, Math.max(0, t.indexOf('\n')) || t.length);
    const trenner = (ersteZeile.match(/;/g) || []).length > (ersteZeile.match(/,/g) || []).length ? ';' : ',';
    const zeilen = [];
    let feld = '', zeile = [], inQ = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inQ) {
        if (c === '"') { if (t[i + 1] === '"') { feld += '"'; i++; } else inQ = false; }
        else feld += c;
      } else if (c === '"') inQ = true;
      else if (c === trenner) { zeile.push(feld); feld = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i++;
        zeile.push(feld); feld = '';
        if (zeile.length > 1 || zeile[0] !== '') zeilen.push(zeile);
        zeile = [];
      } else feld += c;
    }
    if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
    return zeilen;
  }

  /** Asana setzt vor Felder, die mit - = + @ beginnen, ein Hochkomma (Schutz für Excel). Das gehört nicht zum Text. */
  const ohneHochkomma = (s) => String(s || '').replace(/^'(?=[-=+@])/, '');

  /**
   * Asana-CSV («Exportieren/Drucken → CSV») in Pendenzen übersetzen. Nur offene Aufgaben (ohne «Completed At»).
   * Tag «offen» → Anfrage offen (und kein Tag mehr); Priorität Low/Medium → Was tun.
   */
  function ausAsanaCsv(text, uid) {
    const zeilen = csvParse(text);
    if (!zeilen.length) return { fehler: 'Die Datei ist leer.' };
    const kopf = zeilen[0].map((h) => h.trim());
    const sp = (name) => kopf.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const iName = sp('Name'), iErl = sp('Completed At'), iFaellig = sp('Due Date'), iTags = sp('Tags'), iNotes = sp('Notes'), iPrio = sp('Priority'), iId = sp('Task ID'), iErst = sp('Created At'), iParent = sp('Parent task');
    if (iName < 0 || iErl < 0) return { fehler: 'Das ist kein Asana-Export: Die Spalten «Name» und «Completed At» fehlen.' };
    const wert = (z, i) => (i >= 0 && i < z.length ? z[i] : '');
    const out = [];
    let erledigt = 0;
    for (const z of zeilen.slice(1)) {
      if (!wert(z, iName).trim() && !wert(z, iNotes).trim()) continue;
      if (wert(z, iErl).trim()) { erledigt++; continue; }
      const tags = wert(z, iTags).split(',').map((s) => s.trim()).filter(Boolean);
      const prio = wert(z, iPrio).trim().toLowerCase();
      let notiz = ohneHochkomma(wert(z, iNotes)).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
      const parent = wert(z, iParent).trim();
      if (parent) notiz = `Unteraufgabe von: ${parent}${notiz ? '\n\n' + notiz : ''}`;
      out.push(normalize({
        id: uid ? uid() : 'pd' + Math.random().toString(36).slice(2, 10),
        titel: wert(z, iName).trim(),
        notiz,
        faellig: wert(z, iFaellig).trim().slice(0, 10),
        tags: tags.filter((t) => t.toLowerCase() !== 'offen'),
        anfrage: tags.some((t) => t.toLowerCase() === 'offen') ? 'offen' : 'bestaetigt',
        wasTun: prio === 'low' || prio === 'niedrig' ? 'rueckmeldung' : prio === 'medium' || prio === 'mittel' ? 'nachfragen' : '',
        erstellt: wert(z, iErst).trim().slice(0, 10),
        asanaId: wert(z, iId).trim() || undefined,
      }));
    }
    return { pendenzen: out, erledigt, gesamt: out.length + erledigt };
  }

  const addTage = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  /** Abschnitt einer Pendenz: offen oder erledigt. */
  function abschnitt(p) { return p.erledigt ? 'erledigt' : 'offen'; }

  /** Nächster Schritt: die erste Zeile der Notizen (in Asana stehen dort die datierten To-dos). */
  function naechsterSchritt(p) {
    const z = String(p.notiz || '').split('\n').map((s) => s.trim()).find((s) => s && !/^[-–_*=]{3,}$/.test(s) && !/^(HISTORY|INFORMATIONEN)/i.test(s));
    return z || '';
  }

  return { WAS_TUN, WAS_TUN_TEXT, ANFRAGE, TAGS, TAG_NEU, normalize, todosAusNotiz, csvParse, ausAsanaCsv, abschnitt, naechsterSchritt, addTage };
});
