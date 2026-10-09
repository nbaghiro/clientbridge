from datetime import time

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.parametrize(
    "values",
    [
        {"weekday": 42},
        {"weekday": None},
        {"start_time": time(19), "end_time": time(9)},
        {"end_time": None},
        {"basis": "date", "date": None},
        {"reason": "exception fields are command-only"},
    ],
)
async def test_database_rejects_invalid_hours(db: AsyncSession, values: dict[str, object]) -> None:
    from sqlalchemy.exc import IntegrityError

    assignments = ", ".join(f"{key} = :{key}" for key in values)
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            await db.execute(
                text(f"UPDATE hours SET {assignments} WHERE id = 'av_st_diego_1'"), values
            )
