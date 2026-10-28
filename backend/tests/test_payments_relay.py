"""Exercise the test relay's transport and ownership failures without provider calls."""

import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
import stripe
from e2e.stripe_fixtures import validate_cleanup_fixtures
from e2e.stripe_relay import Relay, Target

from clientbridge.core import clock


@pytest.fixture
def relay(tmp_path: Path) -> Relay:
    manifest = tmp_path / "stripe-fixtures.json"
    manifest.write_text(
        json.dumps(
            {
                "account": "acct_owned",
                "business": "bz_owned",
                "fixtures": [
                    {
                        "invoice": "inv_owned",
                        "client": "cl_owned",
                        "customer": "cus_owned",
                    }
                ],
            }
        )
    )
    instance = Relay(manifest, "http://127.0.0.1:1/webhooks/stripe")
    instance.secret = "whsec_synthetic_unit_fixture"
    return instance


def signed(relay: Relay, **changes: object) -> tuple[bytes, str]:
    intent: dict[str, object] = {
        "id": "pi_owned",
        "customer": "cus_owned",
        "amount": 2000,
        "currency": "cad",
        "metadata": {"invoice_id": "inv_owned", "business_id": "bz_owned"},
    }
    event: dict[str, object] = {
        "id": "evt_owned",
        "object": "event",
        "type": "payment_intent.succeeded",
        "livemode": False,
        "account": "acct_owned",
        "data": {"object": intent},
    }
    for key, value in changes.items():
        if key in intent:
            intent[key] = value
        else:
            event[key] = value
    body = json.dumps(event, separators=(",", ":")).encode()
    stamp = str(int(clock.wall().timestamp()))
    digest = hmac.new(
        relay.secret.encode(), stamp.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    return body, f"t={stamp},v1={digest}"


def arm(relay: Relay) -> None:
    relay.arm(Target(invoice="inv_owned", intent="pi_owned"))


def test_relay_holds_exact_signed_bytes_then_releases_once(relay: Relay) -> None:
    sent: list[tuple[str, bytes, str]] = []

    def transport(url: str, body: bytes, signature: str) -> int:
        sent.append((url, body, signature))
        return 200

    relay.transport = transport
    arm(relay)
    body, signature = signed(relay)
    assert relay.receive(body, signature) == 202
    assert sent == []
    assert relay.status()["held"] is True
    assert relay.release() == 200
    assert sent == [(relay.upstream, body, signature)]
    assert relay.status()["held"] is False
    with pytest.raises(ValueError, match="no genuine"):
        relay.release()
    artifact = (relay.manifest.parent / "stripe-relay.json").read_text()
    assert (
        signature not in artifact and relay.secret not in artifact and relay.token not in artifact
    )
    assert '"customer"' not in artifact


@pytest.mark.parametrize(
    "changes",
    [
        {"livemode": True},
        {"account": "acct_other"},
        {"customer": "cus_other"},
        {"amount": 2001},
        {"currency": "usd"},
        {"metadata": {"invoice_id": "inv_other", "business_id": "bz_owned"}},
        {"metadata": {"invoice_id": "inv_owned", "business_id": "bz_other"}},
    ],
)
def test_relay_rejects_unsafe_target_before_transport(
    relay: Relay, changes: dict[str, object]
) -> None:
    def transport(url: str, body: bytes, signature: str) -> int:
        pytest.fail("unsafe event reached upstream")

    relay.transport = transport
    arm(relay)
    with pytest.raises(ValueError, match="ownership mismatch"):
        relay.receive(*signed(relay, **changes))
    assert relay.held is None


def test_relay_passes_unrelated_genuine_events_transparently(relay: Relay) -> None:
    sent: list[bytes] = []

    def transport(url: str, body: bytes, signature: str) -> int:
        sent.append(body)
        return 503

    relay.transport = transport
    arm(relay)
    body, signature = signed(relay, id="pi_other")
    assert relay.receive(body, signature) == 503
    assert sent == [body]
    assert relay.held is None


def test_relay_rejects_invalid_signature_and_unregistered_arm(relay: Relay) -> None:
    with pytest.raises(ValueError, match="registered"):
        relay.arm(Target(invoice="inv_other", intent="pi_owned"))
    arm(relay)
    with pytest.raises(ValueError, match="already armed"):
        arm(relay)
    body, _ = signed(relay)
    with pytest.raises(stripe.SignatureVerificationError):
        relay.receive(body, "t=1,v1=invalid")
    assert relay.held is None


def test_relay_upstream_retry_preserves_body_and_signature(relay: Relay) -> None:
    attempts: list[tuple[bytes, str]] = []

    def transport(url: str, body: bytes, signature: str) -> int:
        attempts.append((body, signature))
        return 503 if len(attempts) == 1 else 200

    relay.transport = transport
    arm(relay)
    payload = signed(relay)
    relay.receive(*payload)
    assert relay.release() == 503
    assert relay.held is not None
    assert relay.release() == 200
    assert attempts == [payload, payload]


def test_relay_expiry_requires_official_resend_and_never_resigns(relay: Relay) -> None:
    arm(relay)
    body, signature = signed(relay)
    relay.receive(body, signature)
    relay.held = (body, signature, "evt_owned", time.monotonic() - 241)
    with pytest.raises(ValueError, match="safe release window"):
        relay.release()
    recovered: list[str] = []
    relay.recover(recovered.append)
    assert recovered == ["evt_owned"]
    assert relay.held is None and relay.target is None


def test_relay_recovery_failure_is_explicit(relay: Relay) -> None:
    arm(relay)
    relay.receive(*signed(relay))

    def resend(event_id: str) -> None:
        raise OSError("synthetic transport unavailable")

    with pytest.raises(OSError, match="unavailable"):
        relay.recover(resend)
    assert relay.records[-1]["status"] == "recovery_resend_requested"


def test_relay_http_control_auth_and_shutdown(relay: Relay) -> None:
    url = relay.start()
    try:
        request = Request(url + "/status", data=b"{}", method="POST")
        with pytest.raises(HTTPError) as failure:
            urlopen(request, timeout=2)
        assert failure.value.code == 403
        request.add_header("Authorization", f"Bearer {relay.token}")
        with urlopen(request, timeout=2) as response:
            assert json.load(response) == {"held": False, "records": []}
    finally:
        relay.close()
    assert relay.thread is not None and not relay.thread.is_alive()


def test_relay_close_refuses_unrecovered_event(relay: Relay) -> None:
    arm(relay)
    relay.receive(*signed(relay))
    with pytest.raises(RuntimeError, match="unrecovered"):
        relay.close()


@pytest.mark.parametrize(
    "fixtures",
    [
        [{"invoice": "inv_owned", "client": "cl_owned"}],
        [{"invoice": "inv_owned", "client": "cl_owned", "customer": ""}],
        [{"invoice": "inv_owned", "client": "cl_owned", "customer": "cus_owned"}] * 2,
    ],
)
def test_cleanup_refuses_ambiguous_or_duplicate_lineage(
    fixtures: list[dict[str, str]],
) -> None:
    with pytest.raises(ValueError, match="cannot prove cleanup"):
        validate_cleanup_fixtures(fixtures)


def test_cleanup_allows_complete_or_empty_lineage() -> None:
    validate_cleanup_fixtures([])
    validate_cleanup_fixtures(
        [
            {"invoice": "inv_owned", "client": "cl_owned", "customer": "cus_owned"},
        ]
    )


def test_relay_blocked_forward_does_not_block_status_or_hide_shutdown_failure(
    relay: Relay,
) -> None:
    entered = threading.Event()
    proceed = threading.Event()
    completed = threading.Event()

    def blocked(url: str, body: bytes, signature: str) -> int:
        entered.set()
        if not proceed.wait(5):
            raise TimeoutError("synthetic transport deadline")
        return 200

    relay.transport = blocked
    url = relay.start()
    body, signature = signed(relay)

    def request() -> None:
        try:
            with urlopen(
                Request(url + "/webhook", data=body, headers={"Stripe-Signature": signature}),
                timeout=5,
            ):
                pass
        except (OSError, HTTPError):
            pass
        finally:
            completed.set()

    client = threading.Thread(target=request, daemon=False)
    client.start()
    try:
        assert entered.wait(2)
        with urlopen(
            Request(
                url + "/status",
                data=b"{}",
                headers={"Authorization": f"Bearer {relay.token}"},
            ),
            timeout=1,
        ) as response:
            assert json.load(response)["held"] is False
        started = time.monotonic()
        with pytest.raises(RuntimeError, match="shutdown deadline"):
            relay.close(timeout=0.1)
        assert time.monotonic() - started < 1
        assert relay.records[-1]["status"] == "shutdown_failed"
        assert any(worker.is_alive() for worker in relay.workers)
        with pytest.raises(OSError, match="stopping"):
            relay.arm(Target(invoice="inv_owned", intent="pi_owned"))
    finally:
        proceed.set()
        client.join(5)
        relay.close()
    assert completed.is_set()
    assert not any(worker.is_alive() for worker in relay.workers)


def test_relay_release_does_not_hold_state_lock_and_rejects_concurrent_release(
    relay: Relay,
) -> None:
    entered = threading.Event()
    proceed = threading.Event()
    results: list[int] = []

    def blocked(url: str, body: bytes, signature: str) -> int:
        entered.set()
        if not proceed.wait(5):
            raise TimeoutError("synthetic transport deadline")
        return 200

    relay.transport = blocked
    arm(relay)
    relay.receive(*signed(relay))
    worker = threading.Thread(target=lambda: results.append(relay.release()), daemon=False)
    worker.start()
    try:
        assert entered.wait(2)
        assert relay.status()["held"] is True
        with pytest.raises(ValueError, match="already releasing"):
            relay.release()
        with pytest.raises(RuntimeError, match="cannot race"):
            relay.recover(lambda event_id: pytest.fail("recovery raced active release"))
    finally:
        proceed.set()
        worker.join(5)
    assert results == [200]
    relay.close()


def test_relay_shutdown_interrupts_real_local_upstream_wait(relay: Relay) -> None:
    entered = threading.Event()
    proceed = threading.Event()

    class Upstream(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            pass

        def do_POST(self) -> None:
            entered.set()
            proceed.wait(5)
            try:
                self.send_response(200)
                self.end_headers()
            except OSError:
                pass

    upstream = HTTPServer(("127.0.0.1", 0), Upstream)
    server = threading.Thread(target=upstream.serve_forever, daemon=False)
    server.start()
    relay.upstream = f"http://127.0.0.1:{upstream.server_port}/webhooks/stripe"
    url = relay.start()
    body, signature = signed(relay)

    def request() -> None:
        try:
            with urlopen(
                Request(url + "/webhook", data=body, headers={"Stripe-Signature": signature}),
                timeout=5,
            ):
                pass
        except OSError:
            pass

    client = threading.Thread(target=request, daemon=False)
    client.start()
    try:
        assert entered.wait(2)
        started = time.monotonic()
        relay.close(timeout=2)
        assert time.monotonic() - started < 2
        assert not relay.connections
        assert not any(worker.is_alive() for worker in relay.workers)
    finally:
        proceed.set()
        client.join(5)
        relay.close()
        upstream.shutdown()
        upstream.server_close()
        server.join(5)
    assert not client.is_alive() and not server.is_alive()
