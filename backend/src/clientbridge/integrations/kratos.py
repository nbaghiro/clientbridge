"""Identity: Ory Kratos sessions, plus the admin calls staff removal and the seed need."""

import hashlib
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Protocol

import httpx

from clientbridge.core.config import get_settings
from clientbridge.core.errors import AppError, Unauthorized

_EXTEND_WITHIN = timedelta(hours=24)
_CACHE_LIMIT = 10_000


@dataclass(frozen=True)
class Identity:
    id: str
    email: str
    verified_emails: frozenset[str]
    name: str | None
    session_id: str
    aal: str

    @property
    def email_verified(self) -> bool:
        return self.email.casefold() in self.verified_emails


@dataclass(frozen=True)
class Credential:
    session_token: str = ""
    cookie: str = ""

    def cache_key(self) -> str:
        raw = f"t:{self.session_token}" if self.session_token else f"c:{self.cookie}"
        return hashlib.sha256(raw.encode()).hexdigest()


class IdentityProvider(Protocol):
    async def whoami(self, credential: Credential) -> Identity: ...

    async def revoke_sessions(self, identity_id: str) -> None: ...


def unavailable() -> AppError:
    return AppError("identity service unavailable", code="identity_unavailable", status_code=503)


def _dict(value: object) -> dict[str, object]:
    return {str(k): v for k, v in value.items()} if isinstance(value, dict) else {}


def _str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def parse_session(payload: object) -> tuple[Identity, datetime | None]:
    session = _dict(payload)
    identity = _dict(session.get("identity"))
    traits = _dict(identity.get("traits"))
    identity_id, session_id, email = (
        _str(identity.get("id")),
        _str(session.get("id")),
        _str(traits.get("email")),
    )
    if not identity_id or not session_id or not email or session.get("active") is not True:
        raise Unauthorized("session expired", code="unauthenticated")
    addresses = identity.get("verifiable_addresses")
    verified = frozenset(
        value.casefold()
        for address in (addresses if isinstance(addresses, list) else [])
        if _dict(address).get("verified") is True and (value := _str(_dict(address).get("value")))
    )
    expires = _str(session.get("expires_at"))
    return (
        Identity(
            id=identity_id,
            email=email,
            verified_emails=verified,
            name=_str(traits.get("name")),
            session_id=session_id,
            aal=_str(session.get("authenticator_assurance_level")) or "aal1",
        ),
        datetime.fromisoformat(expires) if expires else None,
    )


class KratosIdentityProvider:
    def __init__(
        self,
        public_url: str,
        admin_url: str,
        cookie_name: str,
        cache_ttl_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._public = public_url.rstrip("/")
        self._admin = admin_url.rstrip("/")
        self._cookie_name = cookie_name
        self._ttl = cache_ttl_seconds
        self._cache: dict[str, tuple[float, Identity]] = {}
        self._http = httpx.AsyncClient(timeout=3.0, transport=transport)

    async def whoami(self, credential: Credential) -> Identity:
        key = credential.cache_key()
        cached = self._cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        headers = (
            {"X-Session-Token": credential.session_token}
            if credential.session_token
            else {"Cookie": f"{self._cookie_name}={credential.cookie}"}
        )
        response = await self._call("GET", f"{self._public}/sessions/whoami", headers=headers)
        if response.status_code == 403 and "session_aal2_required" in response.text:
            raise Unauthorized("second factor required", code="aal2_required")
        if response.status_code in (401, 403):
            raise Unauthorized("session expired", code="unauthenticated")
        if response.status_code != 200:
            raise unavailable()
        identity, expires = parse_session(response.json())
        if expires and expires - datetime.now(UTC) < _EXTEND_WITHIN:
            await self._call("PATCH", f"{self._admin}/admin/sessions/{identity.session_id}/extend")
        self._remember(key, identity)
        return identity

    async def revoke_sessions(self, identity_id: str) -> None:
        response = await self._call(
            "DELETE", f"{self._admin}/admin/identities/{identity_id}/sessions"
        )
        self._cache = {k: v for k, v in self._cache.items() if v[1].id != identity_id}
        if response.status_code not in (204, 404):
            raise unavailable()

    async def find_identity(self, email: str) -> str | None:
        response = await self._call(
            "GET", f"{self._admin}/admin/identities", params={"credentials_identifier": email}
        )
        if response.status_code != 200:
            raise unavailable()
        found = response.json()
        return _str(_dict(found[0]).get("id")) if isinstance(found, list) and found else None

    async def create_identity(self, email: str, name: str, password: str) -> str:
        response = await self._call(
            "POST",
            f"{self._admin}/admin/identities",
            json={
                "schema_id": "default",
                "traits": {"email": email, "name": name},
                "credentials": {"password": {"config": {"password": password}}},
                "verifiable_addresses": [
                    {"value": email, "via": "email", "verified": True, "status": "completed"}
                ],
            },
        )
        identity_id = (
            _str(_dict(response.json()).get("id")) if response.status_code == 201 else None
        )
        if identity_id is None:
            raise unavailable()
        return identity_id

    async def _call(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
        json: dict[str, object] | None = None,
    ) -> httpx.Response:
        try:
            return await self._http.request(method, url, headers=headers, params=params, json=json)
        except httpx.HTTPError as exc:
            raise unavailable() from exc

    def _remember(self, key: str, identity: Identity) -> None:
        now = time.monotonic()
        if len(self._cache) >= _CACHE_LIMIT:
            self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
        self._cache[key] = (now + self._ttl, identity)


@lru_cache
def get_kratos() -> KratosIdentityProvider:
    settings = get_settings()
    return KratosIdentityProvider(
        settings.kratos_public_url,
        settings.kratos_admin_url,
        settings.kratos_session_cookie,
        settings.identity_cache_ttl_seconds,
    )


def get_identity_provider() -> (
    IdentityProvider
):  # pragma: no cover — overridden by the fake in tests
    return get_kratos()
