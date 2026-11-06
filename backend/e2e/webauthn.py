"""A software security key that registers itself on an account, as a browser would on the web."""

import base64
import hashlib
import json
import secrets
from typing import TypedDict, cast

import httpx
from cryptography.hazmat.primitives.asymmetric import ec

type Cbor = int | bytes | str | dict[Cbor, Cbor]


class NodeAttributes(TypedDict, total=False):
    name: str
    value: object


class Node(TypedDict):
    attributes: NodeAttributes


class Ui(TypedDict):
    nodes: list[Node]


class Flow(TypedDict):
    id: str
    ui: Ui


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def cbor(value: Cbor) -> bytes:
    def head(major: int, length: int) -> bytes:
        if length < 24:
            return bytes([major << 5 | length])
        size = 1 if length < 256 else 2
        return bytes([major << 5 | (24 if size == 1 else 25)]) + length.to_bytes(size, "big")

    match value:
        case int() if value >= 0:
            return head(0, value)
        case int():
            return head(1, -1 - value)
        case bytes():
            return head(2, len(value)) + value
        case str():
            return head(3, len(value.encode())) + value.encode()
        case dict():
            return head(5, len(value)) + b"".join(cbor(k) + cbor(v) for k, v in value.items())


def field(flow: Flow, name: str) -> object:
    for node in flow["ui"]["nodes"]:
        if node["attributes"].get("name") == name:
            return node["attributes"].get("value")
    raise LookupError(f"the flow has no {name} field")


def attestation(options: str, origin: str) -> str:
    """The credential a key returns for these creation options, with a "none" attestation."""
    public_key = cast(dict[str, object], json.loads(options)["publicKey"])
    rp = cast(dict[str, str], public_key["rp"])
    point = ec.generate_private_key(ec.SECP256R1()).public_key().public_numbers()
    credential = secrets.token_bytes(32)
    cose: dict[Cbor, Cbor] = {
        1: 2,
        3: -7,
        -1: 1,
        -2: point.x.to_bytes(32, "big"),
        -3: point.y.to_bytes(32, "big"),
    }
    authenticator = (
        hashlib.sha256(rp["id"].encode()).digest()
        # user present and verified, with attested credential data
        + bytes([0x45])
        + (0).to_bytes(4, "big")
        + bytes(16)
        + len(credential).to_bytes(2, "big")
        + credential
        + cbor(cose)
    )
    client = {
        "type": "webauthn.create",
        "challenge": public_key["challenge"],
        "origin": origin,
        "crossOrigin": False,
    }
    attested: dict[Cbor, Cbor] = {"fmt": "none", "attStmt": {}, "authData": authenticator}
    return json.dumps(
        {
            "id": b64(credential),
            "rawId": b64(credential),
            "type": "public-key",
            "response": {
                "attestationObject": b64(cbor(attested)),
                "clientDataJSON": b64(json.dumps(client).encode()),
            },
        }
    )


def register_key(auth: str, origin: str, email: str, password: str) -> None:
    """Signs in with the password and adds a security key, leaving it the only second factor."""
    with httpx.Client(headers={"Accept": "application/json"}, timeout=30) as browser:
        login = cast(Flow, browser.get(f"{auth}/self-service/login/browser").json())
        signed_in = browser.post(
            f"{auth}/self-service/login?flow={login['id']}",
            json={
                "method": "password",
                "identifier": email,
                "password": password,
                "csrf_token": field(login, "csrf_token"),
            },
        )
        signed_in.raise_for_status()
        settings = cast(Flow, browser.get(f"{auth}/self-service/settings/browser").json())
        added = browser.post(
            f"{auth}/self-service/settings?flow={settings['id']}",
            json={
                "method": "webauthn",
                "csrf_token": field(settings, "csrf_token"),
                "webauthn_register": attestation(
                    str(field(settings, "webauthn_register_trigger")), origin
                ),
                "webauthn_register_displayname": "Desk key",
            },
        )
        if added.status_code != 200:
            raise RuntimeError(f"adding the key failed: {added.status_code} {added.text}")
