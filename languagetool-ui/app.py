#!/usr/bin/env python3
"""Small loopback-only UI for the local LanguageTool server."""

from __future__ import annotations

import json
import errno
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from supplemental_grammar import check as check_supplemental_commas


HOST = "127.0.0.1"
FIRST_PORT = 8765
LAST_PORT = 8790
LT_HOST = "127.0.0.1"
LT_PORT = 8081
LT_URL = f"http://{LT_HOST}:{LT_PORT}/v2/check"
LT_BINARY = Path("/opt/homebrew/opt/languagetool/bin/languagetool-server")
MAX_CHARS = 20_000
SUPPLEMENTAL_COMMA_RULES = os.environ.get("ENABLE_SUPPLEMENTAL_COMMA_RULES", "1") != "0"

PAGE = r"""<!doctype html>
<html lang="de-CH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lokale Textprüfung</title>
  <style>
    :root { color-scheme: light; --ink:#202522; --muted:#65716a; --green:#176b4b; --line:#dce4de; --paper:#f5f8f5; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { width:min(900px, calc(100% - 32px)); margin:48px auto; }
    header { margin-bottom:22px; }
    h1 { margin:0 0 6px; font-size:clamp(25px,4vw,34px); letter-spacing:-.03em; }
    header p,.hint { color:var(--muted); margin:0; }
    .panel { background:white; border:1px solid var(--line); border-radius:14px; padding:18px; box-shadow:0 8px 28px #203a2810; }
    .editor-shell { position:relative; }
    textarea, #marked { display:block; width:100%; min-height:280px; border:1px solid var(--line); border-radius:9px; padding:14px; font:inherit; font-size:16px; line-height:1.6; letter-spacing:normal; tab-size:8; }
    textarea { position:relative; z-index:2; resize:vertical; color:transparent; caret-color:var(--ink); background:transparent; outline:none; }
    textarea::placeholder { color:var(--muted); opacity:1; }
    textarea::selection { background:#176b4b44; }
    #marked { position:absolute; z-index:1; inset:0; height:100%; overflow:hidden; white-space:pre-wrap; overflow-wrap:break-word; pointer-events:none; }
    .error-mark { text-decoration-line:underline; text-decoration-style:wavy; text-decoration-color:#c62828; text-decoration-thickness:2px; text-underline-offset:3px; }
    textarea:focus { border-color:var(--green); box-shadow:0 0 0 3px #176b4b20; }
    .row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; }
    .count,.hint { font-size:13px; }
    button { border:0; border-radius:8px; padding:10px 17px; background:var(--green); color:white; font-weight:650; font-size:15px; cursor:pointer; }
    button:disabled { opacity:.55; cursor:wait; }
    #status { min-height:25px; margin:14px 2px 0; color:var(--muted); }
    #results { display:grid; gap:10px; margin-top:12px; }
    .issue { background:white; border:1px solid var(--line); border-left:4px solid #d88b28; border-radius:9px; padding:13px 15px; }
    .issue p { margin:0 0 7px; }
    .quote { color:var(--muted); font-size:14px; }
    mark { background:#ffedb5; color:inherit; border-radius:2px; }
    .suggestions { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
    .suggestion { border:1px solid var(--line); border-radius:99px; padding:3px 9px; color:var(--green); font-size:14px; }
    .foot { margin:14px 2px 0; color:var(--muted); font-size:13px; }
    @media(max-width:560px) { main { margin:24px auto; } .panel { padding:12px; } textarea, #marked { min-height:240px; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Lokale Textprüfung</h1>
    <p>LanguageTool prüft deinen Text auf Schweizer Hochdeutsch.</p>
  </header>
  <section class="panel">
    <div class="editor-shell">
      <div id="marked" aria-hidden="true"></div>
      <textarea id="text" maxlength="20000" placeholder="Text hier eingeben oder einfügen …" aria-label="Text zur Prüfung" spellcheck="false"></textarea>
    </div>
    <div class="row">
      <span class="count" id="count">0 / 20’000 Zeichen</span>
      <button id="check" type="button">Text prüfen</button>
    </div>
    <div id="status" role="status" aria-live="polite"></div>
    <div id="results"></div>
  </section>
  <p class="foot">Prüfung läuft lokal. Zusatzregeln markieren mögliche Kommafehler. Vorschläge prüfen; Regeln können sich irren.</p>
</main>
<script>
const input = document.querySelector('#text');
const button = document.querySelector('#check');
const count = document.querySelector('#count');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const markedLayer = document.querySelector('#marked');
let latestMatches = [];

function drawUnderlines(source, matches) {
  const ranges = matches.map(match => {
    const start = Math.max(0, Math.min(source.length, Number(match.offset) || 0));
    const length = Math.max(0, Number(match.length) || 0);
    if (!source.length) return null;
    if (length === 0) return start > 0 ? [start - 1, start] : [0, 1];
    return [start, Math.min(source.length, start + length)];
  }).filter(Boolean).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  markedLayer.replaceChildren();
  let cursor = 0;
  for (const [start, end] of merged) {
    addText(markedLayer, source.slice(cursor, start));
    const span = document.createElement('span');
    span.className = 'error-mark';
    span.textContent = source.slice(start, end);
    markedLayer.append(span);
    cursor = end;
  }
  addText(markedLayer, source.slice(cursor));
}

input.addEventListener('input', () => {
  count.textContent = `${input.value.length.toLocaleString('de-CH')} / 20’000 Zeichen`;
  if (latestMatches.length) {
    latestMatches = [];
    drawUnderlines(input.value, []);
    results.replaceChildren();
    status.textContent = 'Text geändert. Bitte erneut prüfen.';
  } else {
    drawUnderlines(input.value, []);
  }
});
input.addEventListener('scroll', () => {
  markedLayer.scrollTop = input.scrollTop;
  markedLayer.scrollLeft = input.scrollLeft;
});

function addText(parent, text) { parent.append(document.createTextNode(text)); }

function renderIssue(match, source) {
  const card = document.createElement('article');
  card.className = 'issue';
  const message = document.createElement('p');
  message.textContent = match.message || 'Möglicher Fehler';
  card.append(message);

  const start = Math.max(0, match.offset || 0);
  const end = Math.min(source.length, start + (match.length || 0));
  const quote = document.createElement('p');
  quote.className = 'quote';
  addText(quote, 'Textstelle: „');
  addText(quote, source.slice(Math.max(0, start - 45), start));
  const marked = document.createElement('mark');
  marked.textContent = source.slice(start, end) || '…';
  quote.append(marked);
  addText(quote, source.slice(end, Math.min(source.length, end + 45)) + '“');
  card.append(quote);

  const replacements = (match.replacements || []).slice(0, 5).map(item => item.value).filter(Boolean);
  if (replacements.length) {
    const suggestions = document.createElement('div');
    suggestions.className = 'suggestions';
    for (const replacement of replacements) {
      const chip = document.createElement('span');
      chip.className = 'suggestion';
      chip.textContent = replacement;
      suggestions.append(chip);
    }
    card.append(suggestions);
  }
  return card;
}

button.addEventListener('click', async () => {
  const text = input.value;
  results.replaceChildren();
  if (!text.trim()) { status.textContent = 'Gib zuerst Text ein.'; input.focus(); return; }
  button.disabled = true;
  status.textContent = 'Prüfe Text …';
  try {
    const response = await fetch('/check', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({text})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Prüfung fehlgeschlagen.');
    if (input.value !== text) {
      status.textContent = 'Text geändert. Bitte erneut prüfen.';
      return;
    }
    const matches = data.matches || [];
    latestMatches = matches;
    drawUnderlines(text, matches);
    status.textContent = matches.length
      ? `${matches.length} mögliche Fehler gefunden. Prüfe die Vorschläge selbst.`
      : 'Keine Treffer. Das beweist nicht, dass der Text fehlerfrei ist.';
    for (const match of matches) results.append(renderIssue(match, text));
  } catch (error) {
    status.textContent = `Fehler: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
</script>
</body>
</html>
"""


def api_is_ready() -> bool:
    data = urllib.parse.urlencode({"language": "de-CH", "text": ""}).encode()
    request = urllib.request.Request(LT_URL, data=data, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=1.5) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def utf16_to_index(text: str, offset: int) -> int:
    """Convert LanguageTool's UTF-16 offset to a Python string index."""
    consumed = 0
    for index, char in enumerate(text):
        if consumed >= offset:
            return index
        consumed += 2 if ord(char) > 0xFFFF else 1
    return len(text)


def start_languagetool_if_needed() -> subprocess.Popen | None:
    if api_is_ready():
        return None
    if not LT_BINARY.exists():
        raise RuntimeError(f"LanguageTool nicht gefunden: {LT_BINARY}")
    process = subprocess.Popen(
        [str(LT_BINARY), "--port", str(LT_PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    for _ in range(40):
        if api_is_ready():
            return process
        if process.poll() is not None:
            raise RuntimeError("LanguageTool-Server konnte nicht gestartet werden.")
        time.sleep(0.5)
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    raise RuntimeError("LanguageTool-Server antwortet nicht auf Port 8081.")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def local_request_allowed(self, *, check_origin: bool = False) -> bool:
        port = self.server.server_port
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host", "") not in allowed_hosts:
            self.send_error(403, "Local access only")
            return False
        origin = self.headers.get("Origin") if check_origin else None
        if origin:
            try:
                parsed = urllib.parse.urlsplit(origin)
                valid_origin = (
                    parsed.scheme == "http"
                    and parsed.hostname in {"127.0.0.1", "localhost"}
                    and parsed.port == port
                )
            except ValueError:
                valid_origin = False
            if not valid_origin:
                self.send_error(403, "Cross-origin requests are not allowed")
                return False
        return True

    def do_GET(self) -> None:
        if not self.local_request_allowed():
            return
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if not self.local_request_allowed(check_origin=True):
            return
        if self.path != "/check":
            self.send_json(404, {"error": "Unbekannter Endpunkt."})
            return
        try:
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self.send_json(400, {"error": "Content-Length fehlt oder ist ungültig."})
                return
            if length <= 0 or length > 100_000:
                self.send_json(413, {"error": "Ungültige Anfragegrösse."})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                self.send_json(400, {"error": "JSON-Anfrage muss ein Objekt sein."})
                return
            text = payload.get("text", "")
            if not isinstance(text, str):
                self.send_json(400, {"error": "Text muss eine Zeichenkette sein."})
                return
            if len(text) > MAX_CHARS:
                self.send_json(413, {"error": "LanguageTool prüft höchstens 20’000 Zeichen pro Anfrage."})
                return
            form = urllib.parse.urlencode({"language": "de-CH", "text": text}).encode()
            request = urllib.request.Request(LT_URL, data=form, method="POST")
            with urllib.request.urlopen(request, timeout=45) as response:
                result = json.loads(response.read())
            if SUPPLEMENTAL_COMMA_RULES:
                matches = result.get("matches", [])
                local_candidates = check_supplemental_commas(text)
                # LanguageTool sometimes calls the finite verb before «aber» a
                # duplicate when the sentence is actually a comma splice.
                filtered = []
                for item in matches:
                    offset = utf16_to_index(text, item.get("offset", 0))
                    end = utf16_to_index(text, item.get("offset", 0) + item.get("length", 0))
                    rule_id = item.get("rule", {}).get("id", "")
                    marked_text = text[offset:end]
                    context_before = text[max(0, offset - 45):offset]
                    context_after = text[end:min(len(text), end + 120)]
                    is_false_duplicate = (
                        rule_id == "DOPPELTES_VERB"
                        and marked_text.lower() == "ist"
                        and re.match(r"\s+aber\b", text[end:], re.IGNORECASE) is not None
                    )
                    is_vocative_case = (
                        rule_id == "DE_CASE"
                        and marked_text.lower() == "kleiner"
                        and re.search(r",\s*$", context_before)
                        and re.match(r"\s*,", context_after)
                    )
                    if not (is_false_duplicate or is_vocative_case):
                        filtered.append(item)
                matches = filtered
                for candidate in local_candidates:
                    offset = candidate["offset"]
                    length = candidate.get("length", 0)
                    existing = next((
                        item for item in matches
                        if item.get("offset", -1) == offset
                        and item.get("length", 0) == length
                    ), None)
                    if existing:
                        suggestions = existing.setdefault("replacements", [])
                        for preferred in candidate.get("replacements", []):
                            value = preferred.get("value")
                            current = next((entry for entry in suggestions if entry.get("value") == value), None)
                            if current:
                                suggestions.remove(current)
                            else:
                                current = preferred
                            suggestions.insert(0, current)
                    else:
                        matches.append(candidate)
                matches.sort(key=lambda item: (item.get("offset", 0), item.get("length", 0)))
                result["matches"] = matches
            self.send_json(200, result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Ungültige JSON-Anfrage."})
        except (OSError, urllib.error.URLError, TimeoutError) as error:
            self.send_json(502, {"error": f"LanguageTool ist nicht erreichbar: {error}"})


def main() -> None:
    server = None
    for port in range(FIRST_PORT, LAST_PORT + 1):
        try:
            server = ThreadingHTTPServer((HOST, port), Handler)
            break
        except OSError as error:
            if error.errno != errno.EADDRINUSE:
                raise
    if server is None:
        raise RuntimeError(f"Kein freier Port zwischen {FIRST_PORT} und {LAST_PORT}.")
    lt_process = None
    try:
        lt_process = start_languagetool_if_needed()
        print(f"Lokale Textprüfung: http://{HOST}:{server.server_port}")
        print("Stoppen mit Ctrl+C.")
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if lt_process is not None and lt_process.poll() is None:
            lt_process.terminate()
            try:
                lt_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                lt_process.kill()


if __name__ == "__main__":
    main()
