"""Small, conservative local comma checks to supplement LanguageTool."""

from __future__ import annotations

import re
from re import escape


FINITE_VERBS = {
    "bin", "bist", "ist", "sind", "seid", "war", "warst", "waren", "wart",
    "habe", "hast", "hat", "haben", "habt", "hatte", "hatten",
    "werde", "wirst", "wird", "werden", "wurde", "wurden",
    "kann", "kannst", "können", "könnt", "muss", "musst", "müssen", "müsst",
    "soll", "sollst", "sollen", "sollt", "will", "willst", "wollen", "wollt", "wollte", "wolltest", "wollten", "wolltet",
    "darf", "darfst", "dürfen", "dürft", "mag", "magst", "mögen", "mögt",
    "regne", "regnest", "regnet", "regnen", "regnete", "regnetest", "regneten", "regnetet",
    "arbeite", "arbeitest", "arbeitet", "arbeiten", "arbeitete", "arbeiteten",
    "spiele", "spielst", "spielt", "spielen", "spieltet", "spielte", "spielten",
    "komme", "kommst", "kommt", "kommen", "kam", "kamen",
    "lerne", "lernst", "lernt", "lernen", "lernte", "lernten",
    "gehe", "gehst", "geht", "gehen", "ging", "gingen",
    "mache", "machst", "macht", "machen", "machte", "machten",
    "sage", "sagst", "sagt", "sagen", "sagte", "sagten",
    "lese", "liest", "lesen", "las", "lasen",
    "schreibe", "schreibst", "schreibt", "schreiben", "schrieb", "schrieben",
    "erzähle", "erzählst", "erzählt", "erzählen", "erzählte", "erzählten",
    "gehört", "gehören", "gehöre", "gehst", "gehört", "bleibe", "bleibst",
    "bleibt", "bleiben", "rufe", "rufst", "ruft", "rufen", "kommt", "findet",
    "wirke", "wirkst", "wirkt", "wirken", "enthält", "enthalten", "enthalte",
    "stieg", "stiegen", "steige", "steigst", "steigen", "steigt",
    "vergleiche", "vergleichst", "vergleicht", "vergleichen",
    "bleibe", "bleibst", "bleibt", "bleiben", "blieb", "bliebst", "blieben",
    "helfe", "hilfst", "hilft", "helfen", "half", "halfen",
    "finde", "findest", "findet", "finden", "fand", "fanden",
    "untersuche", "untersuchst", "untersucht", "untersuchen", "untersuchte", "untersuchten",
    "beobachte", "beobachtest", "beobachtet", "beobachten", "beobachtete", "beobachteten",
    "probiere", "probierst", "probiert", "probieren", "probierte", "probierten",
    "empfehle", "empfiehlst", "empfiehlt", "empfehlen", "empfahl", "empfahlen",
    "ordne", "ordnest", "ordnet", "ordnen", "ordnete", "ordneten",
    "beantworte", "beantwortest", "beantwortet", "beantworten", "beantwortete", "beantworteten",
    "trainiere", "trainierst", "trainiert", "trainieren", "trainierte", "trainierten",
    "gebe", "gibst", "gibt", "geben", "gab", "gaben",
    "stelle", "stellst", "stellt", "stellen", "stellte", "stellten",
    "schildere", "schilderst", "schildert", "schildern", "schilderte", "schilderten",
    "frage", "fragst", "fragt", "fragen", "fragte", "fragten",
    "erkläre", "erklärst", "erklärt", "erklären", "erklärte", "erklärten",
}

PRONOUNS = r"(?:ich|du|er|sie|es|wir|ihr|man|Sie)"
SUBJECT_VERB = re.compile(rf"\s*\b{PRONOUNS}\s+(?P<verb>[\wÄÖÜäöüß-]+)", re.IGNORECASE)
FINITE_PATTERN = "(?:" + "|".join(
    escape(word) for word in sorted(FINITE_VERBS, key=len, reverse=True)
) + ")"
INITIAL_CONDITION = re.compile(
    rf"(?P<clause>[A-ZÄÖÜ][\wÄÖÜäöüß-]*st\s+du\b(?:\s+[\wÄÖÜäöüß-]+){{1,6}})\s+"
    rf"(?P<verb>kann|kannst|können|könnt|muss|musst|müssen|müsst|soll|sollst|sollen|sollt|will|willst|wollen|wollt|darf|darfst|dürfen|dürft)\s+"
    rf"(?P<subject>{PRONOUNS})\b",
    re.IGNORECASE,
)
SUBORDINATE_CONDITION = re.compile(
    rf"(?:Wenn|Falls)\b(?:\s+[\wÄÖÜäöüß-]+){{1,12}}?\s+"
    rf"(?P<verb>kann|kannst|können|könnt|könnte|könnten|muss|musst|müssen|müsst|soll|sollst|sollte|solltest|sollen|sollt|will|willst|wollen|wollt|darf|darfst|dürfen|dürft|würde|würden)\s+"
    rf"(?P<subject>{PRONOUNS})\b",
    re.IGNORECASE,
)
APPOSITION = re.compile(
    r"\b(?:Mein|Meine|Unser|Unsere|Sein|Seine|Ihr|Ihre|Der|Die|Das|Ein|Eine)\s+"
    r"(?:[\wÄÖÜäöüß-]+\s+){0,2}[A-ZÄÖÜ][\wÄÖÜäöüß-]*\s+(?P<leftcomma>,)?\s*"
    r"(?P<app>(?:ein|eine|einen|einem|einer)\s+"
    r"(?:[\wÄÖÜäöüß-]+\s+){1,2}[\wÄÖÜäöüß-]+)\s*"
    r"(?P<rightcomma>,)?\s+(?P<verb>" + FINITE_PATTERN + r")\b",
)
NAME_APPOSITION = re.compile(
    r"\b(?P<head>[A-ZÄÖÜ][\wÄÖÜäöüß-]*)\s+(?P<leftcomma>,)?\s*"
    r"(?P<app>(?:ein|eine|einen|einem|einer)\s+"
    r"(?:[\wÄÖÜäöüß-]+\s+){1,2}[\wÄÖÜäöüß-]+)\s*"
    r"(?P<rightcomma>,)?\s+(?P<verb>" + FINITE_PATTERN + r")\b",
)


def looks_finite(word: str) -> bool:
    return word.lower() in FINITE_VERBS


def _match(offset: int, rule_id: str, message: str) -> dict:
    return {
        "message": message,
        "shortMessage": "Zusatzregel: Komma prüfen",
        "replacements": [{"value": ","}],
        "offset": offset,
        "length": 0,
        "rule": {
            "id": rule_id,
            "description": "Lokale Zusatzregel zur Kommaprüfung",
            "issueType": "typographical",
            "category": {"id": "PUNCTUATION", "name": "Zeichensetzung"},
        },
    }


def check(text: str) -> list[dict]:
    """Return cautious comma candidates; do not alter the source text."""
    found: list[dict] = []

    for match in re.finditer(r"\baber\b", text, re.IGNORECASE):
        offset = match.start()
        if offset == 0 or text[:offset].rstrip().endswith((",", ";", ":", ".", "!", "?")):
            continue
        prior = text[max(text.rfind(mark, 0, offset) for mark in ".!?\n") + 1:offset]
        after = SUBJECT_VERB.match(text, match.end())
        if after and looks_finite(after.group("verb")) and any(
            looks_finite(word) for word in re.findall(r"[\wÄÖÜäöüß-]+", prior)
        ):
            found.append(_match(
                offset,
                "LOCAL_COMMA_BEFORE_ABER",
                "Möglicherweise fehlt ein Komma vor «aber» zwischen zwei Hauptsätzen.",
            ))

    for sentence in re.finditer(r"[^.!?\n]+", text):
        raw_sentence = sentence.group(0)
        for pattern, rule_id, message in (
            (INITIAL_CONDITION, "LOCAL_COMMA_AFTER_INITIAL_CONDITION", "Möglicherweise fehlt ein Komma nach einem vorangestellten Bedingungssatz."),
            (SUBORDINATE_CONDITION, "LOCAL_COMMA_AFTER_SUBORDINATE_CONDITION", "Möglicherweise fehlt ein Komma nach einem vorangestellten Wenn- oder Falls-Satz."),
        ):
            for candidate in pattern.finditer(raw_sentence):
                prefix = raw_sentence[:candidate.start()].rstrip()
                if prefix and not prefix.endswith((":", "«", "„", '"', "'")):
                    continue
                found.append(_match(
                    sentence.start() + candidate.start("verb"),
                    rule_id,
                    message,
                ))

    for pattern in (APPOSITION, NAME_APPOSITION):
        for match in pattern.finditer(text):
            if looks_finite(match.group("verb")):
                missing_offsets = []
                if not match.group("leftcomma"):
                    missing_offsets.append(match.start("app"))
                if not match.group("rightcomma"):
                    missing_offsets.append(match.start("verb"))
                for offset in missing_offsets:
                    found.append(_match(
                        offset,
                        "LOCAL_COMMA_AROUND_APPOSITION",
                        "Möglicherweise fehlen Kommas um eine nachgestellte Erläuterung.",
                    ))

    unique = {(item["rule"]["id"], item["offset"]): item for item in found}
    matches = list(unique.values())
    for item in matches:
        item["offset"] = len(text[:item["offset"]].encode("utf-16-le")) // 2
    return sorted(matches, key=lambda item: item["offset"])
