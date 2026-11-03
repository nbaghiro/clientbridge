"""Record a run (E2E_RECORD=1): wrap Maestro flows, then gather the videos into an index."""

import html
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import cast
from xml.etree import ElementTree

import yaml

from e2e.results import Attempt, Report

# a context closes, and its video is written, shortly after its test ends
CLOSE_SLACK_SECONDS = 15

type Row = tuple[str, str, list[Path]]


def recording() -> bool:
    return os.environ.get("E2E_RECORD") == "1"


def keep_recordings(directory: Path) -> None:
    """After a recorded run, gather its videos and print where to watch them."""
    if not recording():
        return
    rows = [*browser_rows(directory), *native_rows(directory)]
    if rows:
        print(f"recordings: {write_index(directory, rows)}", flush=True)


def recorded_flows(flows: list[str], root: Path, directory: Path) -> list[str]:
    """Each flow wrapped to record itself, keeping its name and tags; folders pass through."""
    directory.mkdir(parents=True, exist_ok=True)
    wrapped: list[str] = []
    for flow in flows:
        source = root / flow
        if not source.is_file():
            wrapped.append(flow)
            continue
        header = cast(dict[str, object], yaml.safe_load(source.read_text().split("\n---", 1)[0]))
        config: dict[str, object] = {
            "appId": header["appId"],
            "name": header.get("name", source.stem),
            **({"tags": header["tags"]} if "tags" in header else {}),
            # stopping on completion keeps the video of a flow that fails
            "onFlowComplete": ["waitForAnimationToEnd", "stopRecording"],
        }
        target = directory / source.name
        target.write_text(
            yaml.safe_dump(config, sort_keys=False)
            + "---\n"
            + yaml.safe_dump([{"startRecording": source.stem}, {"runFlow": str(source)}])
        )
        wrapped.append(str(target))
    return wrapped


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]


def to_mp4(source: Path, target: Path) -> Path:
    """An mp4 that plays in a browser and in Linear; the source itself when ffmpeg is missing."""
    if source.suffix == ".mp4" or shutil.which("ffmpeg") is None:
        kept = target.with_suffix(source.suffix)
        shutil.copyfile(source, kept)
        return kept
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(source),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(target),
        ],
        check=True,
    )
    return target


def attempt_window(attempt: Attempt) -> tuple[float, float] | None:
    if not attempt.startTime:
        return None
    start = datetime.fromisoformat(attempt.startTime.replace("Z", "+00:00")).timestamp()
    return start, start + attempt.duration / 1000 + CLOSE_SLACK_SECONDS


def browser_rows(directory: Path) -> list[Row]:
    """One row per Playwright attempt, with its own video and those of contexts it opened."""
    results = directory / "browser-results"
    report_path = results / "results.json"
    if not report_path.is_file():
        return []
    report = Report.model_validate_json(report_path.read_text())
    contexts = list((results / "contexts").glob("*.webm"))
    rows: list[Row] = []
    for case in (case for suite in report.suites for case in suite.cases()):
        for test in case.tests:
            for attempt in test.results:
                videos = [Path(a.path) for a in attempt.attachments if a.name == "video" and a.path]
                if (window := attempt_window(attempt)) is not None:
                    videos += sorted(
                        (v for v in contexts if window[0] <= v.stat().st_mtime <= window[1]),
                        key=lambda video: video.stat().st_mtime,
                    )
                detail = (
                    f"{case.file} · {test.projectName} · {attempt.status} · "
                    f"{attempt.duration / 1000:.0f}s"
                )
                rows.append((case.title, detail, [v for v in videos if v.is_file()]))
    return rows


def native_rows(directory: Path) -> list[Row]:
    """One row per Maestro flow, with the video its wrapper recorded."""
    report = directory / "native-results.xml"
    if not report.is_file():
        return []
    # Maestro writes them under the debug output, or the test output without one
    videos = list(directory.glob("native-*/**/startRecording/*.mp4"))
    rows: list[Row] = []
    for case in ElementTree.fromstring(report.read_text()).iter("testcase"):
        name = case.get("name", "")
        detail = f"{case.get('file', '')} · {case.get('status', '')} · {case.get('time', '')}s"
        rows.append((name, detail, [v for v in videos if v.parent.parent.name == name]))
    return rows


def write_index(directory: Path, rows: list[Row]) -> Path:
    """`recordings/` with one mp4 per video and an index.html listing each test's result."""
    target = directory / "recordings"
    target.mkdir(exist_ok=True)
    sections: list[str] = []
    for number, (title, detail, videos) in enumerate(rows, start=1):
        name = f"{number:02d}-{slug(title)}"
        kept = [
            to_mp4(video, target / f"{name}{'' if index == 0 else f'-{index + 1}'}.mp4")
            for index, video in enumerate(videos)
        ]
        players = "".join(
            f'<video controls preload="metadata" src="{html.escape(v.name)}"></video>' for v in kept
        )
        sections.append(
            f"<section><h2>{html.escape(title)}</h2><p>{html.escape(detail)}</p>{players}</section>"
        )
    index = target / "index.html"
    index.write_text(
        "<!doctype html><meta charset=utf-8><title>e2e recordings</title>"
        "<style>body{font:15px system-ui;max-width:1100px;margin:24px auto;padding:0 16px}"
        "video{max-width:100%;max-height:80vh;margin:8px 0;border:1px solid #ddd}"
        "p{color:#666}</style>"
        f"<h1>{html.escape(directory.name)}</h1>{''.join(sections)}"
    )
    return index
