from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from clientbridge.core.db import Base

DEMO_VERSION = "2026-10-08.1"
BUSINESS_TIMEZONE = ZoneInfo("America/Vancouver")


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
