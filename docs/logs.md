# Logs e auditoria

Módulo de auditoria do backend: CRUD em `/log` e registro automático das operações de escrita do sistema. Fonte da verdade é o código: `src/controllers/logController.js`, `src/services/logService.js`, `src/services/auditService.js`, `src/middlewares/auditLog.js` e `src/routes/modules/logRoutes.js`.

## Modelo de dados

Tabela `log` (definição em `RFScript.sql`, migração em `migration_log_audit.sql`):

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `BINARY(16)` | UUIDv7 gerado pelo serviço |
| `reference_id` | `BINARY(16)` NULL | Registro afetado, quando identificável |
| `id_user` | `BINARY(16)` NULL | Autor autenticado; NULL em ações anônimas |
| `status` | `VARCHAR(50)` | `sucesso` ou `falha` na auditoria automática |
| `operation` | `VARCHAR(20)` | `create`, `update`, `delete`, `login`, `callback`, `read`, `other` |
| `table` | `VARCHAR(20)` | Primeiro segmento da rota (ex.: `product`, `shopping-product`) |
| `description` | `VARCHAR(255)` NULL | Método + caminho + status HTTP |
| `ip` | `VARCHAR(45)` NULL | IP do cliente (suporta IPv6) |
| `user_agent` | `VARCHAR(255)` NULL | User-agent truncado |
| `datetime` | `DATETIME` | `CURRENT_TIMESTAMP` |

A migração aditiva `src/mysql-init/migration_log_audit.sql` cria as colunas, índices e a FK `fk_log_user` (`user(id)`, `ON DELETE SET NULL`). Aplique uma vez em banco existente; não execute `RFScript.sql` (destrutivo) em dados importantes.

## Endpoints (JWT + admin)

Todas as rotas exigem `verifyJWT` e papel `admin`.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/log/` | Cria entrada manual. Obrigatórios: `status`, `operation`, `table`. Opcionais: `reference_id`, `id_user`, `description`. Sem `id_user`, usa o administrador autenticado |
| `GET` | `/log/` | Lista com filtros e paginação; retorna `{ total, limit, offset, logs }` |
| `GET` | `/log/:id` | Detalhe; UUID inválido 400, inexistente 404 |
| `PUT` | `/log/:id` | Atualiza `status`, `operation`, `table`, `description`; exige ao menos um campo |
| `DELETE` | `/log/:id` | Exclui; inexistente 404 |

Filtros de `GET /log/`: `reference_id`, `id_user`, `status`, `operation`, `table`, `from`, `to` (formato `YYYY-MM-DD` ou `YYYY-MM-DD HH:MM:SS`; datas sem hora são inclusivas, `to` usa 23:59:59), `limit` (1–200, padrão 50) e `offset`.

`id`, `datetime`, `reference_id` e `id_user` não são editáveis por `PUT`, preservando a integridade do rastro.

## Auditoria automática HTTP

`src/middlewares/auditLog.js` é montado no topo de `src/routes/apiRoutes.js`. A cada resposta `finish` de um método auditado, chama `auditService.recordAudit`, que grava via `logService`.

- Métodos sempre auditados: `POST`, `PUT`, `PATCH`, `DELETE`.
- `GET` só é auditado com `AUDIT_LOG_READS=1|true` (padrão desativado para não inundar a tabela).
- `status`: `sucesso` para HTTP < 400; `falha` caso contrário.
- `operation`: `login` para caminhos com `/login`, `callback` para `/webhook` e `/callback`, senão derivado do verbo.
- `table`: primeiro segmento após `/api/reaproveitafranca`.
- `reference_id`: primeiro UUID encontrado em params, body (`reference_id`/`id`) ou na resposta JSON.
- `description`: `MÉTODO /caminho -> status` (sem query string).
- Nunca persiste corpo, headers, senhas, tokens ou conteúdo de mensagem.
- A gravação é assíncrona e best-effort: falha de auditoria não altera a resposta HTTP e não desfaz a operação.

## Auditoria de Socket.IO

Eventos em `src/sockets/chatSocket.js` chamam `auditSocket` (que usa `auditService.recordAudit`):

| Evento | `operation` | `table` | `reference_id` |
|---|---|---|---|
| `get_or_create_conversation` | `create`/`other` | `conversation` | conversa |
| `send_message` | `create` | `message` | mensagem criada |
| `edit_message` | `update` | `message` | mensagem |
| `delete_message` | `delete` | `message` | mensagem |
| `mark_read` | `update` | `message` | conversa |
| `leave_conversation` | `delete` | `conversation` | conversa |
| `load_conversations` / `load_messages` | `read` | `conversation`/`message` | somente com `AUDIT_LOG_READS` |

Falhas desses eventos também são registradas com `status='falha'`. Conteúdo de mensagem não entra na auditoria.

## Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `AUDIT_LOG_READS` | `1`/`true` audita também `GET` e leituras via socket; padrão desativado |
| `DB_HOST`, `DB_NAME` | Sem ambos, a auditoria automática fica desativada (usado nos testes de rota) |

## Testes

`npm run test:log` executa `test/logRoutes.test.js` e `test/chatSocketAudit.test.js` sem banco (services mockados): autenticação, papel admin, validação, paginação, auditoria automática HTTP, leitura configurável, 20 escritas concorrentes, sanitização de campos e auditoria de sucesso/falha do `send_message` via socket.

`npm run test:log:db` executa `tests/log.integration.js` com MySQL real (`RF_TEST_ALLOW_DB=1`): cria usuários sintéticos, exercita `/log`, `/card` e `/product`, confere as linhas de auditoria (sucesso, falha, `reference_id`, IP, user-agent e leitura habilitada) e remove tudo no final. Resultado em 10/11/2026: 21 PASS, 0 FAIL.

Teste manual anterior com MySQL real (10/11/2026): CRUD de `/log`, falha em `/product/create`, criação/exclusão de cartão e conferência das linhas geradas; dados de teste removidos.

## Limitações

- Auditoria não é transacional com a operação original: pode haver operação confirmada sem log se o banco falhar logo depois.
- Não há retenção, rotação, exportação ou painel de consulta além da API.
- Alterações feitas diretamente no banco (fora de HTTP/Socket.IO) não são auditadas.
- Não há garantia de entrega única: repetição de requisição gera nova entrada.
