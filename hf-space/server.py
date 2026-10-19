"""API-Server fuer Hugging Face Spaces: LanguageTool (de-CH) plus Zusatzregeln, geschuetzt mit API-Key.

POST /check   Header: Authorization: Bearer <API_KEY>   Body: {"text": "..."}
GET  /health  ohne Key, nur {"ok": true}
Der Key kommt aus der Umgebungsvariable API_KEY (Space-Secret), nie aus dem Code.
"""
from __future__ import annotations

import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from supplemental_grammar import check as check_supplemental_commas

API_KEY = os.environ.get("API_KEY", "")
PORT = int(os.environ.get("PORT", "7860"))
LT_URL = "http://127.0.0.1:8081/v2/check"
MAX_CHARS = 20_000
MAX_BODY = 100_000


def key_ok(header: str) -> bool:
    scheme, _, token = header.partition(" ")
    return scheme.lower() == "bearer" and hmac.compare_digest(token.encode(), API_KEY.encode())


def merge_supplemental(text: str, result: dict) -> dict:
    matches = result.get("matches", [])
    for candidate in check_supplemental_commas(text):
        offset = candidate["offset"]
        if not any(m.get("offset", -1) <= offset <= m.get("offset", -1) + m.get("length", 0) for m in matches):
            matches = [*matches, candidate]
    return {**result, "matches": sorted(matches, key=lambda m: (m.get("offset", 0), m.get("length", 0)))}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass  # keine Schuelertexte oder Keys in Logs

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True})
        else:
            self.send_json(404, {"error": "Nur POST /check mit API-Key."})

    def do_POST(self) -> None:
        if self.path != "/check":
            self.send_json(404, {"error": "Unbekannter Endpunkt."})
            return
        if not key_ok(self.headers.get("Authorization", "")):
            self.send_json(401, {"error": "API-Key fehlt oder falsch."})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
            if length <= 0 or length > MAX_BODY:
                self.send_json(413, {"error": "Ungültige Anfragegrösse."})
                return
            payload = json.loads(self.rfile.read(length))
            text = payload.get("text") if isinstance(payload, dict) else None
            if not isinstance(text, str):
                self.send_json(400, {"error": 'Body muss {"text": "..."} sein.'})
                return
            if len(text) > MAX_CHARS:
                self.send_json(413, {"error": "Höchstens 20'000 Zeichen pro Anfrage."})
                return
            form = urllib.parse.urlencode({"language": "de-CH", "text": text}).encode()
            with urllib.request.urlopen(urllib.request.Request(LT_URL, data=form, method="POST"), timeout=60) as r:
                result = json.loads(r.read())
            self.send_json(200, merge_supplemental(text, result))
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "Ungültige Anfrage."})
        except (OSError, urllib.error.URLError, TimeoutError):
            self.send_json(502, {"error": "LanguageTool nicht erreichbar."})


def main() -> None:
    if len(API_KEY) < 16:
        raise SystemExit("API_KEY fehlt oder ist zu kurz (mindestens 16 Zeichen, als Space-Secret setzen).")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
