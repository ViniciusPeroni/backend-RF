# Decisões e restrições conhecidas

Este arquivo reúne fatos úteis para implementação. Só decisões aprovadas devem ser tratadas como política de produto; registrar uma lacuna não a resolve.

## Base técnica verificada

- Web, API e mobile são aplicações independentes, com dependências e processos próprios.
- API usa CommonJS, Express 4, MySQL 8, Socket.IO e UUIDv7 armazenado em `BINARY(16)`.
- Prefixo HTTP atual: `/api/reaproveitafranca`.
- Não há framework de migração. `RFScript.sql` recria banco; `migration_social_login.sql` é aditiva.
- Schema contém enum/tabela de notificações, mas a revisão atual da `main` não expõe rotas/gatilhos de notificação.
- Socket.IO na revisão atual só trata `join_conversation`; não autentica nem confere participação.

## Pontos em aberto

- Ciclo de vida de compra/reserva, bloqueio de quantidade, aceite, recusa, cancelamento e propriedade dos itens.
- Provedor de pagamento, tarifas, reembolso, webhooks e confirmação da fonte externa.
- Contratos REST para conversas, mensagens, negociação, review, disputa e impacto ambiental.
- Autorização de `localization` e `log`; propriedade em update/delete de produto.
- Política de autorização para `join_conversation` e origens CORS por ambiente.
- Limpeza de mensagens: `src/cron.js` está desabilitado e depende de `cleanUpMessages` não implementado.
- Caso de Linux/CI: `src/index.js` requer `./db/testConnect`, mas o arquivo se chama `src/db/testconnect.js`; diferenças de maiúsculas/minúsculas podem impedir inicialização.

Resolva dúvidas com evidência no código ou decisão explícita da equipe. Para escolhas duráveis, use o processo de [ADR](adr/README.md).
