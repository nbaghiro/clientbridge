"""The shape of real Stripe event objects, recorded by the sandbox run and checked against fakes."""

import json
from collections.abc import Mapping
from pathlib import Path

RECORDINGS = Path(__file__).parents[1] / "tests" / "fixtures" / "stripe_events"

# a scalar is its kinds joined by "|", a list holds the shape of its items, a dict is an object
type Shape = str | list[Shape] | dict[str, Shape]


def _kind(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


def shape(value: object) -> Shape:
    if isinstance(value, Mapping):
        fields: Mapping[object, object] = value
        # metadata holds whatever keys the caller set, so it is recorded as an open object
        return {
            str(key): {} if key == "metadata" else shape(item)
            for key, item in sorted(fields.items(), key=str)
        }
    if isinstance(value, list):
        entries: list[object] = value
        found: list[Shape] = []
        for entry in entries:
            found = [shape(entry) if not found else merge(found[0], shape(entry))]
        return found
    return _kind(value)


def merge(first: Shape, second: Shape) -> Shape:
    """One shape that admits both; null merges into anything, since a fake may always send null."""
    if first == "null":
        return second
    if second == "null":
        return first
    if isinstance(first, dict) and isinstance(second, dict):
        return {
            key: merge(first.get(key, "null"), second.get(key, "null"))
            for key in sorted(set(first) | set(second))
        }
    if isinstance(first, list) and isinstance(second, list):
        if not first or not second:
            return first or second
        return [merge(first[0], second[0])]
    if isinstance(first, str) and isinstance(second, str):
        return "|".join(sorted(set(first.split("|")) | set(second.split("|"))))
    return "mixed"


def differences(fake: object, real: Shape, path: str = "") -> list[str]:
    """Where a fake object has a field real Stripe doesn't send, or sends with another type."""
    # only ever seen as null or as an empty object (metadata), so any value is plausible
    if fake is None or real in ("mixed", "null", {}):
        return []
    if isinstance(real, dict):
        if not isinstance(fake, Mapping):
            return [f"{path or '.'}: real Stripe sends an object, the fake sends {_kind(fake)}"]
        fields: Mapping[object, object] = fake
        problems: list[str] = []
        for key, value in fields.items():
            if str(key) in real:
                problems.extend(differences(value, real[str(key)], f"{path}.{key}"))
            else:
                problems.append(f"{path}.{key}: real Stripe doesn't send this field")
        return problems
    if isinstance(real, list):
        if not isinstance(fake, list):
            return [f"{path}: real Stripe sends a list, the fake sends {_kind(fake)}"]
        entries: list[object] = fake
        if not real:
            return []
        return [
            problem for entry in entries for problem in differences(entry, real[0], path + "[]")
        ]
    kinds = set(real.split("|"))
    actual = (
        "object" if isinstance(fake, Mapping) else "list" if isinstance(fake, list) else _kind(fake)
    )
    if actual in kinds or (actual == "integer" and "number" in kinds):
        return []
    return [f"{path}: real Stripe sends {real}, the fake sends {actual}"]


def recorded(event_type: str, folder: Path = RECORDINGS) -> Shape | None:
    path = folder / f"{event_type}.json"
    if not path.exists():
        return None
    loaded: Shape = json.loads(path.read_text())
    return loaded


def record(event_type: str, obj: object, folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    found = recorded(event_type, folder)
    merged = shape(obj) if found is None else merge(found, shape(obj))
    (folder / f"{event_type}.json").write_text(json.dumps(merged, indent=2) + "\n")


def removed(committed: Shape, fresh: Shape, path: str = "") -> list[str]:
    """What the committed recording has that tonight's real Stripe responses no longer show."""
    if fresh == "null":
        return []
    if isinstance(committed, dict):
        if not isinstance(fresh, dict):
            return [f"{path or '.'}: was an object, now {fresh}"]
        return [
            problem
            for key, value in committed.items()
            for problem in (
                removed(value, fresh[key], f"{path}.{key}")
                if key in fresh
                else [f"{path}.{key}: no longer sent"]
            )
        ]
    if isinstance(committed, list):
        if not isinstance(fresh, list):
            return [f"{path}: was a list, now {fresh}"]
        return removed(committed[0], fresh[0], path + "[]") if committed and fresh else []
    if not isinstance(fresh, str):
        return [f"{path}: was {committed}, now an object or list"]
    lost = set(committed.split("|")) - set(fresh.split("|")) - {"null"}
    return [f"{path}: no longer sent as {'|'.join(sorted(lost))}"] if lost else []
