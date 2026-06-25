# Clientbridge — Code Style & Type Safety (enforced)

Both stacks enforce: **4-space indent · double quotes · semicolons (JS) · strict types · no `Any` ·
full type safety.** All verified green on 2026-06-24.

## Backend (Python)
- **ruff** — `backend/ruff.toml`
  - format: `indent-style=space` (**4 spaces**), `quote-style=double` (**double quotes**), 100 cols.
  - lint: `E F I UP B SIM TID ANN RUF`. **`ANN401` bans explicit `Any`** in signatures; `ANN` requires full annotations.
- **mypy** — `backend/pyproject.toml [tool.mypy]`: `strict = true` + `plugins=["pydantic.mypy"]`.
  - strict bans *implicit* `Any` (untyped defs, bare generics, returning Any) → **full type safety**.
  - JSON columns typed `dict[str, object]` / `list[object]` (Any-free).
- Verified: `ruff check` ✓ · `ruff format --check` ✓ · `mypy src` ✓ **(no issues, 29 files)**.

## Frontend (TypeScript)
- **prettier** — `packages/config/prettier.config.json` (referenced via root `"prettier"` key):
  `tabWidth:4` (**4 spaces**), `semi:true` (**semicolons**), `singleQuote:false` (**double quotes**), `printWidth:100`.
- **eslint** — `packages/config/eslint.config.mjs` + root `eslint.config.mjs`:
  `strictTypeChecked` + `stylisticTypeChecked` (**type-aware**) → bans `any` **and** unsafe-`any` data flows;
  `no-console` error. `projectService` supplies per-package type info.
- **tsconfig** — `tsconfig.base.json`: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
  + `noUnusedLocals/Parameters` + `noImplicitReturns/Override` + `noFallthroughCasesInSwitch` → **full type safety**.
- Verified: `prettier --check` ✓ · `tsc --noEmit` ✓ **(5/5 packages)** · `eslint .` ✓ **(0 problems)**.

## Commands (root)
```
make lint        # backend: ruff check + mypy strict   |  frontend: eslint + tsc
make typecheck   # backend: mypy strict                 |  frontend: tsc --noEmit
make format      # backend: ruff format                 |  frontend: prettier --write
make format-check
```

## CI — `.github/workflows/ci.yml`
Runs on every push / PR (once the repo is on GitHub — `git init` + push first):
- **backend** — `uv sync` · `ruff check` · `ruff format --check` · `mypy src` · `pytest`
- **frontend** — `pnpm install --frozen-lockfile` · `pnpm lint` (eslint) · `pnpm typecheck` (tsc) · `pnpm format:check`
- **schema-drift** — runs `make gen-sync-schema` then `git diff --exit-code` on
  `packages/sync/schema.ts`, so the generated client schema can't drift from the models
  (if it fails: run `make gen-sync-schema` and commit).
