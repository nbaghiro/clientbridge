import socket
import threading
from collections.abc import Iterator
from contextlib import contextmanager

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError
from clientbridge.integrations.resend import Email, SmtpEmailSender
from clientbridge.integrations.twilio import Sms, SmtpSmsSender
from clientbridge.models.messaging import Delivery
from clientbridge.schemas.deliveries import EmailDelivery, SmsDelivery
from clientbridge.services.deliveries import dispatch, enqueue
from tests.conftest import BIZ, FakeEmailSender, FakePushSender, FakeSmsSender

LOOPBACK = str(socket.getaddrinfo(None, 0, socket.AF_INET, socket.SOCK_STREAM)[0][4][0])
MAIL = EmailDelivery(message=Email(to="pat@example.ca", subject="Payment", body="Receipt"))


def _closed_port() -> int:
    with socket.socket() as probe:
        probe.bind((LOOPBACK, 0))
        return int(probe.getsockname()[1])


@contextmanager
def _smtp_server(
    *, rcpt: bytes = b"250 ok", after_data: bytes | None = b"250 queued"
) -> Iterator[int]:
    """One scripted SMTP session; `after_data=None` drops the line once the message is sent."""
    listener = socket.socket()
    listener.bind((LOOPBACK, 0))
    listener.listen(1)

    def serve() -> None:
        conn, _ = listener.accept()
        with conn, conn.makefile("rb") as lines:
            conn.sendall(b"220 test\r\n")
            for raw in lines:
                verb = raw[:4].upper()
                if verb in (b"EHLO", b"HELO"):
                    conn.sendall(b"250 test\r\n")
                elif verb == b"MAIL":
                    conn.sendall(b"250 ok\r\n")
                elif verb == b"RCPT":
                    conn.sendall(rcpt + b"\r\n")
                elif verb == b"RSET":
                    conn.sendall(b"250 ok\r\n")
                elif verb == b"DATA":
                    conn.sendall(b"354 go\r\n")
                    for body in lines:
                        if body == b".\r\n":
                            break
                    if after_data is None:
                        return
                    conn.sendall(after_data + b"\r\n")
                elif verb == b"QUIT":
                    conn.sendall(b"221 bye\r\n")
                    return

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield int(listener.getsockname()[1])
    finally:
        listener.close()
        thread.join(timeout=5)


async def _dispatch_mail(db: AsyncSession, port: int, key: str) -> Delivery:
    identity = await enqueue(db, MAIL, key=key, business_id=BIZ)
    await db.commit()
    sender = SmtpEmailSender(f"smtp://{LOOPBACK}:{port}", "no-reply@example.ca")
    await dispatch(db, identity, sender, FakeSmsSender(), FakePushSender())
    row = await db.get(Delivery, identity)
    assert row is not None
    await db.refresh(row)
    return row


async def test_a_refused_smtp_connection_is_retried(db: AsyncSession) -> None:
    row = await _dispatch_mail(db, _closed_port(), "smtp:refused")
    assert (row.state, row.error) == ("queued", "connection_unavailable")
    assert row.next_at is not None and row.claim is None


@pytest.mark.parametrize(
    ("rcpt", "after_data", "outcome"),
    [
        (b"451 try later", b"250 queued", ("queued", "smtp_451")),
        (b"550 no such mailbox", b"250 queued", ("failed", "smtp_550")),
        (b"250 ok", b"452 mailbox full", ("queued", "smtp_452")),
        (b"250 ok", b"250 queued", ("accepted", None)),
        (b"250 ok", None, ("ambiguous", "delivery_unconfirmed")),
    ],
)
async def test_an_smtp_reply_decides_whether_the_message_was_accepted(
    db: AsyncSession, rcpt: bytes, after_data: bytes | None, outcome: tuple[str, str | None]
) -> None:
    with _smtp_server(rcpt=rcpt, after_data=after_data) as port:
        row = await _dispatch_mail(db, port, f"smtp:{rcpt[:3].decode()}:{after_data!r}")
    assert (row.state, row.error) == outcome
    assert (row.next_at is not None) == (outcome[0] == "queued")


async def test_a_text_the_provider_never_received_is_retried(
    db: AsyncSession, sms: FakeSmsSender, push: FakePushSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    text = SmsDelivery(message=Sms(to="+12505551234", body="Reminder", from_number="+12365550190"))
    identity = await enqueue(db, text, key="sms:refused", business_id=BIZ)
    await db.commit()

    async def unreachable(_: Sms) -> str | None:
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(sms, "send", unreachable)
    sender = SmtpEmailSender(f"smtp://{LOOPBACK}:{_closed_port()}", "no-reply@example.ca")
    await dispatch(db, identity, sender, sms, push)
    row = await db.get(Delivery, identity)
    assert row is not None and (row.state, row.error) == ("queued", "connection_unavailable")


async def test_a_dev_text_lands_in_its_numbers_inbox_under_the_run(
    email: FakeEmailSender, monkeypatch: pytest.MonkeyPatch
) -> None:
    sender = SmtpSmsSender(email)
    await sender.send(Sms(to="+1 (250) 555-1234", body="Code 123456", from_number="+12365550190"))
    await sender.send(Sms(to="+12505550142", body="Demo", from_number="+12365550190"))
    monkeypatch.setattr(get_settings(), "run_namespace", "0042")
    await sender.send(Sms(to="+12505551234", body="Reminder", from_number="+12365550190"))
    await sender.send(Sms(to="+12505550142", body="Fiction", from_number="+12365550190"))
    assert [(m.to, m.body) for m in email.sent] == [
        ("12505551234@sms.test", "Code 123456"),
        ("12505550142@sms.test", "Demo"),
        ("12505551234+0042@sms.test", "Reminder"),
        ("12505550142+0042@sms.invalid", "Fiction"),
    ]
    with pytest.raises(AppError) as unassigned:
        await sender.send(Sms(to="+12505551234", body="Hi"))
    assert unassigned.value.code == "sms_unassigned"
