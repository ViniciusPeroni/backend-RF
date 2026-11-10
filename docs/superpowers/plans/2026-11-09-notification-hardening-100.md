# Notification Hardening Implementation Plan

> **For agentic workers:** execute inline, tests first, no commit/push without authorization.

**Goal:** fechar as lacunas restantes de notificação: listagem paginada/filtrável, expiração de JWT no socket e fila de retry persistida para falhas de entrega.

**Architecture:** o caminho feliz continua síncrono (`notifyUser` persiste, lê e emite). Se a persistência ou a entrega falhar, o evento é gravado em `notification_retry` com o mesmo UUID e um worker periódico reprocessa com backoff. A listagem ganha `limit`, `offset` e filtros por referência sem quebrar o formato de array. O Socket.IO agenda a desconexão no `exp` do JWT.

**Tech Stack:** Node.js/CommonJS, Express 4, MySQL 8 (`mysql2`), Socket.IO existentes.

**Spec:** escopo definido nesta conversa e em `docs/notification-integration.md`.

## Global Constraints

- Não alterar frontend/mobile, pagamento, review ou disputa.
- Não executar `RFScript.sql` em banco com dados.
- Manter o formato de resposta atual da listagem (array).
- Falha de notificação não desfaz a operação de domínio.
- Sem push/e-mail e sem definir recusa/estorno de pagamento.

## Review Focus

- Retry não pode duplicar uma notificação já persistida.
- Worker não pode travar o processo nem rodar sobreposto.
- Token expirado deve parar de receber eventos.
- Paginação não pode quebrar clientes que não enviam parâmetros.
- Suíte de notificação não pode avisar admins reais.

---

### Task 1: Suíte em banco temporário

**Files:** `scripts/test-notification-suite.js`, `package.json`, `docs/quality.md`.

- [x] Criar wrapper que cria `rf_notification_test_<hex>` a partir dos `CREATE TABLE`/`ALTER TABLE` do schema, executa `tests/notification.integration.js` com `DB_NAME` temporário e remove o banco no `finally`.
- [x] Trocar `test:notification` para o wrapper.
- [x] Rodar `RF_TEST_ALLOW_DB=1 npm run test:notification` e registrar a linha de base.

### Task 2: Fila de retry

**Files:** `src/mysql-init/RFScript.sql`, `src/mysql-init/migration_notification_retry.sql`, `src/services/notificationService.js`, `src/server.js`, `tests/notification.integration.js`.

- [x] Adicionar `notification_retry` (id, payload, persisted, attempts, next_attempt_at, last_error, timestamps, FK user, índice de vencimento) ao schema e à migração aditiva.
- [x] `notifyUser` gera o UUID uma vez; falha no INSERT enfileira `persisted=false`, falha após o INSERT enfileira `persisted=true`, e a operação de domínio segue falhando para o chamador.
- [x] `retryPending({ limit = 20, maxAttempts = 5 })` reivindica linhas com `FOR UPDATE SKIP LOCKED`, reenvia sem duplicar, aplica backoff e descarta após o máximo.
- [x] `startNotificationRetryWorker({ intervalMs = 30000 })` no `server.js`, com guarda de execução sobreposta e `unref`.
- [x] Testes: falha no INSERT → linha de retry → `retryPending` entrega; linha `persisted=true` só emite; repetição não duplica; limpeza de `notification_retry`; worker entrega e não duplica instância.

### Task 3: Listagem paginada e filtrável

**Files:** `src/services/notificationService.js`, `src/controllers/notificationController.js`, `tests/notification.integration.js`.

- [x] `listNotifications(id_user, { read, type, reference_table, reference_id, limit = 50, offset = 0 })` com `ORDER BY created_in DESC, id DESC LIMIT ? OFFSET ?`.
- [x] Controller valida `limit` (1..100), `offset` (0..2147483647), `reference_table` (<=30, com trim) e `reference_id` (UUID), retornando 400 sem consultar.
- [x] Testes HTTP: paginação, filtro por referência, parâmetros inválidos e compatibilidade sem parâmetros.

### Task 4: Expiração de JWT no socket

**Files:** `src/sockets/notificationSocket.js`, `tests/helpers/notificationSocketClient.js`, `tests/notification.integration.js`.

- [x] Agendar `socket.disconnect(true)` no `decoded.exp`, limpando o timer no disconnect; sem `exp`, sem timer.
- [x] Adicionar `waitForClose()` ao cliente de teste.
- [x] Teste: token curto é desconectado; tokens longos continuam funcionando.

### Task 5: Documentação e verificação

**Files:** `docs/api-contract.md`, `docs/architecture.md`, `docs/notification-integration.md`, `docs/quality.md`, `AGENTS.md`.

- [x] Documentar paginação/filtros, retry/worker, expiração e o wrapper de teste.
- [x] Rodar `node --check`, `git diff --check`, `test:notification`, `test:card`; registrar a falha pré-existente de localização se persistir.
- [x] Revisão independente somente leitura dos arquivos alterados.

## Evidências (09/11/2026)

- `node --check` nos arquivos JS alterados: OK.
- `npm run test:notification` em banco temporário: **150 PASS, 0 FAIL, 0 SKIP**.
- `npm run test:card`: **52 PASS, 0 FAIL**.
- `git diff --check`: sem erros.
- `npm run test:localization` não foi reexecutado nesta etapa; a falha de latitude nula é pré-existente e fora do escopo.
- Revisão independente não encontrou bloqueadores; riscos médios de retry/paginação/worker foram corrigidos e revalidados.
- Sem commit ou push: aguardando autorização explícita.
