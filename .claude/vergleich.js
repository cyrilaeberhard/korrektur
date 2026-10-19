// Vergleich zweier Fehlerlisten (Referenz gegen Claude), nur macOS (osascript -l JavaScript).
// Aufruf:  osascript -l JavaScript .claude/vergleich.js "<referenz.json>" "<liste.json>"
// Test:    osascript -l JavaScript .claude/vergleich.js --test
ObjC.import('Foundation');

const KATEGORIEN = ['R', 'G', 'T', 'Z'];

function dateiLesen(pfad) {
  const fehler = $();
  const s = $.NSString.stringWithContentsOfFileEncodingError($(pfad).stringByStandardizingPath, $.NSUTF8StringEncoding, fehler);
  if (!s || s.isNil()) throw new Error('Datei nicht lesbar: ' + pfad);
  return ObjC.unwrap(s);
}

function listeLesen(pfad) {
  const daten = JSON.parse(dateiLesen(pfad));
  if (!Array.isArray(daten)) throw new Error('Keine JSON-Liste: ' + pfad);
  return daten;
}

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Schluessel einer Stelle: Absatz plus Fehlertext. Fehlende Zeichen/Woerter: Absatz plus
// das letzte Wort des Kontexts plus Einfuegung (Kontext endet direkt vor der Stelle).
function schluessel(e) {
  if (e.art === 'einfuegen') {
    const wort = norm(e.kontext).split(' ').slice(-1)[0];
    return e.p + '|+|' + wort + '|' + norm(e.korrektur);
  }
  return e.p + '|' + norm(e.falsch);
}

function zaehlbar(e) {
  return e.art !== 'gelb' && KATEGORIEN.indexOf(e.kat) >= 0;
}

function vergleichen(referenz, liste) {
  const ref = referenz.filter(zaehlbar);
  const neu = liste.filter(zaehlbar);
  const gebraucht = new Set();
  const ergebnis = {};
  KATEGORIEN.forEach(k => { ergebnis[k] = { treffer: 0, uebersehen: 0, fehlalarm: 0 }; });
  ref.forEach(r => {
    const index = neu.findIndex((n, i) => !gebraucht.has(i) && schluessel(n) === schluessel(r));
    if (index >= 0) {
      gebraucht.add(index);
      ergebnis[r.kat].treffer += 1;
    } else {
      ergebnis[r.kat].uebersehen += 1;
    }
  });
  neu.forEach((n, i) => {
    if (!gebraucht.has(i)) ergebnis[n.kat].fehlalarm += 1;
  });
  return ergebnis;
}

function prozent(teil, ganz) {
  return ganz === 0 ? '-' : Math.round(100 * teil / ganz) + ' %';
}

function bericht(ergebnis) {
  const zeilen = ['Kat  Referenz  Treffer  Übersehen  Fehlalarm  Recall  Genauigkeit'];
  const summe = { treffer: 0, uebersehen: 0, fehlalarm: 0 };
  KATEGORIEN.forEach(k => {
    const e = ergebnis[k];
    summe.treffer += e.treffer; summe.uebersehen += e.uebersehen; summe.fehlalarm += e.fehlalarm;
    zeilen.push(zeile(k, e));
  });
  zeilen.push(zeile('Alle', summe));
  return zeilen.join('\n');
}

function zeile(name, e) {
  const referenz = e.treffer + e.uebersehen;
  const gemeldet = e.treffer + e.fehlalarm;
  return [name, referenz, e.treffer, e.uebersehen, e.fehlalarm,
    prozent(e.treffer, referenz), prozent(e.treffer, gemeldet)].join('  ');
}

function selbsttest() {
  const ref = [
    { p: 1, falsch: 'Strase', kontext: 'in der Strase vor', kat: 'R', art: 'ersetzen', korrektur: 'Strasse' },
    { p: 2, falsch: '', kontext: 'Er versuchte', kat: 'Z', art: 'einfuegen', korrektur: ',' },
    { p: 3, falsch: 'sieht', kontext: 'Tür und sieht', kat: 'T', art: 'ersetzen', korrektur: 'sah' },
    { p: 4, falsch: 'schlecht', kontext: 'war schlecht', kat: 'H', art: 'gelb' }
  ];
  const neu = [
    { p: 1, falsch: 'Strase', kontext: 'der Strase', kat: 'R', art: 'ersetzen', korrektur: 'Strasse' },
    { p: 2, falsch: '', kontext: 'Gestern er versuchte', kat: 'Z', art: 'einfuegen', korrektur: ',' },
    { p: 5, falsch: 'dass', kontext: 'sagte dass', kat: 'G', art: 'ersetzen', korrektur: 'das' },
    { p: 6, falsch: '', kontext: 'kam heim', kat: 'Z', art: 'einfuegen', korrektur: ',' }
  ];
  const e = vergleichen(ref, neu);
  const pruefe = (bedingung, text) => { if (!bedingung) throw new Error('Selbsttest fehlgeschlagen: ' + text); };
  pruefe(e.R.treffer === 1, 'R-Treffer');
  pruefe(e.Z.treffer === 1, 'Z-Treffer trotz unterschiedlich langem Kontext');
  pruefe(e.Z.fehlalarm === 1, 'Z-Fehlalarm in Absatz 6');
  pruefe(e.T.uebersehen === 1, 'T uebersehen');
  pruefe(e.G.fehlalarm === 1, 'G Fehlalarm');
  pruefe(e.R.uebersehen + e.R.fehlalarm + e.Z.uebersehen === 0, 'keine weiteren Abweichungen');
  const gleich = vergleichen(ref, ref);
  pruefe(gleich.R.treffer === 1 && gleich.Z.treffer === 1 && gleich.T.treffer === 1, 'Gleiche Listen = alles Treffer');
  pruefe(gleich.R.fehlalarm + gleich.Z.fehlalarm + gleich.T.fehlalarm === 0, 'Gleiche Listen = keine Fehlalarme');
  return 'Alle Tests bestanden';
}

function run(argv) {
  if (argv[0] === '--test') return selbsttest();
  if (argv.length !== 2) throw new Error('Aufruf: vergleich.js <referenz.json> <liste.json>   oder   --test');
  return bericht(vergleichen(listeLesen(argv[0]), listeLesen(argv[1])));
}
