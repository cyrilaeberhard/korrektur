// Werkzeug fuer die Korrektur von Schueler-.docx auf macOS, ohne Installation (Regeln: CLAUDE.md).
// Laeuft mit dem in macOS eingebauten JavaScript (osascript) und den Systemprogrammen zip/unzip/xmllint.
// Gegenstueck fuer Windows: korrektur.ps1 (gleiches Verhalten, gleiche Ausgaben).
//
//   osascript -l JavaScript .claude/korrektur.js extrahieren <docx>          Absatztext als "[p] text"
//   osascript -l JavaScript .claude/korrektur.js kandidaten <docx>           Vorfilter: Stellen, die Claude gern uebersieht
//   osascript -l JavaScript .claude/korrektur.js pruefen <docx> <json>      Liste gegen Text pruefen, nichts schreiben
//   osascript -l JavaScript .claude/korrektur.js setzen <docx> <json> [out] Kopie korrigiert/<name>_korrigiert.docx + Selbstpruefung
//
// JSON-Eintrag: {"p", "falsch", "kontext", "kat" R|G|T|Z|H,
//                "art" ersetzen|einfuegen|streichen|zeichen_weg|gelb, "korrektur", "kommentar"}
// H + gelb = unsicher oder unschoen: gelb hinterlegen und dick gelb unterstreichen, Kommentar "H: ..." ueber die ganze Stelle, zaehlt nicht als Fehler.
//
// Das XML wird mit einem eigenen, verlustfreien Parser gelesen: Unveraenderte Teile werden Zeichen fuer
// Zeichen wieder ausgegeben. (Das macOS-eigene NSXML verschluckt Leerzeichen-Runs und ist darum ungeeignet.)
ObjC.import('Foundation');
ObjC.import('stdlib');
ObjC.import('AppKit');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const R_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const COMMENTS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const MARKER = '0C0FFEE0'; // rsidR der eingefuegten Runs, nur fuer die Selbstpruefung
const ARTEN = ['ersetzen', 'einfuegen', 'streichen', 'zeichen_weg', 'gelb'];
const KATEGORIEN = ['R', 'G', 'T', 'Z', 'H'];
const FEHLER_KATEGORIEN = [['R', 'Rechtschreibung'], ['G', 'Grammatik'], ['T', 'Tempus'], ['Z', 'Zeichensetzung']];
const GELB = 'FFFF00'; // Word-Farbe yellow
// Reihenfolge der Kinder von w:rPr laut Schema
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
  'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish',
  'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight',
  'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang',
  'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange'];
const USAGE = [
  'Werkzeug fuer die Korrektur von Schueler-.docx (Regeln: CLAUDE.md im Korrektur-Ordner).',
  '',
  '  osascript -l JavaScript korrektur.js extrahieren <docx>',
  '  osascript -l JavaScript korrektur.js kandidaten <docx>',
  '  osascript -l JavaScript korrektur.js pruefen <docx> <json>',
  '  osascript -l JavaScript korrektur.js setzen <docx> <json> [out]',
].join('\n');

class KorrekturFehler extends Error {}

// ---------- XML: verlustfreier Parser und Ausgabe ----------
// Knoten: {k:'el', name, uri, local, attrs:[{name, uri, local, raw, q}], kids, parent, leer}
//         {k:'text', raw, parent} | {k:'cdata', raw, parent} | {k:'raw', raw, parent} (Kommentar/PI)

const ENTITAET = /&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);)/;
const NAME = /^[A-Za-z_À-￿][-A-Za-z0-9_.:·À-￿]*$/;

function xmlFehler(teil, msg) {
  return new KorrekturFehler(`Ungueltiges XML in ${teil}: ${msg}`);
}

function nsAufloesen(el, prefix, teil) {
  if (prefix === 'xml') return XML_NS;
  for (let n = el; n; n = n.parent) {
    for (const a of n.attrs) {
      if ((prefix === '' && a.name === 'xmlns') || a.name === 'xmlns:' + prefix) return decode(a.raw);
    }
  }
  if (prefix === '') return '';
  throw xmlFehler(teil, `Praefix ${prefix} nicht deklariert`);
}

function teileName(name) {
  const i = name.indexOf(':');
  return i < 0 ? ['', name] : [name.slice(0, i), name.slice(i + 1)];
}

function parseXml(text, teil) {
  let i = 0;
  const n = text.length;
  const stack = [];
  let root = null;
  let rootStart = -1;
  let rootEnde = -1;
  const neuerKnoten = (knoten) => {
    if (!stack.length) {
      if (knoten.k !== 'raw') throw xmlFehler(teil, 'Inhalt ausserhalb des Wurzelelements');
      return;
    }
    knoten.parent = stack[stack.length - 1];
    knoten.parent.kids.push(knoten);
  };
  while (i < n) {
    if (text[i] !== '<') {
      let j = text.indexOf('<', i);
      if (j < 0) j = n;
      const raw = text.slice(i, j);
      if (!stack.length) {
        if (raw.trim() && raw !== '﻿') throw xmlFehler(teil, 'Text ausserhalb des Wurzelelements');
      } else {
        if (ENTITAET.test(raw)) throw xmlFehler(teil, 'ungueltiges & im Text');
        neuerKnoten({ k: 'text', raw });
      }
      i = j;
    } else if (text.startsWith('<!--', i)) {
      const j = text.indexOf('-->', i + 4);
      if (j < 0) throw xmlFehler(teil, 'Kommentar nicht geschlossen');
      neuerKnoten({ k: 'raw', raw: text.slice(i, j + 3) });
      i = j + 3;
    } else if (text.startsWith('<![CDATA[', i)) {
      const j = text.indexOf(']]>', i + 9);
      if (j < 0 || !stack.length) throw xmlFehler(teil, 'CDATA ungueltig');
      neuerKnoten({ k: 'cdata', raw: text.slice(i + 9, j) });
      i = j + 3;
    } else if (text.startsWith('<?', i)) {
      const j = text.indexOf('?>', i + 2);
      if (j < 0) throw xmlFehler(teil, 'Verarbeitungsanweisung nicht geschlossen');
      neuerKnoten({ k: 'raw', raw: text.slice(i, j + 2) });
      i = j + 2;
    } else if (text.startsWith('<!', i)) {
      throw xmlFehler(teil, 'DOCTYPE wird nicht unterstuetzt');
    } else if (text.startsWith('</', i)) {
      const j = text.indexOf('>', i);
      if (j < 0) throw xmlFehler(teil, 'Endtag nicht geschlossen');
      const name = text.slice(i + 2, j).trim();
      const offen = stack.pop();
      if (!offen || offen.name !== name) throw xmlFehler(teil, `Endtag </${name}> passt nicht`);
      i = j + 1;
      if (!stack.length) rootEnde = i;
    } else {
      if (root && !stack.length) throw xmlFehler(teil, 'mehr als ein Wurzelelement');
      const start = i;
      i += 1;
      let m = /^[^\s/>]+/.exec(text.slice(i, i + 300));
      if (!m || !NAME.test(m[0])) throw xmlFehler(teil, 'ungueltiger Elementname');
      const el = { k: 'el', name: m[0], attrs: [], kids: [], parent: null, leer: false };
      i += m[0].length;
      for (;;) {
        while (i < n && /\s/.test(text[i])) i += 1;
        if (i >= n) throw xmlFehler(teil, 'Starttag nicht geschlossen');
        if (text.startsWith('/>', i)) { el.leer = true; i += 2; break; }
        if (text[i] === '>') { i += 1; break; }
        m = /^[^\s=/>]+/.exec(text.slice(i, i + 300));
        if (!m || !NAME.test(m[0])) throw xmlFehler(teil, 'ungueltiger Attributname');
        const aname = m[0];
        i += aname.length;
        while (i < n && /\s/.test(text[i])) i += 1;
        if (text[i] !== '=') throw xmlFehler(teil, `= fehlt nach ${aname}`);
        i += 1;
        while (i < n && /\s/.test(text[i])) i += 1;
        const q = text[i];
        if (q !== '"' && q !== "'") throw xmlFehler(teil, `Anfuehrungszeichen fehlt bei ${aname}`);
        const j = text.indexOf(q, i + 1);
        if (j < 0) throw xmlFehler(teil, 'Attributwert nicht geschlossen');
        const raw = text.slice(i + 1, j);
        if (raw.includes('<') || ENTITAET.test(raw)) throw xmlFehler(teil, `ungueltiger Wert in ${aname}`);
        if (el.attrs.some((a) => a.name === aname)) throw xmlFehler(teil, `Attribut ${aname} doppelt`);
        el.attrs.push({ name: aname, raw, q });
        i = j + 1;
      }
      if (!stack.length) {
        root = el;
        rootStart = start;
      }
      neuerKnotenElement(el, stack);
      if (el.leer) {
        if (!stack.length) rootEnde = i;
      } else {
        stack.push(el);
      }
    }
  }
  if (stack.length) throw xmlFehler(teil, `<${stack[stack.length - 1].name}> nicht geschlossen`);
  if (!root) throw xmlFehler(teil, 'kein Wurzelelement');
  namensraeume(root, teil);
  return { prolog: text.slice(0, rootStart), root, epilog: text.slice(rootEnde) };
}

function neuerKnotenElement(el, stack) {
  if (stack.length) {
    el.parent = stack[stack.length - 1];
    el.parent.kids.push(el);
  }
}

function namensraeume(root, teil) {
  for (const el of alleElemente(root)) {
    const [p, local] = teileName(el.name);
    el.uri = nsAufloesen(el, p, teil);
    el.local = local;
    for (const a of el.attrs) {
      const [ap, alocal] = teileName(a.name);
      a.local = alocal;
      a.uri = ap && ap !== 'xmlns' ? nsAufloesen(el, ap, teil) : '';
    }
  }
}

function decode(raw) {
  return raw.replace(/\r\n?/g, '\n').replace(/&(lt|gt|amp|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g, (_, g) => {
    if (g === 'lt') return '<';
    if (g === 'gt') return '>';
    if (g === 'amp') return '&';
    if (g === 'quot') return '"';
    if (g === 'apos') return "'";
    return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  });
}

function escText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return escText(s).replace(/"/g, '&quot;');
}

function serialisieren(dok) {
  const out = [dok.prolog];
  const schreiben = (knoten) => {
    if (knoten.k === 'text' || knoten.k === 'raw') { out.push(knoten.raw); return; }
    if (knoten.k === 'cdata') { out.push('<![CDATA[', knoten.raw, ']]>'); return; }
    out.push('<', knoten.name);
    for (const a of knoten.attrs) out.push(' ', a.name, '=', a.q, a.raw, a.q);
    if (!knoten.kids.length && knoten.leer) { out.push('/>'); return; }
    out.push('>');
    for (const kind of knoten.kids) schreiben(kind);
    out.push('</', knoten.name, '>');
  };
  schreiben(dok.root);
  out.push(dok.epilog);
  return out.join('');
}

// ---------- XML: Baum-Hilfen ----------

function* alleElemente(start) {
  const stapel = [start];
  while (stapel.length) {
    const el = stapel.pop();
    yield el;
    for (let j = el.kids.length - 1; j >= 0; j -= 1) {
      if (el.kids[j].k === 'el') stapel.push(el.kids[j]);
    }
  }
}

function istW(knoten, local) {
  return knoten.k === 'el' && knoten.uri === W && knoten.local === local;
}

function kindW(el, local) {
  return el.kids.find((k) => istW(k, local)) || null;
}

function attr(el, uri, local) {
  const a = el.attrs.find((x) => x.uri === uri && x.local === local);
  return a ? decode(a.raw) : null;
}

function attrSetzen(el, name, uri, wert) {
  const local = teileName(name)[1];
  const neu = { name, uri, local, raw: escAttr(wert), q: '"' };
  const i = el.attrs.findIndex((x) => x.uri === uri && x.local === local);
  if (i >= 0) el.attrs[i] = neu; else el.attrs.push(neu);
}

function element(local, attrs = {}) {
  const el = { k: 'el', name: 'w:' + local, uri: W, local, attrs: [], kids: [], parent: null, leer: true };
  for (const [k, v] of Object.entries(attrs)) attrSetzen(el, 'w:' + k, W, v);
  return el;
}

function element0(name, uri, attrs) { // ohne Praefix (Relationships, Content-Types)
  const el = { k: 'el', name, uri, local: name, attrs: [], kids: [], parent: null, leer: true };
  for (const [k, v] of Object.entries(attrs)) el.attrs.push({ name: k, uri: '', local: k, raw: escAttr(v), q: '"' });
  return el;
}

function anhaengen(eltern, kind) {
  kind.parent = eltern;
  eltern.kids.push(kind);
}

function einfuegenAn(eltern, index, kind) {
  kind.parent = eltern;
  eltern.kids.splice(index, 0, kind);
}

function davor(ref, kind) {
  einfuegenAn(ref.parent, ref.parent.kids.indexOf(ref), kind);
}

function danach(ref, kind) {
  einfuegenAn(ref.parent, ref.parent.kids.indexOf(ref) + 1, kind);
}

function entfernen(kind) {
  kind.parent.kids.splice(kind.parent.kids.indexOf(kind), 1);
  kind.parent = null;
}

function kopie(knoten) {
  const neu = { ...knoten, parent: null };
  if (knoten.k === 'el') {
    neu.attrs = knoten.attrs.map((a) => ({ ...a }));
    neu.kids = knoten.kids.map((k) => {
      const c = kopie(k);
      c.parent = neu;
      return c;
    });
  }
  return neu;
}

function textVon(t) {
  return t.kids.map((k) => (k.k === 'text' ? decode(k.raw) : k.k === 'cdata' ? k.raw : '')).join('');
}

function textSetzen(t, s) {
  t.kids = [{ k: 'text', raw: escText(s), parent: t }];
  attrSetzen(t, 'xml:space', XML_NS, 'preserve');
}

// ---------- Text ----------

function absaetze(root) {
  return [...alleElemente(root)].filter((el) => istW(el, 'p'));
}

function eigeneRuns(p) {
  // Runs des Absatzes, ohne die von verschachtelten Absaetzen (Textfelder)
  const runs = [];
  const stapel = p.kids.filter((k) => k.k === 'el').reverse();
  while (stapel.length) {
    const el = stapel.pop();
    if (istW(el, 'p')) continue;
    if (istW(el, 'r')) runs.push(el);
    for (let j = el.kids.length - 1; j >= 0; j -= 1) {
      if (el.kids[j].k === 'el') stapel.push(el.kids[j]);
    }
  }
  return runs;
}

function inhalt(run) {
  return run.kids.filter((k) => k.k === 'el' && !istW(k, 'rPr'));
}

function runText(run) {
  return inhalt(run).map((c) => (istW(c, 't') ? textVon(c) : istW(c, 'tab') ? '\t' : istW(c, 'br') ? '\n' : '')).join('');
}

function absatzText(p, ohneMarker = false) {
  return eigeneRuns(p)
    .filter((r) => !(ohneMarker && attr(r, W, 'rsidR') === MARKER))
    .map(runText)
    .join('');
}

function textKarte(p) {
  // [[run, start, ende]] fuer alle Runs mit Text
  const karte = [];
  let pos = 0;
  for (const r of eigeneRuns(p)) {
    const n = runText(r).length;
    if (n) {
      karte.push([r, pos, pos + n]);
      pos += n;
    }
  }
  return karte;
}

// ---------- Runs bearbeiten ----------

function rprSetzen(run, tag, attrs = {}) {
  let rpr = kindW(run, 'rPr');
  if (!rpr) {
    rpr = element('rPr');
    einfuegenAn(run, 0, rpr);
  }
  rpr.kids = rpr.kids.filter((k) => !istW(k, tag));
  const neu = element(tag, attrs);
  const rang = RPR_ORDER.indexOf(tag);
  let stelle = rpr.kids.length;
  for (let i = 0; i < rpr.kids.length; i += 1) {
    const kind = rpr.kids[i];
    if (kind.k !== 'el') continue;
    // Fremde Namensraeume (w14 ...) und Unbekanntes stehen laut Schema am Schluss
    if (kind.uri !== W || !RPR_ORDER.includes(kind.local) || RPR_ORDER.indexOf(kind.local) > rang) {
      stelle = i;
      break;
    }
  }
  einfuegenAn(rpr, stelle, neu);
}

function neuerTextRun(vorlage, text) {
  const run = element('r', { rsidR: MARKER });
  const rpr = kindW(vorlage, 'rPr');
  if (rpr) anhaengen(run, kopie(rpr));
  const t = element('t');
  textSetzen(t, text);
  anhaengen(run, t);
  rprSetzen(run, 'color', { val: 'FF0000' });
  const neuRpr = kindW(run, 'rPr');
  neuRpr.kids = neuRpr.kids.filter((k) => !['strike', 'dstrike', 'highlight', 'shd'].some((tag) => istW(k, tag)));
  return run;
}

function atomar(p) {
  // Runs mit mehreren Inhaltselementen in je einen Run pro Element aufteilen
  for (const r of eigeneRuns(p)) {
    let letzter = r;
    for (const c of inhalt(r).slice(1)) {
      const neu = { k: 'el', name: r.name, uri: r.uri, local: r.local, attrs: r.attrs.map((a) => ({ ...a })), kids: [], parent: null, leer: false };
      const rpr = kindW(r, 'rPr');
      if (rpr) anhaengen(neu, kopie(rpr));
      entfernen(c);
      anhaengen(neu, c);
      danach(letzter, neu);
      letzter = neu;
    }
  }
}

function schneiden(p, pos) {
  for (const [r, s, e] of textKarte(p)) {
    if (s < pos && pos < e) {
      const t = kindW(r, 't');
      const text = textVon(t);
      const k = pos - s;
      const hinten = kopie(r);
      textSetzen(t, text.slice(0, k));
      textSetzen(kindW(hinten, 't'), text.slice(k));
      danach(r, hinten);
      return;
    }
  }
}

// ---------- Eintraege aufloesen ----------

function zaehlen(text, teil) {
  return text.split(teil).length - 1;
}

function eintraegeLesen(pfad) {
  const roh = dateiText(pfad, 'JSON');
  let daten;
  try {
    daten = JSON.parse(roh.replace(/^﻿/, ''));
  } catch (err) {
    throw new KorrekturFehler(`JSON ungueltig: ${err.message}`);
  }
  if (!Array.isArray(daten)) throw new KorrekturFehler('JSON muss eine Liste sein');
  daten.forEach((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) throw new KorrekturFehler(`Eintrag ${i}: kein Objekt`);
    const fehlt = ['art', 'kat', 'kontext', 'p'].filter((k) => !(k in e));
    if (fehlt.length) throw new KorrekturFehler(`Eintrag ${i}: Felder fehlen: ${fehlt.join(', ')}`);
    if (!Number.isInteger(e.p)) throw new KorrekturFehler(`Eintrag ${i}: 'p' muss eine ganze Zahl sein`);
    const falscheTypen = ['falsch', 'kontext', 'kat', 'art', 'korrektur', 'kommentar']
      .filter((k) => k in e && typeof e[k] !== 'string');
    if (falscheTypen.length) throw new KorrekturFehler(`Eintrag ${i}: kein Text in ${falscheTypen.join(', ')}`);
    if (!e.kontext) throw new KorrekturFehler(`Eintrag ${i}: 'kontext' ist leer`);
    if (!ARTEN.includes(e.art) || !KATEGORIEN.includes(e.kat)) {
      throw new KorrekturFehler(`Eintrag ${i}: art/kat ungueltig: ${e.art}/${e.kat}`);
    }
    if (e.art === 'zeichen_weg' && e.kat !== 'Z') throw new KorrekturFehler(`Eintrag ${i}: zeichen_weg nur mit Z`);
    if (!(e.kommentar || '').startsWith(e.kat + ':')) {
      throw new KorrekturFehler(`Eintrag ${i}: Kommentar muss mit '${e.kat}:' beginnen`);
    }
    if ((e.art === 'ersetzen' || e.art === 'einfuegen') && !e.korrektur) {
      throw new KorrekturFehler(`Eintrag ${i}: 'korrektur' fehlt`);
    }
    if (e.art !== 'einfuegen' && !e.falsch) throw new KorrekturFehler(`Eintrag ${i}: 'falsch' fehlt`);
    if ((e.kat === 'H') !== (e.art === 'gelb')) throw new KorrekturFehler(`Eintrag ${i}: H gehoert zu gelb und gelb nur zu H`);
  });
  return daten;
}

function aufloesen(paras, daten) {
  // Gibt [aufgeloeste Eintraege, Probleme] zurueck. Position = Zeichenoffset im Absatz.
  const ok = [];
  const probleme = [];
  daten.forEach((e, i) => {
    if (!(e.p >= 0 && e.p < paras.length)) {
      probleme.push(`Eintrag ${i}: Absatz ${e.p} gibt es nicht`);
      return;
    }
    const text = absatzText(paras[e.p]);
    const n = zaehlen(text, e.kontext);
    if (n !== 1) {
      probleme.push(`Eintrag ${i} (p${e.p}): Kontext ${JSON.stringify(e.kontext)} kommt ${n}x vor`);
      return;
    }
    const k = text.indexOf(e.kontext);
    let s;
    let ende;
    if (e.art === 'einfuegen') {
      s = k + e.kontext.length;
      ende = s;
    } else {
      if (zaehlen(e.kontext, e.falsch) !== 1) {
        probleme.push(`Eintrag ${i} (p${e.p}): ${JSON.stringify(e.falsch)} nicht genau 1x im Kontext`);
        return;
      }
      s = k + e.kontext.indexOf(e.falsch);
      ende = s + e.falsch.length;
    }
    const korrektur = e.art === 'einfuegen' ? einfuegeText(text, s, e.korrektur) : e.korrektur;
    ok.push({ ...e, korrektur, i, s, e: ende });
  });
  ok.sort((a, b) => a.p - b.p || a.s - b.s || a.e - b.e);
  for (let j = 0; j + 1 < ok.length; j += 1) {
    const a = ok[j];
    const b = ok[j + 1];
    if (a.p === b.p && (b.s < a.e || (b.s === a.e && (a.art === 'einfuegen' || b.art === 'einfuegen')))) {
      probleme.push(`Eintraege ${a.i} und ${b.i} ueberlappen/grenzen an (p${a.p})`);
    }
  }
  return [ok, probleme];
}

function einfuegeText(text, pos, korrektur) {
  // Eingefuegte Woerter bekommen das fehlende Leerzeichen selbst (Satzzeichen bleiben, wie sie sind)
  let r = korrektur;
  const davor = pos > 0 ? text[pos - 1] : '';
  const danach = pos < text.length ? text[pos] : '';
  if (/^[\p{L}\p{N}]/u.test(r) && davor && !/[\s(«„"'‹]/u.test(davor)) r = ' ' + r;
  if (/[\p{L}\p{N}]$/u.test(r) && /^[\p{L}\p{N}]/u.test(danach)) r += ' ';
  return r;
}

// ---------- Kandidaten (Vorfilter ohne LLM) ----------
// Findet Stellen, an denen Claude erfahrungsgemaess Fehler uebersieht. Das sind nur Hinweise, keine Fehler:
// Die Agents pruefen jede Stelle und entscheiden selbst. Gleiche Regeln in korrektur.ps1.

const WORTLISTE = [['\\p{L}*[Rr]eflektion', 'Reflexion'], ['[Vv]orraus', 'Voraus'], ['[Ss]tandart', 'Standard'],
  ['[Ww]iederspiegel', 'widerspiegel'], ['[Ww]iederspruch', 'Widerspruch'], ['[Ww]iedersprech', 'widersprech'],
  ['[Gg]arnicht', 'gar nicht'], ['[Aa]usversehen', 'aus Versehen'], ['[Zz]umindestens', 'zumindest'],
  ['Romanes', 'Romans'],
  ['(?<=(?:[Ss]einer|[Ii]hrer|[Mm]einer|[Dd]einer|[Uu]nserer|[Ee]urer|[Ee]iner|[Dd]er|[Dd]ie|[Dd]as|[Ee]in|[Ss]ein|[Ii]hr|[Mm]ein) )eign(?:e|en|em|er|es)', 'eigen(e|en|em|er|es)']];
const ADJ_ENDUNG = '(?:e|en|em|er|es)';
const BEGLEITER = '(?:ein|eine|einen|einem|einer|eines|der|die|das|dem|den|des|dieser|diese|diesen|diesem|dieses|'
  + 'sein|seine|seinen|seinem|seiner|seines|ihr|ihre|ihren|ihrem|ihrer|ihres|mein|meine|unser|unsere|kein|keine)';
const PRAEP_DIESER = '(?:hinter|in|mit|von|auf|an|bei|durch|f\u00fcr|gegen|nach|\u00fcber|unter|vor|zu|aus|um|neben)';
const NICHT_INFINITIV = ['den', 'dem', 'einen', 'einem', 'keinen', 'keinem', 'meinen', 'meinem', 'deinen', 'seinen',
  'ihren', 'unseren', 'diesen', 'diesem', 'jenen', 'allen', 'vielen', 'anderen', 'beiden', 'manchen', 'solchen',
  'welchen', 'jeden', 'denen', 'wen'];
const L = '\\p{L}';
const EINLEITER = `(?<!${L})([Uu]m|[Oo]hne|[Ss]tatt|[Aa]nstatt)(?!${L})`;
const TRENNBAR_ZU = `(?<!${L})(?:auf|an|ab|aus|ein|mit|vor|nach|weg|fest|her|hin|dar|zur\\u00fcck|teil|fort|bei|heraus|hinaus|herunter|hinzu)zu\\p{Ll}+`;


// Rechtschreibpruefer des Betriebssystems (macOS: NSSpellChecker, "de"). Meldet nur unbekannte Woerter,
// jedes Wort einmal pro Dokument. Gleiches Verhalten in korrektur.ps1 (dort ISpellChecker, falls Deutsch installiert).
let pruefer = null;
function unbekannteWoerter(text) {
  if (pruefer === null) {
    pruefer = $.NSSpellChecker.sharedSpellChecker;
    const sprachen = ObjC.deepUnwrap(pruefer.availableLanguages);
    pruefer = sprachen.includes('de_CH') ? { sc: pruefer, sprache: 'de_CH' }
      : sprachen.some((x) => /^de/.test(x)) ? { sc: pruefer, sprache: sprachen.find((x) => /^de/.test(x)) } : false;
  }
  const t = [];
  if (!pruefer) return t;
  let pos = 0;
  while (pos < text.length) {
    const r = pruefer.sc.checkSpellingOfStringStartingAtLanguageWrapInSpellDocumentWithTagWordCount(
      $(text), pos, $(pruefer.sprache), false, 0, null);
    const start = Number(r.location);
    const laenge = Number(r.length);
    if (laenge === 0 || start >= text.length) break;
    t.push([start, laenge]);
    pos = start + laenge;
  }
  return t;
}

function hinweise(text, gesehen) {
  // [[position, laenge, kategorie, hinweis]] fuer einen Absatz
  const t = [];
  for (const [muster, richtig] of WORTLISTE) {
    for (const m of text.matchAll(new RegExp(`(?<!${L})${muster}${L}*`, 'gu'))) {
      t.push([m.index, m[0].length, 'R', `Schreibung "${m[0]}" -> ${richtig}?`]);
    }
  }
  for (const m of text.matchAll(new RegExp(EINLEITER, 'gu'))) {
    const wort = m[0];
    const vor = text.slice(0, m.index).trimEnd();
    const nach = text.slice(m.index + wort.length);
    if (/^[Uu]m$/.test(wort) && nach.startsWith(',')) {
      t.push([m.index, wort.length + 1, 'Z', 'Komma hinter "um" ueberfluessig, Komma gehoert davor?']);
    }
    const fenster = /^[^.!?;:,]{0,100}/.exec(nach.replace(/^,/, ''))[0];
    const mitZu = new RegExp(`(?<!${L})zu\\s+\\p{Ll}|${TRENNBAR_ZU}`, 'u').test(fenster);
    if (mitZu && vor && !/[,;:.!?(«„"–—-]$/.test(vor)) {
      t.push([m.index, wort.length, 'Z', `Komma vor "${wort}" fehlt? (Infinitivgruppe)`]);
    }
  }
  for (const m of text.matchAll(new RegExp(`(?<!${L})zu\\s+(\\p{Ll}+)(?!${L})`, 'gu'))) {
    const wort = m[1];
    if (!(/(?:en|ern|eln)$/.test(wort) || wort === 'sein') || NICHT_INFINITIV.includes(wort)) continue;
    const satz = text.slice(0, m.index).split(/[.!?;:]/).pop().trimEnd();
    const woerter = satz.split(/\s+/);
    if (woerter.slice(-4).join(' ').includes(',')) continue;
    if (new RegExp(EINLEITER, 'u').test(woerter.slice(-8).join(' '))) continue;
    t.push([m.index, m[0].length, 'Z', 'zu-Infinitiv ohne Komma davor, erweitert? (Pflicht ab Fassung 2024)']);
  }
  for (const [pos, laenge] of unbekannteWoerter(text)) {
    const wort = text.substr(pos, laenge);
    if (laenge < 3 || /[\p{N}@]/u.test(wort) || gesehen.has(wort)) continue;
    if (t.some((h) => h[2] === 'R' && h[0] < pos + laenge && pos < h[0] + h[1])) continue;
    gesehen.add(wort);
    t.push([pos, laenge, 'R', `Unbekanntes Wort "${wort}"? (Rechtschreibpruefer)`]);
  }
  const adjWort = `(?!${BEGLEITER}(?!${L}))\\p{Ll}+${ADJ_ENDUNG}(?!${L})`;
  const adjReihe = `(?<!${L})${BEGLEITER}\\s+(${adjWort}(?:\\s+${adjWort}){1,2})\\s+\\p{Lu}`;
  for (const m of text.matchAll(new RegExp(adjReihe, 'gu'))) {
    t.push([m.index, m[0].length, 'Z', `Adjektivreihe "${m[1]}": Komma, wenn "und" passt?`]);
  }
  const relPron = `(?<!${L})${PRAEP_DIESER}\\s+(?:dieser|diesem|diesen|dieses|welcher|welchem|welchen)\\s+(?:sich|er|sie|es|ihm|ihn|ihr|man)(?!${L})`;
  for (const m of text.matchAll(new RegExp(relPron, 'giu'))) {
    t.push([m.index, m[0].length, 'G', 'Relativsatz? "dieser/diesem" statt "der/dem", Komma davor?']);
  }
  return t.sort((a, b) => a[0] - b[0] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
}

function kandidatenZeilen(paras) {
  const zeilen = [];
  const gesehen = new Set();
  paras.forEach((p, nr) => {
    const text = absatzText(p);
    for (const [pos, laenge, kat, hinweis] of hinweise(text, gesehen)) {
      const ausschnitt = text.slice(Math.max(0, pos - 25), pos + laenge + 25).replace(/\s+/g, ' ');
      zeilen.push(`[${nr}] ${kat}: ${hinweis} | ...${ausschnitt}...`);
    }
  });
  return zeilen;
}

// ---------- Umsetzen ----------

function referenz(cid) {
  const r = element('r');
  r.leer = false;
  anhaengen(r, element('commentReference', { id: String(cid) }));
  return r;
}

function eintragSetzen(p, e, cid) {
  const karte = textKarte(p);
  let erster;
  let letzter;
  if (e.art === 'einfuegen') {
    const vorher = karte.filter((x) => x[2] === e.s);
    let neu;
    if (vorher.length) {
      const anker = vorher[vorher.length - 1][0];
      neu = neuerTextRun(anker, e.korrektur);
      danach(anker, neu);
    } else {
      const anker = karte[0][0];
      neu = neuerTextRun(anker, e.korrektur);
      davor(anker, neu);
    }
    erster = neu;
    letzter = neu;
  } else {
    const runs = karte.filter(([, s, en]) => s >= e.s && en <= e.e).map(([r]) => r);
    if (!runs.length || runs.map(runText).join('') !== e.falsch) {
      throw new KorrekturFehler(`Eintrag ${e.i}: Stelle ${JSON.stringify(e.falsch)} nicht sauber gefunden`);
    }
    const vorlage = kopie(runs[runs.length - 1]);
    for (const r of runs) {
      if (e.art === 'zeichen_weg') {
        rprSetzen(r, 'highlight', { val: 'red' });
        rprSetzen(r, 'shd', { val: 'clear', color: 'auto', fill: 'FF0000' });
      } else if (e.art === 'gelb') {
        rprSetzen(r, 'highlight', { val: 'yellow' });
        rprSetzen(r, 'shd', { val: 'clear', color: 'auto', fill: GELB });
        // Word zeichnet die Kommentarfarbe ueber Hintergrund und Hervorhebung: die dicke Linie bleibt sichtbar
        rprSetzen(r, 'u', { val: 'thick', color: GELB });
      } else {
        rprSetzen(r, 'strike');
        rprSetzen(r, 'color', { val: 'FF0000' });
      }
    }
    erster = runs[0];
    letzter = runs[runs.length - 1];
    if (e.art === 'ersetzen') {
      const neu = neuerTextRun(vorlage, e.korrektur);
      danach(runs[runs.length - 1], neu);
      letzter = neu;
    }
  }
  if (e.art === 'zeichen_weg') { // Kommentar aufs Zeichen danach, sonst verdeckt die Kommentarfarbe das Rot
    const folgend = karte.filter(([, s, en]) => s === e.e && en === e.e + 1);
    if (!folgend.length) { // Absatzende: Punktkommentar
      danach(letzter, referenz(cid));
      return;
    }
    erster = folgend[0][0];
    letzter = folgend[0][0];
  }
  davor(erster, element('commentRangeStart', { id: String(cid) }));
  const ende = element('commentRangeEnd', { id: String(cid) });
  danach(letzter, ende);
  danach(ende, referenz(cid));
}

function zusammenfassungZeilen(ok) {
  // Text der Schlusszusammenfassung: Fehler gesamt und Anzahl pro Kategorie (ohne gelb)
  const fehler = ok.filter((e) => e.kat !== 'H');
  return [['Zusammenfassung', true], [`Fehler gesamt: ${fehler.length}`, false]]
    .concat(FEHLER_KATEGORIEN.map(([k, name]) => [`${name} (${k}): ${fehler.filter((e) => e.kat === k).length}`, false]));
}

function zusammenfassungAnhaengen(root, ok) {
  // Haengt am Dokumentende rote Absaetze mit der Zusammenfassung an (vor dem Abschnitt sectPr)
  const body = kindW(root, 'body');
  if (!body) throw new KorrekturFehler('w:body fehlt');
  // Leere Vorlage: nichts vom Schueler erben (sonst z.B. Titelgroesse oder verborgen)
  const vorlage = element('r');
  const sektion = kindW(body, 'sectPr');
  for (const [text, fett] of zusammenfassungZeilen(ok)) {
    const run = neuerTextRun(vorlage, text);
    if (fett) rprSetzen(run, 'b');
    const p = element('p');
    anhaengen(p, run);
    if (sektion) davor(sektion, p); else anhaengen(body, p);
  }
}

function kommentarElemente(eintraege, startId) {
  const jetzt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return eintraege.map((e, n) => {
    const c = element('comment', { id: String(startId + n), author: 'Korrektur', date: jetzt, initials: 'K' });
    const p = element('p');
    const r1 = element('r');
    anhaengen(r1, element('annotationRef'));
    const r2 = element('r');
    const t = element('t');
    textSetzen(t, e.kommentar);
    anhaengen(r2, t);
    anhaengen(p, r1);
    anhaengen(p, r2);
    anhaengen(c, p);
    return c;
  });
}

function freieId(baeume) {
  // Erste w:id ueber allen vorhandenen (Kommentare, Lesezeichen, Aenderungen), damit jede eindeutig ist
  let max = -1;
  for (const baum of baeume) {
    if (!baum) continue;
    for (const el of alleElemente(baum)) {
      const wert = attr(el, W, 'id');
      if (wert !== null && /^-?\d+$/.test(wert)) max = Math.max(max, parseInt(wert, 10));
    }
  }
  return max + 1;
}

function wPraefixPruefen(dok, teil) {
  if (nsAufloesen(dok.root, 'w', teil) !== W) throw new KorrekturFehler(`${teil}: Praefix w ist nicht WordprocessingML`);
}

function setzen(docx, jsonpfad, out) {
  const vorher = $.NSData.dataWithContentsOfFile(docx);
  const daten = eintraegeLesen(jsonpfad);
  const paket = zipLesen(docx);
  try {
    const teile = paket.teile;
    const dok = parseXml(teilText(teile, 'word/document.xml'), 'word/document.xml');
    wPraefixPruefen(dok, 'word/document.xml');
    const paras = absaetze(dok.root);
    const [ok, probleme] = aufloesen(paras, daten);
    if (probleme.length) throw new KorrekturFehler(probleme.join('\n'));

    const rels = parseXml(teilText(teile, 'word/_rels/document.xml.rels'), 'document.xml.rels');
    const ct = parseXml(teilText(teile, '[Content_Types].xml'), '[Content_Types].xml');
    if (rels.root.name !== 'Relationships' || rels.root.uri !== R_NS) throw new KorrekturFehler('document.xml.rels unerwartet aufgebaut');
    if (ct.root.name !== 'Types' || ct.root.uri !== CT_NS) throw new KorrekturFehler('[Content_Types].xml unerwartet aufgebaut');
    const rel = rels.root.kids.find((r) => r.k === 'el' && attr(r, '', 'Type') === COMMENTS_REL);
    const ziel = rel ? attr(rel, '', 'Target') : null;
    let teilname = 'word/comments.xml';
    if (ziel) teilname = ziel.startsWith('/') ? ziel.slice(1) : 'word/' + ziel;
    let kommentarDok = null;
    if (teile.has(teilname)) {
      kommentarDok = parseXml(teilText(teile, teilname), teilname);
      wPraefixPruefen(kommentarDok, teilname);
    }
    const startId = freieId([dok.root, kommentarDok && kommentarDok.root]);

    const absatzNummern = [...new Set(ok.map((e) => e.p))].sort((a, b) => a - b);
    for (const pNr of absatzNummern) {
      const p = paras[pNr];
      atomar(p);
      for (const e of ok.filter((x) => x.p === pNr)) {
        const stellen = [e.s, e.e].concat(e.art === 'zeichen_weg' ? [e.e + 1] : []);
        for (const pos of stellen) schneiden(p, pos);
      }
    }
    const kommentiert = ok;
    kommentiert.forEach((e, n) => { e.cid = startId + n; });
    for (const e of [...ok].reverse()) { // hinten zuerst, Absatzpositionen bleiben gueltig
      eintragSetzen(paras[e.p], e, e.cid);
    }
    zusammenfassungAnhaengen(dok.root, ok);

    const neu = new Map();
    neu.set('word/document.xml', serialisieren(dok));
    if (kommentarDok) {
      for (const c of kommentarElemente(kommentiert, startId)) anhaengen(kommentarDok.root, c);
      kommentarDok.root.leer = false;
      neu.set(teilname, serialisieren(kommentarDok));
    } else {
      const kroot = element('comments');
      kroot.leer = false;
      kroot.attrs.unshift({ name: 'xmlns:w', uri: '', local: 'w', raw: W, q: '"' });
      for (const c of kommentarElemente(kommentiert, startId)) anhaengen(kroot, c);
      neu.set(teilname, serialisieren({ prolog: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', root: kroot, epilog: '' }));
    }
    if (!ziel) {
      const nummern = rels.root.kids.filter((r) => r.k === 'el')
        .map((r) => /^rId(\d+)$/.exec(attr(r, '', 'Id') || ''))
        .filter(Boolean).map((m) => parseInt(m[1], 10));
      anhaengen(rels.root, element0('Relationship', R_NS, {
        Id: `rId${Math.max(0, ...nummern) + 1}`, Type: COMMENTS_REL, Target: 'comments.xml' }));
      rels.root.leer = false;
      neu.set('word/_rels/document.xml.rels', serialisieren(rels));
    }
    if (!ct.root.kids.some((o) => o.k === 'el' && attr(o, '', 'PartName') === '/' + teilname)) {
      anhaengen(ct.root, element0('Override', CT_NS, { PartName: '/' + teilname, ContentType: COMMENTS_CT }));
      ct.root.leer = false;
      neu.set('[Content_Types].xml', serialisieren(ct));
    }

    // Erst in eine Zwischendatei schreiben und pruefen; nur eine gepruefte Kopie bekommt den Zielnamen
    const zwischen = ordner(out) + '/.' + dateiname(out) + '.tmp';
    try {
      zipSchreiben(paket, neu, zwischen);
      selbstpruefung(zwischen, kommentiert.length, startId, teile, teilname);
      if (!$.NSData.dataWithContentsOfFile(docx).isEqualToData(vorher)) throw new KorrekturFehler('Original veraendert');
      programm('/bin/mv', ['-f', zwischen, out]);
    } finally {
      loeschen(zwischen);
    }
    return ok.length;
  } finally {
    loeschen(paket.ordner);
  }
}

// ---------- Selbstpruefung ----------

function selbstpruefung(out, anzahl, startId, altTeile, teilname) {
  if (programm('/usr/bin/unzip', ['-tqq', out], null, true).code !== 0) throw new KorrekturFehler('Zip der Kopie defekt');
  const gelesen = zipLesen(out);
  try {
    for (const [name, daten] of gelesen.teile) {
      if (/\.(xml|rels)$/.test(name)) {
        parseXml(teilText(gelesen.teile, name), name);
        if (programm('/usr/bin/xmllint', ['--noout', gelesen.ordner + '/x/' + name], null, true).code !== 0) {
          throw new KorrekturFehler(`Teil ${name}: xmllint meldet ungueltiges XML`);
        }
      }
      if (!daten) throw new KorrekturFehler(`Teil ${name} nicht lesbar`);
    }
    const geaendert = new Set(['word/document.xml', teilname, 'word/_rels/document.xml.rels', '[Content_Types].xml']);
    for (const [name, daten] of altTeile) {
      if (!geaendert.has(name) && !(gelesen.teile.has(name) && gelesen.teile.get(name).isEqualToData(daten))) {
        throw new KorrekturFehler(`Teil ${name} unbeabsichtigt veraendert`);
      }
    }
    const alt = absaetze(parseXml(teilText(altTeile, 'word/document.xml'), 'word/document.xml').root);
    const neuRoot = parseXml(teilText(gelesen.teile, 'word/document.xml'), 'word/document.xml').root;
    const neu = absaetze(neuRoot);
    if (neu.length < alt.length) throw new KorrekturFehler('Absatzzahl geaendert');
    alt.forEach((a, i) => {
      if (absatzText(a) !== absatzText(neu[i], true)) throw new KorrekturFehler(`Absatz ${i}: Schuelertext veraendert`);
    });
    if (neu.slice(alt.length).some((b) => absatzText(b, true))) {
      throw new KorrekturFehler('Nach dem Schuelertext steht mehr als die Zusammenfassung');
    }
    const ids = (local) => [...alleElemente(neuRoot)].filter((x) => istW(x, local)).map((x) => attr(x, W, 'id'));
    const starts = ids('commentRangeStart');
    const enden = ids('commentRangeEnd');
    const refs = ids('commentReference');
    const neue = Array.from({ length: anzahl }, (_, n) => String(startId + n));
    const gleich = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    const sStarts = new Set(starts);
    const sRefs = new Set(refs);
    if (!(sStarts.size === starts.length && sRefs.size === refs.length && gleich(sStarts, new Set(enden))
          && starts.every((x) => sRefs.has(x)) && neue.every((x) => sRefs.has(x)))) {
      throw new KorrekturFehler('Kommentarmarken unvollstaendig oder doppelt');
    }
    const kommentare = parseXml(teilText(gelesen.teile, teilname), teilname).root;
    const kIds = new Set(kommentare.kids.filter((c) => c.k === 'el').map((c) => attr(c, W, 'id')));
    if (!neue.every((x) => kIds.has(x))) throw new KorrekturFehler('Kommentare fehlen in comments.xml');
  } finally {
    loeschen(gelesen.ordner);
  }
}

// ---------- Dateien, Zip, Programme ----------

function programm(pfad, args, cwd = null, stillErlaubt = false) {
  const task = $.NSTask.alloc.init;
  task.launchPath = pfad;
  task.arguments = $(args);
  if (cwd) task.currentDirectoryPath = cwd;
  const aus = $.NSPipe.pipe;
  const fehler = $.NSPipe.pipe;
  task.standardOutput = aus;
  task.standardError = fehler;
  task.launch;
  const ausDaten = aus.fileHandleForReading.readDataToEndOfFile;
  const fehlerDaten = fehler.fileHandleForReading.readDataToEndOfFile;
  task.waitUntilExit;
  const ergebnis = {
    code: task.terminationStatus,
    out: $.NSString.alloc.initWithDataEncoding(ausDaten, $.NSUTF8StringEncoding).js || '',
    err: $.NSString.alloc.initWithDataEncoding(fehlerDaten, $.NSUTF8StringEncoding).js || '',
  };
  if (ergebnis.code !== 0 && !stillErlaubt) {
    throw new KorrekturFehler(`${pfad.split('/').pop()} fehlgeschlagen: ${ergebnis.err.trim() || ergebnis.code}`);
  }
  return ergebnis;
}

function tempOrdner() {
  const pfad = $.NSTemporaryDirectory().js + 'korrektur-' + $.NSUUID.UUID.UUIDString.js;
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(pfad, true, $(), null);
  return pfad;
}

function loeschen(pfad) {
  const fm = $.NSFileManager.defaultManager;
  if (fm.fileExistsAtPath(pfad)) fm.removeItemAtPathError(pfad, null);
}

function zipLesen(docx) {
  // Liest alle Teile als NSData, in der Reihenfolge des Zip-Verzeichnisses
  const liste = programm('/usr/bin/unzip', ['-Z1', docx], null, true);
  if (liste.code !== 0) throw new KorrekturFehler(`${dateiname(docx)} ist keine gueltige .docx`);
  const namen = liste.out.split('\n').filter((x) => x);
  const ordnerPfad = tempOrdner();
  try {
    programm('/usr/bin/unzip', ['-qq', docx, '-d', ordnerPfad + '/x']);
    const teile = new Map();
    for (const name of namen) {
      if (name.endsWith('/')) continue;
      const daten = $.NSData.dataWithContentsOfFile(ordnerPfad + '/x/' + name);
      if (daten.isNil()) throw new KorrekturFehler(`Teil ${name} nicht lesbar`);
      teile.set(name, daten);
    }
    return { namen, teile, ordner: ordnerPfad };
  } catch (err) {
    loeschen(ordnerPfad);
    throw err;
  }
}

function teilText(teile, name) {
  if (!teile.has(name)) throw new KorrekturFehler(`Teil ${name} fehlt`);
  const s = $.NSString.alloc.initWithDataEncoding(teile.get(name), $.NSUTF8StringEncoding);
  if (s.isNil()) throw new KorrekturFehler(`Teil ${name} ist nicht UTF-8`);
  return s.js;
}

function zipSchreiben(paket, neu, ziel) {
  // Geaenderte Teile in den entpackten Ordner schreiben, dann alles in Originalreihenfolge zippen
  for (const [name, text] of neu) {
    if (!$(text).dataUsingEncoding($.NSUTF8StringEncoding).writeToFileAtomically(paket.ordner + '/x/' + name, true)) {
      throw new KorrekturFehler(`Teil ${name} nicht schreibbar`);
    }
  }
  const namen = paket.namen.concat([...neu.keys()].filter((n) => !paket.namen.includes(n)));
  loeschen(ziel);
  programm('/usr/bin/zip', ['-q', '-X', '-nw', ziel, '--'].concat(namen), paket.ordner + '/x');
}

function dateiText(pfad, was) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(pfad, $.NSUTF8StringEncoding, null);
  if (s.isNil()) throw new KorrekturFehler(`${was} nicht lesbar: ${pfad}`);
  return s.js;
}

function absolut(pfad) {
  const p = pfad.startsWith('/') ? pfad : $.NSFileManager.defaultManager.currentDirectoryPath.js + '/' + pfad;
  return $(p).stringByStandardizingPath.js;
}

function ordner(pfad) {
  return pfad.slice(0, pfad.lastIndexOf('/')) || '/';
}

function dateiname(pfad) {
  return pfad.slice(pfad.lastIndexOf('/') + 1);
}

function echt(pfad) {
  return $(pfad).stringByResolvingSymlinksInPath.js;
}

function schreiben(handle, text) {
  handle.writeData($(text).dataUsingEncoding($.NSUTF8StringEncoding));
}

// ---------- Aufruf ----------

function ausfuehren(argv) {
  const aus = (text) => schreiben($.NSFileHandle.fileHandleWithStandardOutput, text + '\n');
  if (argv.length < 2 || !['extrahieren', 'kandidaten', 'pruefen', 'setzen'].includes(argv[0])
      || (argv[0] !== 'extrahieren' && argv[0] !== 'kandidaten' && argv.length < 3)) {
    aus(USAGE);
    return 2;
  }
  const docx = absolut(argv[1]);
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(docx)) throw new KorrekturFehler(`Datei fehlt: ${argv[1]}`);
  if (['extrahieren', 'kandidaten', 'pruefen'].includes(argv[0])) {
    const paket = zipLesen(docx);
    let dok;
    try {
      dok = parseXml(teilText(paket.teile, 'word/document.xml'), 'word/document.xml');
    } finally {
      loeschen(paket.ordner);
    }
    if (argv[0] === 'extrahieren') {
      absaetze(dok.root).forEach((p, i) => {
        const text = absatzText(p);
        if (text.trim()) aus(`[${i}] ${text}`);
      });
      return 0;
    }
    if (argv[0] === 'kandidaten') {
      const zeilen = kandidatenZeilen(absaetze(dok.root));
      aus(zeilen.length ? zeilen.join('\n') : 'keine Kandidaten');
      return 0;
    }
    const [ok, probleme] = aufloesen(absaetze(dok.root), eintraegeLesen(absolut(argv[2])));
    aus(probleme.length ? probleme.join('\n') : `OK: ${ok.length} Eintraege eindeutig`);
    return probleme.length ? 1 : 0;
  }
  const name = dateiname(docx);
  const stamm = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  const out = argv.length > 3 ? absolut(argv[3]) : ordner(docx) + '/korrigiert/' + stamm + '_korrigiert.docx';
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(ordner(out), true, $(), $());
  if (echt(out) === echt(docx)) throw new KorrekturFehler('Ziel ist das Original');
  const istOrdner = Ref();
  if ($.NSFileManager.defaultManager.fileExistsAtPathIsDirectory(out, istOrdner) && istOrdner[0]) {
    throw new KorrekturFehler('Ziel ist ein Ordner');
  }
  const n = setzen(docx, absolut(argv[2]), out);
  aus(`${dateiname(out)}: ${n} Eintraege gesetzt, Selbstpruefung bestanden`);
  return 0;
}

function run(argv) {
  let code;
  try {
    code = ausfuehren(argv);
  } catch (err) {
    const text = err instanceof KorrekturFehler ? err.message : `intern: ${err && err.message ? err.message : err}`;
    schreiben($.NSFileHandle.fileHandleWithStandardError, `FEHLER: ${text}\n`);
    code = 1;
  }
  $.exit(code);
}
