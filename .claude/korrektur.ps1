# Werkzeug fuer die Korrektur von Schueler-.docx auf Windows, ohne Installation (Regeln: CLAUDE.md).
# Laeuft mit der in Windows eingebauten PowerShell 5.1 (und mit PowerShell 7).
# Gegenstueck fuer macOS: korrektur.js (gleiches Verhalten, gleiche Ausgaben).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/korrektur.ps1 extrahieren <docx>
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/korrektur.ps1 kandidaten <docx>
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/korrektur.ps1 pruefen <docx> <json>
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/korrektur.ps1 setzen <docx> <json> [out]
#
# JSON-Eintrag: {"p", "falsch", "kontext", "kat" R|G|T|Z|H,
#                "art" ersetzen|einfuegen|streichen|zeichen_weg|gelb, "korrektur", "kommentar"}
# H + gelb = unsicher oder unschoen: gelb hinterlegen und dick gelb unterstreichen, Kommentar "H: ..." ueber die ganze Stelle, zaehlt nicht als Fehler.
#
# Hinweise zur Sprache: Funktionen geben XML-Knoten und Listen mit "return ,$x" zurueck, weil PowerShell
# sie sonst aufzaehlt. .NET-Eigenschaften von XML-Knoten werden ueber get_...() gelesen, weil PowerShell
# gleichnamige XML-Attribute vorzieht. Vergleiche von Text immer gross/klein-genau (-ceq, Ordinal).
# Diese Datei muss reines ASCII bleiben (PowerShell 5.1 liest Skripte ohne BOM nicht als UTF-8).

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$XML_NS = 'http://www.w3.org/XML/1998/namespace'
$R_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
$CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
$COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
$COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
$MARKER = '0C0FFEE0'  # rsidR der eingefuegten Runs, nur fuer die Selbstpruefung
$ARTEN = @('ersetzen', 'einfuegen', 'streichen', 'zeichen_weg', 'gelb')
$KATEGORIEN = @('R', 'G', 'T', 'Z', 'H')
$FEHLER_KATEGORIEN = @(@('R', 'Rechtschreibung'), @('G', 'Grammatik'), @('T', 'Tempus'), @('Z', 'Zeichensetzung'))
$GELB = 'FFFF00'  # Word-Farbe yellow
# Reihenfolge der Kinder von w:rPr laut Schema
$RPR_ORDER = @('rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
    'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish',
    'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight',
    'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang',
    'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange')
$ELEMENT = [System.Xml.XmlNodeType]::Element
$ORDINAL = [System.StringComparison]::Ordinal
$UTF8 = New-Object System.Text.UTF8Encoding $false
$USAGE = @(
    'Werkzeug fuer die Korrektur von Schueler-.docx (Regeln: CLAUDE.md im Korrektur-Ordner).',
    '',
    '  powershell -NoProfile -ExecutionPolicy Bypass -File korrektur.ps1 extrahieren <docx>',
    '  powershell -NoProfile -ExecutionPolicy Bypass -File korrektur.ps1 pruefen <docx> <json>',
    '  powershell -NoProfile -ExecutionPolicy Bypass -File korrektur.ps1 setzen <docx> <json> [out]'
) -join "`n"

function Fehler([string]$text) {
    $ex = New-Object System.Exception $text
    $ex.Data['korrektur'] = $true
    throw $ex
}

function Zitat([string]$s) {
    return '"' + $s.Replace('\', '\\').Replace('"', '\"').Replace("`t", '\t').Replace("`n", '\n') + '"'
}

# ---------- XML ----------

function Xml-Laden([byte[]]$daten, [string]$teil) {
    $doc = New-Object System.Xml.XmlDocument
    $doc.PreserveWhitespace = $true
    $doc.XmlResolver = $null
    $einstellungen = New-Object System.Xml.XmlReaderSettings
    $einstellungen.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $einstellungen.XmlResolver = $null
    $strom = New-Object System.IO.MemoryStream (, $daten)
    try {
        $leser = [System.Xml.XmlReader]::Create($strom, $einstellungen)
        try { $doc.Load($leser) } finally { $leser.Close() }
    } catch {
        Fehler "Ungueltiges XML in ${teil}: $($_.Exception.Message)"
    }
    return , $doc
}

function Xml-Bytes([System.Xml.XmlDocument]$doc) {
    $einstellungen = New-Object System.Xml.XmlWriterSettings
    $einstellungen.Encoding = $UTF8
    $einstellungen.NewLineHandling = [System.Xml.NewLineHandling]::None
    $einstellungen.Indent = $false
    $strom = New-Object System.IO.MemoryStream
    $schreiber = [System.Xml.XmlWriter]::Create($strom, $einstellungen)
    $doc.Save($schreiber)
    $schreiber.Flush()
    $schreiber.Close()
    return , $strom.ToArray()
}

function Alle-Elemente($start) {
    # Alle Elemente in Dokumentreihenfolge, ohne Rekursion
    $liste = New-Object 'System.Collections.Generic.List[System.Xml.XmlElement]'
    $stapel = New-Object 'System.Collections.Generic.Stack[System.Xml.XmlElement]'
    $stapel.Push($start)
    while ($stapel.Count -gt 0) {
        $el = $stapel.Pop()
        $liste.Add($el)
        $kinder = @($el.get_ChildNodes())
        for ($j = $kinder.Count - 1; $j -ge 0; $j--) {
            if ($kinder[$j].get_NodeType() -eq $ELEMENT) { $stapel.Push($kinder[$j]) }
        }
    }
    return , $liste
}

function Ist-W($knoten, [string]$local) {
    if ($null -eq $knoten -or -not ($knoten -is [System.Xml.XmlElement])) { return $false }
    return ($knoten.get_NamespaceURI() -ceq $W -and $knoten.get_LocalName() -ceq $local)
}

function Kind-W($el, [string]$local) {
    foreach ($k in @($el.get_ChildNodes())) {
        if (Ist-W $k $local) { return , $k }
    }
    return $null
}

function Kinder-Elemente($el) {
    $liste = New-Object 'System.Collections.Generic.List[System.Xml.XmlElement]'
    foreach ($k in @($el.get_ChildNodes())) {
        if ($k.get_NodeType() -eq $ELEMENT) { $liste.Add($k) }
    }
    return , $liste
}

function W-Attr($el, [string]$local) {
    $a = $el.GetAttributeNode($local, $W)
    if ($null -eq $a) { return $null }
    return $a.get_Value()
}

function Attr0($el, [string]$name) {
    $a = $el.GetAttributeNode($name)
    if ($null -eq $a) { return $null }
    return $a.get_Value()
}

function Neues-Element([System.Xml.XmlDocument]$doc, [string]$local, $attrs) {
    $el = $doc.CreateElement('w', $local, $W)
    if ($null -ne $attrs) {
        foreach ($k in $attrs.Keys) {
            $a = $doc.CreateAttribute('w', $k, $W)
            $a.set_Value([string]$attrs[$k])
            [void]$el.SetAttributeNode($a)
        }
    }
    return , $el
}

function Einfuegen-Nach($ref, $neu) { [void]$ref.get_ParentNode().InsertAfter($neu, $ref) }
function Einfuegen-Vor($ref, $neu) { [void]$ref.get_ParentNode().InsertBefore($neu, $ref) }

function Text-Setzen($t, [string]$s) {
    $t.set_InnerText($s)
    $a = $t.get_OwnerDocument().CreateAttribute('xml', 'space', $XML_NS)
    $a.set_Value('preserve')
    [void]$t.SetAttributeNode($a)
}

function W-Praefix-Pruefen([System.Xml.XmlDocument]$doc, [string]$teil) {
    if ($doc.get_DocumentElement().GetNamespaceOfPrefix('w') -cne $W) {
        Fehler "${teil}: Praefix w ist nicht WordprocessingML"
    }
}

# ---------- Text ----------

function Absaetze($root) {
    $liste = New-Object 'System.Collections.Generic.List[System.Xml.XmlElement]'
    foreach ($el in (Alle-Elemente $root)) {
        if (Ist-W $el 'p') { $liste.Add($el) }
    }
    return , $liste
}

function Eigene-Runs($p) {
    # Runs des Absatzes, ohne die von verschachtelten Absaetzen (Textfelder)
    $runs = New-Object 'System.Collections.Generic.List[System.Xml.XmlElement]'
    $stapel = New-Object 'System.Collections.Generic.Stack[System.Xml.XmlElement]'
    $kinder = Kinder-Elemente $p
    for ($j = $kinder.Count - 1; $j -ge 0; $j--) { $stapel.Push($kinder[$j]) }
    while ($stapel.Count -gt 0) {
        $el = $stapel.Pop()
        if (Ist-W $el 'p') { continue }
        if (Ist-W $el 'r') { $runs.Add($el) }
        $kinder = Kinder-Elemente $el
        for ($j = $kinder.Count - 1; $j -ge 0; $j--) { $stapel.Push($kinder[$j]) }
    }
    return , $runs
}

function Inhalt($run) {
    $liste = New-Object 'System.Collections.Generic.List[System.Xml.XmlElement]'
    foreach ($k in (Kinder-Elemente $run)) {
        if (-not (Ist-W $k 'rPr')) { $liste.Add($k) }
    }
    return , $liste
}

function Run-Text($run) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($c in (Inhalt $run)) {
        if (Ist-W $c 't') { [void]$sb.Append($c.get_InnerText()) }
        elseif (Ist-W $c 'tab') { [void]$sb.Append("`t") }
        elseif (Ist-W $c 'br') { [void]$sb.Append("`n") }
    }
    return $sb.ToString()
}

function Absatz-Text($p, [bool]$ohneMarker = $false) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($r in (Eigene-Runs $p)) {
        if ($ohneMarker -and ((W-Attr $r 'rsidR') -ceq $MARKER)) { continue }
        [void]$sb.Append((Run-Text $r))
    }
    return $sb.ToString()
}

function Text-Karte($p) {
    # [{r, s, e}] fuer alle Runs mit Text
    $karte = New-Object 'System.Collections.Generic.List[object]'
    $pos = 0
    foreach ($r in (Eigene-Runs $p)) {
        $n = (Run-Text $r).Length
        if ($n -gt 0) {
            $karte.Add([pscustomobject]@{ r = $r; s = $pos; e = $pos + $n })
            $pos += $n
        }
    }
    return , $karte
}

# ---------- Runs bearbeiten ----------

function Rpr-Setzen($run, [string]$tag, $attrs) {
    $doc = $run.get_OwnerDocument()
    $rpr = Kind-W $run 'rPr'
    if ($null -eq $rpr) {
        $rpr = Neues-Element $doc 'rPr' $null
        [void]$run.PrependChild($rpr)
    }
    foreach ($alt in (Kinder-Elemente $rpr)) {
        if (Ist-W $alt $tag) { [void]$rpr.RemoveChild($alt) }
    }
    $neu = Neues-Element $doc $tag $attrs
    $rang = [array]::IndexOf($RPR_ORDER, $tag)
    $stelle = $null
    foreach ($kind in (Kinder-Elemente $rpr)) {
        # Fremde Namensraeume (w14 ...) und Unbekanntes stehen laut Schema am Schluss
        $local = $kind.get_LocalName()
        if ($kind.get_NamespaceURI() -cne $W -or -not ($RPR_ORDER -ccontains $local) -or
                [array]::IndexOf($RPR_ORDER, $local) -gt $rang) {
            $stelle = $kind
            break
        }
    }
    if ($null -eq $stelle) { [void]$rpr.AppendChild($neu) } else { [void]$rpr.InsertBefore($neu, $stelle) }
}

function Neuer-Text-Run($vorlage, [string]$text) {
    $doc = $vorlage.get_OwnerDocument()
    $run = Neues-Element $doc 'r' ([ordered]@{ rsidR = $MARKER })
    $rpr = Kind-W $vorlage 'rPr'
    if ($null -ne $rpr) { [void]$run.AppendChild($rpr.CloneNode($true)) }
    $t = Neues-Element $doc 't' $null
    Text-Setzen $t $text
    [void]$run.AppendChild($t)
    Rpr-Setzen $run 'color' ([ordered]@{ val = 'FF0000' })
    $neuRpr = Kind-W $run 'rPr'
    foreach ($k in (Kinder-Elemente $neuRpr)) {
        foreach ($tag in @('strike', 'dstrike', 'highlight', 'shd')) {
            if (Ist-W $k $tag) { [void]$neuRpr.RemoveChild($k) }
        }
    }
    return , $run
}

function Atomar($p) {
    # Runs mit mehreren Inhaltselementen in je einen Run pro Element aufteilen
    $doc = $p.get_OwnerDocument()
    foreach ($r in (Eigene-Runs $p)) {
        $letzter = $r
        $teile = Inhalt $r
        for ($j = 1; $j -lt $teile.Count; $j++) {
            $c = $teile[$j]
            $neu = $doc.CreateElement($r.get_Prefix(), $r.get_LocalName(), $r.get_NamespaceURI())
            foreach ($a in @($r.get_Attributes())) { [void]$neu.SetAttributeNode($a.CloneNode($true)) }
            $rpr = Kind-W $r 'rPr'
            if ($null -ne $rpr) { [void]$neu.AppendChild($rpr.CloneNode($true)) }
            [void]$r.RemoveChild($c)
            [void]$neu.AppendChild($c)
            Einfuegen-Nach $letzter $neu
            $letzter = $neu
        }
    }
}

function Schneiden($p, [int]$pos) {
    foreach ($x in (Text-Karte $p)) {
        if ($x.s -lt $pos -and $pos -lt $x.e) {
            $t = Kind-W $x.r 't'
            $text = $t.get_InnerText()
            $k = $pos - $x.s
            $hinten = $x.r.CloneNode($true)
            Text-Setzen $t $text.Substring(0, $k)
            Text-Setzen (Kind-W $hinten 't') $text.Substring($k)
            Einfuegen-Nach $x.r $hinten
            return
        }
    }
}

# ---------- Eintraege aufloesen ----------

function Zaehlen([string]$text, [string]$teil) {
    $n = 0
    $i = 0
    while ($true) {
        $j = $text.IndexOf($teil, $i, $ORDINAL)
        if ($j -lt 0) { break }
        $n++
        $i = $j + $teil.Length
    }
    return $n
}

function Hat-Feld($e, [string]$name) {
    return (@($e.PSObject.Properties | ForEach-Object { $_.Name }) -ccontains $name)
}

function Eintraege-Lesen([string]$pfad) {
    try { $roh = [System.IO.File]::ReadAllText($pfad, $UTF8) } catch { Fehler "JSON nicht lesbar: $pfad" }
    # In ein Objekt verpacken: so zaehlt PowerShell 5.1 und 7 die Liste gleich (auch leer oder mit 1 Eintrag)
    try { $huelle = ('{"liste":' + $roh.TrimStart([char]0xFEFF) + "`n}") | ConvertFrom-Json }
    catch { Fehler "JSON ungueltig: $($_.Exception.Message)" }
    $liste = $huelle.liste
    if (-not ($liste -is [array])) { Fehler 'JSON muss eine Liste sein' }
    $daten = New-Object 'System.Collections.Generic.List[hashtable]'
    for ($i = 0; $i -lt $liste.Count; $i++) {
        $e = $liste[$i]
        if (-not ($e -is [System.Management.Automation.PSCustomObject])) { Fehler "Eintrag ${i}: kein Objekt" }
        $fehlt = @('art', 'kat', 'kontext', 'p') | Where-Object { -not (Hat-Feld $e $_) }
        if (@($fehlt).Count -gt 0) { Fehler "Eintrag ${i}: Felder fehlen: $(@($fehlt) -join ', ')" }
        $h = @{}
        foreach ($name in @('p', 'falsch', 'kontext', 'kat', 'art', 'korrektur', 'kommentar')) {
            if (Hat-Feld $e $name) { $h[$name] = $e.PSObject.Properties[$name].Value }
        }
        if (-not ($h.p -is [int] -or $h.p -is [long])) { Fehler "Eintrag ${i}: 'p' muss eine ganze Zahl sein" }
        $falscheTypen = @('falsch', 'kontext', 'kat', 'art', 'korrektur', 'kommentar') |
            Where-Object { $h.ContainsKey($_) -and -not ($h[$_] -is [string]) }
        if (@($falscheTypen).Count -gt 0) { Fehler "Eintrag ${i}: kein Text in $(@($falscheTypen) -join ', ')" }
        if ([string]::IsNullOrEmpty($h.kontext)) { Fehler "Eintrag ${i}: 'kontext' ist leer" }
        if (-not ($ARTEN -ccontains $h.art) -or -not ($KATEGORIEN -ccontains $h.kat)) {
            Fehler "Eintrag ${i}: art/kat ungueltig: $($h.art)/$($h.kat)"
        }
        if ($h.art -ceq 'zeichen_weg' -and $h.kat -cne 'Z') { Fehler "Eintrag ${i}: zeichen_weg nur mit Z" }
        $kommentar = ''
        if ($h.ContainsKey('kommentar')) { $kommentar = $h.kommentar }
        if (-not $kommentar.StartsWith($h.kat + ':', $ORDINAL)) {
            Fehler "Eintrag ${i}: Kommentar muss mit '$($h.kat):' beginnen"
        }
        if (($h.art -ceq 'ersetzen' -or $h.art -ceq 'einfuegen') -and [string]::IsNullOrEmpty($h.korrektur)) {
            Fehler "Eintrag ${i}: 'korrektur' fehlt"
        }
        if ($h.art -cne 'einfuegen' -and [string]::IsNullOrEmpty($h.falsch)) { Fehler "Eintrag ${i}: 'falsch' fehlt" }
        if (($h.kat -ceq 'H') -ne ($h.art -ceq 'gelb')) { Fehler "Eintrag ${i}: H gehoert zu gelb und gelb nur zu H" }
        $daten.Add($h)
    }
    return , $daten
}

function Aufloesen($paras, $daten) {
    # Gibt @{ok; probleme} zurueck. Position = Zeichenoffset im Absatz.
    $ok = New-Object 'System.Collections.Generic.List[hashtable]'
    $probleme = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $daten.Count; $i++) {
        $e = $daten[$i]
        if (-not ($e.p -ge 0 -and $e.p -lt $paras.Count)) {
            $probleme.Add("Eintrag ${i}: Absatz $($e.p) gibt es nicht")
            continue
        }
        $text = Absatz-Text $paras[[int]$e.p]
        $n = Zaehlen $text $e.kontext
        if ($n -ne 1) {
            $probleme.Add("Eintrag $i (p$($e.p)): Kontext $(Zitat $e.kontext) kommt ${n}x vor")
            continue
        }
        $k = $text.IndexOf($e.kontext, $ORDINAL)
        if ($e.art -ceq 'einfuegen') {
            $s = $k + $e.kontext.Length
            $ende = $s
        } else {
            if ((Zaehlen $e.kontext $e.falsch) -ne 1) {
                $probleme.Add("Eintrag $i (p$($e.p)): $(Zitat $e.falsch) nicht genau 1x im Kontext")
                continue
            }
            $s = $k + $e.kontext.IndexOf($e.falsch, $ORDINAL)
            $ende = $s + $e.falsch.Length
        }
        $neu = $e.Clone()
        if ($e.art -ceq 'einfuegen') { $neu.korrektur = Einfuege-Text $text $s $e.korrektur }
        $neu.i = $i
        $neu.s = $s
        $neu.e = $ende
        $ok.Add($neu)
    }
    $sortiert = New-Object 'System.Collections.Generic.List[hashtable]'
    foreach ($x in @($ok | Sort-Object -Property @{ Expression = { $_.p } }, @{ Expression = { $_.s } },
            @{ Expression = { $_.e } }, @{ Expression = { $_.i } })) {
        $sortiert.Add($x)
    }
    for ($j = 0; $j + 1 -lt $sortiert.Count; $j++) {
        $a = $sortiert[$j]
        $b = $sortiert[$j + 1]
        if ($a.p -eq $b.p -and ($b.s -lt $a.e -or ($b.s -eq $a.e -and
                ($a.art -ceq 'einfuegen' -or $b.art -ceq 'einfuegen')))) {
            $probleme.Add("Eintraege $($a.i) und $($b.i) ueberlappen/grenzen an (p$($a.p))")
        }
    }
    return @{ ok = $sortiert; probleme = $probleme }
}

function Einfuege-Text([string]$text, [int]$pos, [string]$korrektur) {
    # Eingefuegte Woerter bekommen das fehlende Leerzeichen selbst (Satzzeichen bleiben, wie sie sind)
    $r = $korrektur
    $davor = ''
    if ($pos -gt 0) { $davor = [string]$text[$pos - 1] }
    $danach = ''
    if ($pos -lt $text.Length) { $danach = [string]$text[$pos] }
    if ([regex]::IsMatch($r, '^[\p{L}\p{N}]') -and $davor -cne '' -and -not [regex]::IsMatch($davor, '[\s(\u00AB\u201E"''\u2039]')) { $r = ' ' + $r }
    if ([regex]::IsMatch($r, '[\p{L}\p{N}]$') -and [regex]::IsMatch($danach, '^[\p{L}\p{N}]')) { $r = $r + ' ' }
    return $r
}

# ---------- Kandidaten (Vorfilter ohne LLM) ----------
# Findet Stellen, an denen Claude erfahrungsgemaess Fehler uebersieht. Das sind nur Hinweise, keine Fehler:
# Die Agents pruefen jede Stelle und entscheiden selbst. Gleiche Regeln in korrektur.js.

$WORTLISTE = @(@('\p{L}*[Rr]eflektion', 'Reflexion'), @('[Vv]orraus', 'Voraus'), @('[Ss]tandart', 'Standard'),
    @('[Ww]iederspiegel', 'widerspiegel'), @('[Ww]iederspruch', 'Widerspruch'), @('[Ww]iedersprech', 'widersprech'),
    @('[Gg]arnicht', 'gar nicht'), @('[Aa]usversehen', 'aus Versehen'), @('[Zz]umindestens', 'zumindest'),
    @('Romanes', 'Romans'),
    @('(?<=(?:[Ss]einer|[Ii]hrer|[Mm]einer|[Dd]einer|[Uu]nserer|[Ee]urer|[Ee]iner|[Dd]er|[Dd]ie|[Dd]as|[Ee]in|[Ss]ein|[Ii]hr|[Mm]ein) )eign(?:e|en|em|er|es)', 'eigen(e|en|em|er|es)'))
$ADJ_ENDUNG = '(?:e|en|em|er|es)'
$BEGLEITER = '(?:ein|eine|einen|einem|einer|eines|der|die|das|dem|den|des|dieser|diese|diesen|diesem|dieses|' +
    'sein|seine|seinen|seinem|seiner|seines|ihr|ihre|ihren|ihrem|ihrer|ihres|mein|meine|unser|unsere|kein|keine)'
$PRAEP_DIESER = '(?:hinter|in|mit|von|auf|an|bei|durch|f\u00fcr|gegen|nach|\u00fcber|unter|vor|zu|aus|um|neben)'
$NICHT_INFINITIV = @('den', 'dem', 'einen', 'einem', 'keinen', 'keinem', 'meinen', 'meinem', 'deinen', 'seinen',
    'ihren', 'unseren', 'diesen', 'diesem', 'jenen', 'allen', 'vielen', 'anderen', 'beiden', 'manchen', 'solchen',
    'welchen', 'jeden', 'denen', 'wen')
$EINLEITER = '(?<!\p{L})([Uu]m|[Oo]hne|[Ss]tatt|[Aa]nstatt)(?!\p{L})'
$TRENNBAR_ZU = '(?<!\p{L})(?:auf|an|ab|aus|ein|mit|vor|nach|weg|fest|her|hin|dar|zur\u00fcck|teil|fort|bei|heraus|hinaus|herunter|hinzu)zu\p{Ll}+'
$SATZ_ENDE_VOR_EINLEITER = '[,;:.!?(\u00AB\u201E"\u2013\u2014-]$'

function Letzte-Woerter([string[]]$woerter, [int]$n) {
    $start = [Math]::Max(0, $woerter.Count - $n)
    return (@($woerter[$start..($woerter.Count - 1)]) -join ' ')
}


# Rechtschreibpruefer des Betriebssystems (Windows: ISpellChecker, braucht installierte deutsche Sprache).
# Meldet nur unbekannte Woerter, jedes Wort einmal pro Dokument. Gegenstueck: unbekannteWoerter in korrektur.js.
# Fehlt der Pruefer oder die Sprache, entfaellt dieser Hinweis ohne Fehlermeldung.
$script:Pruefer = $null
function Pruefer-Holen {
    if ($null -ne $script:Pruefer) { return $script:Pruefer }
    $script:Pruefer = $false
    try {
        if (-not ('RechtschreibHilfe' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellCheckerFactory {
    [PreserveSig] int get_SupportedLanguages(out IntPtr value);
    [PreserveSig] int IsSupported([MarshalAs(UnmanagedType.LPWStr)] string languageTag, out int value);
    [PreserveSig] int CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string languageTag, [MarshalAs(UnmanagedType.Interface)] out ISpellChecker value);
}
[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellChecker {
    [PreserveSig] int get_LanguageTag([MarshalAs(UnmanagedType.LPWStr)] out string value);
    [PreserveSig] int Check([MarshalAs(UnmanagedType.LPWStr)] string text, [MarshalAs(UnmanagedType.Interface)] out IEnumSpellingError value);
}
[ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IEnumSpellingError {
    [PreserveSig] int Next([MarshalAs(UnmanagedType.Interface)] out ISpellingError value);
}
[ComImport, Guid("B7C82D61-FBE8-4B47-9B27-6C0D2E0DE0A3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISpellingError {
    [PreserveSig] int get_StartIndex(out uint value);
    [PreserveSig] int get_Length(out uint value);
}
[ComImport, Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")]
public class SpellCheckerFactoryClass { }
public static class RechtschreibHilfe {
    public static ISpellChecker Holen(string[] tags) {
        ISpellCheckerFactory f = (ISpellCheckerFactory)new SpellCheckerFactoryClass();
        foreach (string t in tags) {
            int ok;
            ISpellChecker c;
            if (f.IsSupported(t, out ok) == 0 && ok != 0 && f.CreateSpellChecker(t, out c) == 0) return c;
        }
        return null;
    }
    public static int[] Fehler(ISpellChecker c, string text) {
        List<int> r = new List<int>();
        IEnumSpellingError e;
        if (c.Check(text, out e) != 0 || e == null) return r.ToArray();
        ISpellingError x;
        while (e.Next(out x) == 0 && x != null) {
            uint start, laenge;
            x.get_StartIndex(out start);
            x.get_Length(out laenge);
            r.Add((int)start);
            r.Add((int)laenge);
        }
        return r.ToArray();
    }
}
'@
        }
        $c = [RechtschreibHilfe]::Holen([string[]]@('de-CH', 'de-DE', 'de-AT', 'de'))
        if ($null -ne $c) { $script:Pruefer = $c }
    } catch {
        $script:Pruefer = $false
    }
    return $script:Pruefer
}

function Unbekannte-Woerter([string]$text) {
    # Liste von @(start, laenge) fuer unbekannte Woerter in einem Absatz
    $pr = Pruefer-Holen
    if ($pr -is [bool]) { return ,@() }
    try { $paare = [RechtschreibHilfe]::Fehler($pr, $text) } catch { return ,@() }
    $r = New-Object 'System.Collections.Generic.List[int[]]'
    for ($i = 0; $i + 1 -lt $paare.Count; $i += 2) { $r.Add([int[]]@($paare[$i], $paare[$i + 1])) }
    return ,$r
}

function Hinweise([string]$text, $gesehen) {
    # Liste von @{pos; laenge; kat; hinweis} fuer einen Absatz
    $t = New-Object 'System.Collections.Generic.List[hashtable]'
    foreach ($w in $WORTLISTE) {
        foreach ($m in [regex]::Matches($text, '(?<!\p{L})' + $w[0] + '\p{L}*')) {
            $t.Add(@{ pos = $m.Index; laenge = $m.Length; kat = 'R'; hinweis = "Schreibung `"$($m.Value)`" -> $($w[1])?" })
        }
    }
    foreach ($m in [regex]::Matches($text, $EINLEITER)) {
        $wort = $m.Value
        $vor = $text.Substring(0, $m.Index).TrimEnd()
        $nach = $text.Substring($m.Index + $wort.Length)
        if ($wort -cmatch '^[Uu]m$' -and $nach.StartsWith(',', [System.StringComparison]::Ordinal)) {
            $t.Add(@{ pos = $m.Index; laenge = $wort.Length + 1; kat = 'Z'; hinweis = 'Komma hinter "um" ueberfluessig, Komma gehoert davor?' })
        }
        $fenster = [regex]::Match([regex]::Replace($nach, '^,', ''), '^[^.!?;:,]{0,100}').Value
        $mitZu = [regex]::IsMatch($fenster, '(?<!\p{L})zu\s+\p{Ll}|' + $TRENNBAR_ZU)
        if ($mitZu -and $vor -cne '' -and -not [regex]::IsMatch($vor, $SATZ_ENDE_VOR_EINLEITER)) {
            $t.Add(@{ pos = $m.Index; laenge = $wort.Length; kat = 'Z'; hinweis = "Komma vor `"$wort`" fehlt? (Infinitivgruppe)" })
        }
    }
    foreach ($m in [regex]::Matches($text, '(?<!\p{L})zu\s+(\p{Ll}+)(?!\p{L})')) {
        $wort = $m.Groups[1].Value
        if (-not ([regex]::IsMatch($wort, '(?:en|ern|eln)$') -or $wort -ceq 'sein') -or ($NICHT_INFINITIV -ccontains $wort)) { continue }
        $teile = [regex]::Split($text.Substring(0, $m.Index), '[.!?;:]')
        $woerter = [regex]::Split($teile[$teile.Count - 1].TrimEnd(), '\s+')
        if ((Letzte-Woerter $woerter 4).Contains(',')) { continue }
        if ([regex]::IsMatch((Letzte-Woerter $woerter 8), $EINLEITER)) { continue }
        $t.Add(@{ pos = $m.Index; laenge = $m.Length; kat = 'Z'; hinweis = 'zu-Infinitiv ohne Komma davor, erweitert? (Pflicht ab Fassung 2024)' })
    }
    foreach ($uw in (Unbekannte-Woerter $text)) {
        if ($uw.Count -lt 2) { continue }
        $pos = $uw[0]; $laenge = $uw[1]
        if ($pos + $laenge -gt $text.Length) { continue }
        $wort = $text.Substring($pos, $laenge)
        if ($laenge -lt 3 -or [regex]::IsMatch($wort, '[\p{N}@]') -or $gesehen.Contains($wort)) { continue }
        $belegt = $false
        foreach ($h in $t) { if ($h.kat -ceq 'R' -and $h.pos -lt ($pos + $laenge) -and $pos -lt ($h.pos + $h.laenge)) { $belegt = $true } }
        if ($belegt) { continue }
        [void]$gesehen.Add($wort)
        $t.Add(@{ pos = $pos; laenge = $laenge; kat = 'R'; hinweis = "Unbekanntes Wort `"$wort`"? (Rechtschreibpruefer)" })
    }
    $adjWort = '(?!' + $BEGLEITER + '(?!\p{L}))\p{Ll}+' + $ADJ_ENDUNG + '(?!\p{L})'
    $adjReihe = '(?<!\p{L})' + $BEGLEITER + '\s+(' + $adjWort + '(?:\s+' + $adjWort + '){1,2})\s+\p{Lu}'
    foreach ($m in [regex]::Matches($text, $adjReihe)) {
        $t.Add(@{ pos = $m.Index; laenge = $m.Length; kat = 'Z'; hinweis = "Adjektivreihe `"$($m.Groups[1].Value)`": Komma, wenn `"und`" passt?" })
    }
    $relPron = '(?<!\p{L})' + $PRAEP_DIESER + '\s+(?:dieser|diesem|diesen|dieses|welcher|welchem|welchen)\s+(?:sich|er|sie|es|ihm|ihn|ihr|man)(?!\p{L})'
    foreach ($m in [regex]::Matches($text, $relPron, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $t.Add(@{ pos = $m.Index; laenge = $m.Length; kat = 'G'; hinweis = 'Relativsatz? "dieser/diesem" statt "der/dem", Komma davor?' })
    }
    return ,@($t | Sort-Object -Property @{ Expression = { $_.pos } }, @{ Expression = { $_.hinweis } })
}

function Kandidaten-Zeilen($paras) {
    $zeilen = New-Object 'System.Collections.Generic.List[string]'
    $gesehen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    for ($nr = 0; $nr -lt $paras.Count; $nr++) {
        $text = Absatz-Text $paras[$nr]
        foreach ($h in (Hinweise $text $gesehen)) {
            $start = [Math]::Max(0, $h.pos - 25)
            $ende = [Math]::Min($text.Length, $h.pos + $h.laenge + 25)
            $ausschnitt = [regex]::Replace($text.Substring($start, $ende - $start), '\s+', ' ')
            $zeilen.Add("[$nr] $($h.kat): $($h.hinweis) | ...$ausschnitt...")
        }
    }
    return ,$zeilen
}

# ---------- Umsetzen ----------

function Referenz([System.Xml.XmlDocument]$doc, $cid) {
    $r = Neues-Element $doc 'r' $null
    [void]$r.AppendChild((Neues-Element $doc 'commentReference' ([ordered]@{ id = [string]$cid })))
    return , $r
}

function Eintrag-Setzen($p, [hashtable]$e, $cid) {
    $doc = $p.get_OwnerDocument()
    $karte = Text-Karte $p
    if ($e.art -ceq 'einfuegen') {
        $anker = $null
        foreach ($x in $karte) { if ($x.e -eq $e.s) { $anker = $x.r } }
        if ($null -ne $anker) {
            $neu = Neuer-Text-Run $anker $e.korrektur
            Einfuegen-Nach $anker $neu
        } else {
            $anker = $karte[0].r
            $neu = Neuer-Text-Run $anker $e.korrektur
            Einfuegen-Vor $anker $neu
        }
        $erster = $neu
        $letzter = $neu
    } else {
        $runs = New-Object 'System.Collections.Generic.List[System.Xml.XmlElement]'
        $gefunden = New-Object System.Text.StringBuilder
        foreach ($x in $karte) {
            if ($x.s -ge $e.s -and $x.e -le $e.e) {
                $runs.Add($x.r)
                [void]$gefunden.Append((Run-Text $x.r))
            }
        }
        if ($runs.Count -eq 0 -or $gefunden.ToString() -cne $e.falsch) {
            Fehler "Eintrag $($e.i): Stelle $(Zitat $e.falsch) nicht sauber gefunden"
        }
        $vorlage = $runs[$runs.Count - 1].CloneNode($true)
        foreach ($r in $runs) {
            if ($e.art -ceq 'zeichen_weg') {
                Rpr-Setzen $r 'highlight' ([ordered]@{ val = 'red' })
                Rpr-Setzen $r 'shd' ([ordered]@{ val = 'clear'; color = 'auto'; fill = 'FF0000' })
            } elseif ($e.art -ceq 'gelb') {
                Rpr-Setzen $r 'highlight' ([ordered]@{ val = 'yellow' })
                Rpr-Setzen $r 'shd' ([ordered]@{ val = 'clear'; color = 'auto'; fill = $GELB })
                # Word zeichnet die Kommentarfarbe ueber Hintergrund und Hervorhebung: die dicke Linie bleibt sichtbar
                Rpr-Setzen $r 'u' ([ordered]@{ val = 'thick'; color = $GELB })
            } else {
                Rpr-Setzen $r 'strike' $null
                Rpr-Setzen $r 'color' ([ordered]@{ val = 'FF0000' })
            }
        }
        $erster = $runs[0]
        $letzter = $runs[$runs.Count - 1]
        if ($e.art -ceq 'ersetzen') {
            # Die Vorlage gehoert noch zu keinem Dokumentbaum; der neue Run wird im Dokument erzeugt
            $neu = Neuer-Text-Run $vorlage $e.korrektur
            Einfuegen-Nach $runs[$runs.Count - 1] $neu
            $letzter = $neu
        }
    }
    if ($e.art -ceq 'zeichen_weg') {  # Kommentar aufs Zeichen danach, sonst verdeckt die Kommentarfarbe das Rot
        $folgend = $null
        foreach ($x in $karte) { if ($x.s -eq $e.e -and $x.e -eq $e.e + 1) { $folgend = $x.r; break } }
        if ($null -eq $folgend) {  # Absatzende: Punktkommentar
            Einfuegen-Nach $letzter (Referenz $doc $cid)
            return
        }
        $erster = $folgend
        $letzter = $folgend
    }
    Einfuegen-Vor $erster (Neues-Element $doc 'commentRangeStart' ([ordered]@{ id = [string]$cid }))
    $ende = Neues-Element $doc 'commentRangeEnd' ([ordered]@{ id = [string]$cid })
    Einfuegen-Nach $letzter $ende
    Einfuegen-Nach $ende (Referenz $doc $cid)
}

function Zusammenfassung-Zeilen($ok) {
    # Text der Schlusszusammenfassung: Fehler gesamt und Anzahl pro Kategorie (ohne gelb)
    $fehler = @($ok | Where-Object { $_.kat -cne 'H' })
    $zeilen = New-Object 'System.Collections.Generic.List[object]'
    $zeilen.Add(@('Zusammenfassung', $true))
    $zeilen.Add(@("Fehler gesamt: $($fehler.Count)", $false))
    foreach ($kn in $FEHLER_KATEGORIEN) {
        $anzahl = @($fehler | Where-Object { $_.kat -ceq $kn[0] }).Count
        $zeilen.Add(@("$($kn[1]) ($($kn[0])): $anzahl", $false))
    }
    return , $zeilen
}

function Zusammenfassung-Anhaengen([System.Xml.XmlDocument]$doc, $ok) {
    # Haengt am Dokumentende rote Absaetze mit der Zusammenfassung an (vor dem Abschnitt sectPr)
    $body = Kind-W $doc.get_DocumentElement() 'body'
    if ($null -eq $body) { Fehler 'w:body fehlt' }
    # Leere Vorlage: nichts vom Schueler erben (sonst z.B. Titelgroesse oder verborgen)
    $vorlage = Neues-Element $doc 'r' $null
    $sektion = Kind-W $body 'sectPr'
    foreach ($zeile in (Zusammenfassung-Zeilen $ok)) {
        $run = Neuer-Text-Run $vorlage $zeile[0]
        if ($zeile[1]) { Rpr-Setzen $run 'b' $null }
        $p = Neues-Element $doc 'p' $null
        [void]$p.AppendChild($run)
        if ($null -ne $sektion) { [void]$body.InsertBefore($p, $sektion) } else { [void]$body.AppendChild($p) }
    }
}

function Kommentare-Anhaengen([System.Xml.XmlDocument]$kdoc, $eintraege, [int]$startId) {
    $jetzt = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
    $root = $kdoc.get_DocumentElement()
    for ($n = 0; $n -lt $eintraege.Count; $n++) {
        $c = Neues-Element $kdoc 'comment' ([ordered]@{ id = [string]($startId + $n); author = 'Korrektur'; date = $jetzt; initials = 'K' })
        $p = Neues-Element $kdoc 'p' $null
        $r1 = Neues-Element $kdoc 'r' $null
        [void]$r1.AppendChild((Neues-Element $kdoc 'annotationRef' $null))
        $r2 = Neues-Element $kdoc 'r' $null
        $t = Neues-Element $kdoc 't' $null
        Text-Setzen $t $eintraege[$n].kommentar
        [void]$r2.AppendChild($t)
        [void]$p.AppendChild($r1)
        [void]$p.AppendChild($r2)
        [void]$c.AppendChild($p)
        [void]$root.AppendChild($c)
    }
}

function Freie-Id($baeume) {
    # Erste w:id ueber allen vorhandenen (Kommentare, Lesezeichen, Aenderungen), damit jede eindeutig ist
    [long]$max = -1
    foreach ($baum in $baeume) {
        if ($null -eq $baum) { continue }
        foreach ($el in (Alle-Elemente $baum)) {
            $wert = W-Attr $el 'id'
            if ($null -ne $wert -and $wert -cmatch '^-?[0-9]+$') {
                $zahl = [long]$wert
                if ($zahl -gt $max) { $max = $zahl }
            }
        }
    }
    return [int]($max + 1)
}

function Sha([byte[]]$daten) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($sha.ComputeHash($daten)) } finally { $sha.Dispose() }
}

function Setzen([string]$docx, [string]$jsonpfad, [string]$out) {
    $vorher = Sha ([System.IO.File]::ReadAllBytes($docx))
    $daten = Eintraege-Lesen $jsonpfad
    $paket = Zip-Lesen $docx
    $teile = $paket.teile
    $doc = Xml-Laden (Teil $teile 'word/document.xml') 'word/document.xml'
    W-Praefix-Pruefen $doc 'word/document.xml'
    $paras = Absaetze $doc.get_DocumentElement()
    $ergebnis = Aufloesen $paras $daten
    $ok = $ergebnis.ok
    if ($ergebnis.probleme.Count -gt 0) { Fehler ($ergebnis.probleme -join "`n") }

    $rels = Xml-Laden (Teil $teile 'word/_rels/document.xml.rels') 'document.xml.rels'
    $ct = Xml-Laden (Teil $teile '[Content_Types].xml') '[Content_Types].xml'
    $relsRoot = $rels.get_DocumentElement()
    $ctRoot = $ct.get_DocumentElement()
    if ($relsRoot.get_LocalName() -cne 'Relationships' -or $relsRoot.get_NamespaceURI() -cne $R_NS -or $relsRoot.get_Prefix() -cne '') {
        Fehler 'document.xml.rels unerwartet aufgebaut'
    }
    if ($ctRoot.get_LocalName() -cne 'Types' -or $ctRoot.get_NamespaceURI() -cne $CT_NS -or $ctRoot.get_Prefix() -cne '') {
        Fehler '[Content_Types].xml unerwartet aufgebaut'
    }
    $ziel = $null
    foreach ($r in (Kinder-Elemente $relsRoot)) {
        if ((Attr0 $r 'Type') -ceq $COMMENTS_REL) { $ziel = Attr0 $r 'Target'; break }
    }
    $teilname = 'word/comments.xml'
    if ($ziel) {
        if ($ziel.StartsWith('/', $ORDINAL)) { $teilname = $ziel.Substring(1) } else { $teilname = 'word/' + $ziel }
    }
    $kdoc = $null
    if ($teile.ContainsKey($teilname)) {
        $kdoc = Xml-Laden $teile[$teilname] $teilname
        W-Praefix-Pruefen $kdoc $teilname
    }
    $kroot = $null
    if ($null -ne $kdoc) { $kroot = $kdoc.get_DocumentElement() }
    $startId = Freie-Id @($doc.get_DocumentElement(), $kroot)

    $nummern = @($ok | ForEach-Object { [int]$_.p } | Sort-Object -Unique)
    foreach ($pNr in $nummern) {
        $p = $paras[$pNr]
        Atomar $p
        foreach ($e in $ok) {
            if ($e.p -ne $pNr) { continue }
            $stellen = @($e.s, $e.e)
            if ($e.art -ceq 'zeichen_weg') { $stellen += ($e.e + 1) }
            foreach ($pos in $stellen) { Schneiden $p $pos }
        }
    }
    $kommentiert = New-Object 'System.Collections.Generic.List[hashtable]'
    foreach ($e in $ok) {
        $e.cid = $startId + $kommentiert.Count
        $kommentiert.Add($e)
    }
    for ($j = $ok.Count - 1; $j -ge 0; $j--) {  # hinten zuerst, Absatzpositionen bleiben gueltig
        $e = $ok[$j]
        $cid = $null
        if ($e.ContainsKey('cid')) { $cid = $e.cid }
        Eintrag-Setzen $paras[[int]$e.p] $e $cid
    }
    Zusammenfassung-Anhaengen $doc $ok

    $neu = New-Object 'System.Collections.Generic.Dictionary[string,byte[]]' ([System.StringComparer]::Ordinal)
    $neu['word/document.xml'] = Xml-Bytes $doc
    if ($null -eq $kdoc) {
        $kdoc = New-Object System.Xml.XmlDocument
        $kdoc.PreserveWhitespace = $true
        [void]$kdoc.AppendChild($kdoc.CreateXmlDeclaration('1.0', 'UTF-8', 'yes'))
        [void]$kdoc.AppendChild($kdoc.CreateElement('w', 'comments', $W))
    }
    Kommentare-Anhaengen $kdoc $kommentiert $startId
    $neu[$teilname] = Xml-Bytes $kdoc
    if (-not $ziel) {
        $hoechste = 0
        foreach ($r in (Kinder-Elemente $relsRoot)) {
            $id = Attr0 $r 'Id'
            if ($null -ne $id -and $id -cmatch '^rId([0-9]+)$') {
                if ([int]$Matches[1] -gt $hoechste) { $hoechste = [int]$Matches[1] }
            }
        }
        $rel = $rels.CreateElement('Relationship', $R_NS)
        $rel.SetAttribute('Id', "rId$($hoechste + 1)")
        $rel.SetAttribute('Type', $COMMENTS_REL)
        $rel.SetAttribute('Target', 'comments.xml')
        [void]$relsRoot.AppendChild($rel)
        $neu['word/_rels/document.xml.rels'] = Xml-Bytes $rels
    }
    $vorhanden = $false
    foreach ($o in (Kinder-Elemente $ctRoot)) {
        if ((Attr0 $o 'PartName') -ceq ('/' + $teilname)) { $vorhanden = $true }
    }
    if (-not $vorhanden) {
        $ov = $ct.CreateElement('Override', $CT_NS)
        $ov.SetAttribute('PartName', '/' + $teilname)
        $ov.SetAttribute('ContentType', $COMMENTS_CT)
        [void]$ctRoot.AppendChild($ov)
        $neu['[Content_Types].xml'] = Xml-Bytes $ct
    }

    # Erst in eine Zwischendatei schreiben und pruefen; nur eine gepruefte Kopie bekommt den Zielnamen
    $zwischen = Join-Path ([System.IO.Path]::GetDirectoryName($out)) ('.' + [System.IO.Path]::GetFileName($out) + '.tmp')
    try {
        Zip-Schreiben $paket $neu $zwischen
        Selbstpruefung $zwischen $kommentiert.Count $startId $teile $teilname
        if ((Sha ([System.IO.File]::ReadAllBytes($docx))) -cne $vorher) { Fehler 'Original veraendert' }
        if ([System.IO.File]::Exists($out)) { [System.IO.File]::Delete($out) }
        [System.IO.File]::Move($zwischen, $out)
    } finally {
        if ([System.IO.File]::Exists($zwischen)) { [System.IO.File]::Delete($zwischen) }
    }
    return $ok.Count
}

# ---------- Selbstpruefung ----------

function Selbstpruefung([string]$out, [int]$anzahl, [int]$startId, $altTeile, [string]$teilname) {
    try { $gelesen = (Zip-Lesen $out).teile } catch { Fehler 'Zip der Kopie defekt' }
    foreach ($name in $gelesen.Keys) {
        if ($name.EndsWith('.xml', $ORDINAL) -or $name.EndsWith('.rels', $ORDINAL)) {
            [void](Xml-Laden $gelesen[$name] $name)  # wirft bei ungueltigem XML
        }
    }
    $geaendert = @('word/document.xml', $teilname, 'word/_rels/document.xml.rels', '[Content_Types].xml')
    foreach ($name in $altTeile.Keys) {
        if ($geaendert -ccontains $name) { continue }
        if (-not $gelesen.ContainsKey($name) -or (Sha $gelesen[$name]) -cne (Sha $altTeile[$name])) {
            Fehler "Teil $name unbeabsichtigt veraendert"
        }
    }
    $alt = Absaetze (Xml-Laden (Teil $altTeile 'word/document.xml') 'word/document.xml').get_DocumentElement()
    $neuRoot = (Xml-Laden (Teil $gelesen 'word/document.xml') 'word/document.xml').get_DocumentElement()
    $neu = Absaetze $neuRoot
    if ($neu.Count -lt $alt.Count) { Fehler 'Absatzzahl geaendert' }
    for ($i = 0; $i -lt $alt.Count; $i++) {
        if ((Absatz-Text $alt[$i]) -cne (Absatz-Text $neu[$i] $true)) { Fehler "Absatz ${i}: Schuelertext veraendert" }
    }
    for ($i = $alt.Count; $i -lt $neu.Count; $i++) {
        if ((Absatz-Text $neu[$i] $true) -cne '') { Fehler 'Nach dem Schuelertext steht mehr als die Zusammenfassung' }
    }
    $starts = New-Object 'System.Collections.Generic.List[string]'
    $enden = New-Object 'System.Collections.Generic.List[string]'
    $refs = New-Object 'System.Collections.Generic.List[string]'
    foreach ($x in (Alle-Elemente $neuRoot)) {
        if (Ist-W $x 'commentRangeStart') { $starts.Add((W-Attr $x 'id')) }
        elseif (Ist-W $x 'commentRangeEnd') { $enden.Add((W-Attr $x 'id')) }
        elseif (Ist-W $x 'commentReference') { $refs.Add((W-Attr $x 'id')) }
    }
    $sStarts = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    $sEnden = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    $sRefs = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($x in $starts) { [void]$sStarts.Add($x) }
    foreach ($x in $enden) { [void]$sEnden.Add($x) }
    foreach ($x in $refs) { [void]$sRefs.Add($x) }
    $neue = @(for ($n = 0; $n -lt $anzahl; $n++) { [string]($startId + $n) })
    $gut = ($sStarts.Count -eq $starts.Count) -and ($sRefs.Count -eq $refs.Count) -and $sStarts.SetEquals($sEnden) -and
        $sStarts.IsSubsetOf($sRefs)
    foreach ($x in $neue) { if (-not $sRefs.Contains($x)) { $gut = $false } }
    if (-not $gut) { Fehler 'Kommentarmarken unvollstaendig oder doppelt' }
    $kIds = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($c in (Kinder-Elemente (Xml-Laden (Teil $gelesen $teilname) $teilname).get_DocumentElement())) {
        [void]$kIds.Add((W-Attr $c 'id'))
    }
    foreach ($x in $neue) { if (-not $kIds.Contains($x)) { Fehler 'Kommentare fehlen in comments.xml' } }
}

# ---------- Dateien und Zip ----------

function Zip-Lesen([string]$pfad) {
    # Liest alle Teile als Bytes, in der Reihenfolge des Zip-Verzeichnisses
    try { $zip = [System.IO.Compression.ZipFile]::OpenRead($pfad) }
    catch { Fehler "$([System.IO.Path]::GetFileName($pfad)) ist keine gueltige .docx" }
    try {
        $namen = New-Object 'System.Collections.Generic.List[string]'
        $teile = New-Object 'System.Collections.Generic.Dictionary[string,byte[]]' ([System.StringComparer]::Ordinal)
        foreach ($eintrag in $zip.Entries) {
            $namen.Add($eintrag.FullName)
            if ($eintrag.FullName.EndsWith('/', $ORDINAL)) { continue }
            $strom = $eintrag.Open()
            try {
                $puffer = New-Object System.IO.MemoryStream
                $strom.CopyTo($puffer)
            } finally { $strom.Close() }
            $teile[$eintrag.FullName] = $puffer.ToArray()
        }
    } catch {
        if ($_.Exception.Data.Contains('korrektur')) { throw }
        Fehler "$([System.IO.Path]::GetFileName($pfad)) ist keine gueltige .docx"
    } finally { $zip.Dispose() }
    return @{ namen = $namen; teile = $teile }
}

function Teil($teile, [string]$name) {
    if (-not $teile.ContainsKey($name)) { Fehler "Teil $name fehlt" }
    return , $teile[$name]
}

function Zip-Schreiben($paket, $neu, [string]$ziel) {
    # Alle Teile in Originalreihenfolge, geaenderte ersetzt, neue am Schluss
    $namen = New-Object 'System.Collections.Generic.List[string]'
    foreach ($n in $paket.namen) { $namen.Add($n) }
    foreach ($n in $neu.Keys) { if (-not $namen.Contains($n)) { $namen.Add($n) } }
    if ([System.IO.File]::Exists($ziel)) { [System.IO.File]::Delete($ziel) }
    $datei = [System.IO.File]::Open($ziel, [System.IO.FileMode]::CreateNew)
    try {
        $zip = New-Object System.IO.Compression.ZipArchive ($datei, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in $namen) {
                $eintrag = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
                if ($name.EndsWith('/', $ORDINAL)) { continue }
                if ($neu.ContainsKey($name)) { $bytes = $neu[$name] } else { $bytes = $paket.teile[$name] }
                $strom = $eintrag.Open()
                try { $strom.Write($bytes, 0, $bytes.Length) } finally { $strom.Close() }
            }
        } finally { $zip.Dispose() }
    } finally { $datei.Dispose() }
}

function Absolut([string]$pfad) {
    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location).ProviderPath, $pfad))
}

# ---------- Aufruf ----------

function Ausfuehren([string[]]$argv, $aus) {
    if ($argv.Count -lt 2 -or -not (@('extrahieren', 'kandidaten', 'pruefen', 'setzen') -ccontains $argv[0]) -or
            ($argv[0] -cne 'extrahieren' -and $argv[0] -cne 'kandidaten' -and $argv.Count -lt 3)) {
        $aus.WriteLine($USAGE)
        return 2
    }
    $docx = Absolut $argv[1]
    if (-not [System.IO.File]::Exists($docx)) { Fehler "Datei fehlt: $($argv[1])" }
    if (@('extrahieren', 'kandidaten', 'pruefen') -ccontains $argv[0]) {
        $paket = Zip-Lesen $docx
        $doc = Xml-Laden (Teil $paket.teile 'word/document.xml') 'word/document.xml'
        $paras = Absaetze $doc.get_DocumentElement()
        if ($argv[0] -ceq 'extrahieren') {
            for ($i = 0; $i -lt $paras.Count; $i++) {
                $text = Absatz-Text $paras[$i]
                if ($text.Trim() -cne '') { $aus.WriteLine("[$i] $text") }
            }
            return 0
        }
        if ($argv[0] -ceq 'kandidaten') {
            $zeilen = Kandidaten-Zeilen $paras
            if ($zeilen.Count -gt 0) { $aus.WriteLine(($zeilen -join "`n")) } else { $aus.WriteLine('keine Kandidaten') }
            return 0
        }
        $ergebnis = Aufloesen $paras (Eintraege-Lesen (Absolut $argv[2]))
        if ($ergebnis.probleme.Count -gt 0) {
            $aus.WriteLine(($ergebnis.probleme -join "`n"))
            return 1
        }
        $aus.WriteLine("OK: $($ergebnis.ok.Count) Eintraege eindeutig")
        return 0
    }
    if ($argv.Count -gt 3) { $out = Absolut $argv[3] }
    else {
        $out = Join-Path (Join-Path ([System.IO.Path]::GetDirectoryName($docx)) 'korrigiert') ([System.IO.Path]::GetFileNameWithoutExtension($docx) + '_korrigiert.docx')
    }
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($out))
    if ([string]::Equals($out, $docx, [System.StringComparison]::OrdinalIgnoreCase)) { Fehler 'Ziel ist das Original' }
    if ([System.IO.Directory]::Exists($out)) { Fehler 'Ziel ist ein Ordner' }
    $n = Setzen $docx (Absolut $argv[2]) $out
    $aus.WriteLine("$([System.IO.Path]::GetFileName($out)): $n Eintraege gesetzt, Selbstpruefung bestanden")
    return 0
}

$aus = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput(), $UTF8)
$aus.NewLine = "`n"
$aus.AutoFlush = $true
$err = New-Object System.IO.StreamWriter ([Console]::OpenStandardError(), $UTF8)
$err.NewLine = "`n"
$err.AutoFlush = $true
try {
    $code = Ausfuehren ([string[]]$args) $aus
} catch {
    $ex = $_.Exception
    while ($ex -is [System.Management.Automation.MethodInvocationException] -and $null -ne $ex.InnerException) {
        $ex = $ex.InnerException
    }
    if ($ex.Data.Contains('korrektur')) { $err.WriteLine("FEHLER: $($ex.Message)") }
    else { $err.WriteLine("FEHLER: intern: $($ex.Message) (Zeile $($_.InvocationInfo.ScriptLineNumber))") }
    $code = 1
}
exit $code
