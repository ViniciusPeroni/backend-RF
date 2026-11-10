# Documentação do backend

Documentação operacional e técnica da API do Reaproveita Franca. Ela descreve o estado observado no código; não é especificação de funcionalidades futuras.

## Comece por aqui

1. Leia [`../AGENTS.md`](../AGENTS.md) para as regras obrigatórias do repositório.
2. Identifique a tarefa e consulte apenas os guias aplicáveis abaixo.
3. Confirme rotas, middleware, controllers, services e schema atuais antes de assumir um comportamento.
4. Ao concluir, relate alterações, verificações executadas e limitações; não faça commit/push sem autorização.

## Mapa por objetivo

| Se você vai… | Leia primeiro |
|---|---|
| Entender inicialização, camadas ou MySQL | [architecture.md](architecture.md) |
| Alterar ou integrar uma rota/evento | [api-contract.md](api-contract.md), [integration-workflow.md](integration-workflow.md) |
| Trabalhar com autenticação, documentos ou dados pessoais | [security-privacy.md](security-privacy.md) |
| Alterar textos, UUIDs, datas ou formatos | [localization.md](localization.md) |
| Planejar ou verificar uma funcionalidade | [feature-readiness.md](feature-readiness.md), [quality.md](quality.md) |
| Integrar notificações em outro fluxo | [notification-integration.md](notification-integration.md) |
| Auditar operações ou trabalhar no módulo de logs | [logs.md](logs.md), [security-privacy.md](security-privacy.md) |
| Executar uma tarefa como agente | [agent-workflow.md](agent-workflow.md) |
| Entender o escopo real do produto | [product.md](product.md) |
| Registrar decisão técnica duradoura | [decisions.md](decisions.md), [adr/README.md](adr/README.md) |

## Referência rápida

Pagamentos: configuração do Mercado Pago, migrações aditivas, contrato e cURLs no Postman em [payments.md](payments.md). Split 1:1, OAuth e ativação em [payment-split.md](payment-split.md).

Roteiro para concluir configuração, integração mobile, validação externa e publicação: [guia de implementação e liberação dos pagamentos](payment-implementation-guide.md).

Execução local e diagnóstico do túnel HTTPS: [Cloudflare local](cloudflare-local.md).

- Stack: Node.js/CommonJS, Express 4, MySQL 8 (`mysql2`) e Socket.IO.
- Inicialização: `npm start`; porta `PORT` ou `5000`; prefixo HTTP `/api/reaproveitafranca`.
- Aplicações web e móvel são projetos independentes. Esta documentação cobre somente `backend-RF/`.
- Não há suíte completa de testes, lint, typecheck ou build no `package.json`.
- Existem scripts de integração: `npm run test:notification`, `npm run test:card` e `npm run test:localization` (requerem `RF_TEST_ALLOW_DB=1` e MySQL de desenvolvimento). O teste de pagamentos usa `RUN_PAYMENT_DB_TESTS=1` e `node scripts/test-payment-integration.js`. `npm run test:log` cobre rotas, auditoria HTTP e socket com services mockados, sem banco; `npm run test:log:db` faz o teste de integração com MySQL real e exige `RF_TEST_ALLOW_DB=1`. Eles não cobrem todo o backend.
- `src/mysql-init/RFScript.sql` contém `DROP DATABASE`; nunca o execute em banco com dados importantes.
- CPF/CNPJ não podem ser persistidos em texto puro. Não inclua segredos ou dados pessoais em documentação, logs ou exemplos.

## Fonte da verdade e manutenção

O código e o schema atuais são a fonte da verdade. Se houver divergência, confira a implementação e atualize o documento afetado com evidência. Indique explicitamente se algo é requisito, schema disponível, API disponível, integração exercitada ou lacuna. Não transforme tabela, enum ou comentário em promessa de funcionalidade.

Revise links locais e afirmações técnicas quando editar documentação. Não duplique este mapa nos documentos temáticos: mantenha aqui a navegação e, em cada guia, o conteúdo especializado.
