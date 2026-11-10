# Decisões, fatos e questões em aberto

Este documento é um registro de fatos técnicos e pendências observadas; não transforma lacuna em decisão de produto. Decisões duradouras devem ter ADR conforme [`adr/README.md`](adr/README.md).

## Base técnica observada

- Web, API e mobile são apps independentes. Este repositório é somente backend.
- Backend: CommonJS, Express 4, MySQL 8, Socket.IO; IDs UUIDv7 em `BINARY(16)`.
- Prefixo REST: `/api/reaproveitafranca`.
- Não há ORM nem framework de migration; `RFScript.sql` recria o banco; migration social é SQL manual.
- Socket valida JWT para salas de usuário; envio de mensagem e `join_conversation` exigem identidade autenticada e participação. A validação do JWT no ingresso não implica revogação/expiração contínua da conexão.
- Compras e itens têm rotas REST; há notificações de reserva, mensagem, cadastro e OTP. Review e disputa também têm rotas e gatilhos: `nova_review` para avaliado, `disputa_aberta` para demais partes/admins ativos e `disputa_resolvida` para todas as partes. Apenas pagamento continua sem fluxo REST e sem gatilho.
- `package.json` não oferece suíte de teste, lint, build ou typecheck.

## Pendências que exigem decisão ou verificação

- Ciclo de compra/reserva: quantidade, aceite/recusa, cancelamento, conclusão e ownership.
- Provedor/política de pagamento, tarifas, reembolso, webhooks e fonte de confirmação.
- O contrato de notificações está em [`notification-integration.md`](notification-integration.md). Review/disputa já o utilizam; falta a implementação de pagamento. Resolver/rejeitar preserva a regra do código que permite finalizar diretamente de `aberta`, além de `em_analise`; não foi introduzida uma etapa obrigatória nova.
- Autorização de `localization` resolvida: todas as rotas com JWT (POST exige `userId` igual ao token) e visão pública com token opcional conforme RN10. Autorização de `log` resolvida: JWT + admin em todas as rotas, com auditoria automática de escrita pelo middleware `auditLog`. Permanecem pendentes propriedade de update/delete de produto e isolamento de documentos.
- Autorização de `PATCH /shopping/:id/status` resolvida para admin ou vendedor único (apenas `accepted`/`refused`); ownership das consultas `/shopping-product/*` continua pendente.
- Autenticação/autorização do socket e origens CORS configuráveis por ambiente.
- Limpeza de mensagens: cron desativado e função `cleanUpMessages` ausente.
- Portabilidade: `src/index.js` requer `./db/testConnect`, mas o arquivo chama-se `testconnect.js`.
- Carregamento do `.env`: `src/index.js` captura erro do `dotenv-safe` e tenta `dotenv`; confirmar comportamento efetivo antes de documentar requisito fatal.

Resolva com evidência no código ou decisão explícita da equipe. Registre como ADR quando a decisão for transversal, cara de reverter ou alterar instruções futuras.
