# Arquitetura do backend

## Escopo e stack

Este repositório entrega a API do Reaproveita Franca. É uma aplicação independente dos clientes web e móvel, sem TypeScript e sem etapa de build.

- Node.js e JavaScript CommonJS.
- Express 4 para HTTP REST.
- MySQL 8 com pool compartilhado `mysql2`.
- Socket.IO para comunicação em tempo real.
- `dotenv-safe` para carregamento e validação de variáveis de ambiente.
- Comando principal: `npm start` (`node --watch src/server.js`).

## Inicialização e fluxo de requisição

`src/server.js` cria o servidor HTTP, configura CORS, instancia Socket.IO e registra os handlers de `src/sockets/index.js`. `src/index.js` cria o Express, configura parsers, monta as rotas no prefixo `/api/reaproveitafranca` e executa a verificação de conectividade MySQL.

Fluxo REST predominante:

```text
src/routes/apiRoutes.js
  → src/routes/modules/*Routes.js
  → src/middlewares/* (quando aplicável)
  → src/controllers/*
  → src/services/*
  → src/db/connect.js (pool mysql2)
```

`userController.js` ainda consulta o pool diretamente em diversos fluxos. Não aumente essa exceção automaticamente em código novo; siga o padrão service/controller quando apropriado.

## Organização atual

```text
src/
  controllers/       # HTTP: validação de entrada, status e formato da resposta
  db/                # pool MySQL e teste de conectividade
  middlewares/       # JWT, papel, upload, validação e rate limits
  mysql-init/        # schema inicial e migração social login
  routes/            # montagem da API e rotas por módulo
  services/          # consultas e regras de acesso a dados
  sockets/           # handler Socket.IO atual para entrada em salas de conversa
  utils/             # UUID, documentos e utilitários de e-mail/OTP
```

## Banco e identificadores

- O schema de referência é `src/mysql-init/RFScript.sql`; tabelas não equivalem a APIs implementadas.
- IDs primários e relações UUID usam `BINARY(16)`. Gere UUIDv7 com `utils/uuid.generateId()`, converta com `toBin()` e exponha strings por `BIN_TO_UUID()`/`fromBin()`.
- Use crases para palavras reservadas em SQL, especialmente `user`, `table` e `read`.
- A aplicação pode iniciar mesmo se MySQL estiver indisponível; `testConnect()` apenas registra a falha. Isso não significa que endpoints dependentes do banco funcionarão.

O schema também contém `conversation_participant` para participantes de conversas. A existência dessa tabela não significa que o fluxo de conversa esteja implementado por completo.

## Chat e notificações

Na revisão atual da `main`, `src/sockets/chatSocket.js` implementa somente `join_conversation`, que coloca o socket em uma sala pelo ID recebido. Não há autenticação de socket, persistência de mensagem ou evento de envio implementado. A tabela `notification` está no schema, mas não há controller, rota ou gatilho automático de notificação nesta revisão. Confira [api-contract.md](api-contract.md) e [security-privacy.md](security-privacy.md).
