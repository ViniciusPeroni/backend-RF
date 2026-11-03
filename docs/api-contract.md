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
| review | `POST /review/`, `POST /review/create` | JWT | Cria avaliação bilateral em compra `completed`; uma por autor/compra (UNIQUE), duplicata retorna 409; avisa somente `id_reviewed` com `nova_review` |
| review | `GET /review/`, `GET /review/:id` | Público | Consulta avaliações; não envia notificação |
| review | `PUT/DELETE /review/:id` | JWT | Autor ou admin; editar/excluir não envia `nova_review` |
| dispute | `POST /dispute/`, `POST /dispute/create` | JWT | Comprador ou vendedor abre disputa; duplicata ativa do mesmo autor/compra retorna 409; avisa demais partes e admins ativos com `disputa_aberta` |
| dispute | `GET /dispute/`, `GET /dispute/:id` | JWT | Admin ou participantes da compra conforme service |
| dispute | `PUT /dispute/:id` | JWT | Autor edita type/description enquanto `aberta`; admin também pode definir `aberta`/`em_analise`; sem novo aviso; estado alterado concorrentemente pode retornar 409 |
| dispute | `PATCH /dispute/:id/resolve`, `PATCH /dispute/:id/reject` | JWT + admin | Recebe `resolution`; finaliza `aberta` ou `em_analise`, avisa todas as partes com `disputa_resolvida`; repetição/conflito entre finalizações retorna 409 |
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
| commission | `POST /commission/payment/:paymentId` | JWT + admin + limitador global | Gera comissão de 8% sobre pagamento aprovado; repetição retorna comissão existente |
| payment | `POST /payment/checkout` | JWT + limitador global | Recebe `shoppingId` e `method`; service permite apenas o comprador e shopping `accepted`, calcula total do banco e cria/retoma preferência Checkout Pro |
| payment | `GET /payment/:paymentId` | JWT + limitador global | Consulta status/método/valor; somente comprador dono ou admin |
| payment | `POST /payment/webhook` | Público + limitador global | Valida `x-signature`, `x-request-id` e ID da notificação; consulta o pagamento no provedor antes de atualizar estado local |
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
- Cartões têm CRUD autenticado e restrito ao dono. O `payment_token` armazenado não é devolvido pela API. Checkout usa as rotas `/payment` descritas abaixo.
- Review e disputa têm rotas e notificações integradas. Impacto ambiental tem rotas montadas em `/environmental-impact`, não exercitadas nesta integração; pagamento possui fluxo Checkout Pro em sandbox.
- Os tipos `nova_review`, `disputa_aberta` e `disputa_resolvida` estão conectados aos controllers de domínio; a existência de Payment não comprova integração do aviso `pagamento_confirmado`. Destinatários, concorrência e limites estão em [`notification-integration.md`](notification-integration.md).
- Log não tem JWT explícito nas rotas atuais. Todas as rotas de `localization` agora exigem JWT (inclusive o POST, com `userId` restrito ao token); a única rota pública é `GET /localization/product/:productId` com token opcional. Rotas shopping-product têm JWT e autorização por comprador dono/admin aplicada no service. `PUT`/`DELETE /product/:id` restringem a mutação ao dono via `id_user`; as rotas de foto ainda não verificam propriedade.
- Checkout Pro tem rotas autenticadas para iniciar/retomar preferência e consultar estado local em sandbox; webhook assinado atualiza estado e gera comissão idempotente para aprovações. Configure o segredo e aplique as migrações manuais antes de habilitar notificações.
- Para alterar contrato, confirme regra no controller/service/schema, atualize este snapshot somente com comportamento verificado e comunique o impacto ao cliente. Consulte [`security-privacy.md`](security-privacy.md).

## Atualização do comprador — 03/11/2026

GET `/user/:id/photo` é leitura binária autenticada exclusiva do titular/admin, com 204 sem foto e raster com MIME identificado; PUT do perfil valida raster e 5 MB. Itens de compra aplicam escopo do comprador/admin, UUID de filtro inválido retorna 400 e item alheio retorna 404. Listagem de conversas teve o alias SQL corrigido. Contrato, limitações e evidências em `buyer-fixes-2026-11-03.md`.

## Google — 03/11/2026

O fluxo Google passou a usar `googleLoginService.js`, separado do helper LinkedIn: transação, vínculo sem sobrescrever outro google_id, conservação de papel/firstLogin, bloqueio de inactive e verificação de autoridade do Google ao vincular e-mail local. Controller mantém verifyIdToken/audience e separa 400/401/403/409/500/503. A ativação depende do GOOGLE_CLIENT_ID real, ausente no ambiente observado. `node tests/google-login.integration.js` passou contra banco descartável com verificador Google simulado e limiter isolado somente no teste. Não comprova OAuth real. Não foram alterados LinkedIn nem pagamento por cartão. Configuração externa e teste real pendentes do acesso do proprietário ao Google Cloud; guia detalhado em FrontEnd-RF/docs/google-login-setup.md. Nenhum commit/push nesta etapa.

O usuário forneceu o Client ID público e GOOGLE_CLIENT_ID foi configurado no .env local ignorado pelo Git. API reiniciada, verificação inválida retorna 401 e não configuração ausente. Após configuração das origens e correção do meta referrer no web, a última verificação do SDK oficial no localhost:5174 recebeu HTTP 200 no botão, sem rejeição de origem. Login completo com conta real continua sem validação confirmada. Nenhuma credencial real foi usada em teste automatizado.

O usuário autorizou consolidar as alterações na main dos dois projetos. Esta autorização de Git não inclui LinkedIn nem pagamento por cartão. Arquivos de ambiente e testes locais ignorados ficam fora do commit.

## Sincronização da main — 03/11/2026

Integrados 28 commits remotos até `a19eb94`, incluindo Docker, reviews, disputas, impacto ambiental, notificações de review/disputa e checkout/commission da equipe. Conflitos restritos a AGENTS e documentos de contrato/segurança, resolvidos preservando a autorização local de shopping-product e as capacidades novas. Nenhum desenvolvimento adicional de LinkedIn ou pagamento por cartão.

Verificação após integração: 47 testes em `test/*.test.js` e `tests/buyer-read-access.test.js` passaram; integração Google em MySQL descartável passou com verificador do provedor simulado; sintaxe de 28 arquivos JS conferida. Não comprova entrega real de pagamento, Docker, notificações novas ou autenticação Google real. Inspeção somente de metadados do banco local confirmou ausência de `payment.mp_preference_id` e `payment.mp_payment_id`: migrações Mercado Pago não aplicadas nesta sincronização. Não executar o schema destrutivo no banco existente.
