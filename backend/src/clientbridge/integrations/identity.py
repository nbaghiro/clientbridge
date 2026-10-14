"""The auth service as the API sees it: who a session belongs to, behind one interface."""

import hashlib
from dataclasses import dataclass
from typing import Protocol

from clientbridge.core.emails import normalize_email
from clientbridge.core.errors import AppError


@dataclass(frozen=True)
class Identity:
    id: str
    email: str
    verified_emails: frozenset[str]
    name: str | None
    session_id: str
    second_factor: bool

    @property
    def email_verified(self) -> bool:
        return normalize_email(self.email) in self.verified_emails


@dataclass(frozen=True)
class Credential:
    session_token: str = ""
    cookie: str = ""

    def cache_key(self) -> str:
        raw = f"t:{self.session_token}" if self.session_token else f"c:{self.cookie}"
        return hashlib.sha256(raw.encode()).hexdigest()


class IdentityProvider(Protocol):
    async def whoami(self, credential: Credential, *, fresh: bool = False) -> Identity: ...

    async def identity_exists(self, identity_id: str) -> bool: ...

    async def find_identity(self, email: str) -> str | None: ...

    async def create_identity(self, email: str, name: str, password: str) -> str: ...


def unavailable() -> AppError:
    return AppError("identity service unavailable", code="identity_unavailable", status_code=503)
