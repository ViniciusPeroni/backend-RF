# Plano de implementação — fechamento possível de notificações

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para executar as tarefas abaixo nesta sessão.

**Goal:** fortalecer as notificações dos fluxos existentes sem implementar os domínios de pagamento, avaliação ou disputa.

**Architecture:** manter rotas e respostas HTTP atuais. Validar o payload antes do banco e decidir se a reserva mudou dentro da transação que bloqueia a compra, retornando metadados internos ao controller. Exercitar os eventos com servidor Socket.IO real e WebSocket nativo, sem novas dependências.

**Tech Stack:** Node.js/CommonJS, Express 4, mysql2/MySQL 8, Socket.IO 4; testes com assert e WebSocket nativo (Node.js 22+).

**Spec:** quatro pontos aprovados na conversa: validação, concorrência de reservas, sockets reais e documentação.

## Restrições globais

- Sem commit/push, novas dependências, alteração de schema ou execução de RFScript.sql.
- Não editar frontend/mobile nem criar Payment, Review ou Dispute.
- Preservar autorização e formatos das respostas; fixtures sintéticas e limpeza obrigatória.
- Manter erro 400 para alteração de compra finalizada, inclusive repetição de recusa/cancelamento.

## Foco de revisão

- Objetos, arrays, números e valores em branco não podem chegar a colunas textuais como payload válido.
- Repetir aceite simultaneamente não pode duplicar aviso; cancelamento/recusa não podem repor estoque duas vezes.
- Falha ao notificar não pode desfazer compra confirmada.
- Outro usuário, token inválido ou conexão anônima não podem receber eventos da sala individual.
- Teste de socket deve verificar entrega real e limpeza, não apenas emissão simulada.

## Tarefa 1 — validação de notificações

Arquivos: `src/controllers/notificationController.js`, `tests/notification.integration.js`.

- [x] Adicionar casos HTTP para title/content/reference_table/reference_id malformados e filtros compostos; verificar 400 e ausência de inserção.
- [x] Executar a suíte e observar falhas esperadas antes da correção.
- [x] Rejeitar corpo não objeto, campos com tipos incorretos, título em branco e conteúdo acima da capacidade TEXT (65.535 bytes UTF-8); preservar campos opcionais nulos e formatos atuais.
- [x] Executar novamente e confirmar regressões verdes.

## Tarefa 2 — decisão atômica dos gatilhos de reserva

Arquivos: `src/services/shoppingService.js`, `src/controllers/shoppingController.js`, `tests/notification.integration.js`.

Interface interna: `updateStatus(id, newStatus, { onlyPending = false } = {})` retorna `{ shopping, previousStatus, changed }` ou null. Metadados não são expostos na resposta HTTP.

- [x] Reproduzir dois aceites com leitura inicial simultânea via barreira de teste e HTTP real; confirmar exatamente um aviso, inclusive mesmo status aceito retornando 200.
- [x] Cobrir recusa/cancelamento concorrentes (um 200, um 400), estoque restaurado uma vez, cancelamento de compra que deixou de estar pending e falha de notificação sem rollback.
- [x] Rodar os casos antes da implementação e registrar falha de duplicidade.
- [x] Derivar previousStatus/changed sob SELECT FOR UPDATE; validar onlyPending sob o mesmo lock; buscar resposta dentro da conexão transacional, evitando releitura de uma transição posterior.
- [x] Controllers notificam somente quando changed; preservar respostas, autorização e restrições de estados finais.
- [x] Rodar suíte e confirmar verde.

## Tarefa 3 — transporte real e documentação

Arquivos: `tests/helpers/notificationSocketClient.js`, `tests/notification.integration.js`, `AGENTS.md`, `llms.txt` e guias afetados em `docs/`.

- [x] Conectar por WebSocket/Engine.IO v4 ao servidor Socket.IO real, com auth no pacote CONNECT; tratar heartbeat e timeout com limpeza.
- [x] Testar entrega de notification, notification_read, notifications_read_all e notification_deleted em duas sessões do dono; isolamento de outro usuário, anônimo e JWT inválido/expirado; reconexão e recuperação por GET de notificação persistida offline.
- [x] Corrigir referências desatualizadas a join_conversation, descrever validação/concorrência e separar transporte real de SMTP/OAuth simulados.
- [x] Verificar sintaxe dos JS alterados, rodar integrações notification/card/localization sequencialmente, revisar diff e registrar limites (gatilhos futuros, push mobile, carga e garantia de entrega após queda do processo).

## Registro de execução

- Análise inicial: 70 PASS / 0 FAIL / 0 SKIP na suíte existente; árvore limpa.
- Execução autorizada pelo usuário nesta sessão, no workspace atual, sem commits.
- Preflight: tarefas 1/2 compartilham a suíte, mas não interfaces de produção; tarefa 3 conserva os testes anteriores e acrescenta transporte real ao final. Não houve conflito entre interfaces.
- Tarefa 1: RED 75 PASS / 15 FAIL; GREEN 90 PASS / 0 FAIL. Falhas reproduzidas: coerção de objetos/números, título em branco e TEXT excessivo respondendo 500.
- Tarefa 2: RED 93 PASS / 2 FAIL (aceite duplicado e cancelamento após aceite concorrente); GREEN 95 PASS / 0 FAIL.
- Tarefa 3: transporte real 105 PASS / 0 FAIL; com casos de fronteira, corpo ausente/array e persistência inválida, 108 PASS / 0 FAIL / 0 SKIP.
- Ajuste de bootstrap do teste: importar módulos de produção somente após carregar dotenv, evitando criação antecipada do pool sem configuração.
- Decisão: usar WebSocket nativo de Node.js 22+ para testes em vez de adicionar socket.io-client; não altera requisitos do processo de produção. Se o ambiente de testes usar Node anterior, é necessário atualizá-lo.
- Testes finais sequenciais com RF_TEST_ALLOW_DB=1: `npm run test:notification` → 108 PASS / 0 FAIL / 0 SKIP; `npm run test:card` → 52 PASS / 0 FAIL; `npm run test:localization` → 26 PASS / 0 FAIL. Node.js v24.20.0; MySQL de desenvolvimento. Nenhuma fixture restante reportada pelas suítes notification/card.
- `node --check` nos cinco JS alterados/novos e `git diff --check`: sem erros (Git avisa apenas conversão LF/CRLF no Windows).
- Revisão independente somente leitura: nenhum achado crítico, importante ou menor; sem execução paralela de testes de banco e sem alterações pelo revisor.
- Limites mantidos: sem gatilhos de domínios ausentes, outbox/retry persistente, expiração contínua de socket, push mobile ou validação de clientes externos/carga. Notificações de reserva agora evitam duplicidade da mesma transição, não oferecem deduplicação global.
