# Contrato HTTP e Socket.IO (estado observado)

Snapshot da montagem em `src/routes/apiRoutes.js` e `src/routes/modules/*Routes.js`. Confirme middleware e controller antes de mudar ou integrar um contrato. Prefixo REST: `/api/reaproveitafranca`.

## Convenções

- `verifyJWT` aceita Bearer ou token cru; injeta `req.userId`, `req.role`, `req.userName`.
- Respostas de erro geralmente têm `{ error: "..." }`; sucesso varia por endpoint.
- UUIDs públicos são strings; o banco armazena IDs como `BINARY(16)`.
- Não deduza autenticação pelo verbo HTTP. A tabela abaixo resume somente a montagem da rota; confirme ownership e validações no controller.

## Rotas montadas

| Módulo | Método e caminho após prefixo | Acesso na rota | Observação confirmada |
|---|---|---|---|
| user | `POST /user/create` | Público + limitador global | Cadastro, upload opcional `photo`, papel forçado pelo endpoint, OTP |
| user | `POST /user/create/empresa` | Público + limitador global | Cadastro de empresa |
| user | `POST /user/login` | Público + limitador de autenticação | Login local |
| user | `POST /user/login/google` | Público + limitador de autenticação | Login Google |
| user | `GET /user/login/linkedin`, `GET/POST /user/login/linkedin/callback` | Público + limitador de autenticação | URL/callback LinkedIn |
| user | `POST /user/password/forgot` | Público + limitador de autenticação | Recuperação por e-mail |
| user | `POST /user/password/reset` | Público | Redefinição; conferir contrato/token no controller |
| user | `PUT/DELETE/GET /user/:id` | JWT | Controller aplica verificações conforme operação |
| user | `PATCH /user/password`, `PATCH /user/password/first-access` | JWT | Alteração de senha |
| user | `POST /user/create/admin`, `GET /user/`, `GET /user/search/:name` | JWT + admin | Ordem do middleware em `userRoutes.js` é significativa |
| otp | `POST /otp/enviar`, `POST /otp/verificar` | Sem JWT explícito | Envio e validação de OTP; ativação válida também gera notificação `sistema` |
| product | `GET /product/`, `GET /product/:id` | Público | Lista/consulta de produto |
| product | `POST /product/create` | JWT | Cria produto; fotos via multipart `photos` |
| product | `PUT/DELETE /product/:id` | JWT | Atualiza/remove; confira autorização por propriedade no controller |
| product | `POST /product/:id/photos` | JWT | Adiciona várias fotos, multipart `photos` |
| product | `PUT /product/photos/:photoId` | JWT | Atualiza foto, multipart `photo` |
| product | `DELETE /product/photos/:photoId` | JWT | Remove foto |
| shopping | `POST /shopping/create` | JWT | Cria compra com `items` (produto UUID e quantidade positiva); baixa estoque dentro de transação; notifica cada vendedor com `reserva_solicitada` |
| shopping | `GET /shopping/` | JWT | Lista compras do usuário; admin recebe listagem geral |
| shopping | `GET /shopping/:id` | JWT | Detalhe; controller restringe ao comprador ou admin |
| shopping | `PATCH /shopping/:id/cancel` | JWT | Cancela compra pendente; controller restringe comprador/admin; notifica cada vendedor com `sistema` ("Reserva cancelada") |
| shopping | `PATCH /shopping/:id/status` | JWT | Admin pode qualquer status válido; vendedor único dos itens pode apenas `accepted`/`refused`; comprador recebe 403. Aceite/recusa notifica o comprador (`reserva_aceita`/`reserva_recusada`); cancelamento por admin notifica os vendedores |
| shopping-product | `GET /shopping-product/` | JWT | Lista/filtra por query `shoppingId` e `productId`; controller/service não verificam ownership |
| shopping-product | `GET /shopping-product/:id` | JWT | Consulta item por ID; controller não verifica ownership |
| shopping-product | `GET /shopping-product/shopping/:shoppingId` | JWT | Lista itens da compra; controller não verifica ownership |
| localization | `POST /localization/` | Validador; sem JWT explícito | Cria localização |
| log | `POST/GET /log/`, `GET/PUT/DELETE /log/:id` | Sem JWT explícito | CRUD montado sem controle de acesso na rota |
| document | `POST /document/`, `GET /document/user/:userId`, `GET /document/:id` | JWT + limitador global | Criar/listar metadados; verificar ownership no controller antes de expor |
| document | `GET /document/:id/decrypt`, `DELETE /document/:id` | JWT + admin | Descriptografar/excluir documento |
| notification | `POST /notification/` | JWT | Cria notificação para `req.userId`; o destinatário não é aceito do body |
| notification | `GET /notification/` | JWT | Lista as notificações do usuário; filtros `read=sim|nao` e `type` |
| notification | `GET /notification/unread/count` | JWT | Retorna `{ total }` de não lidas |
| notification | `PATCH /notification/read-all` | JWT | Marca as notificações do usuário como lidas |
| notification | `GET /notification/:id` | JWT | Consulta a notificação do próprio usuário; não pertencente/inexistente retorna 404 |
| notification | `PATCH /notification/:id/read` | JWT | Marca como lida e define `read_in` |
| notification | `DELETE /notification/:id` | JWT | Exclui somente notificação do usuário autenticado |

Os payloads e códigos HTTP variam e devem ser obtidos dos controllers. Não derive contrato detalhado apenas desta tabela.

## Socket.IO

- O handshake lê o JWT para associar sockets autenticados à sala `user:<uuid>`; conexão sem JWT não é rejeitada, mas não recebe eventos dessa sala.
- `send_message` recebe `{ conversationId, type?, content?, id_answer? }` e callback; exige usuário autenticado e verifica participação por `conversation_participant` antes de persistir.
- Mensagens são emitidas como `new_message`; uma notificação `nova_mensagem` é persistida e emitida para cada outro participante da conversa.
- Eventos de sincronização de notificação: `notification`, `notification_read`, `notifications_read_all` e `notification_deleted`.
- `join_conversation` ainda aceita o ID recebido sem validar autenticação ou participação. Não trate a sala da conversa como protegida até corrigir essa lacuna.
- HTTP e Socket.IO em `src/server.js` configuram origem CORS `http://localhost:3000`.

## Lacunas relevantes

- Compras e itens de compra agora têm rotas REST. Isso não implica pagamento integrado, negociação completa ou demais fluxos do schema.
- O schema inclui pagamento, disputa, avaliação e impacto ambiental, mas ainda não há rotas correspondentes a esses fluxos.
- Gatilhos automáticos existentes incluem `nova_mensagem`, notificações `sistema` no cadastro/ativação OTP e cancelamento de compra, `reserva_solicitada` na criação de compra e `reserva_aceita`/`reserva_recusada` no aceite/recusa. Pagamento, review e disputa ainda não têm eventos de domínio conectados; o contrato para essas branches está em [`notification-integration.md`](notification-integration.md).
- Log/localização não têm JWT explícito nas rotas atuais. Rotas shopping-product têm JWT, mas não verificam ownership no controller atual. Documento exige revisão de ownership; produto update/delete também deve ser validado.
- Para alterar contrato, confirme regra no controller/service/schema, atualize este snapshot somente com comportamento verificado e comunique o impacto ao cliente. Consulte [`security-privacy.md`](security-privacy.md).
