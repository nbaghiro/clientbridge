import json
import pathlib

import pytest
from scripts.check_structure import pyright_problems, suppression_problems

SUPPRESSIONS = [
    "x = 1  # noqa",
    "x = 1  # noqa: E501",
    "x = 1  # type: ignore",
    "x = 1  # type: ignore[assignment]",
    "x = 1  # pyright: ignore",
    "x = 1  # pyright: ignore[reportPrivateUsage]",
    "# pyright: basic",
    "# pyright: strict=false",
    "# mypy: ignore-errors",
    "# ruff: noqa",
    "# ruff: noqa: E501",
    "# fmt: off",
    "# fmt: on",
    "x = 1  # fmt: skip",
    "if x:  # pragma: no cover",
    "if x:  # pragma: no branch",
    "import os  # isort: skip",
    "x = 1  # pylint: disable=unused",
]


@pytest.mark.parametrize("line", SUPPRESSIONS)
def test_structure_check_rejects_each_suppression_comment(line: str) -> None:
    assert suppression_problems(pathlib.Path("example.py"), f"x = 1\n{line}\n") != []


def test_structure_check_accepts_ordinary_comments_and_strings() -> None:
    source = 'x = "# noqa"  # the type is ignored by nobody\n# a pragmatic note\n'
    assert suppression_problems(pathlib.Path("example.py"), source) == []


STRICT_CONFIG = {
    "typeCheckingMode": "strict",
    "include": [
        "backend/src",
        "backend/tests",
        "backend/scripts",
        "backend/e2e",
        "backend/migrations",
    ],
    "reportMissingTypeStubs": False,
    "reportUnknownMemberType": False,
}


@pytest.mark.parametrize(
    "change",
    [
        {"typeCheckingMode": "basic"},
        {"typeCheckingMode": None},
        {"reportPrivateUsage": False},
        {"reportOptionalMemberAccess": "warning"},
        {"reportUnusedVariable": "none"},
        {"ignore": ["backend/scripts"]},
        {"exclude": ["backend/tests"]},
        {"executionEnvironments": [{"root": "backend/src"}]},
        {"include": ["backend/src"]},
    ],
)
def test_structure_check_rejects_a_weakened_pyright_config(
    tmp_path: pathlib.Path, change: dict[str, object]
) -> None:
    config = tmp_path / "pyrightconfig.json"
    config.write_text(json.dumps({**STRICT_CONFIG, **change}))
    assert pyright_problems(config) != []


def test_structure_check_accepts_the_strict_pyright_config(tmp_path: pathlib.Path) -> None:
    config = tmp_path / "pyrightconfig.json"
    config.write_text(json.dumps({**STRICT_CONFIG, "reportImplicitOverride": "error"}))
    assert pyright_problems(config) == []
    assert pyright_problems() == []
