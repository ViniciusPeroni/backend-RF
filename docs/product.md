# Produto e capacidades observadas

## Objetivo

Reaproveita Franca conecta empresas que geram materiais reutilizáveis a pessoas, cooperativas, artesãos, instituições de ensino e organizações interessadas em reaproveitá-los. O produto amplo inclui web, mobile e API; este repositório entrega somente o backend.

Requisitos do TCC, tabelas e enums podem representar planos ou modelo de dados, não fluxos utilizáveis. Consulte rotas e controllers atuais antes de afirmar disponibilidade.

## Regras refletidas no backend

- Cadastro diferencia `user`, `company` e `admin`; endpoints públicos definem o papel e descartam `role` enviado pelo cliente.
- Cadastro comum/empresa usa OTP. Status do schema incluem `awaitingForEmail`, `firstLogin`, `active`, `inactive`.
- Produtos diferenciam venda e doação; venda exige preço e doação não aceita preço conforme validação atual. Fotos têm endpoints separados.
- Compras podem ser criadas com itens; serviço verifica disponibilidade/estoque e atualiza estoque dentro de transação. Cancelamento/restauração e atualização de status também têm endpoints.
- Categorias e estados do produto são enums do schema; consulte `RFScript.sql` e controller antes de adicionar valor.
- CPF/CNPJ não são armazenados em claro: HMAC para deduplicação e cifra AES-256-GCM.
- O envio de mensagens via Socket.IO persiste a mensagem e notifica os demais participantes; a entrada `join_conversation` ainda não valida participação.

## Estado resumido

| Capacidade | Evidência observada | Como comunicar |
|---|---|---|
| Cadastro, autenticação local e OTP | Rotas/controllers | API presente; integração depende de ambiente e SMTP real |
| Google/LinkedIn | Rotas e código no controller | API presente; credenciais e integração externa precisam ser verificadas |
| Produtos e fotos | Rotas públicas, JWT para mutações | CRUD disponível; conferir ownership e validar ponta a ponta |
| Compras | `/shopping/*` com JWT | Criação (notifica vendedores com `reserva_solicitada`), listagem, detalhe, cancelamento (notifica vendedores) e atualização de status (aceite/recusa notifica comprador) disponíveis; `PATCH /status` restrito a admin ou vendedor único |
| Itens de compra | `/shopping-product/*` com JWT | Consultas disponíveis; endpoints não verificam ownership no controller atual |
| Cartões | `/card/*` com JWT | CRUD do próprio cartão tokenizado (gateway); `payment_token` nunca retornado; pagamento ainda não integrado |
| Localização | CRUD do dono + visão pública (RN10) | Todas as rotas com JWT exceto `GET /product/:productId` (token opcional); POST exige `userId` igual ao token (403); mascaramento antes da reserva aceita |
| Logs | CRUD montado | Rota presente sem JWT explícito; não presumir seguro para exposição pública |
| Documentos | Rotas JWT/admin | Há operações; revisão de ownership necessária para criação/listagens/metadados |
| Chat | `send_message` e `join_conversation` via Socket.IO | Mensagem e notificação persistidas; `join_conversation` ainda não valida participação |
| Notificações | Rotas autenticadas, serviço e eventos Socket.IO | CRUD e contagem disponíveis; gatilhos atuais para mensagem, cadastro, OTP e criação de compra |
| Reserva/negociação | Tabelas e fluxo de compra | Criação notifica `reserva_solicitada`; aceite/recusa notifica `reserva_aceita`/`reserva_recusada`; cancelamento notifica `sistema` aos vendedores |
| Pagamento/comissão | Tabelas, sem integração/rotas correspondentes | Não afirmar pagamento disponível |
| Disputa/review/impacto ambiental | Estruturas no schema, sem rotas correspondentes | Não afirmar fluxo disponível |
| Mapas/classificação de materiais | Não confirmado nas rotas | Não afirmar API implementada |

Este snapshot não é roadmap aprovado. Antes de atualizar estados, obtenha evidência executável conforme [`feature-readiness.md`](feature-readiness.md).
