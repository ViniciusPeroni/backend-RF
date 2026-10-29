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
| card | `POST /card/create` | JWT | Cadastra cartão tokenizado do próprio usuário; `payment_token` é gravado e nunca retornado; JWT de usuário removido responde 401 |
| card | `GET /card/` | JWT | Lista somente os cartões de `req.userId`; token não é exposto |
| card | `GET /card/:id` | JWT | Detalhe do próprio cartão; cartão de outro usuário responde 404 |
| card | `PUT /card/:id` | JWT | Atualiza campos do próprio cartão; validade é checada contra a data atual |
| card | `DELETE /card/:id` | JWT | Exclui o próprio cartão; pagamentos antigos ficam com `id_card` NULL |
| localization | `POST /localization/` | JWT + validador | Cria localização; `userId` do corpo precisa ser o do token (divergente → 403) |
| localization | `GET /localization/` | JWT | Lista somente as localizações de `req.userId` |
| localization | `GET /localization/:id` | JWT | Detalhe da própria localização; de outro usuário responde 404 |
| localization | `PUT /localization/:id` | JWT | Atualiza campos da própria localização; valida o estado final; `latitude`/`longitude` são opcionais e `null` limpa a coordenada |
| localization | `DELETE /localization/:id` | JWT | Exclui a própria localização; se vinculada a anúncio (FK RESTRICT) responde 409 |
| localization | `GET /localization/product/:productId` | Token opcional | Visão pública do anúncio (RN10): sem reserva aceita devolve apenas `city`/`neighborhood` com `latitude`/`longitude` arredondadas (2 casas); dono ou comprador com shopping `accepted`/`completed` recebe `street`/`number`/`zipCode`/`state` e coordenadas exatas |
| log | `POST/GET /log/`, `GET/PUT/DELETE /log/:id` | Sem JWT explícito | CRUD montado sem controle de acesso na rota |
| document | `POST /document/`, `GET /document/user/:userId`, `GET /document/:id` | JWT + limitador global | Criar/listar metadados; verificar ownership no controller antes de expor |
| document | `GET /document/:id/decrypt`, `DELETE /document/:id` | JWT + admin | Descriptografar/excluir documento |
| notification | `POST /notification/` | JWT | Cria notificação para `req.userId`; o destinatário não é aceito do body. Corpo objeto JSON; título textual não vazio, até 100 caracteres; `content` opcional textual, até 65.535 bytes UTF-8; `reference_table` opcional textual não vazio, até 30 caracteres; `reference_id` opcional UUID. Campos opcionais aceitam null; entrada inválida retorna 400 |
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
- `join_conversation` exige identidade autenticada, UUID válido e vínculo em `conversation_participant`; o callback retorna erro quando o usuário não participa.
- HTTP e Socket.IO em `src/server.js` configuram origem CORS `http://localhost:3000`.

Nas reservas, a mudança de status é decidida sob `SELECT ... FOR UPDATE`: dois aceites simultâneos retornam 200, mas apenas uma transição gera `reserva_aceita`. Repetir recusa/cancelamento de compra finalizada continua retornando 400, sem nova reposição de estoque ou aviso. `/cancel` revalida `pending` dentro da transação. Os formatos das respostas HTTP não mudam.

Eventos de notificação não são reproduzidos automaticamente após reconectar: o cliente deve consultar `GET /notification/` (ou `?read=nao`) para recuperar avisos persistidos offline. A assinatura/expiração do JWT é validada no ingresso; não há desconexão automática na expiração posterior do token.

## Lacunas relevantes

- Compras e itens de compra agora têm rotas REST. Isso não implica pagamento integrado, negociação completa ou demais fluxos do schema.
- Cartões têm CRUD autenticado e restrito ao dono, mas o pagamento (`payment`) continua sem rotas e sem integração com gateway. O `payment_token` armazenado não é devolvido pela API.
- O schema inclui pagamento, disputa, avaliação e impacto ambiental, mas ainda não há rotas correspondentes a esses fluxos.
- Gatilhos automáticos existentes incluem `nova_mensagem`, notificações `sistema` no cadastro/ativação OTP e cancelamento de compra, `reserva_solicitada` na criação de compra e `reserva_aceita`/`reserva_recusada` no aceite/recusa. Pagamento, review e disputa ainda não têm eventos de domínio conectados; o contrato para essas branches está em [`notification-integration.md`](notification-integration.md).
- Log não tem JWT explícito nas rotas atuais. Todas as rotas de `localization` agora exigem JWT (inclusive o POST, com `userId` restrito ao token); a única rota pública é `GET /localization/product/:productId` com token opcional. Rotas shopping-product têm JWT, mas não verificam ownership no controller atual. `PUT`/`DELETE /product/:id` restringem a mutação ao dono via `id_user`; as rotas de foto ainda não verificam propriedade.
- Para alterar contrato, confirme regra no controller/service/schema, atualize este snapshot somente com comportamento verificado e comunique o impacto ao cliente. Consulte [`security-privacy.md`](security-privacy.md).
