from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.models.business import Business
from clientbridge.models.messaging import Message, Thread
from tests.conftest import Factory

BIZ = "bz_birchbark"
START = datetime(2023, 3, 6, 15, tzinfo=UTC)


async def _thread(db: AsyncSession, business_id: str = BIZ) -> str:
    business = await db.get(Business, business_id)
    assert business is not None
    client = await Factory(db).client(business=business)
    thread = Thread(
        id=f"th_{client.id}", business_id=business_id, client_id=client.id, channel="sms"
    )
    db.add(thread)
    await db.flush()
    for n in range(3):
        db.add(
            Message(
                id=f"ms_{client.id}_{n}",
                business_id=business_id,
                thread_id=thread.id,
                direction="out" if n % 2 else "in",
                channel="sms",
                sent_by="us_dev" if n % 2 else None,
                body=f"message {n}",
                status="read",
                created_at=START + timedelta(days=n),
            )
        )
    await db.flush()
    return thread.id


async def test_older_messages_page_newest_first(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    thread = await _thread(db)
    before = (START + timedelta(days=10)).isoformat()
    first = await as_owner.get(
        f"/v1/threads/{thread}/messages", params={"before": before, "limit": 2}
    )
    assert first.status_code == 200, first.text
    page = first.json()
    assert [m["body"] for m in page["messages"]] == ["message 2", "message 1"]
    assert page["more"] is True
    assert page["messages"][1]["author"] is not None
    last = page["messages"][-1]
    rest = await as_owner.get(
        f"/v1/threads/{thread}/messages",
        params={"before": last["created_at"], "before_id": last["id"]},
    )
    assert [m["body"] for m in rest.json()["messages"]] == ["message 0"]
    assert rest.json()["more"] is False


async def test_any_member_reads_older_messages(
    as_staff: httpx.AsyncClient, db: AsyncSession
) -> None:
    thread = await _thread(db)
    res = await as_staff.get(
        f"/v1/threads/{thread}/messages",
        params={"before": (START + timedelta(days=10)).isoformat()},
    )
    assert res.status_code == 200, res.text
    assert len(res.json()["messages"]) == 3


async def test_another_business_thread_is_404(
    as_owner: httpx.AsyncClient, db: AsyncSession
) -> None:
    other = await Factory(db).business()
    thread = await _thread(db, other.id)
    res = await as_owner.get(f"/v1/threads/{thread}/messages", params={"before": START.isoformat()})
    assert res.status_code == 404


async def test_older_messages_require_auth_and_a_bounded_page(
    as_owner: httpx.AsyncClient, unauth: httpx.AsyncClient, db: AsyncSession
) -> None:
    thread = await _thread(db)
    url = f"/v1/threads/{thread}/messages"
    assert (
        await as_owner.get(url, params={"before": START.isoformat(), "limit": 101})
    ).status_code == 422
    unauth.headers.pop("X-Session-Token", None)
    assert (await unauth.get(url, params={"before": START.isoformat()})).status_code == 401
