---
title: Korrektur API
emoji: ✏️
sdk: docker
app_port: 7860
pinned: false
---

# Korrektur-API (LanguageTool de-CH plus Zusatzregeln)

```bash
curl -X POST https://<user>-<space>.hf.space/check \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Ich komme gern aber ich bleibe nicht lange."}'
```

Antwort: JSON mit `matches` (`offset`, `length`, `message`, `replacements`), Hinweise für die menschliche Prüfung.

## Einrichten

1. Auf huggingface.co einen **Space** anlegen: SDK **Docker**. Sichtbarkeit egal, der Key schützt die API.
2. Space, Settings, **Variables and secrets**: Secret `API_KEY` mit einem langen Zufallswert (`openssl rand -hex 24`).
3. Den Inhalt dieses Ordners (`hf-space/`) in den Space pushen. Der erste Build dauert einige Minuten.
4. Nach ca. 2 Tagen ohne Anfrage schläft der Space, die nächste Anfrage weckt ihn (30 bis 60 s).

Hinweis: Mit Basis-LanguageTool heisst «keine Treffer» nicht «fehlerfrei».
Der Server loggt keine Texte. Schülertexte laufen über einen Server von Hugging Face (USA).
