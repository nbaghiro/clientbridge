"""Regenerate messages.pot from the code and en_XA.po from en_CA.po; fail when en_CA.po drifts."""

import io
import sys
from pathlib import Path

from babel.messages.catalog import Catalog
from babel.messages.extract import extract_from_dir
from babel.messages.pofile import read_po, write_po

from clientbridge.core.locale import LOCALES, PSEUDO_LOCALE, SOURCE_LOCALE, pseudo

PACKAGE = LOCALES.parent
MessageId = str | tuple[str, ...]


def extracted() -> Catalog:
    catalog = Catalog()
    for keyword, counted in (("message", False), ("plural", True)):
        for _, _, key, _, _ in extract_from_dir(
            PACKAGE, method_map=[("**.py", "python")], keywords={keyword: (2,)}
        ):
            if isinstance(key, str):
                catalog.add((key, key) if counted else key)
    return catalog


def ids(catalog: Catalog) -> set[MessageId]:
    return {m.id if isinstance(m.id, str) else tuple(m.id) for m in catalog if m.id}


def write(path: Path, catalog: Catalog) -> None:
    buffer = io.BytesIO()
    write_po(buffer, catalog, width=0, omit_header=True, sort_output=True, no_location=True)
    path.write_bytes(buffer.getvalue())


def main() -> int:
    template = extracted()
    with (LOCALES / f"{SOURCE_LOCALE}.po").open("rb") as file:
        source = read_po(file, locale=SOURCE_LOCALE)
    used, defined = ids(template), ids(source)
    problems = [
        f"missing from {SOURCE_LOCALE}.po: {key}" for key in sorted(map(str, used - defined))
    ]
    problems += [f"unused in {SOURCE_LOCALE}.po: {key}" for key in sorted(map(str, defined - used))]
    pseudo_catalog = Catalog(locale=PSEUDO_LOCALE)
    for entry in source:
        if not entry.id:
            continue
        forms = (entry.string,) if isinstance(entry.string, str) else tuple(entry.string or "")
        if not forms or not all(forms):
            problems.append(f"empty message in {SOURCE_LOCALE}.po: {entry.id}")
        translated = tuple(pseudo(form) for form in forms)
        pseudo_catalog.add(entry.id, translated if entry.pluralizable else translated[0])
    write(LOCALES / "messages.pot", template)
    write(LOCALES / f"{PSEUDO_LOCALE}.po", pseudo_catalog)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
