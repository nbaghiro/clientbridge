import ast
import io
import json
import pathlib
import re
import sys
import tokenize

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = BACKEND / "src" / "clientbridge"
TESTS = BACKEND / "tests"
SCRIPTS = BACKEND / "scripts"
MIGRATIONS = BACKEND / "migrations"
PYRIGHT_CONFIG = BACKEND.parent / "pyrightconfig.json"
PYRIGHT_RELAXED = {
    "reportMissingTypeStubs",
    "reportUnknownArgumentType",
    "reportUnknownMemberType",
    "reportUnknownParameterType",
    "reportUnknownVariableType",
}
PYRIGHT_HIDING = ("ignore", "exclude", "executionEnvironments")
PYRIGHT_INCLUDE = {"backend/src", "backend/tests", "backend/scripts", "backend/migrations"}
CROSS_CUTTING_TESTS = {
    "command",
    "db",
    "derived",
    "harness",
    "integrity",
    "jobs",
    "ratelimit",
    "scoping",
    "security",
    "structure",
}
CROSS_CUTTING_PREFIXES = ("flows_", "sync_")
BANNER_MARKS = ("# ─", "# ━", "# ===", "# ---", "# ###")
BANNED_SUFFIXES = ("_service", "_jobs")
SUPPRESSION = re.compile(
    r"#\s*(noqa\b|type:\s*ignore|pyright\s*:|mypy\s*:|ruff\s*:|fmt\s*:|pragma\b|isort\s*:|pylint\s*:)",
    re.IGNORECASE,
)
NOTIFICATIONS = PACKAGE / "services" / "notifications.py"
ZONES = PACKAGE / "core" / "zones.py"
ZONE_READERS = ("ZoneInfo", "available_timezones", "reset_tzpath")
COPY_FIELDS = ("subject", "body", "title")
SENDER_PARAMS = {
    "Email": ("to", "subject", "body"),
    "Sms": ("to", "body"),
    "Push": ("tokens", "title", "body", "data"),
    "dispatch_message": ("sms", "email", "channel", "to", "subject", "body"),
}
CSV_ROWS = {"writerow": 1, "writerows": 2}
STORED_COPY = ("description", "interval_description", "product_name")
API_DOCS = ("Field", "Query", "Path", "Body", "Header", "FastAPI", "APIRouter")
API_DOC_FIELDS = ("description", "summary", "title")
SENTENCE = re.compile(r"\s*[A-Z][a-z']+,?\s+[A-Za-z]")


def docstring_problems(path: pathlib.Path, tree: ast.Module) -> list[str]:
    problems = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            doc = ast.get_docstring(node, clean=True)
            if doc is not None and "\n" in doc:
                line = 1 if isinstance(node, ast.Module) else node.lineno
                problems.append(f"{path}:{line}: docstring longer than one line")
    return problems


def comment_block_problems(path: pathlib.Path, source: str) -> list[str]:
    problems = []
    run_start, run_length = 0, 0
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        is_comment_line = token.type == tokenize.COMMENT and token.line.strip().startswith("#")
        if is_comment_line:
            if run_length and token.start[0] == run_start + run_length:
                run_length += 1
            else:
                if run_length >= 2:
                    problems.append(f"{path}:{run_start}: comment block longer than one line")
                run_start, run_length = token.start[0], 1
        elif token.type not in (tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT):
            if run_length >= 2:
                problems.append(f"{path}:{run_start}: comment block longer than one line")
            run_length = 0
    if run_length >= 2:
        problems.append(f"{path}:{run_start}: comment block longer than one line")
    return problems


def suppression_problems(path: pathlib.Path, source: str) -> list[str]:
    return [
        f"{path}:{token.start[0]}: suppression comment; fix the cause instead"
        for token in tokenize.generate_tokens(io.StringIO(source).readline)
        if token.type == tokenize.COMMENT and SUPPRESSION.search(token.string)
    ]


def pyright_problems(path: pathlib.Path = PYRIGHT_CONFIG) -> list[str]:
    config: dict[str, object] = json.loads(path.read_text())
    problems: list[str] = []
    if config.get("typeCheckingMode") != "strict":
        problems.append(f'{path}: typeCheckingMode must be "strict"')
    problems += [
        f"{path}: {key} is weaker than error; only {sorted(PYRIGHT_RELAXED)} may be"
        for key, value in config.items()
        if key.startswith("report") and key not in PYRIGHT_RELAXED and value not in (True, "error")
    ]
    problems += [
        f"{path}: {key} hides files or diagnostics from the check; fix them instead"
        for key in PYRIGHT_HIDING
        if key in config
    ]
    include = config.get("include")
    covered = {str(entry) for entry in include} if isinstance(include, list) else set()
    problems += [
        f"{path}: include must cover {folder}" for folder in sorted(PYRIGHT_INCLUDE - covered)
    ]
    return problems


def banner_problems(path: pathlib.Path, source: str) -> list[str]:
    return [
        f"{path}:{number}: divider banner"
        for number, line in enumerate(source.splitlines(), 1)
        if line.strip().startswith(BANNER_MARKS)
    ]


def static_text(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(static_text(part) or "" for part in node.values)
    return None


def is_copy(node: ast.expr) -> bool:
    text = static_text(node)
    if text is not None:
        # a URL or path is an address, not text a reader sees
        return bool(re.search("[A-Za-z]", text)) and not (
            "/" in text and not re.search(r"\s", text.strip())
        )
    if isinstance(node, ast.BinOp):
        return is_copy(node.left) or is_copy(node.right)
    if isinstance(node, ast.IfExp):
        return is_copy(node.body) or is_copy(node.orelse)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        return node.func.attr in ("format", "join") and is_copy(node.func.value)
    return False


def call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return node.func.id if isinstance(node.func, ast.Name) else ""


Sinks = dict[str, dict[int | str, int]]


def assigned(scope: ast.AST) -> dict[str, list[ast.expr]]:
    values: dict[str, list[ast.expr]] = {}
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    values.setdefault(target.id, []).append(node.value)
        elif (
            isinstance(node, ast.AnnAssign | ast.AugAssign)
            and node.value is not None
            and isinstance(node.target, ast.Name)
        ):
            values.setdefault(node.target.id, []).append(node.value)
    return values


def sink_args(node: ast.Call, path: pathlib.Path, wrappers: Sinks) -> list[tuple[ast.expr, int]]:
    """Each argument of a call that reaches readers, with how deeply it nests rows of cells."""
    name = call_name(node)
    found: list[tuple[ast.expr, int]] = []
    if name in SENDER_PARAMS:
        params = SENDER_PARAMS[name]
        found += [(a, 0) for p, a in zip(params, node.args, strict=False) if p in COPY_FIELDS]
        found += [(kw.value, 0) for kw in node.keywords if kw.arg in COPY_FIELDS]
    if name in CSV_ROWS and node.args:
        found.append((node.args[0], CSV_ROWS[name]))
    if path.parent.name == "services":
        found += [(kw.value, 0) for kw in node.keywords if kw.arg in STORED_COPY]
    for key, depth in wrappers.get(name, {}).items():
        if isinstance(key, int) and key < len(node.args):
            found.append((node.args[key], depth))
        found += [(kw.value, depth) for kw in node.keywords if kw.arg == key]
    return found


def cells(value: ast.expr, depth: int, names: dict[str, list[ast.expr]]) -> list[ast.expr]:
    """The texts a value holds, following names, rows and branches."""
    seen: set[int] = set()

    def walk(node: ast.expr, level: int) -> list[ast.expr]:
        if id(node) in seen:
            return []
        seen.add(id(node))
        if isinstance(node, ast.Name):
            return [t for v in names.get(node.id, []) for t in walk(v, level)]
        if isinstance(node, ast.IfExp):
            return walk(node.body, level) + walk(node.orelse, level)
        if isinstance(node, ast.Starred):
            return walk(node.value, level)
        if level > 0:
            if isinstance(node, ast.List | ast.Tuple):
                return [t for e in node.elts for t in walk(e, level - 1)]
            return []
        return [node]

    return walk(value, depth)


def wrappers_of(tree: ast.Module, path: pathlib.Path) -> Sinks:
    """Module functions that hand a parameter to a sink are sinks for that argument."""
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef | ast.AsyncFunctionDef)]
    wrappers: Sinks = {}
    changed = True
    while changed:
        changed = False
        for fn in functions:
            params = [a.arg for a in fn.args.args]
            for call in (n for n in ast.walk(fn) if isinstance(n, ast.Call)):
                for arg, depth in sink_args(call, path, wrappers):
                    if isinstance(arg, ast.Name) and arg.id in params:
                        index = params.index(arg.id)
                        entry = wrappers.setdefault(fn.name, {})
                        if entry.get(index) != depth:
                            entry[index] = entry[arg.id] = depth
                            changed = True
    return wrappers


def copy_problems(path: pathlib.Path, tree: ast.Module) -> list[str]:
    functions = (ast.FunctionDef, ast.AsyncFunctionDef)
    constants = assigned(ast.Module([n for n in tree.body if not isinstance(n, functions)], []))
    wrappers = wrappers_of(tree, path)
    lines: set[int] = set()
    for scope in [tree, *(n for n in ast.walk(tree) if isinstance(n, functions))]:
        names = constants if scope is tree else {**constants, **assigned(scope)}
        for node in ast.walk(scope):
            values: list[tuple[ast.expr, int]] = []
            if isinstance(node, ast.Call):
                values = sink_args(node, path, wrappers)
            if path == NOTIFICATIONS and isinstance(node, ast.Return) and node.value is not None:
                returned = node.value
                parts = returned.elts if isinstance(returned, ast.Tuple) else [returned]
                values = [(part, 0) for part in parts]
            if path == NOTIFICATIONS and isinstance(node, ast.Assign | ast.AugAssign):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                if any(isinstance(t, ast.Name) and t.id in COPY_FIELDS for t in targets):
                    values = [(node.value, 0)]
            if isinstance(node, ast.stmt | ast.expr) and any(
                is_copy(text) for value, depth in values for text in cells(value, depth, names)
            ):
                lines.add(node.lineno)
    return [
        f"{path}:{line}: user-facing text outside the catalog; use core.locale message"
        for line in sorted(lines)
    ]


def prose_problems(path: pathlib.Path, tree: ast.Module) -> list[str]:
    """A capitalized sentence is copy wherever it appears; developer text starts in lowercase."""
    skip: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Raise) or (
            isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
        ):
            skip.update(id(n) for n in ast.walk(node))
        if isinstance(node, ast.Call) and call_name(node) in API_DOCS:
            skip.update(id(n) for n in ast.walk(node))
        if isinstance(node, ast.keyword) and node.arg in API_DOC_FIELDS:
            skip.update(id(n) for n in ast.walk(node.value))
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values, strict=True):
                if isinstance(key, ast.Constant) and key.value == "description":
                    skip.update(id(n) for n in ast.walk(value))
    lines = {
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant | ast.JoinedStr)
        and id(node) not in skip
        and SENTENCE.match(static_text(node) or "")
    }
    return [
        f"{path}:{line}: user-facing text outside the catalog; use core.locale message"
        for line in sorted(lines)
    ]


def zone_problems(path: pathlib.Path, tree: ast.Module) -> list[str]:
    """Zone data has one reader, core/zones.py, and SQL never converts zones itself."""
    if path == ZONES:
        return []
    return [
        f"{path}:{node.lineno}: read time zones through core.zones"
        for node in ast.walk(tree)
        if (isinstance(node, ast.Call) and call_name(node) in ZONE_READERS)
        or (isinstance(node, ast.Constant) and "AT TIME ZONE" in str(node.value).upper())
    ]


def concepts() -> set[str]:
    return {p.stem for layer in ("services", "api") for p in (PACKAGE / layer).glob("*.py")}


def naming_problems(path: pathlib.Path, known: set[str]) -> list[str]:
    name = path.stem.removeprefix("test_")
    if name in CROSS_CUTTING_TESTS or name.startswith(CROSS_CUTTING_PREFIXES):
        return []
    if any(name == concept or name.startswith(f"{concept}_") for concept in known):
        return []
    return [f"{path}: name a test file test_<concept>[_<aspect>] after a services/ or api/ file"]


def layout_problems(path: pathlib.Path) -> list[str]:
    problems = []
    relative = path.relative_to(PACKAGE)
    if len(relative.parts) > 2:
        problems.append(f"{path}: nested deeper than clientbridge/<layer>/<file>.py")
    if path.stem.endswith(BANNED_SUFFIXES):
        problems.append(f"{path}: name the file by its concept, without a suffix")
    return problems


def comment_problems(path: pathlib.Path) -> list[str]:
    source = path.read_text()
    return (
        docstring_problems(path, ast.parse(source))
        + comment_block_problems(path, source)
        + banner_problems(path, source)
        + suppression_problems(path, source)
    )


def main() -> int:
    problems: list[str] = []
    for path in sorted(PACKAGE.rglob("*.py")):
        problems += layout_problems(path)
        problems += comment_problems(path)
        tree = ast.parse(path.read_text())
        problems += (
            copy_problems(path, tree) + prose_problems(path, tree) + zone_problems(path, tree)
        )
    for path in sorted([*TESTS.rglob("*.py"), *SCRIPTS.rglob("*.py")]):
        problems += comment_problems(path)
    for path in sorted(MIGRATIONS.rglob("*.py")):
        problems += suppression_problems(path, path.read_text())
    problems += pyright_problems()
    known = concepts()
    for path in sorted(TESTS.glob("test_*.py")):
        problems += naming_problems(path, known)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
