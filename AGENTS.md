ME SPONDA SEMPRE EM PT-BR
não commite nada e não de push em nada sem minha permissão
bm sempre quando for perguntar, fale em pt-br
não commite e de push no arquivo "AGENTS.MD"
siga o padão de projeto
# AGENTS.md

REST backend for Reaproveita Franca: Node.js (CommonJS) + Express 4 + MySQL 8 + Socket.IO. No TypeScript, no build step.

## Run and verify

- Requires a `.env` at the repo root and a running MySQL 8 instance. `dotenv-safe` loads it at `require` time and **fails startup** if `.env` is missing or lacks any key present in `.env.example`. Add new keys to **both** files.
- `DOCUMENT_ENC_KEY` and `DOCUMENT_HMAC_KEY` must each be 64 hex chars (32 bytes); generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `npm install` then `npm start` (runs `node --watch src/server.js`). `npm run start:dev` requires a **globally installed** `nodemon` — it is not in `package.json`.
- Server listens on `process.env.PORT` or `5000`. All API routes are under `/api/reaproveitafranca` (e.g. `/api/reaproveitafranca/user/login`).
- There are **no tests, lint, typecheck, or build scripts/configs**. Do not invent commands; verify changes with real HTTP requests. Socket.IO can be exercised with `src/sockets/test/socket-test.html` (expects port 5000).
- The app still boots if MySQL is unreachable; `testConnect()` only logs the failure.

## Architecture

- `src/server.js` creates the HTTP server and Socket.IO; `src/index.js` builds the Express app, mounts routes, and runs the DB connectivity check.
- Request flow: `src/routes/modules/*` → `src/controllers/*` → `src/services/*` → `src/db/connect.js` (a shared `mysql2` pool). `userController.js` is the exception: it queries the pool directly instead of using a service.
- All user-facing messages are in Portuguese. Controllers return `{ error: "..." }` on failure and `{ message, ... }` on success — keep that shape.
- `src/services/userServices.js` and `src/middlewares/verifyUuid.js` are unused legacy helpers; don't extend them expecting they are wired up.
- Socket.IO only implements chat rooms (`join_conversation`); there is no socket authentication and clients can join any conversation id.

## Database

- Full schema: `src/mysql-init/RFScript.sql`. **It starts with `DROP DATABASE IF EXISTS Reaproveita_Franca`** — never run it against a database whose data matters.
- `src/mysql-init/migration_social_login.sql` is the additive migration for databases created before Google/LinkedIn login (makes `password`/`cellphone` nullable and adds `google_id`/`linkedin_id`).
- No migration framework or ORM is used. Schema changes are hand-written SQL applied manually, in order.
- Reserved words `user`, `table`, and `read` are always backticked in SQL.
- All primary keys are `BINARY(16)` UUIDv7. Convert at the boundary: use `utils/uuid.toBin()` for query params and `BIN_TO_UUID(col) AS col` in `SELECT`s. Never pass raw UUID strings into `BINARY(16)` columns.
- User statuses: `awaitingForEmail` (default on signup, activated by OTP), `firstLogin` (admin created with generated password), `active`, `inactive`.
- CPF/CNPJ are never stored in plaintext: `document.doc_hmac` (HMAC-SHA256) is used for duplicate checks and `doc_enc`/`doc_iv`/`doc_tag` hold AES-256-GCM ciphertext. Reuse `services/docService.js`, not raw queries. Rotating the env keys makes existing rows undecryptable and breaks dedupe.

## Auth, middleware, and quotas

- JWTs last 8h and are signed with `SECRET`; `verifyJWT` accepts either a raw token or `Bearer <token>` and sets `req.userId`, `req.role`, `req.userName`.
- Ordering in `src/routes/modules/userRoutes.js` is positional and easy to break: everything after `router.use(verifyJWT)` requires auth, and everything after `router.use(roleMiddleware(['admin']))` is admin-only. Put new routes in the correct block.
- Signup routes run `forceUserRole`, which deletes `req.body.role`; role is derived from the endpoint, so client-supplied roles are ignored by design.
- `globalLimiter` applies to all `/user` routes (100 req/15 min); `authLimiter` applies to login/password-forgot (5 req/15 min). Repeated manual login attempts will return 429. OTP resend also has an in-memory 30 s per-user cooldown.
- CORS origins are hardcoded to `http://localhost:3000` in `src/server.js`. `FRONTEND_URL` is used only to build the password-reset link.

## Known gotchas

- `src/index.js` requires `./db/testConnect`, but the file is `src/db/testconnect.js`. This works on Windows/macOS but **fails on case-sensitive filesystems (Linux/CI)**. If you touch startup, fix the casing.
- `src/cron.js` is commented out in `src/index.js` and calls an undefined `cleanUpMessages`; enabling it as-is will crash. The cleanup service was never implemented.
- `productService` expects already-converted binary IDs from controllers; keep conversions in controllers for product routes.
- Git history/branches use Conventional Commit messages (`feat(api): ...`, `fix(database): ...`) and `feature/<owner>/<scope>` branches merged into `main` via PRs.

## Documentação do repositório

- Comece por [`docs/README.md`](docs/README.md) para ver a ordem recomendada de leitura e o mapa da documentação.
- [`docs/architecture.md`](docs/architecture.md): arquitetura, camadas, inicialização e banco de dados.
- [`docs/api-contract.md`](docs/api-contract.md): rotas, autenticação, eventos Socket.IO e lacunas conhecidas.
- [`docs/product.md`](docs/product.md): contexto do produto e status verificado das funcionalidades.
- [`docs/security-privacy.md`](docs/security-privacy.md): autenticação, dados pessoais e riscos de autorização.
- [`docs/quality.md`](docs/quality.md): verificações disponíveis e roteiro de testes.
- [`docs/agent-workflow.md`](docs/agent-workflow.md) e [`docs/feature-readiness.md`](docs/feature-readiness.md): fluxo de trabalho e evidências para declarar conclusão.
- [`docs/integration-workflow.md`](docs/integration-workflow.md), [`docs/decisions.md`](docs/decisions.md) e [`docs/adr/README.md`](docs/adr/README.md): integração entre aplicações e decisões técnicas.
Considere os documentos como referências da implementação observada. Se houver divergência, confira rotas, controllers, services e schema atuais antes de assumir que a documentação está atualizada.
