# Korrektur von Schülertexten

In diesem Ordner liegen Word-Dateien (.docx) von Schülerinnen und Schülern.
Schickt der Benutzer nur einen Dateinamen (oder mehrere), diese Datei sofort nach den Regeln unten korrigieren. Keine Rückfragen.

## Fehlerlog

Die Hauptsitzung liest `FEHLERLOG.md` nicht (spart Tokens), die Agents lesen es selbst. Jeder Eintrag dort ist ein Fehler, den Claude gemacht hat und nie wiederholen darf. Die Einträge tragen ein Bereichs-Tag. Jeder Subagent liest die Datei selbst und beachtet nur die Einträge seines Bereichs: `korrektur-leser` die Tags `[Rechtschreibung]` und `[Grammatik]`, `korrektur-komma` `[Komma]` (mit Tempus zusätzlich `[Tempus]`), `korrektur-tempus` `[Tempus]`, `korrektur-pruefer` alle ausser `[Werkzeug]`. `[Werkzeug]`-Einträge sind im Werkzeug behoben und gehen an keinen Agent. Neue Einträge immer mit Tag.

## Grundsatz

Korrigieren wie mit dem Rotstift auf Papier. Kategorie und Kurzerklärung stehen als Word-Kommentar am Fehler, nicht als Buchstabe im Rand.
Der Schülertext bleibt vollständig stehen: nichts löschen, nichts umformulieren, Formatierung des Schülers nicht ändern.
Alles, was hinzukommt, ist rot.

- Ergebnis als Kopie `<name>_korrigiert.docx` immer in einem neuen Unterordner speichern (nicht direkt neben dem Original). Das Original bleibt unberührt.
- Schweizer Hochdeutsch: kein ß (ss ist korrekt, nie anstreichen). Helvetismen sind keine Fehler. Schweizer Anführungszeichen «…» sind korrekt.
- Nur sprachliche Fehler. Keine Rückmeldung zu Inhalt oder Aufbau. Die einzige Statistik ist die Zusammenfassung am Schluss.
- Unsicher oder nicht falsch, aber unschön: nicht rot, sondern gelb hinterlegen (siehe «Gelb»). Gelb zählt nicht als Fehler.

## Kategorien

- **R** = Rechtschreibung
- **G** = Grammatik
- **T** = Tempus (nie gelb: eindeutiger Fehler in Rot oder gar keine Markierung)
- **Z** = Zeichensetzung
- **H** = Hinweis, nur für gelbe Stellen (zählt nicht als Fehler)

## Regelquellen

Die Detailregeln liegen in `.claude/regeln/` und gelten für alle Subagents:
- `komma.md`: Kommaregeln nach dem amtlichen Regelwerk des Rats für deutsche Rechtschreibung, Fassung 2024 (§§ 70–73, § 79). Erweiterte zu-Infinitive brauchen ein Komma.
- `tempus.md`: Entscheidungsregeln für Tempus (Hauptebene bestimmen, nur eindeutige Fälle anstreichen). Das Regelwerk regelt Tempus nicht, die Regeln folgen der Duden-Grammatik.
- `schweiz.md`: ss, Helvetismen, Briefanrede.

## Markierung im Text

- **Gelb (H):** Unsichere oder unschöne Stelle (Wort bzw. Wortgruppe) gelb hinterlegen, wie die roten Kommas, nur in hellem Gelb (`w:highlight w:val="yellow"` plus `w:shd w:fill="FFFF00"`). Schrift und Text nicht verändern, keine Korrektur, keine rote Schrift. Dazu ein Kommentar «H: …», der kurz sagt, wieso die Stelle markiert ist (siehe «Kürzel als Kommentar»). Bei unsicherem fehlendem Satzzeichen das Wort davor oder danach markieren.

- **R, G, T:** Falsches Wort bzw. falsche Stelle rot durchstreichen (Schriftfarbe rot + durchgestrichen). Direkt danach die Korrektur in roter Schrift einfügen, z.B. ~~Strase~~ Strasse.
  - Fehlt ein Wort: das fehlende Wort rot an der richtigen Stelle einfügen.
  - Überflüssiges Wort: rot durchstreichen, nichts einfügen.
- **Z – fehlendes Satzzeichen:** an der richtigen Stelle rot einfügen.
- **Z – überflüssiges Satzzeichen:** stehen lassen, rot hinterlegen (roter Hintergrund, `w:shd` mit `w:fill="FF0000"`; zusätzlich `w:highlight` rot).

## Kürzel als Kommentar

- Pro Fehler ein Word-Kommentar: zuerst das Kürzel (R, G, T, Z oder H), dann in wenigen Wörtern der Fehler, z.B. «R: Strase → Strasse, Doppel-s». Möglichst kurz, keine ganzen Sätze, keine Belehrung. Bei Kommas steht die Begründung der Funktion, keine Paragrafennummer und nicht nur «Komma fehlt», so genau wie möglich nach Art der Stelle, z.B. «Z: Komma vor Relativsatz», «Z: Komma vor weil-Satz», «Z: Komma schliesst Apposition».
- Auch gelbe Stellen bekommen einen Kommentar mit dem Kürzel H und dem Grund der Markierung, z.B. «H: Ausdruck umgangssprachlich» oder «H: Komma fakultativ». Ebenso kurz.
- Kein Buchstabe im Rand, keine Textfelder.
- Umsetzung: `w:commentRangeStart` vor und `w:commentRangeEnd` + Run mit `w:commentReference` nach der Fehlerstelle (bei R/G/T: um das durchgestrichene Wort samt eingefügter Korrektur; bei Z fehlend: um die Einfügestelle). Ausnahme überflüssiges Satzzeichen: Kommentarbereich um das Zeichen danach (meist das Leerzeichen), nie um das Satzzeichen selbst, sonst verdeckt die Kommentarfarbe in Word das rote Hinterlegen; am Absatzende nur `w:commentReference` nach dem Zeichen. Gelbe Stellen: Kommentarbereich um die ganze gelbe Stelle (Wort bzw. Wortgruppe), damit man in Word auf die Stelle klicken kann. Word malt die Kommentarfarbe über Hintergrund und Hervorhebung, darum hat das Gelb zusätzlich eine dicke gelbe Unterstreichung. Kommentare in `word/comments.xml` (Autor z.B. «Korrektur»), dazu Relationship in `word/_rels/document.xml.rels` und Override in `[Content_Types].xml`. Jede `w:id` eindeutig.

## Zusammenfassung am Schluss

Am Ende des Dokuments (nach dem letzten Absatz des Schülers) steht immer eine Zusammenfassung, rot, nach dem Schema:

```
Zusammenfassung
Fehler gesamt: 5
Rechtschreibung (R): 2
Grammatik (G): 1
Tempus (T): 0
Zeichensetzung (Z): 2
```

- «Zusammenfassung» fett. Nur die Anzahl gesamt und pro Kategorie, keine Liste der einzelnen Fehler. Gelbe Stellen werden nicht gezählt.
- Die Zusammenfassung ist kein Schülertext: ohne Kommentar, ohne Markierung.

## Ablauf mit Subagents

Jede Korrektur läuft über die Subagents in `.claude/agents/` (dieser Auftrag gilt als ausdrücklicher Wunsch nach Subagents) und das Werkzeug (siehe «Werkzeug»). Fehlerliste als JSON im Scratchpad ablegen.
0. Text einmal extrahieren: `extrahieren` aufrufen und die Ausgabe als `text.txt` im Scratchpad ablegen. Alle Agents lesen diese Datei und rufen `extrahieren` nicht selbst auf. Bis etwa 25 Absätze mit Text (ca. 1500 Wörter) ein einziger Block, darüber Blöcke von höchstens 20 Absätzen. Die Absatznummern bleiben die des Werkzeugs.
0b. Vorfilter einmal laufen lassen: `kandidaten` aufrufen und die Ausgabe als `kandidaten.txt` im Scratchpad ablegen. Das Werkzeug findet ohne LLM Stellen, an denen Claude erfahrungsgemäss Fehler übersieht (unbekannte Wörter laut Rechtschreibprüfer des Betriebssystems, bekannte Fehlschreibungen wie «eignen» nach Artikel und «Romanes», fehlendes Komma vor um/ohne/statt + zu-Infinitiv, Komma hinter «um», zu-Infinitiv ohne Komma davor, Adjektivreihen ohne Komma, «hinter dieser sich»). Der Rechtschreibprüfer braucht auf Windows die installierte deutsche Sprache, sonst entfällt er still. Die Zeilen sind nur Hinweise, keine Fehler. Der Leser bekommt die Zeilen `R:` und `G:`, der Komma-Agent die Zeilen `Z:`, der Prüfer die ganze Datei.
0c. LanguageTool (zusätzliche, lokale Prüfschicht, nur macOS): `osascript -l JavaScript .claude/languagetool.js <text.txt>` im selben Bash-Aufruf wie 0 und 0b, Ausgabe als `lt.txt` im Scratchpad. Das Skript nutzt die lokale App `languagetool-ui` (`POST http://127.0.0.1:8772/check`, JSON, mit Zusatzregeln wie `LOCAL_COMMA_BEFORE_ABER`; Start: `languagetool-ui/start.command`). Ist sie nicht erreichbar, meldet es das in einer `HINWEIS`-Zeile und prüft mit dem Basis-Server (`/opt/homebrew/opt/languagetool/bin/languagetool-server --port 8081`, startet es bei Bedarf selbst); fehlt LanguageTool, entfällt `lt.txt` und die Korrektur läuft unverändert. Basisversion ohne Premium-/KI-Regeln: ein leeres Ergebnis heisst nicht fehlerfrei. Die Zeilen `[p] LT Regel: Meldung | «Stelle» -> Vorschläge` sind nur Hinweise, nie Fehlerurteile, und werden nie automatisch übernommen. Nur der Prüfer bekommt `lt.txt`; er prüft jede Zeile von Hand (wie die Kandidaten) und ergänzt nur, was nach Duden/Regelwerk sicher ein Fehler ist. Bestehende Einträge der Leser ändert LanguageTool nicht.
1. Parallel starten, alle mit den Pfaden von `text.txt`, `kandidaten.txt`, `FEHLERLOG.md` und der Ausgabedatei (Auftrag kurz halten, die Agent-Definitionen enthalten die Regeln; Fehlerlog-Auszüge und Kandidaten-Zeilen nicht in den Auftrag kopieren):
   - pro Block ein `korrektur-leser` (Opus; R, G, Z ohne Kommas), Ausgabe `leser_<block>.json`,
   - **bis ca. 1500 Wörter:** ein `korrektur-komma` (Sonnet) mit dem Zusatz «mit Tempus»: macht Kommas und Tempus, Ausgaben `komma.json` und `tempus.json`,
   - **darüber:** pro Block ein `korrektur-komma` (Sonnet), Ausgabe `komma_<block>.json`, und ein `korrektur-tempus` (Sonnet) für den ganzen Text, Ausgabe `tempus.json`.
2. `korrektur-pruefer` (Sonnet): bekommt `text.txt`, `kandidaten.txt`, `lt.txt` (falls vorhanden), alle Teillisten und die Schüler-.docx, führt zusammen, streicht Fehlalarme, ergänzt Übersehenes (gezielt: offene Kandidaten, Widersprüche zwischen den Listen, die letzten Absätze; den ganzen Text liest er nicht noch einmal), ruft `pruefen` einmal auf und schreibt die bereinigte Liste `liste.json`. Nur der Prüfer ruft `pruefen` auf, die Leser nicht.
3. Hauptsitzung setzt um, kein Agent nötig: Werkzeug mit `setzen "<datei.docx>" "<liste.json>"`. Das Werkzeug erzeugt `<name>_korrigiert.docx` und führt die Prüfungen unter «Technik» selbst aus. Bei `FEHLER` Liste anpassen und neu setzen. `pruefen` ruft die Hauptsitzung nicht extra auf (macht der Prüfer, `setzen` prüft nochmals).

Sparsam in der Hauptsitzung: Schritt 0 und 0b in einem einzigen Bash-Aufruf, auf die Agents mit einem einzigen Warte-Aufruf warten, nach `setzen` nichts mehr nachprüfen. Mehrere Dateien: alle Ketten in derselben Nachricht starten.
Mehrere Dateien: pro Datei eine eigene Kette, die Ketten dürfen parallel laufen.

## Messung

`.claude/vergleich.js` vergleicht die Liste von Claude mit einer Referenzliste (Musterkorrektur im gleichen JSON-Format) und gibt pro Kategorie Treffer, Übersehenes und Fehlalarme aus: `osascript -l JavaScript .claude/vergleich.js "<referenz.json>" "<liste.json>"`. Selbsttest: `osascript -l JavaScript .claude/vergleich.js --test`. Nur macOS-Fassung.

## Werkzeug

Ohne Installation, nur mit Bordmitteln des Betriebssystems. Zwei Fassungen mit gleichem Verhalten und gleichen Ausgaben; die zum Betriebssystem passende benutzen:

| | macOS | Windows |
|---|---|---|
| Aufruf | `osascript -l JavaScript .claude/korrektur.js <befehl> …` | `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/korrektur.ps1 <befehl> …` |
| Selbsttest | `osascript -l JavaScript .claude/test_korrektur.js` | `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/test_korrektur.ps1` |

Befehle: `extrahieren "<datei.docx>"` (Absatztext als `[p] text`), `kandidaten "<datei.docx>"` (Vorfilter: Hinweise als `[p] Kategorie: Hinweis | Ausschnitt`, kein Fehlerurteil), `pruefen "<datei.docx>" "<liste.json>"` (Liste prüfen, nichts schreiben), `setzen "<datei.docx>" "<liste.json>"` (Kopie erzeugen und selbst prüfen).
Werkzeug ändern nur in beiden Fassungen gleich und mit beiden Selbsttests als Gegenprobe. `korrektur.ps1` und `test_korrektur.ps1` bleiben reines ASCII (PowerShell 5.1 liest Skripte ohne BOM sonst falsch).

## Technik

- Kein Python, kein python-docx. Das Werkzeug arbeitet direkt im OOXML (`word/document.xml`).
- Runs nur an Fehlergrenzen aufteilen, Run-Eigenschaften (`w:rPr`) des Schülers dabei kopieren und nur `w:color w:val="FF0000"`, `w:strike` bzw. `w:highlight w:val="red"` plus `w:shd w:fill="FF0000"` ergänzen.
- Eingefügte Korrekturen als eigene Runs mit `w:color w:val="FF0000"`. Bei Wort-Einfügungen (`einfuegen`) ergänzt das Werkzeug das fehlende Leerzeichen davor bzw. danach selbst; Satzzeichen bleiben, wie sie sind.
- Gelb: `w:highlight w:val="yellow"` plus `w:shd w:fill="FFFF00"` plus `w:u w:val="thick" w:color="FFFF00"` am Run, sonst nichts verändern; Kommentarbereich um die ganze gelbe Stelle, wie bei R/G/T.
- Nach dem Speichern prüfen: Der Text der Kopie ohne die eingefügten roten Runs, ohne die Kommentare und ohne die Zusammenfassung am Schluss muss exakt dem Original entsprechen. Die Datei muss sich öffnen lassen (gültiges XML).
- Zum Schluss im Chat nur den Dateinamen der Kopie melden.
