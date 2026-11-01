# Plano — notificações de avaliação e disputa

> **For agentic workers:** executar inline, usando o fluxo de testes primeiro e revisão independente ao final.

**Objetivo:** integrar `nova_review`, `disputa_aberta` e `disputa_resolvida` aos fluxos que chegaram à main em `e2a6cf2`.

**Especificação:** escopo aprovado na conversa e contrato em `docs/notification-integration.md`. Sem Payment, frontend/mobile, mudanças de schema, dependências, commit/push ou Trello.

**Arquitetura:** controllers notificam depois de o service confirmar a operação. Avaliações usam a UNIQUE existente. Abertura de disputa bloqueia a compra durante verificação/inserção para impedir abertura ativa duplicada; finalização bloqueia a disputa e devolve o snapshot na transação. A edição comum não pode reabrir uma disputa finalizada por uma operação concorrente. `disputeService.getNotificationRecipients` busca comprador/vendedores e, apenas na abertura, admins ativos; controller deduplica UUIDs e exclui quem abriu.

**Compatibilidade:** manter rotas, respostas HTTP e autorização existentes. O código atual permite resolver/rejeitar de `aberta` ou `em_analise`; preservar isso e documentar (o contrato antigo só exemplificava `em_analise`). Repetições de disputa ativa/finalização continuam 409; edição de review não avisa novamente. Falha de destinatário/consulta/aviso não desfaz domínio e não interrompe os demais avisos quando possível.

**Stack:** Node.js/CommonJS, Express 4, mysql2/MySQL 8 e Socket.IO existentes.

## Tarefa 1 — testes de integração dos novos gatilhos

Arquivos: `tests/helpers/reviewDisputeNotifications.js`, `tests/notification.integration.js`.

- [x] Criar fixtures de admins ativos/inativo, compras com um e vários vendedores, reviews/disputas sintéticas e limpeza por UUID antes de excluir compras/usuários.
- [x] Testar review bilateral, UNIQUE/requisição concorrente, não participantes/compra não concluída, ausência de aviso em edição, falha ao notificar e entrega Socket.IO real sem conteúdo livre.
- [x] Testar disputa aberta por comprador/vendedor, múltiplos itens do mesmo vendedor, admins ativos, exclusão do autor, isolamento de estranho/admin inativo e ausência de descrição/resolução nos avisos.
- [x] Testar abertura ativa concorrente e finalizações resolve/reject concorrentes, 409 na repetição, nenhum aviso em em_analise/edição ou tentativa não autorizada e falha de um aviso sem interromper os demais.
- [x] Executar `RF_TEST_ALLOW_DB=1 npm run test:notification` e registrar RED antes de produção. Recusar casos de disputa se houver admins ativos fora das fixtures, evitando aviso sintético para pessoas reais.

## Tarefa 2 — produção

Arquivos: `src/controllers/reviewController.js`, `src/controllers/disputeController.js`, `src/services/disputeService.js`.

- [x] Adicionar `notifyUser` em criação de review, somente após INSERT; conteúdo só informa nota.
- [x] Adicionar `getNotificationRecipients(shoppingId, { includeAdmins = false } = {})`, retornando UUIDs de comprador/vendedores e admins ativos quando solicitado; consultas parametrizadas.
- [x] Notificar abertura para destinatários únicos sem autor; finalização para todas as partes (admins apenas se participantes). Usar texto estático sem descrição/resolução livre e tratamento individual de falhas.
- [x] Serializar abertura por compra, finalização por disputa e impedir edição comum concorrente de desfazer estado final. Preservar assinaturas públicas dos services e respostas.
- [x] Executar suíte e confirmar GREEN.

## Tarefa 3 — documentação e verificação final

Arquivos: `AGENTS.md`, `llms.txt`, guias afetados em `docs/`.

- [x] Trocar pendências de review/dispute por fluxos implementados e documentar apenas pagamento ainda bloqueado, sem alegar 100% global.
- [x] Rodar `node --check`, `git diff --check` e suites notification/card/localization sequencialmente.
- [x] Revisão independente somente leitura e correções necessárias com regressões RED/GREEN.

## Foco de revisão

- Não avisar estranho, autor da abertura ou admin inativo; deduplicar vendedor com vários itens/admin que também é participante.
- Duplicidade em requisições simultâneas; preservar estado final inclusive disputa editada em paralelo.
- Operação confirmada apesar de erro de aviso; nenhum texto livre sensível nos eventos.
- Limpeza de reviews/disputas antes das compras; não produzir notificações para admins reais no teste.
- Pagamento, outbox/retry, push mobile e expiração contínua de sessão continuam fora do escopo.

## Registro

- Análise: árvore limpa na branch `feature/pedro/ControllerNotification`, HEAD `e2a6cf2`. Baseline executada: 108 PASS / 0 FAIL / 0 SKIP.
- Execução autorizada pelo usuário nesta sessão, sem commits. Interfaces existentes de review/dispute mantidas; a tarefa de teste e produção compartilham somente o novo método interno de destinatários.
- RED dos gatilhos: 110 PASS / 17 FAIL / 0 SKIP antes de alterar produção; GREEN: 127 PASS / 0 FAIL / 0 SKIP.
- Guarda da edição: duas regressões determinísticas, com SQL/HTTP reais e interleaving após a leitura, falharam sem a condição de status (128 PASS / 2 FAIL) e passaram com ela (130 PASS / 0 FAIL).
- Revisão independente somente leitura: sem bugs bloqueantes. Ressalva sobre a ordem no teste de falha de destinatário; reforçada para falhar sempre no primeiro aviso e registrar tentativas a todos os demais, sem depender da ordem do UNION. Mutação que interrompe o loop produziu exatamente duas falhas; o loop correto foi restaurado.
- Verificação anterior e posterior à revisão/reforço: `npm run test:notification` → 130 PASS / 0 FAIL / 0 SKIP; `npm run test:card` → 52 PASS / 0 FAIL; `npm run test:localization` → 26 PASS / 0 FAIL. Node.js v24.20.0 e MySQL de desenvolvimento; nenhuma fixture de usuário restante. `node --check` dos cinco JS alterados/novos e `git diff --check` sem erros.
- Decisão: preservar finalização diretamente de aberta, pois é comportamento executável anterior à integração. A documentação antiga que só citava em_analise foi corrigida; se a equipe quiser etapa obrigatória, exige decisão separada.
- Limites: sem garantia persistente após queda entre commit e aviso, sem Payment, push mobile, testes com clientes externos ou revogação contínua de sessão. A limpeza da suíte continua reportando erros em WARN (comportamento anterior); execuções desta tarefa não apresentaram WARN.
