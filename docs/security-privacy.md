# Segurança e privacidade

O backend é a fronteira de validação e autorização para web/mobile. JWT válido prova identidade/claims; não prova propriedade do recurso. Revise cada operação quanto a identidade, papel, ownership, entrada e exposição de dados.

## Segredos e dados pessoais

- Não inclua `.env`, senhas, JWT/OAuth tokens, chaves, CPF/CNPJ, e-mail, telefone ou endereço real em commits, exemplos, respostas ou logs.
- `DOCUMENT_ENC_KEY` e `DOCUMENT_HMAC_KEY` devem ser 64 caracteres hexadecimais (32 bytes). Rotação pode tornar documentos existentes ilegíveis e quebrar deduplicação.
- CPF/CNPJ devem passar por `src/services/docService.js`; não crie persistência em claro nem queries paralelas que contornem o serviço.
- Evite registrar body, `Authorization`, token social, dados pessoais ou erro bruto do MySQL.
- Uploads usam middleware `upload`; confirme limites, tipos e autorização antes de ampliar o uso.

## Autenticação e autorização observadas

- `verifyJWT` verifica assinatura com `SECRET`, aceita Bearer ou token cru e popula `req.userId`, `req.role`, `req.userName`.
- Login/reset/sessão e papéis devem ser confirmados no middleware/controller; não deduza proteção pelo nome da rota.
- Rotas de `log` não têm JWT explícito na montagem atual. Todas as rotas de `localization` exigem JWT: o POST recusa `userId` divergente de `req.userId` (403) e leitura/edição/exclusão respondem 404 para registro de outro usuário. A única rota pública é `GET /localization/product/:productId` com `optionalJWT`: token inválido/expirado segue anônimo (nunca 401) e o endereço completo só é liberado para o dono ou comprador com shopping `accepted`/`completed` (RN10).
- Mutação de produto exige JWT, mas revise no controller se o usuário é dono do produto/foto.
- Compras: criação, listagem, detalhe e cancelamento têm escopo de comprador/admin conforme controller/service. `PATCH /shopping/:id/status` valida papel/propriedade: admin pode qualquer status válido; vendedor único dos itens pode apenas `accepted`/`refused`; compras multi-vendedor ficam restritas ao admin.
- Consultas `shopping-product` exigem JWT, porém não verificam ownership da compra/item nos controllers atuais; avaliar exposição entre usuários.
- Cartões (`/card/*`) exigem JWT e são sempre filtrados por `req.userId` no service: cartão de outro usuário responde 404. O `payment_token` do gateway é gravado, nunca selecionado nas consultas e nunca retornado; a API não recebe número completo nem CVV. Excluir o cartão não apaga pagamentos (a FK usa `ON DELETE SET NULL`).
- Rotas de documentos que recebem `userId` ou ID de registro precisam conferir vínculo com `req.userId`. Na implementação documentada, criação/listagem/metadados não garantem ownership; descriptografia e exclusão exigem admin.
- OTP enviar/verificar não exigem JWT na rota e recebem identificador no body; considere abuso, enumeração e limites ao alterar esse fluxo.
- `userRoutes.js` aplica middlewares em ordem posicional; inserir rota no bloco errado pode expô-la ou restringi-la indevidamente.

## Socket.IO

- O handshake usa JWT para a sala individual `user:<uuid>`; a conexão anônima ainda pode ser estabelecida, mas não é associada a uma sala de usuário.
- `send_message` exige JWT válido e valida participação usando `conversation_participant` antes de gravar.
- `join_conversation` ainda aceita qualquer ID sem autenticação ou validação de participante. Isso pode expor eventos privados da sala; não trate esse evento como seguro.
- Mensagens/notificações direcionadas a usuários são emitidas para as salas individuais. Não envie tokens em URLs; prefira `auth: { token }` no handshake.

## Configuração e riscos operacionais

- `src/server.js` fixa CORS em `http://localhost:3000` tanto para HTTP quanto Socket.IO; reveja antes de implantação/integração diferente.
- Não habilite `src/cron.js` antes de implementar `cleanUpMessages`.
- `RFScript.sql` apaga o banco `Reaproveita_Franca` antes de recriar: jamais execute contra dados importantes.
- O import `./db/testConnect` versus arquivo `testconnect.js` é potencial problema em Linux/CI sensível à caixa.

## Revisão mínima para mudanças

Para cada rota/evento novo ou alterado, confira autenticação, papel, ownership, validação, limitação de abuso, dados retornados, logs e testes de acesso negado. Consulte [`api-contract.md`](api-contract.md) e [`quality.md`](quality.md). Documentar uma lacuna não a corrige.
