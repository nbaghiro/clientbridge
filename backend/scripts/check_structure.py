import ast
import io
import pathlib
import sys
import tokenize

PACKAGE = pathlib.Path(__file__).resolve().parents[1] / "src" / "clientbridge"
BANNED_SUFFIXES = ("_service", "_jobs")
DIRECTIVES = ("# noqa", "# type:", "# pragma")


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


def layout_problems(path: pathlib.Path) -> list[str]:
    problems = []
    relative = path.relative_to(PACKAGE)
    if len(relative.parts) > 2:
        problems.append(f"{path}: nested deeper than clientbridge/<layer>/<file>.py")
    if path.stem.endswith(BANNED_SUFFIXES):
        problems.append(f"{path}: name the file by its concept, without a suffix")
    return problems


def main() -> int:
    problems: list[str] = []
    for path in sorted(PACKAGE.rglob("*.py")):
        source = path.read_text()
        problems += layout_problems(path)
        problems += docstring_problems(path, ast.parse(source))
        problems += comment_block_problems(path, source)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
