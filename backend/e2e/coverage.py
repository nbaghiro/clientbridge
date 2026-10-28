"""Count the audit families the registered cases cover, partly cover or leave open, by priority."""

from pydantic import BaseModel

from e2e.results import CASES
from e2e.tier import ROOT

FAMILIES = ROOT / ".docs" / "executions" / "e2e" / "families.json"
STATES = ("covered", "partial", "open")


class Audit(BaseModel):
    priority: str


class Family(BaseModel):
    id: str
    status: str
    audit: Audit


class Families(BaseModel):
    families: list[Family]


def families() -> list[Family]:
    return Families.model_validate_json(FAMILIES.read_bytes()).families


def state(family: Family, verified: set[str]) -> str:
    """Partial once a verified case names it; covered only once the family itself is verified."""
    if family.id not in verified:
        return "open"
    return "covered" if family.status == "verified" else "partial"


def totals() -> dict[str, dict[str, int]]:
    verified = {
        name for case in CASES.values() if case.status == "verified" for name in case.families
    }
    counts: dict[str, dict[str, int]] = {}
    for family in families():
        for group in (family.audit.priority, "all"):
            counts.setdefault(group, dict.fromkeys(STATES, 0))[state(family, verified)] += 1
    return {group: counts[group] for group in [*sorted(set(counts) - {"all"}), "all"]}


def main() -> None:
    print(f"{'priority':<16}" + "".join(f"{name:>9}" for name in STATES))
    for group, count in totals().items():
        print(f"{group:<16}" + "".join(f"{count[name]:>9}" for name in STATES))


if __name__ == "__main__":
    main()
