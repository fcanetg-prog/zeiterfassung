# Zeiterfassung

Windows-Desktop-App für die Zeiterfassung pro Tag und Projekt, mit Projektübersicht
(Ansatz, Kosten, Stunden, Franken pro Stunde, Effort) und Rechnungsstatus.

## Installieren

Unter **Releases** die neuste `Zeiterfassung-Setup-x.y.z.exe` herunterladen und doppelklicken.
Bei der Windows-Warnung «Weitere Informationen» und dann «Trotzdem ausführen» wählen.
Ein Update installiert man gleich; die Daten bleiben erhalten.

## Daten

Die Daten liegen als eine Datei unter `Dokumente\Zeiterfassung\zeiterfassung-daten.json`
(änderbar unter Einstellungen). Im Unterordner `Sicherungen` liegt pro Tag eine Kopie.
In diesem Repository liegen keine Daten.

## Entwickeln

    npm install
    npm start        # App starten
    npm test         # Rechenlogik prüfen
    npm run dist     # Installer bauen (auf Windows)

Jeder Push auf `main` baut den Installer über GitHub Actions und legt einen Release an.

`tools/excel_to_json.py` wandelt das bisherige Excel in eine Importdatei um:

    python3 tools/excel_to_json.py Arbeitsstunden_und_Rechnungsstellung_2026.xlsx 2026 Import_2026.json
