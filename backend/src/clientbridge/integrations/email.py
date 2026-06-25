"""Email adapter — the template for every external-service boundary (see .docs/testing.md).

Production implements `EmailSender`; tests override `get_email_sender` with a recording fake, so our
logic up to the wire is covered without the network.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


class EmailSender(Protocol):
    async def send(self, email: Email) -> None: ...


class ConsoleEmailSender:
    """Default impl — no real delivery yet (a real provider lands in P5/P7)."""

    async def send(self, email: Email) -> None:
        return None


def get_email_sender() -> EmailSender:
    """FastAPI dependency; tests override it with a recording fake."""
    return ConsoleEmailSender()
