"""The auth service on Ory Kratos: sessions, plus the admin calls the API, seed and dev need."""

import logging
import time
from datetime import datetime, timedelta
from functools import lru_cache
from urllib.parse import parse_qs, urlsplit

import httpx

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.emails import normalize_email
from clientbridge.core.errors import Unauthorized
from clientbridge.integrations.identity import (
    DEMO_TAG,
    Credential,
    Identity,
    IdentityProvider,
    Login,
    unavailable,
)

_EXTEND_WITHIN = timedelta(hours=24)
_CACHE_LIMIT = 10_000
_PAGE_SIZE = "500"
log = logging.getLogger(__name__)


def _dict(value: object) -> dict[str, object]:
    return {str(k): v for k, v in value.items()} if isinstance(value, dict) else {}


def _str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _login(entry: object) -> Login | None:
    identity = _dict(entry)
    identity_id = _str(identity.get("id"))
    if identity_id is None:
        return None
    email = _str(_dict(identity.get("traits")).get("email"))
    return Login(identity_id, email, _dict(identity.get("metadata_admin")).get(DEMO_TAG) is True)


def parse_session(payload: object) -> tuple[Identity, datetime | None, datetime | None]:
    """The identity, then when the session expires and when its owner last signed in."""
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
        normalize_email(value)
        for address in (addresses if isinstance(addresses, list) else [])
        if _dict(address).get("verified") is True and (value := _str(_dict(address).get("value")))
    )
    signed_in = _str(session.get("authenticated_at"))
    expires = _str(session.get("expires_at"))
    return (
        Identity(
            id=identity_id,
            email=email,
            verified_emails=verified,
            name=_str(traits.get("name")),
            session_id=session_id,
            second_factor=session.get("authenticator_assurance_level") == "aal2",
        ),
        datetime.fromisoformat(expires) if expires else None,
        datetime.fromisoformat(signed_in) if signed_in else None,
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

    async def whoami(self, credential: Credential, *, fresh: bool = False) -> Identity:
        key = credential.cache_key()
        cached = self._cache.get(key)
        if cached and cached[0] > time.monotonic() and not fresh:
            return cached[1]
        headers = (
            {"X-Session-Token": credential.session_token}
            if credential.session_token
            else {"Cookie": f"{self._cookie_name}={credential.cookie}"}
        )
        response = await self._call("GET", f"{self._public}/sessions/whoami", headers=headers)
        if response.status_code == 403 and "session_aal2_required" in response.text:
            raise Unauthorized("second factor required", code="second_factor_required")
        if response.status_code in (401, 403):
            raise Unauthorized("session expired", code="unauthenticated")
        if response.status_code != 200:
            raise unavailable()
        identity, expires, signed_in = parse_session(response.json())
        max_age = timedelta(days=get_settings().session_max_age_days)
        if signed_in and clock.wall() - signed_in > max_age:
            # Kratos would keep it alive, and the login screen would take it as signed in again.
            await self._revoke(identity.session_id)
            raise Unauthorized("session too old", code="unauthenticated")
        if expires and expires - clock.wall() < _EXTEND_WITHIN:
            await self._extend(identity.session_id)
        self._remember(key, identity)
        return identity

    async def identity_exists(self, identity_id: str) -> bool:
        response = await self._call("GET", f"{self._admin}/admin/identities/{identity_id}")
        if response.status_code not in (200, 404):
            raise unavailable()
        return response.status_code == 200

    async def _extend(self, session_id: str) -> None:
        """Best effort: the session is valid either way, and the next request tries again."""
        try:
            response = await self._http.patch(f"{self._admin}/admin/sessions/{session_id}/extend")
        except httpx.HTTPError:
            log.warning("kratos session extend failed", exc_info=True)
            return
        if response.status_code >= 400:
            log.warning("kratos session extend refused: %s", response.status_code)

    async def _revoke(self, session_id: str) -> None:
        try:
            response = await self._http.delete(f"{self._admin}/admin/sessions/{session_id}")
        except httpx.HTTPError:
            log.warning("kratos session revoke failed", exc_info=True)
            return
        if response.status_code >= 400 and response.status_code != 404:
            log.warning("kratos session revoke refused: %s", response.status_code)

    async def find_identity(self, email: str) -> str | None:
        response = await self._call(
            "GET", f"{self._admin}/admin/identities", params={"credentials_identifier": email}
        )
        if response.status_code != 200:
            raise unavailable()
        found = response.json()
        return _str(_dict(found[0]).get("id")) if isinstance(found, list) and found else None

    async def create_identity(
        self, email: str, name: str, password: str, *, demo: bool = False
    ) -> str:
        body: dict[str, object] = {
            "schema_id": "default",
            "traits": {"email": email, "name": name},
            "credentials": {"password": {"config": {"password": password}}},
            "verifiable_addresses": [
                {"value": email, "via": "email", "verified": True, "status": "completed"}
            ],
        }
        if demo:
            body["metadata_admin"] = {DEMO_TAG: True}
        response = await self._call("POST", f"{self._admin}/admin/identities", json=body)
        identity_id = (
            _str(_dict(response.json()).get("id")) if response.status_code == 201 else None
        )
        if identity_id is None:
            raise unavailable()
        return identity_id

    async def tag_demo(self, identity_id: str) -> None:
        """Mark an identity as the demo seed's, keeping any other admin metadata it holds."""
        url = f"{self._admin}/admin/identities/{identity_id}"
        response = await self._call("GET", url)
        if response.status_code != 200:
            raise unavailable()
        metadata = _dict(_dict(response.json()).get("metadata_admin"))
        if metadata.get(DEMO_TAG) is True:
            return
        value: dict[str, object] = {**metadata, DEMO_TAG: True}
        patch: list[dict[str, object]] = [{"op": "add", "path": "/metadata_admin", "value": value}]
        if (await self._call("PATCH", url, json=patch)).status_code != 200:
            raise unavailable()

    async def mark_verified(self, identity_id: str, email: str) -> None:
        url = f"{self._admin}/admin/identities/{identity_id}"
        response = await self._call("GET", url)
        if response.status_code != 200:
            raise unavailable()
        addresses = _dict(response.json()).get("verifiable_addresses")
        index = next(
            (
                i
                for i, address in enumerate(addresses if isinstance(addresses, list) else [])
                if normalize_email(_str(_dict(address).get("value")) or "")
                == normalize_email(email)
            ),
            None,
        )
        if index is None:
            raise unavailable()
        patch: list[dict[str, object]] = [
            {"op": "replace", "path": f"/verifiable_addresses/{index}/verified", "value": True},
            {
                "op": "replace",
                "path": f"/verifiable_addresses/{index}/status",
                "value": "completed",
            },
        ]
        if (await self._call("PATCH", url, json=patch)).status_code != 200:
            raise unavailable()

    async def list_identities(self) -> list[Login]:
        """Every identity's id, email and demo tag, following the admin API's pages."""
        found: list[Login] = []
        params = {"page_size": _PAGE_SIZE}
        while True:
            response = await self._call("GET", f"{self._admin}/admin/identities", params=params)
            if response.status_code != 200:
                raise unavailable()
            page = response.json()
            for entry in page if isinstance(page, list) else []:
                if login := _login(entry):
                    found.append(login)
            following = parse_qs(urlsplit(response.links.get("next", {}).get("url", "")).query)
            token = following.get("page_token", [""])[0]
            if not page or not token or token == params.get("page_token"):
                return found
            params = {"page_size": _PAGE_SIZE, "page_token": token}

    async def delete_identity(self, identity_id: str) -> None:
        response = await self._call("DELETE", f"{self._admin}/admin/identities/{identity_id}")
        if response.status_code not in (204, 404):
            raise unavailable()

    async def _call(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
        json: dict[str, object] | list[dict[str, object]] | None = None,
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
def get_identity_provider() -> IdentityProvider:
    settings = get_settings()
    return KratosIdentityProvider(
        settings.auth_internal_url,
        settings.auth_admin_url,
        settings.auth_session_cookie,
        settings.identity_cache_ttl_seconds,
    )
