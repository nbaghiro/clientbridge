import zoneinfo
from datetime import UTC, datetime, timedelta

import httpx

from clientbridge.core.zones import SUPPORTED_ZONES, TZDATA_VERSION, transitions, zone


def test_zone_data_is_the_pinned_package_with_bc_on_permanent_utc_minus_7() -> None:
    assert zoneinfo.TZPATH == ()
    december = datetime(2026, 12, 1, 12, tzinfo=zone("America/Vancouver"))
    assert december.utcoffset() == timedelta(hours=-7)


def test_transitions_agree_with_zoneinfo_every_day() -> None:
    for name in SUPPORTED_ZONES:
        rules = transitions(name)
        day = datetime(2000, 1, 1, 12, tzinfo=UTC)
        while day.year <= 2060:
            second = int(day.timestamp())
            offset = next(o for s, o in reversed(rules) if s <= second)
            expected = day.astimezone(zone(name)).utcoffset()
            assert expected is not None
            assert offset * 60 == expected.total_seconds(), (name, day)
            day += timedelta(days=1)


def test_each_change_lands_on_the_second_it_happens() -> None:
    for name in SUPPORTED_ZONES:
        for second, offset in transitions(name)[1:]:
            before = datetime.fromtimestamp(second - 1, UTC).astimezone(zone(name)).utcoffset()
            after = datetime.fromtimestamp(second, UTC).astimezone(zone(name)).utcoffset()
            assert before != after and after is not None
            assert after.total_seconds() == offset * 60


async def test_clients_read_the_table_without_signing_in(unauth: httpx.AsyncClient) -> None:
    res = await unauth.get("/v1/zones")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["version"] == TZDATA_VERSION
    assert list(body["zones"]) == list(SUPPORTED_ZONES)
    assert body["zones"]["America/Vancouver"][-1] == [1772964000, -420]
    assert "max-age" in res.headers["cache-control"]
