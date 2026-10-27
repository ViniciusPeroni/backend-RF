# Integração de notificações entre fluxos

Este documento define como os demais fluxos do backend devem disparar notificações usando a infraestrutura já existente. Ele **não implementa** pagamento, avaliação ou disputa; apenas fixa o contrato para que as branches responsáveis por esses domínios chamem o serviço de forma consistente.

## Escopo

- A branch de notificação é dona de `notificationService`, `notificationController`, `notificationRoutes` e `notificationSocket`.
- As branches de pagamento, review e disputa são donas dos respectivos controllers/services/rotas.
- Cada fluxo de domínio deve chamar `notificationService.notifyUser(...)` **depois** de confirmar a operação no banco.
- Falha ao notificar não deve desfazer a operação de domínio nem impedir a resposta HTTP de sucesso.

## Contrato do serviço

```js
const notificationService = require('../services/notificationService');

await notificationService.notifyUser({
    id_user: 'uuid-do-destinatario',
    type: 'reserva_aceita',
    title: 'Reserva aceita',
    content: 'O vendedor aceitou a sua solicitação de reserva.',
    reference_table: 'shopping',
    reference_id: 'uuid-da-compra'
});
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `id_user` | Sim | UUID do destinatário; precisa existir em `user` |
| `type` | Sim | Um valor do ENUM `notification.type` |
| `title` | Sim | Até 100 caracteres |
| `content` | Não | Texto exibido ao usuário; não inclua segredos nem dados pessoais desnecessários |
| `reference_table` | Não | Até 30 caracteres; convenção: `shopping`, `conversation`, `payment`, `review`, `dispute` |
| `reference_id` | Não | UUID do registro referenciado |

O serviço persiste a notificação, busca o registro criado e emite o evento Socket.IO `notification` para a sala `user:<id_user>`. Não é necessário emitir o evento manualmente no controller de domínio.

## Tipos de notificação

| Tipo | Quando usar | Destinatário |
|---|---|---|
| `reserva_solicitada` | Compra criada | Cada vendedor dos itens |
| `reserva_aceita` | Compra aceita | Comprador |
| `reserva_recusada` | Compra recusada | Comprador |
| `pagamento_confirmado` | Pagamento aprovado | Comprador, vendedores dos itens e administradores ativos |
| `nova_mensagem` | Mensagem enviada | Demais participantes da conversa |
| `nova_review` | Avaliação salva | Usuário avaliado (avaliação bilateral) |
| `disputa_aberta` | Disputa criada | Demais partes da compra e administradores ativos |
| `disputa_resolvida` | Disputa resolvida/rejeitada | Todas as partes da compra, incluindo quem abriu |
| `sistema` | Cadastro, OTP, cancelamento e avisos operacionais | Usuário afetado |

## Gatilhos já implementados

| Fluxo | Arquivo | Evento de domínio | Notificação |
|---|---|---|---|
| Cadastro | `src/controllers/userController.js` | `POST /user/create` | `sistema` de boas-vindas |
| OTP | `src/controllers/otpController.js` | `POST /otp/verificar` válido | `sistema` de conta ativada |
| Mensagem | `src/sockets/chatSocket.js` | `send_message` | `nova_mensagem` para os outros participantes |
| Compra criada | `src/controllers/shoppingController.js` | `POST /shopping/create` | `reserva_solicitada` por vendedor |
| Compra aceita/recusada | `src/controllers/shoppingController.js` | `PATCH /shopping/:id/status` | `reserva_aceita` / `reserva_recusada` |
| Compra cancelada | `src/controllers/shoppingController.js` | `/cancel` ou admin em `/status` | `sistema` para cada vendedor |

## Integrações futuras (bloqueadas por outras branches)

### Pagamento

**Depende de:** branch de pagamento criar `paymentController`/rotas e definir a fonte de confirmação (gateway, webhook ou admin).

**Transição que notifica:** `payment.status` de `pending` para `approved`.

`refused` e `refunded` **não** usam `pagamento_confirmado`, porque o tipo indica confirmação. Se a equipe quiser avisar recusa ou estorno, use `sistema` e registre a decisão; este contrato não cobre esse caso.

**Destinatários (decisão da equipe: "todos os tipos de usuários"):**

1. comprador (`shopping.id_user`);
2. cada vendedor dos itens da compra, independente do papel (`user` ou `company`);
3. administradores ativos (`role = 'admin'` e `status = 'active'`).

A notificação vai para cada destinatário individualmente, sempre com `reference_table: 'payment'` e `reference_id: payment.id`.

```js
const connect = require('../db/connect');

const [admins] = await connect.promise().query(
    "SELECT BIN_TO_UUID(id) AS id FROM `user` WHERE role = 'admin' AND status = 'active'"
);

const recipients = new Set([
    shopping.id_user,
    ...sellerIds,
    ...admins.map((row) => row.id)
]);

for (const id_user of recipients) {
    try {
        await notificationService.notifyUser({
            id_user,
            type: 'pagamento_confirmado',
            title: 'Pagamento confirmado',
            content: 'O pagamento da reserva foi confirmado.',
            reference_table: 'payment',
            reference_id: payment.id
        });
    } catch (error) {
        console.error('Erro ao notificar pagamento confirmado:', error);
    }
}
```

Cuidados:

- o `content` não deve conter valor de cartão, bandeira, últimos dígitos, CPF/CNPJ ou payload do gateway;
- webhook repetido não pode gerar segunda notificação: compare o status anterior antes de atualizar;
- se a equipe não quiser avisar administradores, basta remover `...admins.map((row) => row.id)` — o restante do contrato não muda.

### Avaliação

**Depende de:** branch de avaliação criar `reviewController`/rotas.

**Decisão:** avaliação **bilateral**. O comprador avalia o vendedor e o vendedor avalia o comprador. Base: RN23 do documento de requisitos ("cada participante poderá avaliar a outra parte uma única vez por negociação").

Regras confirmadas pelo documento e pelo schema:

- somente participantes de uma compra com status `completed`;
- uma avaliação por participante por compra (garantida por `uq_review_shopping_reviewer`);
- escala de 1 a 5 (`chk_review_rating`);
- sem autoavaliação (`id_reviewer` diferente de `id_reviewed`);
- a média pode ser usada como reputação.

Cada avaliação gera **uma** notificação para quem foi avaliado:

```js
try {
    await notificationService.notifyUser({
        id_user: review.id_reviewed,
        type: 'nova_review',
        title: 'Nova avaliação recebida',
        content: `Você recebeu uma avaliação de ${review.rating} estrela(s).`,
        reference_table: 'review',
        reference_id: review.id
    });
} catch (error) {
    console.error('Erro ao notificar nova avaliação:', error);
}
```

Como o fluxo é bilateral, em uma compra concluída cada lado recebe no máximo uma `nova_review`, e o autor não recebe a própria avaliação. O comentário livre **não** deve ir para o `content`.

### Disputa

**Depende de:** branch de disputa criar `disputeController`/rotas.

A tabela `dispute` já existe: `type`, `description`, `status`, `resolution`, `created_in`, `updated_in`, `resolved_in`, `id_shopping`, `id_resolved_by`, `id_opened_by`. Ela corresponde ao RF10 ("Gerenciamento de Negociações") do documento de requisitos.

**Quem abre:** qualquer parte da compra — o comprador ou um dos vendedores dos itens (`id_opened_by` é obrigatório e referencia `user`). O texto do RF10 trata a área como "do usuário", sem restringir ao comprador.

**Quem resolve:** administrador (`id_resolved_by`). Base: RN20, "somente o administrador poderá tomar decisões administrativas".

| Transição | Notificação | Destinatários |
|---|---|---|
| criação com status `aberta` | `disputa_aberta` | demais partes da compra (não quem abriu) e administradores ativos |
| `aberta` → `em_analise` | nenhuma | — |
| `em_analise` → `resolvida` ou `rejeitada` | `disputa_resolvida` | todas as partes da compra, incluindo quem abriu |

Ao abrir:

```js
for (const id_user of otherParties) {
    try {
        await notificationService.notifyUser({
            id_user,
            type: 'disputa_aberta',
            title: 'Disputa aberta',
            content: 'Uma disputa foi aberta para uma compra da qual você participa.',
            reference_table: 'dispute',
            reference_id: dispute.id
        });
    } catch (error) {
        console.error('Erro ao notificar disputa aberta:', error);
    }
}
```

Ao resolver ou rejeitar:

```js
for (const id_user of allParties) {
    try {
        await notificationService.notifyUser({
            id_user,
            type: 'disputa_resolvida',
            title: status === 'resolvida' ? 'Disputa resolvida' : 'Disputa rejeitada',
            content: 'A disputa da sua compra foi analisada pelo administrador.',
            reference_table: 'dispute',
            reference_id: dispute.id
        });
    } catch (error) {
        console.error('Erro ao notificar disputa resolvida:', error);
    }
}
```

Cuidados:

- quem abriu não recebe `disputa_aberta` da própria disputa;
- `resolution` e `description` podem conter dados sensíveis; não copie o texto para o `content`;
- notifique apenas na transição real de status, não em cada `UPDATE`;
- em compra com vários vendedores, cada parte recebe uma notificação.

## Origem das decisões de destinatário

| Decisão | Origem | Situação |
|---|---|---|
| Pagamento notifica comprador, vendedores e administradores | Decisão da equipe ("todos os tipos de usuários") | Fechada |
| Avaliação bilateral | RN23 do documento de requisitos | Fechada, corroborada pelo schema |
| Disputa aberta por qualquer parte da compra | RF10 + `dispute.id_opened_by` obrigatório | Inferida (o documento não restringe explicitamente) |
| Disputa resolvida apenas por administrador | RN20 ("somente o administrador poderá tomar decisões administrativas") | Fechada |

O documento de requisitos não descreve notificações em nenhum ponto: todos os destinatários acima vêm de decisão da equipe somada às regras de negócio existentes.

Nos exemplos, `connect` é o pool já usado no projeto:

```js
const connect = require('../db/connect');
```

## Idempotência e duplicidade

- Notifique apenas em transições reais de estado. Exemplo já implementado: comparar `shopping.status` antes e depois de atualizar.
- Repetir a mesma ação não deve criar outra notificação.
- Webhooks de pagamento devem ser idempotentes; registre o identificador do evento ou verifique o status anterior antes de notificar.
- Não emita o evento `notification` manualmente: `notifyUser` já faz isso.

## Verificação

Com banco de desenvolvimento e dependências instaladas:

```powershell
$env:RF_TEST_ALLOW_DB="1"; npm run test:notification
```

O script `tests/notification.integration.js`:

- exige `RF_TEST_ALLOW_DB=1` para evitar execução acidental em banco importante;
- cria usuários, produtos, conversa e compras sintéticas;
- testa CRUD de notificações, ownership, filtros, contagem, read-all, exclusão e eventos Socket.IO;
- testa cadastro, OTP, nova mensagem e os gatilhos de compra/reserva;
- remove os dados sintéticos no final.

Se `google-auth-library` não estiver instalada, o caso de cadastro é marcado como `SKIP` e o restante da suíte continua. Rode `npm install` para executar a cobertura completa.

## Limitações

- Os fluxos de pagamento, review e disputa **não existem** no backend atual; os gatilhos acima são contrato para as branches futuras.
- O documento de requisitos não define quem abre disputa nem quais notificações devem existir. A regra de abertura por qualquer parte é inferência a partir do RF10 e do schema; confirme com o orientador antes de implementar.
- Recusa e estorno de pagamento não têm tipo de notificação definido; se necessário, use `sistema` e registre a decisão.
- A suíte cobre integração com MySQL, mas não substitui testes de carga, segurança ou clientes reais.
- `join_conversation` ainda não valida participação; isso é uma lacuna de segurança do chat, não do serviço de notificação.
