from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from clientbridge.core.db import Base

DEMO_VERSION = "2026-10-18.1"
BUSINESS_TIMEZONE = ZoneInfo("America/Vancouver")


@dataclass(frozen=True)
class LegalAddress:
    street_number: str
    street_name: str
    city: str
    province: str
    postal_code: str
    legal_phone: str


LEGAL_ADDRESSES = {
    "bz_birchbark": LegalAddress(
        "1207", "Government Street", "Victoria", "BC", "V8W 1Y9", "+12505550110"
    ),
    "bz_demo_second": LegalAddress(
        "455", "Granville Street", "Vancouver", "BC", "V6C 1T1", "+16045550120"
    ),
}


@dataclass
class DemoContext:
    now: datetime
    business_id: str
    owner_id: str
    rows: list[Base] = field(default_factory=list)

    def at(self, days: float, hour: int = 9, minute: int = 0) -> datetime:
        local = self.now.astimezone(BUSINESS_TIMEZONE) + timedelta(days=days)
        return local.replace(hour=hour, minute=minute, second=0, microsecond=0).astimezone(UTC)

    def all[T: Base](self, model: type[T]) -> list[T]:
        return [
            row
            for row in self.rows
            if isinstance(row, model)
            and getattr(row, "business_id", None) in {None, self.business_id}
        ]

    def get[T: Base](self, model: type[T], row_id: str) -> T:
        return next(row for row in self.all(model) if getattr(row, "id", None) == row_id)

    def add(self, *rows: Base) -> None:
        self.rows.extend(rows)
