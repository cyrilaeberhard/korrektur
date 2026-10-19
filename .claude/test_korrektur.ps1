# Test fuer korrektur.ps1 (Windows): baut ein Mini-Docx, setzt alle Arten (inkl. gelb) und prueft das Ergebnis.
# Aufruf: powershell -NoProfile -ExecutionPolicy Bypass -File .claude/test_korrektur.ps1
# Gleiche Faelle wie test_korrektur.js fuer macOS. Diese Datei muss reines ASCII bleiben.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$HIER = Split-Path -Parent $MyInvocation.MyCommand.Path
$SKRIPT = Join-Path $HIER 'korrektur.ps1'
$POWERSHELL = (Get-Process -Id $PID).Path
$UTF8 = New-Object System.Text.UTF8Encoding $false
$W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$PFEIL = [string][char]0x2192
$UE = [string][char]0x00FC

$DOC = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="$W" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>
<w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">Die Strase ist </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="24"/><w14:ligatures w14:val="standard"/></w:rPr><w:t>lang,</w:t></w:r><w:r><w:t xml:space="preserve"> und er </w:t></w:r><w:r><w:rPr><w:dstrike/><w:rPrChange w:id="7" w:author="x" w:date="2020-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>gehen</w:t></w:r><w:r><w:tab/><w:t>heim</w:t></w:r></w:p>
<w:p><w:bookmarkStart w:id="0" w:name="a"/><w:r><w:t>Ich weiss es nicht</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>
</w:body></w:document>
"@
# Zweites Dokument fuer Vorfilter (kandidaten) und Leerzeichen bei Einfuegungen
$DOC2 = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="$W"><w:body>
<w:p><w:r><w:t>Er hat gelernt zu reflektieren und die Reflektion ist wichtig.</w:t></w:r></w:p>
<w:p><w:r><w:t>Sie lernte um sich auszuruhen.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er ging, um sich auszuruhen.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er blieb um, sich zu erholen.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er sah eine neue bisher verborgene Seite.</w:t></w:r></w:p>
<w:p><w:r><w:t>Es ist eine Maske, hinter dieser sich viel versteckt.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er ging mit seiner eignen Familie am Ende des Romanes heim.</w:t></w:r></w:p>
</w:body></w:document>
"@
$CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/></Types>'
$RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'

$EINTRAEGE = @(
    [ordered]@{ p = 0; falsch = 'Strase'; kontext = 'Die Strase ist'; kat = 'R'; art = 'ersetzen'; korrektur = 'Strasse'; kommentar = "R: Strase $PFEIL Strasse" },
    [ordered]@{ p = 0; falsch = ','; kontext = 'lang, und'; kat = 'Z'; art = 'zeichen_weg'; kommentar = "Z: Komma ${UE}berfl${UE}ssig" },
    [ordered]@{ p = 0; falsch = 'gehen'; kontext = 'er gehen'; kat = 'G'; art = 'ersetzen'; korrektur = 'geht'; kommentar = 'G: er geht' },
    [ordered]@{ p = 0; falsch = ''; kontext = "gehen`theim"; kat = 'Z'; art = 'einfuegen'; korrektur = ','; kommentar = 'Z: Komma fehlt' },
    [ordered]@{ p = 1; falsch = 'weiss'; kontext = 'Ich weiss'; kat = 'R'; art = 'streichen'; kommentar = 'R: Test' },
    [ordered]@{ p = 0; falsch = 'und er'; kontext = 'und er'; kat = 'H'; art = 'gelb'; kommentar = 'H: Ausdruck unsicher' }
)

function Pruefe([bool]$bedingung, [string]$text) {
    if (-not $bedingung) { throw "Test fehlgeschlagen: $text" }
}

function Gleich($ist, $soll, [string]$text) {
    $a = (@($ist) | ForEach-Object { [string]$_ }) -join '|'
    $b = (@($soll) | ForEach-Object { [string]$_ }) -join '|'
    Pruefe ($a -ceq $b -and @($ist).Count -eq @($soll).Count) "${text}: [$a] statt [$b]"
}

function Argument([string]$a) {
    # Windows-Regeln fuer Anfuehrungszeichen in der Befehlszeile
    $a = [regex]::Replace($a, '(\\*)"', '$1$1\"')
    $a = [regex]::Replace($a, '(\\+)$', '$1$1')
    return '"' + $a + '"'
}

function Lauf([string[]]$argumente) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $POWERSHELL
    $info.Arguments = (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Argument $SKRIPT)) +
        @($argumente | ForEach-Object { Argument $_ })) -join ' '
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $UTF8
    $info.StandardErrorEncoding = $UTF8
    $prozess = [System.Diagnostics.Process]::Start($info)
    $fehlerText = $prozess.StandardError.ReadToEndAsync()
    $ausText = $prozess.StandardOutput.ReadToEnd()
    $prozess.WaitForExit()
    return @{ code = $prozess.ExitCode; out = $ausText; err = $fehlerText.Result }
}

function Json-Schreiben([string]$pfad, $daten) {
    $json = ConvertTo-Json -InputObject @($daten) -Depth 5 -Compress
    [System.IO.File]::WriteAllText($pfad, $json, $UTF8)
}

function Zip-Bauen([string]$pfad, $teile) {
    $datei = [System.IO.File]::Open($pfad, [System.IO.FileMode]::CreateNew)
    try {
        $zip = New-Object System.IO.Compression.ZipArchive ($datei, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in $teile.Keys) {
                $strom = $zip.CreateEntry($name).Open()
                $bytes = $UTF8.GetBytes($teile[$name])
                try { $strom.Write($bytes, 0, $bytes.Length) } finally { $strom.Close() }
            }
        } finally { $zip.Dispose() }
    } finally { $datei.Dispose() }
}

function Zip-Xml([string]$pfad, [string]$name) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($pfad)
    try {
        $leser = New-Object System.IO.StreamReader ($zip.GetEntry($name).Open(), $UTF8)
        try { $text = $leser.ReadToEnd() } finally { $leser.Close() }
    } finally { $zip.Dispose() }
    $doc = New-Object System.Xml.XmlDocument
    $doc.PreserveWhitespace = $true
    $doc.LoadXml($text)
    return , $doc
}

function Texte($knoten) {
    return @($knoten | ForEach-Object { $_.get_InnerText() })
}

function Testen {
    $d = Join-Path ([System.IO.Path]::GetTempPath()) ('korrektur-test-' + [guid]::NewGuid())
    [void][System.IO.Directory]::CreateDirectory($d)
    try {
        $docx = Join-Path $d 'test.docx'
        Zip-Bauen $docx ([ordered]@{ '[Content_Types].xml' = $CT; '_rels/.rels' = $RELS;
            'word/_rels/document.xml.rels' = $RELS; 'word/document.xml' = $DOC })
        $liste = Join-Path $d 'liste.json'
        # Eintrag 3 (einfuegen) absichtlich mit Tab im Kontext
        Json-Schreiben $liste $EINTRAEGE

        $ex = Lauf @('extrahieren', $docx)
        Pruefe ($ex.out.Contains("[0] Die Strase ist lang, und er gehen`theim")) ($ex.out + $ex.err)

        $pr = Lauf @('pruefen', $docx, $liste)
        Pruefe ($pr.code -eq 0) ($pr.out + $pr.err)

        $out = Join-Path $d 'test_korrigiert.docx'
        $res = Lauf @('setzen', $docx, $liste, $out)
        Pruefe ($res.code -eq 0) ($res.out + $res.err)

        $doc = Zip-Xml $out 'word/document.xml'
        $kom = Zip-Xml $out 'word/comments.xml'
        Pruefe ((Zip-Xml $out '[Content_Types].xml').get_OuterXml().Contains('comments')) 'Content-Type fehlt'
        Pruefe ((Zip-Xml $out 'word/_rels/document.xml.rels').get_OuterXml().Contains('comments.xml')) 'Relationship fehlt'
        $ns = New-Object System.Xml.XmlNamespaceManager ($doc.get_NameTable())
        $ns.AddNamespace('w', $W)
        $kns = New-Object System.Xml.XmlNamespaceManager ($kom.get_NameTable())
        $kns.AddNamespace('w', $W)
        # Immer als Liste zurueckgeben: ein einzelner Treffer wuerde sonst zum Element, und [0] suchte ein Kind namens 0
        function X([string]$xpath) { return , @($doc.SelectNodes($xpath, $ns)) }
        # Nur der Schuelertext (Absaetze 1 und 2), nicht die Zusammenfassung am Ende
        $text = '/w:document/w:body/w:p[position()<=2]'

        # Gelb bekommt auch einen Kommentar
        Gleich @($kom.SelectNodes('/w:comments/w:comment', $kns)).Count 6 'Anzahl Kommentare'
        Gleich (X '//w:commentReference').Count 6 'Anzahl Kommentarreferenzen'
        # Ueberfluessiges Komma: Kommentar liegt auf dem Leerzeichen danach, damit das Rot sichtbar bleibt
        $komma = (X "//w:r[w:rPr/w:highlight/@w:val='red']")[0]
        Pruefe ($null -eq $komma.SelectSingleNode('preceding-sibling::*[1][self::w:commentRangeStart]', $ns)) 'Kommentar liegt auf dem Komma'
        Pruefe ($null -ne $komma.SelectSingleNode('following-sibling::*[1][self::w:commentRangeStart]', $ns)) 'Kommentar fehlt nach dem Komma'
        Gleich $komma.SelectSingleNode('following-sibling::*[2]/w:t', $ns).get_InnerText() ' ' 'Kommentar auf dem Leerzeichen'
        Gleich (Texte (X '//w:r[w:rPr/w:strike]/w:t')) @('Strase', 'gehen', 'weiss') 'durchgestrichen'
        Gleich (Texte (X "$text//w:r[not(w:rPr/w:strike)][w:rPr/w:color/@w:val='FF0000']/w:t")) @('Strasse', 'geht', ',') 'rot eingefuegt'
        Gleich (Texte (X "$text//w:r[w:rPr/w:highlight/@w:val='red']/w:t")) @(',') 'rot hinterlegt'
        # Gelb: gelb hinterlegt wie die roten Kommas, keine Korrektur und keine rote Schrift
        $gelb = "w:rPr/w:highlight/@w:val='yellow' and w:rPr/w:shd/@w:fill='FFFF00'"
        Gleich (Texte (X "$text//w:r[$gelb]/w:t")) @('und er') 'gelb'
        Gleich (X "//w:r[w:rPr/w:highlight/@w:val='yellow'][w:rPr/w:color]").Count 0 'gelb mit Farbe'
        # Dazu eine dicke gelbe Unterstreichung, die Word nicht mit der Kommentarfarbe uebermalt
        Gleich (Texte (X "$text//w:r[w:rPr/w:u/@w:val='thick' and w:rPr/w:u/@w:color='FFFF00']/w:t")) @('und er') 'gelb unterstrichen'
        # Gelb: Kommentarbereich ueber die ganze gelbe Stelle, damit man auf die Stelle klicken kann
        $gelbRun = (X "$text//w:r[w:rPr/w:highlight/@w:val='yellow']")[0]
        Pruefe ($null -ne $gelbRun.SelectSingleNode('preceding-sibling::*[1][self::w:commentRangeStart]', $ns)) 'Kommentarbereich fehlt vor Gelb'
        Pruefe ($null -ne $gelbRun.SelectSingleNode('following-sibling::*[1][self::w:commentRangeEnd]', $ns)) 'Kommentarbereich endet nicht nach Gelb'
        Pruefe ($null -ne $gelbRun.SelectSingleNode('following-sibling::*[2][w:commentReference]', $ns)) 'Kommentar fehlt nach Gelb'
        # Schueler-Formatierung (fett, Groesse) bleibt in der Korrektur erhalten
        Gleich (X "//w:r[w:t='Strasse']/w:rPr/w:b").Count 1 'Korrektur fett'
        # rPr-Reihenfolge: strike vor color vor sz
        $namen = { param($xp) @((X $xp) | ForEach-Object { $_.get_LocalName() }) }
        Gleich (& $namen "//w:r[w:t='Strase']/w:rPr/*") @('b', 'strike', 'color', 'sz') 'rPr-Reihenfolge'
        # rPrChange (Formatierungs-Aenderung) muss laut Schema das letzte Kind bleiben
        Gleich (& $namen "//w:r[w:t='gehen']/w:rPr/*[last()]") @('rPrChange') 'rPrChange zuletzt'
        # Fremde Elemente (w14) bleiben am Schluss, neue Eigenschaften kommen davor
        Gleich (& $namen "//w:r[w:t=',' and w:rPr/w:highlight]/w:rPr/*") @('b', 'sz', 'highlight', 'shd', 'ligatures') 'rPr mit w14'
        # Die Korrektur erbt keine Doppel-Durchstreichung
        Gleich (X "//w:r[w:t='geht']/w:rPr/w:dstrike").Count 0 'Korrektur doppelt durchgestrichen'
        # Kommentar-IDs kollidieren nicht mit Lesezeichen (0) oder Aenderungen (7)
        $ids = @($kom.SelectNodes('/w:comments/w:comment/@w:id', $kns) | ForEach-Object { $_.get_Value() })
        Pruefe (-not ($ids -ccontains '0') -and -not ($ids -ccontains '7')) "Kommentar-ID kollidiert: $ids"

        # Zusammenfassung am Ende: fett Ueberschrift, rote Schrift, nur Anzahl gesamt und pro Kategorie
        $zusammenfassung = X '/w:document/w:body/w:p[position()>2]'
        Gleich (Texte $zusammenfassung) @('Zusammenfassung', 'Fehler gesamt: 5', 'Rechtschreibung (R): 2',
            'Grammatik (G): 1', 'Tempus (T): 0', 'Zeichensetzung (Z): 2') 'Zusammenfassung'
        Gleich @($zusammenfassung[0].SelectNodes('w:r/w:rPr/w:b', $ns)).Count 1 'Ueberschrift fett'
        # Zusammenfassung erbt nichts vom ersten Schueler-Run (dort fett, Groesse 12)
        Gleich (X '/w:document/w:body/w:p[position()>2]//w:sz').Count 0 'Zusammenfassung mit Schriftgroesse'
        Gleich @($zusammenfassung[1].SelectNodes('w:r/w:rPr/w:b', $ns)).Count 0 'Zeile 2 fett'
        Gleich (X "/w:document/w:body/w:p[position()>2]/w:r[not(w:rPr/w:color/@w:val='FF0000')]").Count 0 'Zusammenfassung nicht rot'

        # Fehlerfall: mehrdeutiger Kontext muss abgelehnt werden
        $schlecht = Join-Path $d 'schlecht.json'
        $kopie = { param($nr, $aenderung) $h = [ordered]@{}; foreach ($k in $EINTRAEGE[$nr].Keys) { $h[$k] = $EINTRAEGE[$nr][$k] }
            foreach ($k in $aenderung.Keys) { $h[$k] = $aenderung[$k] }; $h }
        Json-Schreiben $schlecht @(& $kopie 0 @{ kontext = 'ist' })
        Gleich (Lauf @('pruefen', $docx, $schlecht)).code 1 'mehrdeutiger Kontext'
        # Fehlerfall: H ohne gelb (und gelb ohne H) muss abgelehnt werden
        Json-Schreiben $schlecht @(& $kopie 0 @{ kat = 'H'; kommentar = 'H: x' })
        Gleich (Lauf @('pruefen', $docx, $schlecht)).code 1 'H ohne gelb'
        Json-Schreiben $schlecht @(& $kopie 5 @{ kat = 'R'; kommentar = 'R: unsicher' })
        Gleich (Lauf @('pruefen', $docx, $schlecht)).code 1 'gelb ohne H'
        # Fehlerfall: gelb ohne Kommentar muss abgelehnt werden
        Json-Schreiben $schlecht @(& $kopie 5 @{ kommentar = '' })
        Gleich (Lauf @('pruefen', $docx, $schlecht)).code 1 'gelb ohne Kommentar'
        # Fehlerfall: falsche Typen und zeichen_weg ohne Z werden abgelehnt
        foreach ($kaputt in @((& $kopie 0 @{ p = '0' }), (& $kopie 1 @{ kat = 'R'; kommentar = 'R: x' }),
                (& $kopie 0 @{ kontext = '' }), 'kein Objekt',
                # Gross/klein zaehlt: r ist keine Kategorie, Ersetzen keine Art
                (& $kopie 0 @{ kat = 'r'; kommentar = 'r: x' }), (& $kopie 0 @{ art = 'Ersetzen' }))) {
            Json-Schreiben $schlecht @($kaputt)
            $r = Lauf @('pruefen', $docx, $schlecht)
            Pruefe ($r.code -eq 1 -and $r.err.StartsWith('FEHLER:') -and -not $r.err.Contains('intern')) ("$kaputt " + $r.err)
        }
        # Fehlerfall: misslungenes Setzen hinterlaesst keine Kopie
        Json-Schreiben $schlecht @(& $kopie 0 @{ kontext = 'ist' })
        $weg = Join-Path $d 'weg_korrigiert.docx'
        Gleich (Lauf @('setzen', $docx, $schlecht, $weg)).code 1 'misslungenes Setzen'
        Pruefe (-not (Test-Path -LiteralPath $weg)) 'Kopie trotz Fehler'
        Pruefe (-not (Test-Path -LiteralPath (Join-Path $d '.weg_korrigiert.docx.tmp'))) 'Zwischendatei liegt noch'
        # Erfolgreicher Lauf hinterlaesst keine Zwischendatei
        Pruefe (-not (Test-Path -LiteralPath (Join-Path $d '.test_korrigiert.docx.tmp'))) 'Zwischendatei nach Erfolg'
        # Ziel darf kein Ordner sein
        $ordnerZiel = Lauf @('setzen', $docx, $liste, $d)
        Pruefe ($ordnerZiel.code -eq 1 -and $ordnerZiel.err.Contains('Ziel ist ein Ordner')) ("Ziel = Ordner: " + $ordnerZiel.err)
        # Ziel darf nie das Original sein
        Gleich (Lauf @('setzen', $docx, $liste, $docx)).code 1 'Ziel = Original'
        # Kaputte Datei: sauberer FEHLER statt Absturz
        $kaputtDatei = Join-Path $d 'kaputt.docx'
        [System.IO.File]::WriteAllText($kaputtDatei, 'kein zip')
        $k = Lauf @('setzen', $kaputtDatei, $liste)
        Pruefe ($k.code -eq 1 -and $k.err.StartsWith('FEHLER:') -and -not $k.err.Contains('intern')) $k.err
        # Leerzeichen-Runs und Sonderzeichen bleiben erhalten
        $ex2 = Lauf @('extrahieren', $out)
        Pruefe ($ex2.out.Contains("[0] Die StraseStrasse ist lang, und er gehengeht`theim,")) $ex2.out

        # Vorfilter: meldet nur Kandidaten, kein Treffer bei "Er ging, um sich auszuruhen."
        $doc2 = Join-Path $d 'vorfilter.docx'
        Zip-Bauen $doc2 ([ordered]@{ '[Content_Types].xml' = $CT; '_rels/.rels' = $RELS;
            'word/_rels/document.xml.rels' = $RELS; 'word/document.xml' = $DOC2 })
        $kand = Lauf @('kandidaten', $doc2)
        Pruefe ($kand.code -eq 0) ($kand.out + $kand.err)
        $zeilen = @([regex]::Split($kand.out.Trim(), '\r?\n') | ForEach-Object { $_.Split(@(' | '), [System.StringSplitOptions]::None)[0] })
        Gleich $zeilen @(
            '[0] Z: zu-Infinitiv ohne Komma davor, erweitert? (Pflicht ab Fassung 2024)',
            '[0] R: Schreibung "Reflektion" -> Reflexion?',
            '[1] Z: Komma vor "um" fehlt? (Infinitivgruppe)',
            '[3] Z: Komma hinter "um" ueberfluessig, Komma gehoert davor?',
            '[3] Z: Komma vor "um" fehlt? (Infinitivgruppe)',
            '[4] Z: Adjektivreihe "neue bisher verborgene": Komma, wenn "und" passt?',
            '[5] G: Relativsatz? "dieser/diesem" statt "der/dem", Komma davor?',
            '[6] R: Schreibung "eignen" -> eigen(e|en|em|er|es)?',
            '[6] R: Schreibung "Romanes" -> Romans?') 'Kandidaten'
        # Der Rechtschreibpruefer darf zusaetzlich melden (z.B. "Strase"), sonst gibt es keine Hinweise
        $sauber = @([regex]::Split((Lauf @('kandidaten', $docx)).out.Trim(), '\r?\n') | Where-Object { $_ -cne 'keine Kandidaten' -and -not $_.Contains('Unbekanntes Wort') })
        Pruefe ($sauber.Count -eq 0) 'Kandidaten im sauberen Text'

        # Einfuegen: Wort bekommt das fehlende Leerzeichen selbst, Satzzeichen und " nie" bleiben, wie sie sind
        $liste2 = Join-Path $d 'liste2.json'
        Json-Schreiben $liste2 @(
            [ordered]@{ p = 2; falsch = ''; kontext = 'Er ging, um sich'; kat = 'G'; art = 'einfuegen'; korrektur = 'doch'; kommentar = 'G: Wort fehlt' },
            [ordered]@{ p = 1; falsch = ''; kontext = 'Sie lernte'; kat = 'Z'; art = 'einfuegen'; korrektur = ','; kommentar = 'Z: Komma fehlt' },
            [ordered]@{ p = 0; falsch = ''; kontext = 'Er hat gelernt'; kat = 'G'; art = 'einfuegen'; korrektur = ' nie'; kommentar = 'G: Wort fehlt' })
        $out2 = Join-Path $d 'vorfilter_korrigiert.docx'
        $res2 = Lauf @('setzen', $doc2, $liste2, $out2)
        Pruefe ($res2.code -eq 0) ($res2.out + $res2.err)
        $ex3 = (Lauf @('extrahieren', $out2)).out
        Pruefe ($ex3.Contains('[0] Er hat gelernt nie zu reflektieren')) $ex3
        Pruefe ($ex3.Contains('[1] Sie lernte, um sich auszuruhen.')) $ex3
        Pruefe ($ex3.Contains('[2] Er ging, um sich doch auszuruhen.')) $ex3
    } finally {
        [System.IO.Directory]::Delete($d, $true)
    }
}

try {
    Testen
    [Console]::Out.WriteLine('Alle Tests bestanden')
    exit 0
} catch {
    [Console]::Error.WriteLine("$($_.Exception.Message) (Zeile $($_.InvocationInfo.ScriptLineNumber))")
    exit 1
}
