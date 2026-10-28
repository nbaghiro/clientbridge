"""Seed instants, source fingerprints and the one production build per app that lanes preview."""

import argparse
import fcntl
import hashlib
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import IO

from clientbridge.core.zones import zone
from e2e import tier
from e2e.tier import ROOT


def seed_timestamp(value: str) -> datetime:
    """An explicit seed instant must identify its UTC offset, never local machine time."""
    try:
        at = datetime.fromisoformat(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "seed-as-of must be an ISO datetime with UTC offset"
        ) from error
    if at.utcoffset() is None:
        raise argparse.ArgumentTypeError("seed-as-of must include a UTC offset")
    return at


def filing_seed_anchor(now: datetime) -> datetime:
    """Seed at local quarter opening, leaving the preceding closed quarter unfiled."""
    if now.utcoffset() is None:
        raise ValueError("the current instant must include a UTC offset")
    local = now.astimezone(zone("America/Vancouver"))
    return local.replace(
        month=((local.month - 1) // 3) * 3 + 1, day=1, hour=12, minute=0, second=0, microsecond=0
    )


def source_snapshot() -> dict[str, object]:
    digest = hashlib.sha256()
    paths = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
        )
        .decode()
        .split("\0")
    )
    for name in sorted(set(paths)):
        path = ROOT / name
        if not name or not path.is_file() or name.startswith(".docs/"):
            continue
        digest.update(name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return {
        "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT)
        .decode()
        .strip(),
        "source_sha256": digest.hexdigest(),
        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT)),
    }


BUNDLES = ("web", "connect", "admin")


BUILDS = tier.TIER / "builds"


KEPT_BUILDS = 3


def bundle_sources() -> str:
    """What the web, Connect and admin bundles are built from, leaving out tests and other apps."""
    names = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "frontend"],
            cwd=ROOT,
        )
        .decode()
        .split("\0")
    )
    digest = hashlib.sha256()
    for name in sorted(set(names)):
        path = ROOT / name
        skipped = (
            name.startswith(("frontend/apps/mobile/", "frontend/apps/site/"))
            or "/e2e/" in name
            or ".test." in path.name
            or path.name.startswith("playwright.")
        )
        if not name or skipped or not path.is_file():
            continue
        digest.update(name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()[:16]


def ensure_builds(log: IO[bytes] | None = None) -> dict[str, Path]:
    """One production build per app and source fingerprint, which every lane previews."""
    BUILDS.mkdir(parents=True, exist_ok=True)
    key = bundle_sources()
    built: dict[str, Path] = {}
    with (BUILDS / "builds.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for app in BUNDLES:
            target = BUILDS / f"{app}-{key}"
            if not (target / "index.html").is_file():
                partial = BUILDS / f"{app}-{key}.partial"
                shutil.rmtree(partial, ignore_errors=True)
                subprocess.run(
                    ["pnpm", "--filter", app, "exec", "vite", "build", "--outDir", str(partial)],
                    cwd=ROOT / "frontend",
                    stdout=log or sys.stderr,
                    stderr=subprocess.STDOUT,
                    check=True,
                )
                shutil.rmtree(target, ignore_errors=True)
                partial.rename(target)
            built[app] = target
            older = sorted(
                (found for found in BUILDS.glob(f"{app}-*") if found != target),
                key=lambda found: found.stat().st_mtime,
                reverse=True,
            )
            for stale in older[KEPT_BUILDS - 1 :]:
                shutil.rmtree(stale, ignore_errors=True)
    return built
