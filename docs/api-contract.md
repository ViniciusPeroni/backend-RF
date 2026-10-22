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
| otp | `POST /otp/enviar`, `POST /otp/verificar` | Sem JWT explícito | Envio e validação de OTP; cooldown documentado em memória |
| product | `GET /product/`, `GET /product/:id` | Público | Lista/consulta de produto |
| product | `POST /product/create` | JWT | Cria produto; fotos via multipart `photos` |
| product | `PUT/DELETE /product/:id` | JWT | Atualiza/remove; confira autorização por propriedade no controller |
| product | `POST /product/:id/photos` | JWT | Adiciona várias fotos, multipart `photos` |
| product | `PUT /product/photos/:photoId` | JWT | Atualiza foto, multipart `photo` |
| product | `DELETE /product/photos/:photoId` | JWT | Remove foto |
| shopping | `POST /shopping/create` | JWT | Cria compra com `items` (produto UUID e quantidade positiva); baixa estoque dentro de transação |
| shopping | `GET /shopping/` | JWT | Lista compras do usuário; admin recebe listagem geral |
| shopping | `GET /shopping/:id` | JWT | Detalhe; controller restringe ao comprador ou admin |
| shopping | `PATCH /shopping/:id/cancel` | JWT | Cancela compra pendente; controller restringe comprador/admin |
| shopping | `PATCH /shopping/:id/status` | JWT | Atualiza para status permitido; não há restrição de papel/ownership explícita no controller atual |
| shopping-product | `GET /shopping-product/` | JWT | Lista/filtra por query `shoppingId` e `productId`; controller/service não verificam ownership |
| shopping-product | `GET /shopping-product/:id` | JWT | Consulta item por ID; controller não verifica ownership |
| shopping-product | `GET /shopping-product/shopping/:shoppingId` | JWT | Lista itens da compra; controller não verifica ownership |
| localization | `POST /localization/` | Validador; sem JWT explícito | Cria localização |
| log | `POST/GET /log/`, `GET/PUT/DELETE /log/:id` | Sem JWT explícito | CRUD montado sem controle de acesso na rota |
| document | `POST /document/`, `GET /document/user/:userId`, `GET /document/:id` | JWT + limitador global | Criar/listar metadados; verificar ownership no controller antes de expor |
| document | `GET /document/:id/decrypt`, `DELETE /document/:id` | JWT + admin | Descriptografar/excluir documento |

Os payloads e códigos HTTP variam e devem ser obtidos dos controllers. Não derive contrato detalhado apenas desta tabela.

## Socket.IO

- `src/sockets/chatSocket.js` registra `join_conversation`; o ID recebido é usado para entrar na sala.
- Não há autenticação no handshake, validação de UUID/participante, evento de envio/persistência de mensagem ou notificação nesta revisão documentada.
- HTTP e Socket.IO em `src/server.js` configuram origem CORS `http://localhost:3000`.

## Lacunas relevantes

- Compras e itens de compra agora têm rotas REST. Isso não implica pagamento integrado, negociação completa ou demais fluxos do schema.
- O schema inclui pagamento, disputa, avaliação, impacto ambiental, conversa/mensagem e notificação; não há rotas REST correspondentes no inventário atual. `commissionService` calcula a comissão, mas ainda não é chamado por controller/fluxo de pagamento.
- Tabela/enum `notification` não significa controller, rota ou gatilho existente.
- Log/localização não têm JWT explícito nas rotas atuais. Rotas shopping-product e atualização de status da compra têm JWT, mas não verificam ownership/papel no controller atual. Documento exige revisão de ownership; produto update/delete também deve ser validado.
- Para alterar contrato, confirme regra no controller/service/schema, atualize este snapshot somente com comportamento verificado e comunique o impacto ao cliente. Consulte [`security-privacy.md`](security-privacy.md).
