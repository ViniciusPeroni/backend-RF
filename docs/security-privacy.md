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
- Mutação de produto exige JWT; `PUT`/`DELETE /product/:id` restringem ao dono via `id_user`, mas as rotas de foto (`POST/PUT/DELETE .../photos`) ainda não verificam propriedade.
- Compras: criação, listagem, detalhe e cancelamento têm escopo de comprador/admin conforme controller/service. `PATCH /shopping/:id/status` valida papel/propriedade: admin pode qualquer status válido; vendedor único dos itens pode apenas `accepted`/`refused`; compras multi-vendedor ficam restritas ao admin.
- O cancelamento local da compra não cancela a cobrança externa. A integração de pagamentos deve usar suas rotas próprias de cancelamento/reembolso e manter a sinalização de conciliação quando houver aprovação após cancelamento local.
- Consultas `shopping-product` exigem JWT e aplicam escopo da compra (`s.id_user`) para não administradores, alinhado ao detalhe de shopping. Item alheio responde 404; listas são filtradas e UUID inválido não remove o filtro.
- Cartões (`/card/*`) exigem JWT e são sempre filtrados por `req.userId` no service: cartão de outro usuário responde 404. O `payment_token` do gateway é gravado, nunca selecionado nas consultas e nunca retornado; a API não recebe número completo nem CVV. Excluir o cartão não apaga pagamentos (a FK usa `ON DELETE SET NULL`).
- Rotas de documentos que recebem `userId` ou ID de registro precisam conferir vínculo com `req.userId`. Na implementação documentada, criação/listagem/metadados não garantem ownership; descriptografia e exclusão exigem admin.
- OTP enviar/verificar não exigem JWT na rota e recebem identificador no body; considere abuso, enumeração e limites ao alterar esse fluxo.
- `userRoutes.js` aplica middlewares em ordem posicional; inserir rota no bloco errado pode expô-la ou restringi-la indevidamente.
- Reviews: criação exige JWT e vínculo comprador/vendedor em compra concluída; edição/exclusão exigem autor ou admin. Consultas são públicas. O aviso inclui somente a nota, nunca o comentário livre.
- Disputas: abertura exige participação; apenas admin usa resolve/reject. Abertura avisa partes exceto autor e admins ativos; finalização avisa todas as partes (admins externos não recebem). Descrição e resolução não entram em notificações.

## Socket.IO

- O handshake usa JWT para a sala individual `user:<uuid>`; a conexão anônima ainda pode ser estabelecida, mas não é associada a uma sala de usuário.
- `send_message` exige JWT válido e valida participação usando `conversation_participant` antes de gravar.
- `join_conversation` exige identidade autenticada, UUID válido e vínculo na conversa antes de associar o socket à sala.
- Mensagens/notificações direcionadas a usuários são emitidas para as salas individuais. Não envie tokens em URLs; prefira `auth: { token }` no handshake.
- O JWT é verificado na conexão; a implementação não desconecta automaticamente sessões cujo token expire depois do ingresso. Os testes cobrem token já expirado no ingresso, não revogação/expiração durante sessão ativa.

## Notificações e concorrência

- O POST de notificação aceita somente objeto JSON, título textual não vazio e campos opcionais com tipos validados; `content` respeita a capacidade TEXT (65.535 bytes UTF-8). Destinatário é sempre o token, nunca `id_user` do body.
- Os gatilhos de reserva usam a mudança de status apurada sob lock transacional para evitar duplicidade em aceites concorrentes. Cancelamento revalida `pending` sob o mesmo lock; recusa/cancelamento não repõem estoque duas vezes.
- Reviews repetidas são bloqueadas pela UNIQUE; disputas ativas do mesmo autor são verificadas sob lock da compra. Resolver/rejeitar disputa usa lock do registro e rejeita finalização repetida com 409. Edição comum condiciona o UPDATE ao estado permitido, evitando reabertura por uma leitura obsoleta. Essas proteções não significam idempotência global por chave de requisição.
- O serviço de notificação não oferece deduplicação genérica nem entrega garantida após falha do processo; futuros fluxos devem implementar suas transições idempotentes e não tratar uma consulta prévia fora da transação como proteção suficiente.

## Configuração e riscos operacionais

- `src/server.js` fixa CORS em `http://localhost:3000` tanto para HTTP quanto Socket.IO; reveja antes de implantação/integração diferente.
- Não habilite `src/cron.js` antes de implementar `cleanUpMessages`.
- `RFScript.sql` apaga o banco `Reaproveita_Franca` antes de recriar: jamais execute contra dados importantes.
- O import `./db/testConnect` versus arquivo `testconnect.js` é potencial problema em Linux/CI sensível à caixa.

## Revisão mínima para mudanças

Para cada rota/evento novo ou alterado, confira autenticação, papel, ownership, validação, limitação de abuso, dados retornados, logs e testes de acesso negado. Consulte [`api-contract.md`](api-contract.md) e [`quality.md`](quality.md). Documentar uma lacuna não a corrige.
