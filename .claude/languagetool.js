// Zusatz-Pruefschicht: LanguageTool (lokal, de-CH) ueber die App languagetool-ui (Port 8772, mit Zusatzregeln). Nur macOS. Liefert Hinweise, keine Fehlerurteile.
//
//   osascript -l JavaScript .claude/languagetool.js <text.txt>     text.txt = Ausgabe von "korrektur.js extrahieren"
//
// Ausgabe: "[p] LT Regel: Meldung | «Ausschnitt» -> Vorschlag1, Vorschlag2". Aendert keine Datei, schreibt keine Liste.
// Keine Treffer heissen nicht, dass der Text fehlerfrei ist (Basisversion ohne Premium-/KI-Regeln).
ObjC.import('Foundation');
ObjC.import('stdlib');

const SERVER = '/opt/homebrew/opt/languagetool/bin/languagetool-server';
const URL_ZUSATZ = 'http://127.0.0.1:8772/check'; // lokale App languagetool-ui: LanguageTool plus Zusatzregeln (z.B. LOCAL_COMMA_BEFORE_ABER)
const URL_BASIS = 'http://127.0.0.1:8081/v2/check'; // reines LanguageTool, Rueckfall
const MAX_ZEICHEN = 20000;
// Rauschen: Schweizer Schreibweise und Anfuehrungszeichen sind korrekt, Stil ist nicht Auftrag.
const RAUSCHEN_REGEL = /QUOTE|ANFUEHRUNG|DOPPELTE_LEERZEICHEN|WHITESPACE|SZ|ESZETT/i;
const RAUSCHEN_KATEGORIE = /STYLE|TYPOGRAPHY|REDUNDANCY/i;

function programm(pfad, args) {
  const task = $.NSTask.alloc.init;
  task.launchPath = pfad;
  task.arguments = $(args);
  const aus = $.NSPipe.pipe;
  task.standardOutput = aus;
  task.standardError = $.NSPipe.pipe;
  task.launch;
  const daten = aus.fileHandleForReading.readDataToEndOfFile;
  task.waitUntilExit;
  return {
    code: task.terminationStatus,
    out: $.NSString.alloc.initWithDataEncoding(daten, $.NSUTF8StringEncoding).js || '',
  };
}

// NSTask-Argumente kommen zerlegt (NFD) an, das verschiebt die Fundstellen. Darum den Text ueber eine Datei senden.
function anfrage(text, zusatz) {
  const datei = $.NSTemporaryDirectory().js + 'lt-' + $.NSUUID.UUID.UUIDString.js + '.txt';
  const koerper = zusatz ? JSON.stringify({ text }) : 'language=de-CH&text=' + encodeURIComponent(text);
  $(koerper).writeToFileAtomicallyEncodingError(datei, true, $.NSUTF8StringEncoding, null);
  try {
    const typ = zusatz ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded; charset=utf-8';
    const r = programm('/usr/bin/curl', ['-s', '-m', '30', '-H', 'Content-Type: ' + typ,
      '--data-binary', '@' + datei, zusatz ? URL_ZUSATZ : URL_BASIS]);
    if (r.code !== 0) throw new Error('API nicht erreichbar');
    return JSON.parse(r.out);
  } finally {
    $.NSFileManager.defaultManager.removeItemAtPathError(datei, null);
  }
}

function erreichbar(url) {
  return programm('/usr/bin/curl', ['-s', '-m', '2', '-o', '/dev/null', url]).code === 0;
}

function serverStarten() {
  if (erreichbar('http://127.0.0.1:8081/v2/languages')) return;
  const task = $.NSTask.alloc.init;
  task.launchPath = SERVER;
  task.arguments = $(['--port', '8081']);
  task.standardOutput = $.NSPipe.pipe;
  task.standardError = $.NSPipe.pipe;
  task.launch;
  for (let i = 0; i < 40; i++) {
    $.NSThread.sleepForTimeInterval(1);
    if (erreichbar('http://127.0.0.1:8081/v2/languages')) return;
  }
  throw new Error('LanguageTool-Server startet nicht');
}

function lesen(pfad) {
  const s = $.NSString.stringWithContentsOfFileEncodingError($(pfad), $.NSUTF8StringEncoding, null);
  if (!s) throw new Error(`Datei fehlt: ${pfad}`);
  return s.js;
}

function zeilen(daten) {
  return daten.matches
    .filter((m) => !RAUSCHEN_REGEL.test(m.rule.id) && !RAUSCHEN_KATEGORIE.test(m.rule.category.id))
    .map((m) => ({ m, schnitt: m.length ? daten.text.substr(m.offset, m.length) : daten.text.slice(Math.max(0, m.offset - 15), m.offset) + '|' + daten.text.slice(m.offset, m.offset + 10) }));
}

function run(argv) {
  if (argv.length < 1) {
    console.log('Aufruf: osascript -l JavaScript .claude/languagetool.js <text.txt>');
    $.exit(2);
  }
  try {
    // Zusatz-App (8772) bevorzugt; sonst Basis-Server (8081), den das Skript bei Bedarf startet.
    const zusatz = erreichbar('http://127.0.0.1:8772/');
    const ausgabe = [];
    if (!zusatz) {
      serverStarten();
      ausgabe.push('HINWEIS: Zusatz-App (127.0.0.1:8772) nicht erreichbar, nur LanguageTool-Basis geprueft. Start: languagetool-ui/start.command');
    }
    lesen(argv[0]).split('\n').forEach((zeile) => {
      const t = /^\[(\d+)\] (.*)$/.exec(zeile);
      if (!t || t[2].length > MAX_ZEICHEN) return;
      const text = t[2].normalize('NFC');
      const daten = anfrage(text, zusatz);
      daten.text = text;
      zeilen(daten).forEach(({ m, schnitt }) => {
        const vorschlaege = m.replacements.slice(0, 3).map((r) => r.value).join(', ');
        ausgabe.push(`[${t[1]}] LT ${m.rule.id}: ${m.message} | «${schnitt}»${vorschlaege ? ' -> ' + vorschlaege : ''}`);
      });
    });
    console.log(ausgabe.length ? ausgabe.join('\n') : 'keine LT-Treffer');
    $.exit(0);
  } catch (err) {
    console.log(`FEHLER: ${err.message}`);
    $.exit(1);
  }
}
