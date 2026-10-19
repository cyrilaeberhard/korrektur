// Test fuer korrektur.js (macOS): baut ein Mini-Docx, setzt alle Arten (inkl. gelb) und prueft das Ergebnis.
// Aufruf: osascript -l JavaScript .claude/test_korrektur.js
// Gleiche Faelle wie test_korrektur.ps1 fuer Windows.
ObjC.import('Foundation');
ObjC.import('stdlib');

const TW = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${TW}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>
<w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">Die Strase ist </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="24"/><w14:ligatures w14:val="standard"/></w:rPr><w:t>lang,</w:t></w:r><w:r><w:t xml:space="preserve"> und er </w:t></w:r><w:r><w:rPr><w:dstrike/><w:rPrChange w:id="7" w:author="x" w:date="2020-01-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>gehen</w:t></w:r><w:r><w:tab/><w:t>heim</w:t></w:r></w:p>
<w:p><w:bookmarkStart w:id="0" w:name="a"/><w:r><w:t>Ich weiss es nicht</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>
</w:body></w:document>`;
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="xml" ContentType="application/xml"/></Types>';
const RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

// Zweites Dokument fuer Vorfilter (kandidaten) und Leerzeichen bei Einfuegungen
const DOC2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${TW}"><w:body>
<w:p><w:r><w:t>Er hat gelernt zu reflektieren und die Reflektion ist wichtig.</w:t></w:r></w:p>
<w:p><w:r><w:t>Sie lernte um sich auszuruhen.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er ging, um sich auszuruhen.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er blieb um, sich zu erholen.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er sah eine neue bisher verborgene Seite.</w:t></w:r></w:p>
<w:p><w:r><w:t>Es ist eine Maske, hinter dieser sich viel versteckt.</w:t></w:r></w:p>
<w:p><w:r><w:t>Er ging mit seiner eignen Familie am Ende des Romanes heim.</w:t></w:r></w:p>
</w:body></w:document>`;

const EINTRAEGE = [
  { p: 0, falsch: 'Strase', kontext: 'Die Strase ist', kat: 'R', art: 'ersetzen', korrektur: 'Strasse', kommentar: 'R: Strase → Strasse' },
  { p: 0, falsch: ',', kontext: 'lang, und', kat: 'Z', art: 'zeichen_weg', kommentar: 'Z: Komma überflüssig' },
  { p: 0, falsch: 'gehen', kontext: 'er gehen', kat: 'G', art: 'ersetzen', korrektur: 'geht', kommentar: 'G: er geht' },
  { p: 0, falsch: '', kontext: 'gehen\theim', kat: 'Z', art: 'einfuegen', korrektur: ',', kommentar: 'Z: Komma fehlt' },
  { p: 1, falsch: 'weiss', kontext: 'Ich weiss', kat: 'R', art: 'streichen', kommentar: 'R: Test' },
  { p: 0, falsch: 'und er', kontext: 'und er', kat: 'H', art: 'gelb', kommentar: 'H: Ausdruck unsicher' },
];

function docxBauen(d, ziel, docXml) {
  const roh = d + '/roh_' + ziel.slice(ziel.lastIndexOf('/') + 1);
  for (const [name, inhalt] of [['[Content_Types].xml', CT], ['_rels/.rels', RELS],
    ['word/_rels/document.xml.rels', RELS], ['word/document.xml', docXml]]) {
    const pfad = roh + '/' + name;
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
      $(pfad).stringByDeletingLastPathComponent, true, $(), null);
    $(inhalt).dataUsingEncoding($.NSUTF8StringEncoding).writeToFileAtomically(pfad, true);
  }
  programm('/usr/bin/zip', ['-q', '-X', '-nw', ziel, '--', '[Content_Types].xml', '_rels/.rels',
    'word/_rels/document.xml.rels', 'word/document.xml'], roh);
}

function pruefe(bedingung, text) {
  if (!bedingung) throw new Error('Test fehlgeschlagen: ' + text);
}

function gleich(ist, soll, text) {
  pruefe(JSON.stringify(ist) === JSON.stringify(soll), `${text}: ${JSON.stringify(ist)} statt ${JSON.stringify(soll)}`);
}

function testen(argv, skript, werkzeug) {
  // Werkzeug laden (Parser und Hilfen), nur zum Nachpruefen der Ausgabe
  (0, eval)(werkzeug);
  const lauf = (...args) => programm('/usr/bin/osascript', ['-l', 'JavaScript', skript].concat(args), null, true);
  const d = tempOrdner();
  try {
    const roh = d + '/roh';
    for (const [name, inhalt] of [['[Content_Types].xml', CT], ['_rels/.rels', RELS],
      ['word/_rels/document.xml.rels', RELS], ['word/document.xml', DOC]]) {
      const pfad = roh + '/' + name;
      $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        $(pfad).stringByDeletingLastPathComponent, true, $(), null);
      $(inhalt).dataUsingEncoding($.NSUTF8StringEncoding).writeToFileAtomically(pfad, true);
    }
    const docx = d + '/test.docx';
    programm('/usr/bin/zip', ['-q', '-X', '-nw', docx, '--', '[Content_Types].xml', '_rels/.rels',
      'word/_rels/document.xml.rels', 'word/document.xml'], roh);
    const liste = d + '/liste.json';
    const jsonSchreiben = (pfad, daten) => $(JSON.stringify(daten)).dataUsingEncoding($.NSUTF8StringEncoding)
      .writeToFileAtomically(pfad, true);
    // Eintrag 3 (einfuegen) absichtlich mit Tab im Kontext
    jsonSchreiben(liste, EINTRAEGE);

    const ex = lauf('extrahieren', docx);
    pruefe(ex.out.includes('[0] Die Strase ist lang, und er gehen\theim'), ex.out + ex.err);

    const pr = lauf('pruefen', docx, liste);
    pruefe(pr.code === 0, pr.out + pr.err);

    const out = d + '/test_korrigiert.docx';
    const res = lauf('setzen', docx, liste, out);
    pruefe(res.code === 0, res.out + res.err);

    const paket = zipLesen(out);
    let doc;
    let kom;
    try {
      doc = parseXml(teilText(paket.teile, 'word/document.xml'), 'document').root;
      kom = parseXml(teilText(paket.teile, 'word/comments.xml'), 'comments').root;
      pruefe(teilText(paket.teile, '[Content_Types].xml').includes('comments'), 'Content-Type fehlt');
      pruefe(teilText(paket.teile, 'word/_rels/document.xml.rels').includes('comments.xml'), 'Relationship fehlt');
    } finally {
      loeschen(paket.ordner);
    }
    const elemente = (wurzel, local) => [...alleElemente(wurzel)].filter((x) => istW(x, local));
    const rprHat = (r, local, val) => {
      const rpr = kindW(r, 'rPr');
      const k = rpr && kindW(rpr, local);
      return Boolean(k) && (val === undefined || attr(k, TW, 'val') === val || attr(k, TW, 'fill') === val);
    };
    const tText = (r) => (kindW(r, 't') ? textVon(kindW(r, 't')) : null);
    const body = kindW(doc, 'body');
    const absaetzeBody = body.kids.filter((k) => istW(k, 'p'));
    // Nur der Schuelertext (Absaetze 1 und 2), nicht die Zusammenfassung am Ende
    const schuelerRuns = absaetzeBody.slice(0, 2).flatMap((p) => elemente(p, 'r'));

    // Gelb bekommt auch einen Kommentar
    gleich(kom.kids.filter((k) => k.k === 'el').length, 6, 'Anzahl Kommentare');
    gleich(elemente(doc, 'commentReference').length, 6, 'Anzahl Kommentarreferenzen');
    // Ueberfluessiges Komma: Kommentar liegt auf dem Leerzeichen danach, damit das Rot sichtbar bleibt
    const komma = elemente(doc, 'r').find((r) => rprHat(r, 'highlight', 'red'));
    const geschwister = komma.parent.kids.filter((k) => k.k === 'el');
    const stelle = geschwister.indexOf(komma);
    pruefe(!istW(geschwister[stelle - 1], 'commentRangeStart'), 'Kommentar liegt auf dem Komma');
    pruefe(istW(geschwister[stelle + 1], 'commentRangeStart'), 'Kommentar fehlt nach dem Komma');
    gleich(tText(geschwister[stelle + 2]), ' ', 'Kommentar auf dem Leerzeichen');
    gleich(elemente(doc, 'r').filter((r) => rprHat(r, 'strike')).map(tText), ['Strase', 'gehen', 'weiss'], 'durchgestrichen');
    gleich(schuelerRuns.filter((r) => !rprHat(r, 'strike') && rprHat(r, 'color', 'FF0000')).map(tText),
      ['Strasse', 'geht', ','], 'rot eingefuegt');
    gleich(schuelerRuns.filter((r) => rprHat(r, 'highlight', 'red')).map(tText), [','], 'rot hinterlegt');
    // Gelb: gelb hinterlegt wie die roten Kommas, keine Korrektur und keine rote Schrift
    gleich(schuelerRuns.filter((r) => rprHat(r, 'highlight', 'yellow') && rprHat(r, 'shd', 'FFFF00')).map(tText),
      ['und er'], 'gelb');
    pruefe(!elemente(doc, 'r').some((r) => rprHat(r, 'highlight', 'yellow') && rprHat(r, 'color')), 'gelb mit Farbe');
    // Dazu eine dicke gelbe Unterstreichung, die Word nicht mit der Kommentarfarbe uebermalt
    gleich(schuelerRuns.filter((r) => rprHat(r, 'u', 'thick')).map(tText), ['und er'], 'gelb unterstrichen');
    // Gelb: Kommentarbereich ueber die ganze gelbe Stelle, damit man auf die Stelle klicken kann
    const gelbRun = schuelerRuns.find((r) => rprHat(r, 'highlight', 'yellow'));
    const gelbNachbarn = gelbRun.parent.kids.filter((k) => k.k === 'el');
    const gelbStelle = gelbNachbarn.indexOf(gelbRun);
    pruefe(istW(gelbNachbarn[gelbStelle - 1], 'commentRangeStart'), 'Kommentarbereich fehlt vor Gelb');
    pruefe(istW(gelbNachbarn[gelbStelle + 1], 'commentRangeEnd'), 'Kommentarbereich endet nicht nach Gelb');
    pruefe(Boolean(kindW(gelbNachbarn[gelbStelle + 2], 'commentReference')), 'Kommentar fehlt nach Gelb');
    // Schueler-Formatierung (fett, Groesse) bleibt in der Korrektur erhalten
    pruefe(rprHat(elemente(doc, 'r').find((r) => tText(r) === 'Strasse'), 'b'), 'Korrektur nicht fett');
    // rPr-Reihenfolge: strike vor color vor sz
    const namen = (r) => kindW(r, 'rPr').kids.filter((k) => k.k === 'el').map((k) => k.local);
    gleich(namen(elemente(doc, 'r').find((r) => tText(r) === 'Strase')), ['b', 'strike', 'color', 'sz'], 'rPr-Reihenfolge');
    // rPrChange (Formatierungs-Aenderung) muss laut Schema das letzte Kind bleiben
    const gehen = namen(elemente(doc, 'r').find((r) => tText(r) === 'gehen'));
    gleich(gehen[gehen.length - 1], 'rPrChange', 'rPrChange zuletzt');
    // Fremde Elemente (w14) bleiben am Schluss, neue Eigenschaften kommen davor
    gleich(namen(komma), ['b', 'sz', 'highlight', 'shd', 'ligatures'], 'rPr mit w14');
    // Die Korrektur erbt keine Doppel-Durchstreichung
    pruefe(!rprHat(elemente(doc, 'r').find((r) => tText(r) === 'geht'), 'dstrike'), 'Korrektur doppelt durchgestrichen');
    // Kommentar-IDs kollidieren nicht mit Lesezeichen (0) oder Aenderungen (7)
    const komIds = kom.kids.filter((k) => k.k === 'el').map((c) => attr(c, TW, 'id'));
    pruefe(!komIds.includes('0') && !komIds.includes('7'), 'Kommentar-ID kollidiert: ' + komIds);

    // Zusammenfassung am Ende: fett Ueberschrift, rote Schrift, nur Anzahl gesamt und pro Kategorie
    const zusammenfassung = absaetzeBody.slice(2);
    gleich(zusammenfassung.map((p) => elemente(p, 'r').map(tText).join('')), [
      'Zusammenfassung',
      'Fehler gesamt: 5',
      'Rechtschreibung (R): 2',
      'Grammatik (G): 1',
      'Tempus (T): 0',
      'Zeichensetzung (Z): 2',
    ], 'Zusammenfassung');
    pruefe(rprHat(elemente(zusammenfassung[0], 'r')[0], 'b'), 'Ueberschrift nicht fett');
    // Zusammenfassung erbt nichts vom ersten Schueler-Run (dort fett, Groesse 12)
    pruefe(!zusammenfassung.some((p) => elemente(p, 'sz').length), 'Zusammenfassung mit Schriftgroesse');
    pruefe(!rprHat(elemente(zusammenfassung[1], 'r')[0], 'b'), 'Zeile 2 fett');
    pruefe(zusammenfassung.every((p) => elemente(p, 'r').every((r) => rprHat(r, 'color', 'FF0000'))), 'Zusammenfassung nicht rot');

    // Fehlerfall: mehrdeutiger Kontext muss abgelehnt werden
    const schlecht = d + '/schlecht.json';
    jsonSchreiben(schlecht, [{ ...EINTRAEGE[0], kontext: 'ist' }]);
    gleich(lauf('pruefen', docx, schlecht).code, 1, 'mehrdeutiger Kontext');
    // Fehlerfall: H ohne gelb (und gelb ohne H) muss abgelehnt werden
    jsonSchreiben(schlecht, [{ ...EINTRAEGE[0], kat: 'H', kommentar: 'H: x' }]);
    gleich(lauf('pruefen', docx, schlecht).code, 1, 'H ohne gelb');
    jsonSchreiben(schlecht, [{ ...EINTRAEGE[5], kat: 'R', kommentar: 'R: unsicher' }]);
    gleich(lauf('pruefen', docx, schlecht).code, 1, 'gelb ohne H');
    // Fehlerfall: gelb ohne Kommentar muss abgelehnt werden
    jsonSchreiben(schlecht, [{ ...EINTRAEGE[5], kommentar: '' }]);
    gleich(lauf('pruefen', docx, schlecht).code, 1, 'gelb ohne Kommentar');
    // Fehlerfall: falsche Typen und zeichen_weg ohne Z werden abgelehnt
    for (const kaputt of [{ ...EINTRAEGE[0], p: '0' }, { ...EINTRAEGE[1], kat: 'R', kommentar: 'R: x' },
      { ...EINTRAEGE[0], kontext: '' }, 'kein Objekt',
      // Gross/klein zaehlt: r ist keine Kategorie, Ersetzen keine Art
      { ...EINTRAEGE[0], kat: 'r', kommentar: 'r: x' }, { ...EINTRAEGE[0], art: 'Ersetzen' }]) {
      jsonSchreiben(schlecht, [kaputt]);
      const r = lauf('pruefen', docx, schlecht);
      pruefe(r.code === 1 && r.err.startsWith('FEHLER:') && !r.err.includes('intern'), JSON.stringify(kaputt) + r.err);
    }
    // Fehlerfall: misslungenes Setzen hinterlaesst keine Kopie
    jsonSchreiben(schlecht, [{ ...EINTRAEGE[0], kontext: 'ist' }]);
    const weg = d + '/weg_korrigiert.docx';
    gleich(lauf('setzen', docx, schlecht, weg).code, 1, 'misslungenes Setzen');
    pruefe(!$.NSFileManager.defaultManager.fileExistsAtPath(weg), 'Kopie trotz Fehler');
    pruefe(!$.NSFileManager.defaultManager.fileExistsAtPath(d + '/.weg_korrigiert.docx.tmp'), 'Zwischendatei liegt noch');
    // Erfolgreicher Lauf hinterlaesst keine Zwischendatei
    pruefe(!$.NSFileManager.defaultManager.fileExistsAtPath(d + '/.test_korrigiert.docx.tmp'), 'Zwischendatei nach Erfolg');
    // Ziel darf kein Ordner sein
    const ordnerZiel = lauf('setzen', docx, liste, d);
    pruefe(ordnerZiel.code === 1 && ordnerZiel.err.includes('Ziel ist ein Ordner'), 'Ziel = Ordner: ' + ordnerZiel.err);
    // Ziel darf nie das Original sein
    gleich(lauf('setzen', docx, liste, docx).code, 1, 'Ziel = Original');
    // Kaputte Datei: sauberer FEHLER statt Absturz
    const kaputt = d + '/kaputt.docx';
    $('kein zip').dataUsingEncoding($.NSUTF8StringEncoding).writeToFileAtomically(kaputt, true);
    const k = lauf('setzen', kaputt, liste);
    pruefe(k.code === 1 && k.err.startsWith('FEHLER:') && !k.err.includes('intern'), k.err);
    // Leerzeichen-Runs und Sonderzeichen bleiben erhalten (daran scheitert das macOS-eigene NSXML)
    const ex2 = lauf('extrahieren', out);
    pruefe(ex2.out.includes('[0] Die StraseStrasse ist lang, und er gehengeht\theim,'), ex2.out);

    // Vorfilter: meldet nur Kandidaten, kein Treffer bei "Er ging, um sich auszuruhen."
    const doc2 = d + '/vorfilter.docx';
    docxBauen(d, doc2, DOC2);
    const kand = lauf('kandidaten', doc2);
    pruefe(kand.code === 0, kand.out + kand.err);
    const zeilen = kand.out.trim().split('\n');
    gleich(zeilen.map((z) => z.split(' | ')[0]), [
      '[0] Z: zu-Infinitiv ohne Komma davor, erweitert? (Pflicht ab Fassung 2024)',
      '[0] R: Schreibung "Reflektion" -> Reflexion?',
      '[1] Z: Komma vor "um" fehlt? (Infinitivgruppe)',
      '[3] Z: Komma hinter "um" ueberfluessig, Komma gehoert davor?',
      '[3] Z: Komma vor "um" fehlt? (Infinitivgruppe)',
      '[4] Z: Adjektivreihe "neue bisher verborgene": Komma, wenn "und" passt?',
      '[5] G: Relativsatz? "dieser/diesem" statt "der/dem", Komma davor?',
      '[6] R: Schreibung "eignen" -> eigen(e|en|em|er|es)?',
      '[6] R: Schreibung "Romanes" -> Romans?',
    ], 'Kandidaten');
    // Der Rechtschreibpruefer darf zusaetzlich melden (z.B. "Strase"), sonst gibt es keine Hinweise
    pruefe(lauf('kandidaten', docx).out.trim().split('\n').every((z) => z === 'keine Kandidaten' || z.includes('Unbekanntes Wort')),
      'Kandidaten im sauberen Text');

    // Einfuegen: Wort bekommt das fehlende Leerzeichen selbst, Satzzeichen und " nie" bleiben, wie sie sind
    const liste2 = d + '/liste2.json';
    jsonSchreiben(liste2, [
      { p: 2, falsch: '', kontext: 'Er ging, um sich', kat: 'G', art: 'einfuegen', korrektur: 'doch', kommentar: 'G: Wort fehlt' },
      { p: 1, falsch: '', kontext: 'Sie lernte', kat: 'Z', art: 'einfuegen', korrektur: ',', kommentar: 'Z: Komma fehlt' },
      { p: 0, falsch: '', kontext: 'Er hat gelernt', kat: 'G', art: 'einfuegen', korrektur: ' nie', kommentar: 'G: Wort fehlt' },
    ]);
    const out2 = d + '/vorfilter_korrigiert.docx';
    const res2 = lauf('setzen', doc2, liste2, out2);
    pruefe(res2.code === 0, res2.out + res2.err);
    const ex3 = lauf('extrahieren', out2).out;
    pruefe(ex3.includes('[0] Er hat gelernt nie zu reflektieren'), ex3);
    pruefe(ex3.includes('[1] Sie lernte, um sich auszuruhen.'), ex3);
    pruefe(ex3.includes('[2] Er ging, um sich doch auszuruhen.'), ex3);
  } finally {
    loeschen(d);
  }
}

function run(argv) {
  const ich = $.NSProcessInfo.processInfo.arguments.js.map((a) => a.js).find((a) => a.endsWith('test_korrektur.js'));
  const hier = $(ich).stringByStandardizingPath.stringByDeletingLastPathComponent.js;
  const skript = (hier.startsWith('/') ? '' : $.NSFileManager.defaultManager.currentDirectoryPath.js + '/') + hier + '/korrektur.js';
  const werkzeug = $.NSString.stringWithContentsOfFileEncodingError(skript, $.NSUTF8StringEncoding, null).js;
  let code = 0;
  try {
    testen(argv, skript, werkzeug);
    $.NSFileHandle.fileHandleWithStandardOutput.writeData($('Alle Tests bestanden\n').dataUsingEncoding($.NSUTF8StringEncoding));
  } catch (err) {
    $.NSFileHandle.fileHandleWithStandardError.writeData($(String(err.message || err) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    code = 1;
  }
  $.exit(code);
}
