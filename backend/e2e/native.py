"""Run the Maestro flows against a simulator or emulator wired to the run's services."""

import argparse
import asyncio
import fcntl
import json
import os
import socket
import subprocess
import sys
import threading
from collections.abc import Callable, Coroutine, Iterator
from contextlib import ExitStack, contextmanager
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import IO, Literal

from clientbridge.core import clock
from e2e import tier
from e2e.results import (
    REQUIRED_CASES,
    validate_native_evidence,
)
from e2e.stack import Stack
from e2e.tier import ROOT

MOBILE = ROOT / "frontend" / "apps" / "mobile"


NATIVE_APP_ID = "ca.clientbridge.app.e2e"


# the e2e build has these hosts compiled in; the lane forwards them to the run's services
NATIVE_PORTS = {"api": 8794, "auth": 8795, "powersync": 8796}


# Maestro's own port to its device driver, fixed where a random pick can't meet an emulator socket
DRIVER_PORT = 8797


NATIVE_BUILDS = {
    "ios": ROOT / ".scratchpad" / "native" / "ClientbridgeE2E.app",
    "android": ROOT / ".scratchpad" / "native" / "clientbridge-e2e.apk",
}


ANDROID_HOME = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library/Android/sdk"))


ADB = ANDROID_HOME / "platform-tools" / "adb"


def native_urls(platform: str) -> dict[str, str]:
    """What the e2e build compiles in; the emulator reaches the host at 10.0.2.2 unforwarded."""
    host = "10.0.2.2" if platform == "android" else "127.0.0.1"
    return {
        "APP_ID": NATIVE_APP_ID,
        "API_URL": f"http://{host}:{NATIVE_PORTS['api']}",
        "AUTH_URL": f"http://{host}:{NATIVE_PORTS['auth']}",
        "POWERSYNC_URL": f"http://{host}:{NATIVE_PORTS['powersync']}",
    }


class NativeDevice:
    """Installs the e2e build on a device the developer already started, and takes it off after."""

    def __init__(self, platform: Literal["ios", "android"], device: str) -> None:
        self.platform = platform
        self.device = device

    def run(self, *arguments: str, check: bool = True) -> str:
        command = (
            ["xcrun", "simctl", *arguments]
            if self.platform == "ios"
            else [str(ADB), "-s", self.device, *arguments]
        )
        result = subprocess.run(command, capture_output=True, text=True)
        if check and result.returncode:
            raise RuntimeError(f"{' '.join(command)} failed: {result.stderr.strip()}")
        return result.stdout

    def require_started(self) -> None:
        if self.platform == "ios":
            booted = json.loads(self.run("list", "devices", "booted", "-j"))["devices"]
            started = any(d["udid"] == self.device for ds in booted.values() for d in ds)
        else:
            started = self.run("get-state", check=False).strip() == "device"
        if not started:
            raise RuntimeError(f"start the {self.platform} device {self.device} before the lane")

    def push(self, payload: bytes) -> None:
        if self.platform != "ios":
            raise RuntimeError("only the iOS simulator accepts a push without a push service")
        result = subprocess.run(
            ["xcrun", "simctl", "push", self.device, NATIVE_APP_ID, "-"],
            input=payload,
            capture_output=True,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.decode().strip())

    @contextmanager
    def installed(self, build: Path) -> Iterator[None]:
        self.require_started()
        if self.platform == "ios":
            # a stuck pasteboard daemon blocks every text field's focus, and so Maestro's typing
            self.run("spawn", self.device, "launchctl", "stop", "com.apple.pasteboard.pasted")
            self.run("uninstall", self.device, NATIVE_APP_ID, check=False)
            self.run("install", self.device, str(build))
        else:
            self.run("uninstall", NATIVE_APP_ID, check=False)
            self.run("install", str(build))
        try:
            yield
        finally:
            if self.platform == "ios":
                self.run("terminate", self.device, NATIVE_APP_ID, check=False)
                self.run("uninstall", self.device, NATIVE_APP_ID, check=False)
            else:
                self.run("uninstall", NATIVE_APP_ID, check=False)


class NativeLink:
    """Forwards the build's fixed hosts to the run's services; cutting it takes the app offline."""

    def __init__(self, targets: dict[int, int]) -> None:
        self.targets = targets
        self.loop = asyncio.new_event_loop()
        self.servers: list[asyncio.Server] = []
        self.writers: set[asyncio.StreamWriter] = set()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)

    def call(self, work: Coroutine[object, object, None]) -> None:
        asyncio.run_coroutine_threadsafe(work, self.loop).result(timeout=30)

    async def pipe(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while data := await reader.read(65536):
                writer.write(data)
                await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()

    async def forward(
        self, target: int, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            upstream_reader, upstream = await asyncio.open_connection("127.0.0.1", target)
        except OSError:
            writer.close()
            return
        self.writers |= {writer, upstream}
        try:
            await asyncio.gather(self.pipe(reader, upstream), self.pipe(upstream_reader, writer))
        finally:
            self.writers -= {writer, upstream}

    async def listen(self) -> None:
        for port, target in self.targets.items():
            self.servers.append(
                await asyncio.start_server(partial(self.forward, target), "127.0.0.1", port)
            )

    async def cut(self) -> None:
        servers, self.servers = self.servers, []
        for server in servers:
            server.close()
        for writer in list(self.writers):
            writer.transport.abort()
        for server in servers:
            await server.wait_closed()

    def online(self) -> None:
        if not self.thread.is_alive():
            self.thread.start()
        if not self.servers:
            self.call(self.listen())

    def offline(self) -> None:
        self.call(self.cut())

    def close(self) -> None:
        if self.thread.is_alive():
            self.offline()
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=10)


@contextmanager
def native_control(link: NativeLink, push: Callable[[bytes], None], log: Path) -> Iterator[str]:
    """A local endpoint a flow calls to go offline, come back or receive a push."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            actions: dict[str, Callable[[], None]] = {
                "/offline": link.offline,
                "/online": link.online,
                "/push": lambda: push(body),
            }
            action = actions.get(self.path)
            try:
                if action is None:
                    raise LookupError(self.path)
                action()
            except (LookupError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(str(error).encode())
                return
            with log.open("a") as record:
                record.write(f"{clock.wall().isoformat()} {self.path}\n")
            self.send_response(204)
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=10)


@contextmanager
def native_ports_free() -> Iterator[None]:
    """One native stack at a time: its ports are fixed, and so is the device it drives."""
    tier.TIER.mkdir(parents=True, exist_ok=True)
    with (tier.TIER / "native.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("another native e2e run holds the native ports") from None
        for port in [*NATIVE_PORTS.values(), DRIVER_PORT]:
            with socket.socket() as sock:
                # a previous run's closed connections linger in TIME_WAIT; only a listener counts
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    sock.bind(("127.0.0.1", port))
                except OSError:
                    raise RuntimeError(f"port {port} is taken; the native lane needs it") from None
        yield


def build_native(platform: str) -> None:
    subprocess.run(
        [str(MOBILE / "scripts" / "e2e-build.sh"), platform, str(NATIVE_BUILDS[platform])],
        env={**os.environ, "ANDROID_HOME": str(ANDROID_HOME), **native_urls(platform)},
        check=True,
    )


def native_flows(tests: list[str]) -> list[str]:
    """The named flows, or every walkthrough in name order."""
    names = tests or sorted(flow.name for flow in (MOBILE / "e2e").glob("*.yaml"))
    return [str(Path("e2e") / name) for name in names]


def run_native(
    stack: Stack, args: argparse.Namespace, processes: ExitStack, log: IO[bytes]
) -> None:
    build = NATIVE_BUILDS[args.platform]
    if not build.exists():
        raise RuntimeError(f"no e2e build at {build}; run with --build-native {args.platform}")
    stack.start(processes, log, browser_fixtures=False)
    report = stack.directory / "native-results.xml"
    flows = native_flows(args.tests)
    command = [
        "maestro",
        "--device",
        args.device,
        "test",
        "--driver-host-port",
        str(DRIVER_PORT),
        *flows,
        "-e",
        f"APP_ID={NATIVE_APP_ID}",
        "-e",
        f"E2E_NAMESPACE={stack.namespace}",
        "-e",
        f"MAILPIT_URL={stack.env['MAILPIT_URL']}",
        "-e",
        f"AUTH_ADMIN_URL={stack.env['AUTH_ADMIN_URL']}",
        "-e",
        f"AUTH_URL=http://localhost:{tier.PORTS['auth']}",
        # only the iOS simulator takes a push without a push service
        *(["--exclude-tags", "ios"] if args.platform == "android" else []),
        "--format",
        "junit",
        "--output",
        str(report),
        "--test-output-dir",
        str(stack.directory / "native-artifacts"),
        "--debug-output",
        str(stack.directory / "native-debug"),
        "--flatten-debug-output",
    ]
    device = NativeDevice(args.platform, args.device)
    link = NativeLink(
        {
            NATIVE_PORTS["api"]: stack.api_port,
            NATIVE_PORTS["auth"]: tier.PORTS["auth"],
            NATIVE_PORTS["powersync"]: tier.PORTS["powersync"],
        }
    )
    link.online()
    processes.callback(link.close)

    def message_push(body: bytes) -> None:
        # a flow names the seeded client; the run holds its own namespaced copy
        request = json.loads(body)
        payload = subprocess.run(
            [
                sys.executable,
                "-m",
                "e2e.actions",
                "native-push",
                f"{request['client_id']}_{stack.namespace}",
                str(request["preview"]),
            ],
            cwd=ROOT / "backend",
            env=stack.env,
            capture_output=True,
            check=True,
        ).stdout
        device.push(payload)

    with (
        device.installed(build),
        native_control(link, message_push, stack.directory / "control.log") as control,
        (stack.directory / "native.log").open("wb") as native_log,
    ):
        command += ["-e", f"CONTROL_URL={control}"]
        process = subprocess.Popen(
            command, cwd=MOBILE, stdout=native_log, stderr=subprocess.STDOUT, start_new_session=True
        )
        try:
            process.wait()
        finally:
            stack.stop_owned(process)
    required = [] if args.tests else REQUIRED_CASES[f"native-{args.platform}"]
    validate_native_evidence(report.read_text(), required)
