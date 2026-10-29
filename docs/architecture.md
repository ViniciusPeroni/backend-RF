# Arquitetura do backend

## Escopo e stack

Este repositório contém a API do Reaproveita Franca. Web e mobile são aplicações independentes. Backend em JavaScript CommonJS, Node.js, Express 4, MySQL 8 via `mysql2`, Socket.IO e `dotenv-safe`; não há TypeScript nem etapa de build.

## Inicialização e fluxo

- `npm start` executa `node --watch src/server.js`.
- `src/server.js` importa o Express, configura CORS, cria HTTP/Socket.IO, registra sockets e escuta em `PORT` ou `5000`.
- `src/index.js` carrega ambiente, cria parsers e rotas, chama o teste de conexão MySQL e monta `/api/reaproveitafranca`.
- `src/index.js` tenta `dotenv-safe` e captura falhas para recorrer a `dotenv`. Não assuma validação fatal sem conferir o boot real.

Fluxo REST mais comum:

```text
src/routes/apiRoutes.js
  → src/routes/modules/*Routes.js
  → src/middlewares/* (quando montado)
  → src/controllers/*
  → src/services/* (quando utilizado)
  → src/db/connect.js (pool mysql2)
```

`userController.js` consulta o pool diretamente em diversos caminhos. Considere isso uma exceção existente, não um padrão novo. `src/services/userServices.js` e `src/middlewares/verifyUuid.js` são helpers legados não conectados ao fluxo atual.

## Organização

```text
src/
  controllers/       # entrada HTTP, validação/status/respostas
  db/                # pool e conectividade
  middlewares/       # JWT, papel, upload, validação, limites
  mysql-init/        # schema inicial e migração SQL
  routes/            # montagem e módulos REST
  services/          # acesso a dados/regras compartilhadas
  sockets/           # handlers Socket.IO
  utils/             # UUID, documentos e utilitários
```

## Banco e IDs

- Schema base: `src/mysql-init/RFScript.sql`; começa removendo e recriando `Reaproveita_Franca`. Não executar em banco com dados importantes.
- `src/mysql-init/migration_social_login.sql` é uma migração SQL manual/aditiva. Não há ORM nem framework de migrations.
- UUIDv7 é exposto como string e armazenado como `BINARY(16)`. Use `src/utils/uuid.js` na fronteira e `BIN_TO_UUID()` nas leituras; confira os módulos existentes antes de alterar padrão.
- Use crases para identificadores reservados como `user`, `table` e `read`.
- O boot pode continuar sem MySQL; falha de conectividade no log não comprova disponibilidade dos endpoints.
- A tabela `conversation_participant` e tabelas de domínio não demonstram fluxos REST/socket implementados.

## Chat e notificações

`notificationSocket.js` verifica JWT para adicionar o usuário à sala `user:<uuid>`. `send_message` exige identidade autenticada, confere participação em `conversation_participant`, persiste a mensagem e atualiza a conversa e o último item lido do remetente. Cada outro participante recebe `new_message` e uma notificação `nova_mensagem` persistida.

`join_conversation` exige autenticação, UUID válido e participação em `conversation_participant`. Cadastro e ativação por OTP também geram notificações `sistema`; a criação de compra gera `reserva_solicitada` para cada vendedor, o aceite/recusa gera `reserva_aceita`/`reserva_recusada` para o comprador e o cancelamento gera `sistema` para cada vendedor. `src/cron.js` está desativado e chama `cleanUpMessages`, que não está implementado.

`shoppingService.updateStatus(id, newStatus, { onlyPending = false } = {})` lê o status sob `SELECT ... FOR UPDATE`, aplica as restrições e retorna `{ shopping, previousStatus, changed }`. A compra retornada é lida na mesma conexão/transação antes do commit. Os controllers preservam a resposta HTTP e só notificam se `changed`; `/cancel` também valida `pending` sob o lock. Falhas de notificação não desfazem a transição já confirmada. Não há outbox/fila/retry persistente: uma queda entre commit e aviso pode deixar de produzir a notificação.

## Riscos de compatibilidade

`src/index.js` requer `./db/testConnect`, mas o arquivo no repositório é `src/db/testconnect.js`. A resolução pode funcionar em Windows/macOS e falhar em filesystem sensível a caixa (Linux/CI). Não confunda compatibilidade local com portabilidade.
