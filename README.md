# Korrektur von Schülertexten mit Claude Code

Claude korrigiert Word-Dateien (.docx) von Schülerinnen und Schülern wie mit dem Rotstift:
Fehler rot durchgestrichen und verbessert, Kategorie (R, G, T, Z) als Word-Kommentar,
unsichere Stellen gelb (mit Kommentar «H: Grund»), Zusammenfassung am Schluss. Das Original bleibt unverändert,
das Ergebnis liegt als `<name>_korrigiert.docx` daneben.

Die Regeln stehen in [CLAUDE.md](CLAUDE.md).

## Inhalt

| Datei | Zweck |
|---|---|
| `CLAUDE.md` | Korrekturregeln und Ablauf, liest Claude automatisch |
| `.claude/agents/korrektur-leser.md` | Subagent pro Textblock: findet R-, G- und Z-Fehler (ohne Kommas) |
| `.claude/agents/korrektur-komma.md` | Subagent (Sonnet): nur Kommas nach dem Regelwerk 2024, bei Texten bis ca. 1500 Wörtern auch Tempus |
| `.claude/agents/korrektur-tempus.md` | Subagent (Sonnet) nur für lange Texte: eindeutige Tempusfehler, nie gelb |
| `.claude/agents/korrektur-pruefer.md` | Subagent: führt alle Listen zusammen, prüft und ergänzt |
| `.claude/regeln/` | Detailregeln: `komma.md`, `tempus.md`, `schweiz.md` |
| `.claude/vergleich.js` | Messung: vergleicht Claudes Liste mit einer Musterkorrektur (nur macOS) |
| `.claude/korrektur.js` | Werkzeug für macOS: setzt die Korrekturen ins .docx und prüft das Ergebnis |
| `.claude/korrektur.ps1` | Werkzeug für Windows, gleiches Verhalten |
| `.claude/test_korrektur.js`, `.claude/test_korrektur.ps1` | Selbsttests der beiden Werkzeuge |
| `.claude/settings.json` | erlaubt Claude, das Werkzeug ohne Rückfrage auszuführen |

## Voraussetzungen

- [Claude Code](https://claude.com/claude-code) (Desktop-App oder Terminal), Abo mit Zugang zu Opus
  (`korrektur-leser` läuft mit `model: opus`, `korrektur-pruefer` mit `model: sonnet`, um das Nutzungslimit zu schonen)
- macOS oder Windows 10/11. Sonst nichts: kein Python, keine Zusatzprogramme.
  Das Werkzeug nutzt nur, was das Betriebssystem mitbringt
  (macOS: `osascript`, `zip`, `unzip`, `xmllint`; Windows: PowerShell 5.1).

## Einrichten mit Claude

1. Repo klonen oder als ZIP herunterladen und entpacken, z.B. in den Ordner, in dem die Schülertexte liegen sollen.
2. Den Ordner in Claude Code öffnen.
3. Claude schreiben:

   > Richte das Korrektur-Setup nach README.md ein.

Claude führt dann die Schritte unter «Einrichtung (für Claude)» aus.

## Einrichtung (für Claude)

1. Nichts installieren. Den Selbsttest für das Betriebssystem ausführen:
   - macOS: `osascript -l JavaScript .claude/test_korrektur.js`
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/test_korrektur.ps1`

   Erwartet: `Alle Tests bestanden`.
2. Windows: Meldet PowerShell, dass Skripte gesperrt sind (Ausführungsrichtlinie), ist das eine Vorgabe
   der Schul-IT. Nicht umgehen, sondern der Person sagen, dass die IT `korrektur.ps1` freigeben muss.
3. Der Person melden: Einrichtung fertig, Test bestanden.

## Benutzen

Die .docx-Datei in den Ordner legen und Claude nur den Dateinamen schicken, z.B.:

> Muster_Anna_Erörterung.docx

Claude korrigiert ohne Rückfragen und meldet am Schluss den Namen der Kopie.
Mehrere Dateinamen auf einmal gehen auch.

## Datenschutz

`.gitignore` lässt nur die Setup-Dateien ins Repo. Schülertexte (.docx) und alle anderen Dateien
im Ordner werden nie committet. Diese Regel nicht lockern.

## Hinweis zum Fehlerlog

`FEHLERLOG.md` (Fehler, die Claude gemacht hat, mit Zitaten aus Schülertexten) bleibt lokal und ist nicht im Repo. Die Subagents legen die Datei beim ersten Eintrag selbst an.

## LanguageTool (optional, macOS)

`.claude/languagetool.js` ruft die lokale App `languagetool-ui` (`start.command`, Port 8772, LanguageTool plus Zusatzregeln) auf und liefert dem Prüfer Hinweise. Voraussetzung: `brew install languagetool`.
