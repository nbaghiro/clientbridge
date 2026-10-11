import ast
import io
import pathlib
import re
import sys
import tokenize

BACKEND = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = BACKEND / "src" / "clientbridge"
TESTS = BACKEND / "tests"
SCRIPTS = BACKEND / "scripts"
CROSS_CUTTING_TESTS = {
    "command",
    "derived",
    "harness",
    "integrity",
    "jobs",
    "ratelimit",
    "scoping",
    "security",
}
CROSS_CUTTING_PREFIXES = ("flows_", "sync_")
BANNER_MARKS = ("# ─", "# ━", "# ===", "# ---", "# ###")
BANNED_SUFFIXES = ("_service", "_jobs")
DIRECTIVES = ("# noqa", "# type:", "# pragma")
NOTIFICATIONS = PACKAGE / "services" / "notifications.py"
COPY_FIELDS = ("subject", "body", "title")
SENDER_PARAMS = {
    "Email": ("to", "subject", "body"),
    "Sms": ("to", "body"),
    "Push": ("tokens", "title", "body", "data"),
    "dispatch_message": ("sms", "email", "channel", "to", "subject", "body"),
}
CSV_ROWS = {"writerow": 1, "writerows": 2}


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
        is_comment_line = (
            token.type == tokenize.COMMENT
            and token.line.strip().startswith("#")
            and not token.string.startswith(DIRECTIVES)
        )
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
            "/" in text and not re.search(r"\s", text)
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


def copy_values(
    node: ast.AST, path: pathlib.Path, constants: dict[str, ast.expr]
) -> list[ast.expr]:
    def resolve(value: ast.expr) -> ast.expr:
        return constants.get(value.id, value) if isinstance(value, ast.Name) else value

    values: list[ast.expr] = []
    if isinstance(node, ast.Call) and call_name(node) in SENDER_PARAMS:
        params = SENDER_PARAMS[call_name(node)]
        values += [arg for name, arg in zip(params, node.args, strict=False) if name in COPY_FIELDS]
        values += [kw.value for kw in node.keywords if kw.arg in COPY_FIELDS]
    if isinstance(node, ast.Call) and call_name(node) in CSV_ROWS and node.args:
        rows = [node.args[0]]
        for _ in range(CSV_ROWS[call_name(node)]):
            rows = [
                e
                for row in map(resolve, rows)
                if isinstance(row, ast.List | ast.Tuple)
                for e in row.elts
            ]
        values += rows
    if path == NOTIFICATIONS and isinstance(node, ast.Return) and node.value is not None:
        returned = node.value
        values += returned.elts if isinstance(returned, ast.Tuple) else [returned]
    if (
        path == NOTIFICATIONS
        and isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id in COPY_FIELDS for t in node.targets)
    ):
        values.append(node.value)
    return [resolve(value) for value in values]


def copy_problems(path: pathlib.Path, tree: ast.Module) -> list[str]:
    constants = {
        target.id: statement.value
        for statement in tree.body
        if isinstance(statement, ast.Assign)
        for target in statement.targets
        if isinstance(target, ast.Name)
    }
    return [
        f"{path}:{node.lineno}: user-facing text outside the catalog; use core.locale message"
        for node in ast.walk(tree)
        if isinstance(node, ast.Call | ast.Return | ast.Assign)
        for value in copy_values(node, path, constants)
        if is_copy(value)
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
    )


def main() -> int:
    problems: list[str] = []
    for path in sorted(PACKAGE.rglob("*.py")):
        problems += layout_problems(path)
        problems += comment_problems(path)
        problems += copy_problems(path, ast.parse(path.read_text()))
    for path in sorted([*TESTS.rglob("*.py"), *SCRIPTS.rglob("*.py")]):
        problems += comment_problems(path)
    known = concepts()
    for path in sorted(TESTS.glob("test_*.py")):
        problems += naming_problems(path, known)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
