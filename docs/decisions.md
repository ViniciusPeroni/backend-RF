# Decisões, fatos e questões em aberto

Este documento é um registro de fatos técnicos e pendências observadas; não transforma lacuna em decisão de produto. Decisões duradouras devem ter ADR conforme [`adr/README.md`](adr/README.md).

## Base técnica observada

- Web, API e mobile são apps independentes. Este repositório é somente backend.
- Backend: CommonJS, Express 4, MySQL 8, Socket.IO; IDs UUIDv7 em `BINARY(16)`.
- Prefixo REST: `/api/reaproveitafranca`.
- Não há ORM nem framework de migration; `RFScript.sql` recria o banco; migration social é SQL manual.
- Socket valida JWT para salas de usuário e envio de mensagem, mas `join_conversation` continua sem autenticação/validação de participação.
- Compras e itens têm rotas REST; a criação de compra dispara `reserva_solicitada` para os vendedores, o aceite/recusa dispara `reserva_aceita`/`reserva_recusada` para o comprador e o cancelamento dispara `sistema` para os vendedores. Notificações também têm rotas e gatilhos para mensagem/cadastro/OTP. Pagamento, review e disputa não têm fluxos REST correspondentes.
- `package.json` não oferece suíte de teste, lint, build ou typecheck.

## Pendências que exigem decisão ou verificação

- Ciclo de compra/reserva: quantidade, aceite/recusa, cancelamento, conclusão e ownership.
- Provedor/política de pagamento, tarifas, reembolso, webhooks e fonte de confirmação.
- Contratos para mensagens, negociação, review, disputa e impacto ambiental. O contrato de notificações para esses fluxos está definido em [`notification-integration.md`](notification-integration.md), mas ainda depende das branches de pagamento, review e disputa implementarem os controllers e chamarem `notifyUser`.
- Autorização em `localization`/`log`, propriedade de update/delete de produto e isolamento de documentos.
- Autorização de `PATCH /shopping/:id/status` resolvida para admin ou vendedor único (apenas `accepted`/`refused`); ownership das consultas `/shopping-product/*` continua pendente.
- Autenticação/autorização do socket e origens CORS configuráveis por ambiente.
- Limpeza de mensagens: cron desativado e função `cleanUpMessages` ausente.
- Portabilidade: `src/index.js` requer `./db/testConnect`, mas o arquivo chama-se `testconnect.js`.
- Carregamento do `.env`: `src/index.js` captura erro do `dotenv-safe` e tenta `dotenv`; confirmar comportamento efetivo antes de documentar requisito fatal.

Resolva com evidência no código ou decisão explícita da equipe. Registre como ADR quando a decisão for transversal, cara de reverter ou alterar instruções futuras.
