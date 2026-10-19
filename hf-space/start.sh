#!/bin/sh
# LanguageTool nur lokal (ohne --public), nach aussen spricht allein server.py mit API-Key.
java -Xmx1g -cp "/opt/languagetool/languagetool-server.jar" org.languagetool.server.HTTPServer --port 8081 &
for i in $(seq 1 60); do
  curl -sf -o /dev/null http://127.0.0.1:8081/v2/languages && break
  sleep 1
done
exec python3 /app/server.py
