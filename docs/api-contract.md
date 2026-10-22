# Contrato da API (snapshot verificado)

Referência do backend, não garantia de estabilidade futura. Reconfirme `src/routes/apiRoutes.js`, os módulos de rota e controllers ao alterar um contrato. Prefixo: `/api/reaproveitafranca`.

## HTTP, autenticação e respostas

- JWT é verificado por `src/middlewares/verifyJWT.js`; aceita `Bearer <token>` ou token cru e define `req.userId`, `req.role`, `req.userName`.
- Não deduza autenticação pelo método HTTP: confirme o middleware de cada rota.
- Respostas de erro normalmente usam `{ error: "..." }`; sucesso varia por endpoint.
- IDs enviados/retornados pela API são UUID em string; no banco são `BINARY(16)`.

## Rotas montadas

| Método | Caminho após prefixo | Acesso conforme rota | Comportamento confirmado |
|---|---|---|---|
| POST | `/user/create` | Público; rate limit global | Cadastro de usuário, multipart com campo opcional `photo` e envio de OTP. |
| POST | `/user/create/empresa` | Público; rate limit global | Cadastro de empresa com CPF/CNPJ, endereço e envio de OTP. |
| POST | `/user/login` | Público; limitador de autenticação | Login com o payload verificado pelo controller. |
| POST | `/user/login/google` | Público; limitador de autenticação | Login Google. |
| GET/POST | `/user/login/linkedin[/callback]` | Público; limitador de autenticação | URL/callback LinkedIn. |
| POST | `/user/password/forgot` | Público; limitador de autenticação | Solicitação de recuperação por e-mail. |
| POST | `/user/password/reset` | Público | Redefinição de senha; valide o token/contrato no controller. |
| PUT/DELETE/GET | `/user/:id` | JWT | Atualizar, excluir ou consultar usuário; controller verifica dono/admin conforme operação. |
| PATCH | `/user/password` | JWT | Alterar senha autenticada. |
| PATCH | `/user/password/first-access` | JWT | Definir senha no primeiro acesso. |
| POST | `/user/create/admin` | JWT + papel admin | Criar administrador. |
| GET | `/user/`, `/user/search/:name` | JWT + papel admin | Listar/pesquisar usuários. |
| POST | `/otp/enviar` | Sem JWT na rota | Enviar OTP para o ID informado; cooldown em memória de 30 s por usuário. |
| POST | `/otp/verificar` | Sem JWT na rota | Verificar `{ id, code }` e ativar conta. |
| GET | `/product/`, `/product/:id` | Público | Listar produtos ou consultar produto por UUID. |
| POST | `/product/create` | JWT | Criar produto; dono é derivado de `req.userId`. Venda requer preço; doação não aceita preço. |
| PUT/DELETE | `/product/:id` | JWT | Atualizar/excluir produto. O controller atual não demonstra verificação de propriedade do produto. |
| POST | `/localization/` | Validador; sem JWT explícito na rota | Criar localização com `userId`, CEP e endereço. |
| POST/GET/GET by id/PUT/DELETE | `/log/`, `/log/:id` | Sem JWT explícito na rota | CRUD de log sem controle de acesso de rota. Não exponha a clientes sem revisão. |
| POST | `/document/` | JWT + limitador global | Registra CPF/CNPJ cifrado; payload `{ userId, docType, doc }`. O controller não vincula `userId` ao JWT. |
| GET | `/document/user/:userId` | JWT + limitador global | Lista metadados de documentos do usuário indicado; a rota atual não verifica propriedade. |
| GET | `/document/:id/decrypt` | JWT + papel admin | Retorna o documento descriptografado. |
| GET | `/document/:id` | JWT + limitador global | Retorna metadados (ID, usuário e tipo), sem documento em claro. |
| DELETE | `/document/:id` | JWT + papel admin | Exclui documento. |

O middleware de admin em `userRoutes.js` é posicional: rotas após `router.use(roleMiddleware(['admin']))` são administrativas. Preserve a ordem ao incluir rotas.

## Socket.IO

- `src/sockets/chatSocket.js` registra `join_conversation`; o socket entra na sala com o identificador recebido.
- Não há autenticação no handshake, validação de UUID/participante, envio de mensagem ou emissão de notificação implementados na revisão atual da `main`.
- CORS está fixado em `http://localhost:3000` em `src/server.js`; alinhe com o ambiente antes de integrar outro cliente.

## Lacunas de contrato

- O schema contém compras, pagamentos, disputas, reviews, impacto ambiental e notificações, mas não há controllers/rotas REST correspondentes no inventário atual.
- Os tipos de notificação existem apenas no enum do schema; não há eventos de domínio ativos para dispará-los nesta revisão da `main`.
- Rotas de listagem e metadados de documentos exigem JWT, mas não comprovam propriedade do registro; confira autorização antes de expor esses dados a clientes.
- Confira validações e respostas diretamente no controller; esta tabela resume e não substitui o contrato do código.
