# Instruções para agentes — backend Reaproveita Franca

## Regras obrigatórias

- Autorização pontual de Bryan em 29/10/2026: concluir o módulo de pagamentos e preparar Mercado Pago diretamente no código, exclusivamente em `feature/bryan/PaymentController` neste repositório. Vale somente para esta etapa; não autoriza edições futuras ou em outros projetos/branches. Altere somente lógica de pagamentos; peça autorização antes de alterar outra parte da API.

- Responda sempre em português brasileiro, inclusive perguntas e relatórios.
- Não crie, altere ou exclua arquivos de código sem autorização explícita de Bryan para a alteração solicitada. Por padrão, apenas oriente, leia e revise o código. A única exceção é o arquivo `AGENTS.md`, que pode ser atualizado. Pedidos de orientação ou de execução de testes não autorizam alterações no código; testes e operações no banco devem respeitar o escopo autorizado.
- Não faça commit nem push sem autorização explícita. Não edite os projetos irmãos `FrontEnd-RF/` e `Mobile-RF/` em tarefas restritas ao backend.
- Siga o padrão existente e mantenha alterações no escopo pedido. Não implemente requisitos futuros só porque aparecem no TCC, schema ou documentação.
- Nunca exponha ou registre segredos, tokens ou dados pessoais reais. Nunca armazene CPF/CNPJ em texto puro.
- Não execute `src/mysql-init/RFScript.sql` em banco com dados importantes: o script remove e recria `Reaproveita_Franca`.

## Orientação rápida

- Backend REST em Node.js/CommonJS, Express 4, MySQL 8 (`mysql2`) e Socket.IO. Sem TypeScript ou etapa de build.
- `npm start` inicia `node --watch src/server.js`; porta `PORT` ou `5000`.
- Prefixo da API: `/api/reaproveitafranca`. `.env.example` lista as variáveis de ambiente esperadas.
- Há teste específico de pagamentos em `scripts/test-payment-integration.js`, com MySQL real e transporte externo interceptado; exige `RUN_PAYMENT_DB_TESTS=1`, nunca produção. Não há suíte geral, lint, typecheck ou build. Use `node --check` para sintaxe; configuração e cURLs em `docs/payments.md`.
- Também existem `npm run test:notification`, `npm run test:card` e `npm run test:localization`, que exigem `RF_TEST_ALLOW_DB=1` e MySQL de desenvolvimento. São coberturas parciais; use `node --check` para sintaxe e testes HTTP reais quando o ambiente permitir.

## Fluxo de trabalho do agente

1. Entenda o objetivo, o escopo e as evidências esperadas. Faça perguntas em pt-BR se uma decisão de negócio, segurança ou contrato bloquear o trabalho.
2. Consulte [`docs/README.md`](docs/README.md) e abra os guias relevantes à tarefa; não carregue toda a documentação sem necessidade.
3. Inspecione o código e o schema atuais. Prioridade: implementação executável → schema/configuração → documentação → hipótese. Não trate documentação como garantia de que o código não mudou.
4. Siga o fluxo rotas → controllers → services → banco quando adequado. Converta UUID na fronteira e preserve formatos de resposta existentes.
5. Faça a menor mudança que atenda ao pedido. Não amplie APIs, dependências ou regras de negócio sem necessidade e autorização.
6. Verifique proporcionalmente à mudança, revise segurança e diff, e informe comandos/resultados e o que não foi testado.

## Arquitetura e pontos de atenção

- `src/server.js` cria HTTP/Socket.IO; `src/index.js` configura Express e monta rotas; módulos em `src/routes/modules/` encaminham para controllers.
- `userController.js` acessa o pool diretamente em vários fluxos; `src/services/userServices.js` e `src/middlewares/verifyUuid.js` são helpers legados não utilizados.
- `notificationSocket.js` valida o JWT para associar sockets à sala individual; `send_message` e `join_conversation` exigem identidade autenticada e participação na conversa. A validação do JWT para ingresso ocorre na conexão; não há desconexão automática quando o token expira depois dela.
- Notificações automáticas atuais: mensagem nova, cadastro de conta, ativação por OTP, criação de compra (`reserva_solicitada` para cada vendedor), aceite/recusa (`reserva_aceita`/`reserva_recusada` para o comprador) e cancelamento (`sistema` para cada vendedor). Pagamento, review e disputa ainda dependem dos respectivos fluxos.
- Compras estão implementadas em `/shopping/*`; `PATCH /shopping/:id/status` permite qualquer status ao admin e apenas `accepted`/`refused` ao vendedor único dos itens. Comprador não usa essa rota; o cancelamento do comprador ocorre em `PATCH /shopping/:id/cancel`. Consultas `/shopping-product/*` não verificam ownership nos controllers atuais.
- `shoppingService.updateStatus` retorna `{ shopping, previousStatus, changed }`, decididos sob lock transacional. Controllers notificam apenas quando `changed`; `/cancel` exige `onlyPending` dentro da transação. Esses metadados não fazem parte da resposta HTTP.
- `npm run test:notification` cobre MySQL/HTTP e transporte Socket.IO real (WebSocket nativo; Node.js 22+). O teste não exercita SMTP/OAuth reais, carga nem clientes web/mobile.
- Bryan não autorizou correções próprias no módulo de compras durante o trabalho de pagamentos. As alterações de compras recebidas da `main` foram incorporadas no merge solicitado em 29/10/2026; preserve-as e peça autorização antes de novas mudanças fora de pagamentos.
- `src/server.js` fixa CORS em `http://localhost:3000`.
- `src/index.js` requer `./db/testConnect`, mas o arquivo versionado é `src/db/testconnect.js`; sistemas sensíveis a maiúsculas/minúsculas podem falhar.
- O cron está desativado e `src/cron.js` referencia `cleanUpMessages`, que não existe.
- As camadas de autorização de compras, itens de compra, documentos, logs, localização e propriedade de produto têm lacunas descritas em [`docs/security-privacy.md`](docs/security-privacy.md). Não as amplie inadvertidamente.

## Banco, autenticação e dados

- Schema: `src/mysql-init/RFScript.sql`; migração aditiva social: `src/mysql-init/migration_social_login.sql`. Não há framework de migração.
- Na integração da `main` em 29/10/2026, o banco local ainda não tinha `localization.latitude`/`longitude` e exigia `user.password`/`cellphone`, enquanto o schema versionado permite NULL nesses dois campos. O merge não altera esse banco. Reconfirme o schema antes da integração mobile; as suítes recebidas da main foram validadas em banco temporário com o schema versionado.
- PKs UUIDv7 são `BINARY(16)`: use `src/utils/uuid.js` para conversão e `BIN_TO_UUID()` nas consultas de leitura. Nunca passe UUID string diretamente à coluna binária.
- Use crases para palavras reservadas SQL, especialmente `user`, `table` e `read`.
- JWT tem duração documentada de 8h; `verifyJWT` aceita Bearer ou token cru e define `req.userId`, `req.role`, `req.userName`.
- CPF/CNPJ: reutilize `src/services/docService.js`; chaves `DOCUMENT_ENC_KEY` e `DOCUMENT_HMAC_KEY` são hexadecimais de 64 caracteres. Rotacioná-las pode tornar dados existentes ilegíveis e quebrar deduplicação.
- A ordem dos middlewares em `src/routes/modules/userRoutes.js` é significativa: rotas abaixo de `verifyJWT` exigem JWT; abaixo do middleware admin exigem papel admin.

## Documentação

- Índice e mapa por tarefa: [`docs/README.md`](docs/README.md).
- Contrato observado: [`docs/api-contract.md`](docs/api-contract.md); arquitetura: [`docs/architecture.md`](docs/architecture.md).
- Fluxo de agentes e evidências: [`docs/agent-workflow.md`](docs/agent-workflow.md), [`docs/feature-readiness.md`](docs/feature-readiness.md), [`docs/quality.md`](docs/quality.md).
- Segurança, produto, localização, integração e decisões: consulte os links no índice.
- Ao mudar comportamento confirmado, atualize os documentos afetados. Preserve desconhecidos como desconhecidos e não documente credenciais ou dados pessoais.
