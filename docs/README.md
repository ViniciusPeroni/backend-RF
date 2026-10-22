# Documentação do backend

Leia `AGENTS.md` antes de trabalhar neste repositório. Este índice aponta para os guias do backend; confira sempre as rotas, controllers, services e schema atuais se houver divergência.

## Ordem recomendada

1. [`architecture.md`](architecture.md) — stack, inicialização, camadas e banco.
2. [`api-contract.md`](api-contract.md) — endpoints, autenticação e eventos Socket.IO verificados.
3. [`product.md`](product.md) — contexto do TCC e situação das funcionalidades.
4. [`security-privacy.md`](security-privacy.md) — JWT, autorização, dados pessoais e sockets.
5. [`quality.md`](quality.md) — verificações disponíveis e roteiro de testes.
6. [`agent-workflow.md`](agent-workflow.md) e [`feature-readiness.md`](feature-readiness.md) — fluxo de trabalho e evidências de conclusão.
7. [`localization.md`](localization.md) — mensagens, UUIDs e formatos.
8. [`integration-workflow.md`](integration-workflow.md), [`decisions.md`](decisions.md) e [`adr/README.md`](adr/README.md) — integração entre aplicações e decisões técnicas.

## Fatos rápidos

- Node.js/CommonJS, Express 4, MySQL 8 (`mysql2`) e Socket.IO.
- Prefixo HTTP: `/api/reaproveitafranca`; porta: `PORT` ou 5000.
- CPF/CNPJ usam HMAC e AES-256-GCM; não documente chaves nem dados pessoais reais.
- Não há scripts permanentes de teste, lint, build ou typecheck.
- `src/mysql-init/RFScript.sql` apaga e recria o banco `Reaproveita_Franca`; não o execute em base com dados importantes.
- A tabela `notification` existe no schema, mas não há controller/rota de notificações nesta revisão da `main`.
