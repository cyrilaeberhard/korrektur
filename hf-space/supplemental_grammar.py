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
    "arbeite", "arbeitest", "arbeitet", "arbeiten", "arbeitete", "arbeiteten", "forderte", "forderten", "trug", "trugen",
    "spiele", "spielst", "spielt", "spielen", "spieltet", "spielte", "spielten",
    "komme", "kommst", "kommt", "kommen", "kam", "kamen",
    "bringe", "bringst", "bringt", "bringen", "brachte", "brachten",
    "lerne", "lernst", "lernt", "lernen", "lernte", "lernten",
    "gehe", "gehst", "geht", "gehen", "ging", "gingen",
    "mache", "machst", "macht", "machen", "machte", "machten",
    "sage", "sagst", "sagt", "sagen", "sagte", "sagten",
    "spreche", "sprichst", "spricht", "sprechen", "sprach", "sprachen",
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


def _replacement(start: int, end: int, value: str, rule_id: str, message: str) -> dict:
    """Return a LanguageTool-style replacement suggestion for a local rule."""
    item = _match(start, rule_id, message)
    if rule_id.startswith("LOCAL_SPELLING"):
        item["rule"]["issueType"] = "misspelling"
        item["rule"]["category"] = {"id": "TYPOS", "name": "Rechtschreibung"}
    elif not rule_id.startswith(("LOCAL_COMMA", "LOCAL_COLON")):
        item["rule"]["issueType"] = "grammar"
        item["rule"]["category"] = {"id": "GRAMMAR", "name": "Grammatik"}
    item["offset"] = start
    item["length"] = end - start
    item["replacements"] = [{"value": value}]
    return item


def _punctuation(text: str, offset: int, value: str, rule_id: str, message: str) -> dict:
    """Insert punctuation before existing spaces so applying it preserves spacing."""
    while offset > 0 and text[offset - 1].isspace():
        offset -= 1
    return _replacement(offset, offset, value, rule_id, message)


def check(text: str) -> list[dict]:
    """Return cautious local grammar and spelling candidates without changing text."""
    found: list[dict] = []

    # High-confidence patterns from recurring student errors. Context keeps
    # valid homonyms and quotations out of these replacements.
    contextual_fixes = (
        (r"\bLebensstiel\b", "Lebensstil", "LOCAL_SPELLING", "Hier ist «Lebensstil» gemeint."),
        (r"\bgeschrieben\s+bei(?=\s+[A-ZÄÖÜ])", "geschrieben von", "LOCAL_WORD_CHOICE", "Bei der Urheberschaft steht «von»."),
        (r"\bhandelt\s+es\s+um\b", "handelt es sich um", "LOCAL_REFLEXIVE_VERB", "Die feste Wendung lautet «es handelt sich um»."),
        (r"\bweine(?=\s+[A-ZÄÖÜ])", "eine", "LOCAL_SPELLING", "Vor einem Nomen passt hier «eine»."),
        (r"\bentschiedet\b", "entschied sich", "LOCAL_VERB_FORM", "Die Vergangenheitsform lautet «entschied sich»."),
        (r"\büberlasen(?=\s+(?:haben|hatten)\b)", "überlassen", "LOCAL_SPELLING", "Hier ist das Partizip «überlassen» gemeint."),
        (r"\bden\s+(?:Schicksal|Kind|Haus|Buch|Leben|Mädchen|Auto|Geld)\b", "das", "LOCAL_CASE_AND_GENDER", "Das Nomen ist sächlich; prüfe den Artikel."),
    )
    for pattern, replacement, rule_id, message in contextual_fixes:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            match_replacement = replacement
            if text[match.start()].isupper() and match_replacement and match_replacement[0].islower():
                match_replacement = match_replacement[0].upper() + match_replacement[1:]
            if rule_id == "LOCAL_CASE_AND_GENDER":
                found.append(_replacement(match.start(), match.start() + 3, match_replacement, rule_id, message))
                continue
            found.append(_replacement(match.start(), match.end(), match_replacement, rule_id, message))

    # «nicht X, sondern auch» braucht «nicht nur».
    for match in re.finditer(
        r"\bnicht\s+(?!nur\b|mehr\b|zu\b|so\b|ganz\b|immer\b|ein\w*\b|kein\w*\b)(?P<word>[\wÄÖÜäöüß-]+)(?=\s*,?\s+sondern\s+auch\b)",
        text, re.IGNORECASE,
    ):
        found.append(_replacement(
            match.start(), match.end(), f"nicht nur {match.group('word')}",
            "LOCAL_NOT_ONLY_BUT_ALSO", "Zu «sondern auch» gehört «nicht nur …».",
        ))

    # «nach dem» vor Pronomen und finitem Hilfsverb ist meist die Konjunktion «nachdem».
    for match in re.finditer(
        rf"\bnach\s+dem(?=\s+{PRONOUNS}\s+(?:[\wÄÖÜäöüß-]+\s+){{0,3}}(?:hat|hatte|habe|ist|war|bin)\b)",
        text, re.IGNORECASE,
    ):
        if not text[:match.start()].rstrip().endswith(","):
            found.append(_replacement(
                match.start(), match.end(), "nachdem",
                "LOCAL_SUBORDINATING_CONJUNCTION", "Als Konjunktion wird «nachdem» zusammengeschrieben.",
            ))

    # Verben mit Stammvokalwechsel: nach er/sie/es steht nicht die ihr-Form.
    third_person = {
        "schlaft": "schläft", "lauft": "läuft", "fahrt": "fährt", "tragt": "trägt",
        "lasst": "lässt", "nehmt": "nimmt", "sprecht": "spricht", "helft": "hilft",
        "gebt": "gibt", "esst": "isst", "lest": "liest", "seht": "sieht",
    }
    for match in re.finditer(
        r"\b(?:er|sie|es)\s+(?:(?:auch|sogar|dann|oft|nie|nicht|immer|schon)\s+)?(?P<verb>" + "|".join(third_person) + r")\b",
        text, re.IGNORECASE,
    ):
        verb = match.group("verb")
        found.append(_replacement(
            match.start("verb"), match.end("verb"), third_person[verb.lower()],
            "LOCAL_SPELLING", f"Zu «er/sie/es» passt «{third_person[verb.lower()]}».",
        ))

    # «ist/war einen X geworden»: mit «werden» steht «zu einem» oder der Nominativ.
    for match in re.finditer(
        r"\b(?:ist|war|sind|waren)\s+(?P<art>einen)\s+(?:[\wÄÖÜäöüß-]+\s+)?[\wÄÖÜäöüß-]+\s+geworden\b",
        text, re.IGNORECASE,
    ):
        found.append(_replacement(
            match.start("art"), match.end("art"), "zu einem",
            "LOCAL_CASE_AND_COMPLEMENT", "Mit «werden» steht hier «zu einem».",
        ))

    # Selected dative patterns with "helfen". The noun list avoids guessing
    # whether an ambiguous plural such as "den Leuten" is wrong.
    help_forms = r"(?:helfe|helfest|hilfst|hilft|helfen|helft|half|halfen|halfst|halft)"
    help_nouns = r"(?:Schüler|Mann|Freund|Lehrer)"
    for match in re.finditer(
        rf"\b{help_forms}\b(?:\s+[\wÄÖÜäöüß-]+){{0,3}}\s+den\s+(?P<noun>{help_nouns})\b",
        text,
        re.IGNORECASE,
    ):
        start = match.start("noun") - len("den ")
        found.append(_replacement(
            start, start + 3, "dem", "LOCAL_HELP_DATIVE",
            "«Helfen» verlangt hier den Dativ; prüfe «dem» statt «den».",
        ))
    for match in re.finditer(
        rf"\b(?:Der|Ein|Dieser|Jener)\s+{help_nouns},\s+(?P<article>den)\s+(?:{PRONOUNS})\s+(?:(?:gestern|heute|damals|oft|gerne|schon)\s+)?{help_forms}\b",
        text,
        re.IGNORECASE,
    ):
        found.append(_replacement(
            match.start("article"), match.end("article"), "dem", "LOCAL_HELP_DATIVE",
            "«Helfen» verlangt hier den Dativ; prüfe «dem» statt «den».",
        ))

    # Movement verbs normally take accusative with a two-way preposition.
    movement_verbs = r"(?:lege|legst|legt|legen|legte|legten|stelle|stellst|stellt|stellen|stellte|stellten|setze|setzt|setzen|setzte|setzten|hängte|hängten)"
    masculine_places = r"(?:Tisch|Boden|Stuhl|Schrank|Teller|Platz|Weg|Flur|Berg)"
    for match in re.finditer(
        rf"\b{movement_verbs}\b(?:(?!\b(?:und|aber|sondern|oder|bevor|während|weil|dass|wenn|obwohl|nachdem|sobald|bis)\b)[^.!?,\n]){{0,60}}?\b(?:auf|an|in|unter|über|vor|hinter|neben|zwischen)\s+(?P<article>dem)\s+(?P<noun>{masculine_places})\b",
        text,
        re.IGNORECASE,
    ):
        article = match.group("article")
        found.append(_replacement(
            match.start("article"), match.end("article"), "den",
            "LOCAL_DIRECTIONAL_ACCUSATIVE",
            "Bei einer Bewegung steht nach dieser Wechselpräposition meist der Akkusativ.",
        ))

    # Main-clause verb-second order after a short fronted time adverb.
    for match in re.finditer(
        rf"\b(?P<adverb>Morgen|Heute|Gestern|Danach|Dann|Später)\s+(?P<subject>{PRONOUNS})\s+(?P<verb>[\wÄÖÜäöüß-]+)\b",
        text,
    ):
        if looks_finite(match.group("verb")):
            found.append(_replacement(
                match.start("subject"), match.end("verb"),
                f"{match.group('verb')} {match.group('subject')}",
                "LOCAL_MAIN_CLAUSE_VERB_SECOND",
                "Im Hauptsatz steht das finite Verb nach einem vorangestellten Satzglied an zweiter Stelle.",
            ))

    # In a dass-clause, move a recognized time adverb before the finite verb.
    for match in re.finditer(
        rf"\b(?:dass|weil|obwohl|wenn|als)\s+(?P<subject>{PRONOUNS})\s+(?P<verb>[\wÄÖÜäöüß-]+)\s+(?P<adverb>morgen|heute|gestern|bald|später)\b(?=[,.;:!?]|$)",
        text,
        re.IGNORECASE,
    ):
        if looks_finite(match.group("verb")):
            found.append(_replacement(
                match.start("verb"), match.end("adverb"),
                f"{match.group('adverb')} {match.group('verb')}",
                "LOCAL_SUBORDINATE_VERB_FINAL",
                "Im Nebensatz steht das finite Verb am Ende.",
            ))

    # A subordinate clause introduced by "dass" needs both spelling and comma.
    reporting_verbs = r"(?:hoffe|hoffst|hofft|hoffen|glaube|glaubst|glaubt|glauben|denke|denkst|denkt|denken|meine|meinst|meint|meinen|vermute|vermutest|vermutet|vermuten|weiss|weisst|weiss|wissen)"
    for match in re.finditer(
        rf"\b{reporting_verbs}\s+(?P<das>das)\s+(?P<subject>{PRONOUNS})\s+(?P<verb>[\wÄÖÜäöüß-]+)\b",
        text,
        re.IGNORECASE,
    ):
        start, end = match.span("das")
        found.append(_replacement(
            start, end, "dass", "LOCAL_DASS_CONJUNCTION",
            "Hier leitet «dass» einen Nebensatz ein.",
        ))
        prefix = text[:start]
        if not prefix.rstrip().endswith(","):
            found.append(_punctuation(
                text, start, ",", "LOCAL_COMMA_BEFORE_DASS",
                "Vor dem mit «dass» eingeleiteten Nebensatz fehlt ein Komma.",
            ))

    # Collective noun as subject: suggest singular agreement for this common form.
    collective_singulars = {
        "waren": "war", "sind": "ist", "haben": "hat", "werden": "wird",
        "wurden": "wurde", "gingen": "ging", "gehen": "geht",
    }
    for match in re.finditer(
        r"\bEine Gruppe von(?:\s+[\wÄÖÜäöüß-]+){1,6}\s+(?P<verb>waren|sind|haben|werden|wurden|gingen|gehen)\b",
        text,
        re.IGNORECASE,
    ):
        verb = match.group("verb")
        found.append(_replacement(
            match.start("verb"), match.end("verb"), collective_singulars[verb.lower()],
            "LOCAL_COLLECTIVE_SINGULAR",
            "Bei «Eine Gruppe von …» passt der Singular zum Subjekt; Plural nach den Mitgliedern kommt ebenfalls vor.",
        ))

    for match in re.finditer(r"\baber\b", text, re.IGNORECASE):
        offset = match.start()
        if offset == 0 or text[:offset].rstrip().endswith((",", ";", ":", ".", "!", "?")):
            continue
        prior = text[max(text.rfind(mark, 0, offset) for mark in ".!?\n") + 1:offset]
        after = SUBJECT_VERB.match(text, match.end())
        after_inverted = re.match(rf"\s*(?P<verb>[\wÄÖÜäöüß-]+)\s+(?P<subject>{PRONOUNS})\b", text[match.end():], re.IGNORECASE)
        after_inverted = after_inverted or re.match(
            rf"(?:(?![,.;!?])\s+[\wÄÖÜäöüß-]+){{0,5}}\s+(?P<verb>{FINITE_PATTERN})\s+(?P<subject>{PRONOUNS})\b",
            text[match.end():], re.IGNORECASE,
        )
        right_is_clause = bool(
            after and looks_finite(after.group("verb"))
            or after_inverted and looks_finite(after_inverted.group("verb"))
        )
        prior_words = re.findall(r"[\wÄÖÜäöüß-]+", prior)
        prior_has_finite = any(looks_finite(word) for word in prior_words)
        if after_inverted and len(prior_words) >= 3 and any(
            word.lower().endswith(("te", "ten", "test", "tet", "ete", "eten")) for word in prior_words
        ):
            prior_has_finite = True
        if right_is_clause and prior_has_finite:
            found.append(_punctuation(
                text, offset, ",",
                "LOCAL_COMMA_BEFORE_ABER",
                "Möglicherweise fehlt ein Komma vor «aber» zwischen zwei Hauptsätzen.",
            ))

        # Adversative coordination can also join phrases without a new subject.
        # The narrow NP pattern catches «X, aber keine Y».
        left = text[max(0, offset - 100):offset]
        right = text[match.end():match.end() + 90]
        if re.search(r"\b(?:[\wÄÖÜäöüß-]+\s+){0,3}[\wÄÖÜäöüß-]+\s*$", left) and re.match(
            r"\s+(?:keine?|keinen?|keinem|keiner|nicht|nur)\s+\w+", right, re.IGNORECASE
        ):
            found.append(_punctuation(text, offset, ",", "LOCAL_COMMA_BEFORE_ABER", "Vor dem gegensätzlichen «aber» fehlt möglicherweise ein Komma."))

    # Relative clauses introduced by «wo» need a preceding comma.
    for match in re.finditer(r"(?P<before>\b(?:weiter|dort|da|Ort|Stelle|Weg|Haus|Zimmer|Zeit))\s+(?P<wo>wo)\s+(?=(?:er|sie|es|ich|wir|man)\s+(?:[\wÄÖÜäöüß-]+\s+){0,4}(?:hat|hatte|habe|ist|war|wird|wurde|kann|muss|will|ging|kam|macht|sagt|meint)\b)", text, re.IGNORECASE):
        found.append(_punctuation(text, match.start("wo"), ",", "LOCAL_COMMA_BEFORE_WO_CLAUSE", "Vor dem mit «wo» eingeleiteten Relativsatz fehlt ein Komma."))

    for match in re.finditer(rf"\bbis\s+(?P<subject>{PRONOUNS})\s+(?:[\wÄÖÜäöüß-]+\s+){{0,9}}(?P<verb>{FINITE_PATTERN})\b", text, re.IGNORECASE):
        if not text[:match.start()].rstrip().endswith(","):
            found.append(_punctuation(text, match.start(), ",", "LOCAL_COMMA_BEFORE_BIS_CLAUSE", "Vor dem mit «bis» eingeleiteten Nebensatz fehlt ein Komma."))

    # Infinitive groups introduced by «um ... zu» require a comma.
    for match in re.finditer(r"\bum\b(?:(?![.!?;\n])[^,]){1,70}?\bzu\s+[\wÄÖÜäöüß-]+\b", text, re.IGNORECASE):
        start = match.start()
        if start > 0 and text[:start].rstrip().endswith(","):
            continue
        if re.search(r"\b(?:sein|haben|werden|können|müssen|sollen|wollen|machen|scheinen|beginnen|versuchen|helfen|bleiben|gross|klein)\b", text[max(0, start - 70):start], re.IGNORECASE):
            found.append(_punctuation(text, start, ",", "LOCAL_COMMA_BEFORE_UM_ZU", "Vor der «um … zu»-Infinitivgruppe fehlt ein Komma."))

    # Comma before direct reported speech and after its closing quote.
    for match in re.finditer(r"\b(?:sagte|meinte|fragte|antwortete|erwiderte|rief|schrieb|erklärte)\b(?:(?![,.;!?])\s+[\wÄÖÜäöüß-]+){0,2}(?=\s+«)", text, re.IGNORECASE):
        if not re.search(r":", text[match.end():text.find("«", match.end()) if "«" in text[match.end():] else match.end()]):
            found.append(_punctuation(text, match.end(), ":", "LOCAL_COLON_BEFORE_DIRECT_SPEECH", "Vor der direkten Rede steht nach einem Redebegleitsatz ein Doppelpunkt."))
    for match in re.finditer(r"»\s*(?P<verb>erwiderte|antwortete|meinte|sagte|fragte|rief)\b", text, re.IGNORECASE):
        if re.match(r"»\s*,", text[match.start():], re.IGNORECASE):
            continue
        found.append(_punctuation(text, match.start("verb"), ",", "LOCAL_COMMA_AFTER_DIRECT_SPEECH", "Nach der vorangestellten direkten Rede fehlt ein Komma."))

    # Reported clauses without «dass» need a comma before the clause.
    for match in re.finditer(r"\b(?:meinte|meinte|sagte|schrieb|erklärte|bemerkte|fühlte)\b(?:\s+[\wÄÖÜäöüß-]+){0,5}\s+(?P<subject>er|sie|ich|wir|man)\s+(?P<verb>sei|wäre|habe|hatte|wolle|könne|müsse|werde|sei|bleibe|habe|fühle)\b", text, re.IGNORECASE):
        start = match.start("subject")
        if not text[:start].rstrip().endswith((",", ":")):
            found.append(_punctuation(text, start, ",", "LOCAL_COMMA_BEFORE_REPORTED_CLAUSE", "Vor der indirekten Rede fehlt möglicherweise ein Komma."))

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

    apposition_heads = {
        "arzt", "ärztin", "autor", "autorin", "freund", "freundin", "lehrer", "lehrerin",
        "mann", "frau", "manager", "managerin", "schüler", "schülerin", "student", "studentin",
        "djane", "musiker", "musikerin", "politiker", "politikerin", "bruder", "schwester",
        "sohn", "tochter", "präsident", "präsidentin", "schauspieler", "schauspielerin",
    }
    for pattern in (APPOSITION, NAME_APPOSITION):
        for match in pattern.finditer(text):
            if looks_finite(match.group("verb")):
                app_words = re.findall(r"[\wÄÖÜäöüß-]+", match.group("app"))
                if not app_words or app_words[-1].lower() not in apposition_heads:
                    continue
                missing_offsets = []
                if not match.group("leftcomma"):
                    missing_offsets.append(match.start("app"))
                if not match.group("rightcomma"):
                    missing_offsets.append(match.start("verb"))
                for offset in missing_offsets:
                    found.append(_punctuation(
                        text, offset, ",",
                        "LOCAL_COMMA_AROUND_APPOSITION",
                        "Möglicherweise fehlen Kommas um eine nachgestellte Erläuterung.",
                    ))

    unique = {(item["rule"]["id"], item["offset"]): item for item in found}
    matches = list(unique.values())
    for item in matches:
        start = item["offset"]
        end = start + item["length"]
        item["offset"] = len(text[:start].encode("utf-16-le")) // 2
        item["length"] = len(text[:end].encode("utf-16-le")) // 2 - item["offset"]
    return sorted(matches, key=lambda item: item["offset"])
