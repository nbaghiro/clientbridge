"""KratosIdentityProvider over a mocked transport, plus a contract run against the local Kratos."""

import json
import re
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from clientbridge.core import clock
from clientbridge.core.config import get_settings
from clientbridge.core.deployment import AUTH_SECRETS, auth_env
from clientbridge.core.emails import normalize_email
from clientbridge.core.errors import AppError, Unauthorized
from clientbridge.integrations.identity import Credential
from clientbridge.integrations.kratos import KratosIdentityProvider
from tests.helpers import service_missing

Handler = Callable[[httpx.Request], httpx.Response]
KRATOS_YML = Path(__file__).resolve().parents[2] / "infra/auth/kratos.yml"


def session(
    *,
    verified: bool = True,
    expires_in: timedelta = timedelta(days=20),
    signed_in_ago: timedelta = timedelta(hours=1),
    active: bool = True,
) -> dict[str, object]:
    return {
        "id": "ses-1",
        "active": active,
        "authenticator_assurance_level": "aal2",
        "authenticated_at": (clock.wall() - signed_in_ago).isoformat(),
        "expires_at": (clock.wall() + expires_in).isoformat(),
        "identity": {
            "id": "id-1",
            "traits": {"email": "Pat@Test.ca", "name": "Pat"},
            "verifiable_addresses": [
                {"value": "Pat@Test.ca", "verified": verified},
                {"value": "", "verified": True},
                "not-an-address",
            ],
        },
    }


def provider(handler: Handler, *, ttl: float = 30) -> tuple[KratosIdentityProvider, list[str]]:
    seen: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url.path}")
        return handler(request)

    kratos = KratosIdentityProvider(
        "http://kratos.test/",
        "http://admin.test",
        "cb_session",
        ttl,
        httpx.MockTransport(record),
    )
    return kratos, seen


async def test_whoami_parses_the_session() -> None:
    kratos, _ = provider(lambda r: httpx.Response(200, json=session()))
    identity = await kratos.whoami(Credential(session_token="tok"))
    assert (identity.id, identity.email, identity.name) == ("id-1", "Pat@Test.ca", "Pat")
    assert identity.verified_emails == frozenset({"pat@test.ca"}) and identity.email_verified
    assert (identity.session_id, identity.second_factor) == ("ses-1", True)


async def test_only_the_session_cookie_or_token_is_forwarded() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=session())

    kratos, _ = provider(handler)
    await kratos.whoami(Credential(cookie="c00kie"))
    await kratos.whoami(Credential(session_token="tok"))
    assert requests[0].headers["cookie"] == "cb_session=c00kie"
    assert "x-session-token" not in requests[0].headers
    assert requests[1].headers["x-session-token"] == "tok" and "cookie" not in requests[1].headers


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(401, json={"error": {"id": "session_inactive"}}), "unauthenticated"),
        (
            httpx.Response(403, json={"error": {"id": "session_aal2_required"}}),
            "second_factor_required",
        ),
        (httpx.Response(403, json={"error": {"id": "forbidden"}}), "unauthenticated"),
        (httpx.Response(200, json=session(active=False)), "unauthenticated"),
        (httpx.Response(200, json={"identity": {}}), "unauthenticated"),
    ],
)
async def test_rejected_sessions_401(response: httpx.Response, code: str) -> None:
    kratos, _ = provider(lambda r: response)
    with pytest.raises(Unauthorized) as raised:
        await kratos.whoami(Credential(session_token="tok"))
    assert raised.value.code == code


async def test_outages_are_503() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    def bad_gateway(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502)

    for handler in (bad_gateway, broken):
        kratos, _ = provider(handler)
        with pytest.raises(AppError) as raised:
            await kratos.whoami(Credential(session_token="tok"))
        assert (raised.value.status_code, raised.value.code) == (503, "identity_unavailable")


async def test_whoami_is_cached_unless_fresh() -> None:
    answers = [session(verified=False), session(verified=True)]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=answers[min(len(seen), 2) - 1])

    kratos, seen = provider(handler)
    for _ in range(3):
        assert not (await kratos.whoami(Credential(session_token="tok"))).email_verified
    assert seen.count("GET /sessions/whoami") == 1
    # just verified: the onboarding and invite checks ask Kratos again instead of the cache
    assert (await kratos.whoami(Credential(session_token="tok"), fresh=True)).email_verified
    assert (await kratos.whoami(Credential(session_token="tok"))).email_verified
    assert seen.count("GET /sessions/whoami") == 2


async def test_a_session_older_than_the_maximum_age_is_refused_and_ended() -> None:
    kratos, seen = provider(
        lambda r: httpx.Response(200, json=session(signed_in_ago=timedelta(days=91)))
    )
    with pytest.raises(Unauthorized) as raised:
        await kratos.whoami(Credential(session_token="tok"))
    assert raised.value.code == "unauthenticated"
    assert "DELETE /admin/sessions/ses-1" in seen
    assert "PATCH /admin/sessions/ses-1/extend" not in seen


async def test_a_failed_revoke_still_refuses_the_old_session() -> None:
    def refused(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            return httpx.Response(500)
        return httpx.Response(200, json=session(signed_in_ago=timedelta(days=91)))

    def unreachable(request: httpx.Request) -> httpx.Response:
        if request.method == "DELETE":
            raise httpx.ConnectError("admin down", request=request)
        return httpx.Response(200, json=session(signed_in_ago=timedelta(days=91)))

    for handler in (refused, unreachable):
        kratos, _ = provider(handler)
        with pytest.raises(Unauthorized):
            await kratos.whoami(Credential(session_token="tok"))


def test_emails_compare_ascii_lowercased_only() -> None:
    assert normalize_email(" Pat@Test.CA ") == "pat@test.ca"
    assert normalize_email("Straße@test.ca") != normalize_email("strasse@test.ca")


async def test_cache_expires() -> None:
    kratos, seen = provider(lambda r: httpx.Response(200, json=session()), ttl=0)
    await kratos.whoami(Credential(session_token="tok"))
    await kratos.whoami(Credential(session_token="tok"))
    assert seen.count("GET /sessions/whoami") == 2


async def test_a_session_near_expiry_is_extended() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "PATCH":
            return httpx.Response(200, json=session())
        return httpx.Response(200, json=session(expires_in=timedelta(hours=3)))

    kratos, seen = provider(handler)
    await kratos.whoami(Credential(session_token="tok"))
    assert "PATCH /admin/sessions/ses-1/extend" in seen


async def test_a_failed_extend_keeps_the_session_valid() -> None:
    def refused(request: httpx.Request) -> httpx.Response:
        if request.method == "PATCH":
            return httpx.Response(500)
        return httpx.Response(200, json=session(expires_in=timedelta(hours=3)))

    def unreachable(request: httpx.Request) -> httpx.Response:
        if request.method == "PATCH":
            raise httpx.ConnectError("admin down", request=request)
        return httpx.Response(200, json=session(expires_in=timedelta(hours=3)))

    for handler in (refused, unreachable):
        kratos, _ = provider(handler)
        assert (await kratos.whoami(Credential(session_token="tok"))).id == "id-1"


async def test_identity_exists() -> None:
    kratos, seen = provider(
        lambda r: httpx.Response(200 if r.url.path.endswith("/id-1") else 404, json={})
    )
    assert await kratos.identity_exists("id-1")
    assert not await kratos.identity_exists("gone")
    assert seen[0] == "GET /admin/identities/id-1"
    kratos, _ = provider(lambda r: httpx.Response(500))
    with pytest.raises(AppError):
        await kratos.identity_exists("id-1")


async def test_admin_identity_helpers() -> None:
    created: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            created.append(json.loads(request.content))
            return httpx.Response(201, json={"id": "new-id"})
        if request.url.params.get("credentials_identifier") == "known@test.ca":
            return httpx.Response(200, json=[{"id": "known-id"}])
        return httpx.Response(200, json=[])

    kratos, _ = provider(handler)
    assert await kratos.find_identity("known@test.ca") == "known-id"
    assert await kratos.find_identity("nobody@test.ca") is None
    assert await kratos.create_identity("n@test.ca", "N", "pw-long-enough") == "new-id"
    assert created[0]["traits"] == {"email": "n@test.ca", "name": "N"}
    kratos, _ = provider(lambda r: httpx.Response(500, json={}))
    with pytest.raises(AppError):
        await kratos.find_identity("x@test.ca")
    kratos, _ = provider(lambda r: httpx.Response(409, json={}))
    with pytest.raises(AppError):
        await kratos.create_identity("x@test.ca", "X", "pw")


@pytest.mark.kratos
@pytest.mark.wall_clock
async def test_contract_against_local_kratos() -> None:
    settings = get_settings()
    kratos = KratosIdentityProvider(
        settings.auth_internal_url, settings.auth_admin_url, settings.auth_session_cookie, 0
    )
    email, password = f"contract-{uuid4().hex[:10]}@example.com", f"Pw-{uuid4().hex}"
    try:
        identity_id = await kratos.create_identity(email, "Contract", password)
    except AppError:
        service_missing("Kratos is not running (make up)")
    async with httpx.AsyncClient(base_url=settings.auth_internal_url) as http:
        flow = (await http.get("/self-service/login/api")).json()["id"]
        login = await http.post(
            "/self-service/login",
            params={"flow": flow},
            json={"method": "password", "identifier": email, "password": password},
        )
        token = login.json()["session_token"]
        identity = await kratos.whoami(Credential(session_token=token))
        assert identity.id == identity_id and identity.email_verified
        assert await kratos.identity_exists(identity_id)
        await _past_the_age_cap(kratos, http, email, password)
        await http.delete(f"{settings.auth_admin_url}/admin/identities/{identity_id}")
        assert not await kratos.identity_exists(identity_id)
        with pytest.raises(Unauthorized):
            await kratos.whoami(Credential(session_token=token))


async def _past_the_age_cap(
    kratos: KratosIdentityProvider, http: httpx.AsyncClient, email: str, password: str
) -> None:
    """A session past the cap is ended in Kratos too, so signing in again starts fresh."""
    flow = (await http.get("/self-service/login/api")).json()["id"]
    login = await http.post(
        "/self-service/login",
        params={"flow": flow},
        json={"method": "password", "identifier": email, "password": password},
    )
    token = login.json()["session_token"]
    settings = get_settings()
    cap = settings.session_max_age_days
    settings.session_max_age_days = -1
    try:
        with pytest.raises(Unauthorized):
            await kratos.whoami(Credential(session_token=token))
    finally:
        settings.session_max_age_days = cap
    with pytest.raises(Unauthorized):
        await kratos.whoami(Credential(session_token=token))


def test_the_deployed_auth_env_replaces_every_local_url() -> None:
    app = "https://app.staging.clientbridge.ca"
    env = auth_env(
        "staging.clientbridge.ca", api_url="http://api:8000/", admin_url="http://auth:4434"
    )
    local = sorted(re.findall(r"http://localhost:8700(/[\w/-]*)", KRATOS_YML.read_text()))
    assert local == sorted(v.removeprefix(app) for v in env.values() if v.startswith(f"{app}/"))
    assert not [v for v in env.values() if "localhost" in v or "host.docker.internal" in v]
    assert env["SERVE_PUBLIC_BASE_URL"] == "https://api.staging.clientbridge.ca/auth/"
    assert env["SESSION_COOKIE_NAME"].startswith("__Host-")
    assert env["SELFSERVICE_METHODS_WEBAUTHN_CONFIG_RP_ID"] == "app.staging.clientbridge.ca"
    assert env["SELFSERVICE_ALLOWED_RETURN_URLS"] == f"{app},clientbridge://auth/callback"
    assert env["COURIER_HTTP_REQUEST_CONFIG_URL"] == "http://api:8000/webhooks/auth-email"
    assert not set(env) & set(AUTH_SECRETS)


@pytest.mark.kratos
@pytest.mark.wall_clock
async def test_a_browser_sign_in_cookie_reaches_whoami() -> None:
    """The cookie Kratos sets is the one the API reads; a __Host- cookie keeps its attributes."""
    settings = get_settings()
    name = settings.auth_session_cookie
    kratos = KratosIdentityProvider(settings.auth_internal_url, settings.auth_admin_url, name, 0)
    email, password = f"cookie-{uuid4().hex[:10]}@example.com", f"Pw-{uuid4().hex}"
    try:
        identity_id = await kratos.create_identity(email, "Cookie", password)
    except AppError:
        service_missing("Kratos is not running (make up)")
    headers = {"Accept": "application/json"}
    try:
        async with httpx.AsyncClient(base_url=settings.auth_internal_url, headers=headers) as http:
            flow = await http.get("/self-service/login/browser")
            csrf = next(c for c in flow.headers.get_list("set-cookie") if c.startswith("csrf_"))
            token = next(
                node["attributes"]["value"]
                for node in flow.json()["ui"]["nodes"]
                if node["attributes"].get("name") == "csrf_token"
            )
            login = await http.post(
                "/self-service/login",
                params={"flow": flow.json()["id"]},
                headers={"Cookie": csrf.split(";")[0]},
                json={
                    "method": "password",
                    "identifier": email,
                    "password": password,
                    "csrf_token": token,
                },
            )
        cookie = next(c for c in login.headers.get_list("set-cookie") if c.startswith(f"{name}="))
        if name.startswith("__Host-"):
            attributes = cookie.lower()
            assert "; secure" in attributes and "; path=/;" in attributes
            assert "domain=" not in attributes
        identity = await kratos.whoami(Credential(cookie=cookie.split(";")[0].split("=", 1)[1]))
        assert identity.id == identity_id
    finally:
        async with httpx.AsyncClient() as admin:
            await admin.delete(f"{settings.auth_admin_url}/admin/identities/{identity_id}")
