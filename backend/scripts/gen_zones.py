"""Write the frontend's bundled zone table and its parity cases from the backend's tzdata."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from clientbridge.core.zones import SUPPORTED_ZONES, TZDATA_VERSION, transitions, zone

APP_CORE = Path(__file__).resolve().parents[2] / "frontend" / "packages" / "app-core" / "src"
CASE_YEARS = range(2024, 2031)


def table() -> str:
    zones = {name: [list(t) for t in transitions(name)] for name in SUPPORTED_ZONES}
    body = json.dumps({"version": TZDATA_VERSION, "zones": zones})
    names = json.dumps(list(SUPPORTED_ZONES))
    return (
        "// Generated from the backend's tzdata by `make gen-zones`; edit core/zones.py.\n"
        'import type { ZoneTable } from "./datetime";\n\n'
        f"export const SUPPORTED_ZONES = {names} as const;\n\n"
        "export type SupportedZone = (typeof SUPPORTED_ZONES)[number];\n\n"
        f"export const BUNDLED_ZONES: ZoneTable = {body};\n"
    )


def wall(moment: datetime, name: str) -> str:
    return moment.astimezone(zone(name)).strftime("%Y-%m-%dT%H:%M")


def cases() -> list[dict[str, object]]:
    """Instants around each offset change and noon beside it, as the server's clock reads them."""
    found: list[dict[str, object]] = []
    for name in SUPPORTED_ZONES:
        for second, _ in transitions(name):
            change = datetime.fromtimestamp(second, UTC)
            if change.year not in CASE_YEARS:
                continue
            for step in (-60, 0, 60):
                moment = change + timedelta(seconds=step)
                found.append(
                    {"zone": name, "at": second * 1000 + step * 1000, "wall": wall(moment, name)}
                )
            for days in (-1, 1):
                noon = (
                    (change + timedelta(days=days))
                    .astimezone(zone(name))
                    .replace(hour=12, minute=0)
                )
                found.append(
                    {"zone": name, "at": int(noon.timestamp()) * 1000, "wall": wall(noon, name)}
                )
        for year in CASE_YEARS:
            for month in (1, 7):
                noon = datetime(year, month, 1, 12, tzinfo=zone(name))
                found.append(
                    {"zone": name, "at": int(noon.timestamp()) * 1000, "wall": wall(noon, name)}
                )
    return found


def main() -> None:
    (APP_CORE / "zones.ts").write_text(table())
    (APP_CORE / "zones.cases.json").write_text(json.dumps(cases(), indent=4) + "\n")


if __name__ == "__main__":
    main()
