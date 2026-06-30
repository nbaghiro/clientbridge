# Clientbridge — Local Ports

Clientbridge claims the **87xx** block so it runs **simultaneously** with the other projects in
`~/Documents/code` (+ `~/PocketSuite`). Every host port below is unique across those projects
(verified 2026-06-24). Update this file when adding a service.

## Clientbridge — 8700–8708
| Port | Service | Maps to | Set in |
|---|---|---|---|
| **8700** | Web (Vite dev) | — | `frontend/apps/web` vite.config (strictPort) · Makefile `dev-web` |
| **8701** | Backend API (FastAPI/uvicorn) | — | Makefile `dev-api` · `API_PORT` |
| **8702** | Postgres (source DB + `powersync_storage`) | container `5432` | docker-compose · `DATABASE_URL` |
| **8703** | Redis | container `6379` | docker-compose · `REDIS_URL` |
| **8704** | PowerSync service | container `8080` | docker-compose · `POWERSYNC_URL` |
| **8705** | MinIO — S3 API | container `9000` | docker-compose · `S3_ENDPOINT` |
| **8706** | MinIO — console | container `9001` | docker-compose |
| **8707** | Expo / Metro (mobile) | — | Makefile `dev-mobile` |
| **8708** | stripe-mock (contract tests only) | container `12111` | docker-compose `profiles: [test]` · `make stripe-mock` |

*Container-internal ports stay conventional (5432/6379/8080/9000); only host mappings use 87xx.*

## Sibling projects (observed — do not reuse)
| Project | Host ports in use |
|---|---|
| **sourcewell** | 8900 web · 8901 api · 8902 postgres · 8904 mailpit-ui · 8905 smtp |
| **llamatrade** | 8800 web · 8810–8880 microservices (auth/strategy/backtest/market-data/trading/portfolio/notification/billing) · 5442 pg · 6389 redis · 5433/6380 test · 12111/12112 stripe-mock |
| **flowmaestro** | 3000 web · 3001 api · 4000 · 5173/5174 marketing · 5555 docs · 5432 pg · 6379 redis · 7233 temporal |
| **nbaghiro** | 3100 server · 5283 client |
| **branchpad** | 17600 renderer · 17601 hmr (Electron) |
| **galleo** | 8600 studio (Vite) · 8601 api · 8602 pg · 8603 redis · 8604/8605 minio · 8606 preview — 86xx block (8600 active, rest reserved) |
| **PocketSuite** | 3000 · 25000 · redis (default) |
