# Integração de notificações entre fluxos

Este documento descreve os gatilhos implementados, seus destinatários e os limites da infraestrutura de notificações. Review, disputa e pagamento estão integrados; a entrega persistida tem fila de retry, a listagem é paginada e o socket é desconectado no vencimento do JWT.

## Escopo

- A branch de notificação é dona de `notificationService`, `notificationController`, `notificationRoutes` e `notificationSocket`.
- As branches de pagamento, review e disputa são donas dos respectivos controllers/services/rotas.
- Cada fluxo de domínio grava seu envelope com `notificationOutboxService.enqueue(conn, data)` **dentro** da transação e chama `flush` **depois** do commit e da liberação da conexão.
- Falha de envio não desfaz a operação confirmada. Falha ao gravar o evento durável antes do commit causa rollback para não perder avisos.

## Contrato do serviço

Para novos gatilhos transacionais use `notificationOutboxService.enqueue(conn, payload)` antes do commit e `flush(entries)` após liberar a conexão. Os exemplos abaixo mostram os **payloads**; chamar `notifyUser` isoladamente não cria atomicidade com uma operação de domínio anterior. Os gatilhos de produção já foram movidos para a outbox.

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

## Entrega e retry

O caminho feliz é síncrono: `notifyUser` persiste em `notification`, lê o registro e emite `notification`. Se a persistência falhar, a falha continua sendo lançada ao chamador e o aviso é gravado em `notification_retry` com `persisted = 0` e o mesmo UUID que seria usado na notificação. Se a falha ocorrer depois do INSERT (leitura ou emissão), a linha vai para a fila com `persisted = 1`; o retry apenas reemite, sem inserir de novo.

`retryPending({ limit, maxAttempts })` reivindica linhas vencidas com `FOR UPDATE SKIP LOCKED`, tenta entregar, apaga a linha em caso de sucesso e aplica backoff exponencial (2, 4, 8... segundos, teto de 300 s) em caso de falha. Depois de `maxAttempts` (padrão 5), a linha é retida com `failed_in` para revisão. `startNotificationRetryWorker` roda a cada 30 s a partir de `src/server.js`, com guarda de execução sobreposta e timer `unref`. O retry não refaz a operação de domínio.

A fila exige as migrações de retry, outbox e canais em bancos existentes. Ordem, configuração e critérios externos: [notification-delivery.md](notification-delivery.md).

## Listagem

`GET /notification/` aceita `read`, `type`, `reference_table`, `reference_id`, `limit` (1..100, padrão 50) e `offset` (>=0). A resposta continua um array, ordenado por `created_in DESC, id DESC`. Sem parâmetros, o cliente antigo continua funcionando e recebe até 50 itens.

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
| Avaliação criada | `src/controllers/reviewController.js` | `POST /review/` ou `/review/create` | `nova_review` para o avaliado |
| Disputa aberta | `src/controllers/disputeController.js` | `POST /dispute/` ou `/dispute/create` | `disputa_aberta` para demais partes e admins ativos |
| Disputa finalizada | `src/controllers/disputeController.js` | `PATCH /dispute/:id/resolve` ou `/reject` | `disputa_resolvida` para todas as partes |

## Detalhamento por domínio

### Pagamento

**Implementado no módulo de pagamentos:** `paymentGatewayService.applyCheckout` identifica a transição sob lock, chama `paymentNotificationService.enqueueTransition` na mesma conexão e confirma o commit. Depois de liberar a conexão, chama `notificationOutboxService.flush`. O estado vem do provedor autenticado ou de simulação explicitamente habilitada fora de produção. Repetições não notificam novamente; falha de envio não desfaz a operação. O envelope já gravado em `notification_retry` é recuperado pelo worker.

**Transição que notifica:** `payment.status` de `pending` para `approved`.

`refused` e `refunded` usam `sistema`, nunca `pagamento_confirmado`. Recusa avisa somente o comprador; estorno avisa comprador, vendedores e admins ativos. A política assumida nesta etapa e os textos constam em [notification-delivery.md](notification-delivery.md).

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

**Implementado:** `reviewService.createReview` confirma o INSERT e o envelope da outbox na mesma transação e tenta enviar depois do commit/liberação. As duas rotas usam o mesmo controller, sem segundo envio. A resposta HTTP continua `{ message, id }`.

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

Cada INSERT de review confirmado gera uma `nova_review` para o avaliado, nunca para o autor. A UNIQUE por compra/autor impede repetir ou duplicar simultaneamente a mesma avaliação; editar/excluir não envia novo aviso. Como a API permite excluir uma avaliação, a UNIQUE não impede uma nova criação depois da exclusão. O comentário livre **não** vai para o `content`.

### Disputa

**Implementado:** `disputeService` grava os envelopes antes de confirmar abertura/finalização e tenta enviar após o commit/liberação. `getNotificationRecipients` usa a mesma conexão para obter comprador e vendedores (mais admins ativos apenas na abertura). UUIDs são deduplicados e o autor é excluído somente de `disputa_aberta`.

A tabela `dispute` já existe: `type`, `description`, `status`, `resolution`, `created_in`, `updated_in`, `resolved_in`, `id_shopping`, `id_resolved_by`, `id_opened_by`. Ela corresponde ao RF10 ("Gerenciamento de Negociações") do documento de requisitos.

**Quem abre:** qualquer parte da compra — o comprador ou um dos vendedores dos itens (`id_opened_by` é obrigatório e referencia `user`). O texto do RF10 trata a área como "do usuário", sem restringir ao comprador.

**Quem resolve:** administrador (`id_resolved_by`). Base: RN20, "somente o administrador poderá tomar decisões administrativas".

| Transição | Notificação | Destinatários |
|---|---|---|
| criação com status `aberta` | `disputa_aberta` | demais partes da compra (não quem abriu) e administradores ativos |
| `aberta` → `em_analise` | nenhuma | — |
| `aberta` ou `em_analise` → `resolvida` ou `rejeitada` | `disputa_resolvida` | todas as partes da compra, incluindo quem abriu; admin externo não recebe |

A finalização diretamente de `aberta` já era permitida pelos services atuais e foi preservada; `em_analise` não virou uma etapa obrigatória. Editar descrição/tipo ou passar para `em_analise` não envia aviso.

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
- um vendedor com vários itens ou que também seja admin recebe só um aviso por evento;
- falha de envio depois do commit não desfaz a disputa e não impede tentar avisar os demais; falha ao consultar destinatários/gravar envelopes antes do commit causa rollback para não confirmar uma disputa sem aviso recuperável.

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

- Notifique apenas em transições reais de estado. Em compras, `shoppingService.updateStatus` decide `{ previousStatus, changed }` sob `SELECT ... FOR UPDATE` e só enfileira se `changed`. Comparar apenas uma leitura anterior feita fora da transação permite avisos duplicados em requisições simultâneas.
- Repetir a mesma ação não deve criar outra notificação.
- Aceite repetido permanece 200 sem novo aviso; recusa/cancelamento em compra finalizada permanecem 400. `/cancel` revalida `pending` dentro da transação. Recusa/cancelamento restauram estoque somente uma vez.
- Webhooks de pagamento devem ser idempotentes; registre o identificador do evento ou verifique o status anterior antes de notificar.
- Criação de review depende da UNIQUE existente. Abertura de disputa serializa a verificação/inserção por compra em uma transação; uma disputa ativa do mesmo autor/compra retorna 409. Resolver/rejeitar usa lock da disputa e snapshot na conexão transacional: só a primeira finalização tem sucesso, as demais retornam 409 sem aviso.
- A edição comum condiciona seu UPDATE ao status permitido para não reabrir uma disputa finalizada nem editar como autor depois de entrar em análise por uma operação concorrente. Esses conflitos retornam 409.
- A fila de retry reutiliza o UUID da notificação: linhas com `persisted = 1` apenas reemitem; linhas com `persisted = 0` inserem no máximo uma vez e então reemitem. Repetir o processing não cria uma segunda linha em `notification`.
- Não emita o evento `notification` manualmente: `notifyUser` já faz isso.

## Verificação

Com banco de desenvolvimento, dependências instaladas e Node.js 22+ (WebSocket nativo):

```powershell
$env:RF_TEST_ALLOW_DB="1"; npm run test:notification
```

O script `scripts/test-notification-suite.js` cria um banco temporário `rf_notification_test_<hex>` com as tabelas do schema versionado, executa `tests/notification.integration.js` apontando `DB_NAME` para ele e remove o banco no final. Não copia nem altera o banco configurado no `.env`; a suíte não pode recriar `Reaproveita_Franca`.

`tests/notification.integration.js`:

- exige `RF_TEST_ALLOW_DB=1` para evitar execução acidental em banco importante;
- cria usuários, produtos, conversa e compras sintéticas;
- testa CRUD de notificações, ownership, filtros, contagem, read-all, exclusão e eventos Socket.IO;
- testa paginação (`limit`/`offset`), filtro por `reference_table`/`reference_id` e validação dos parâmetros;
- testa a fila de retry/outbox: rollback, recuperação de commit sem controller, mesmo UUID, exclusão concorrente, lease antigo e retenção auditável após o máximo de tentativas;
- testa cadastro, OTP, nova mensagem e os gatilhos de compra/reserva;
- chama `tests/helpers/reviewDisputeNotifications.js` para exercitar criação bilateral de review, disputa aberta/resolvida/rejeitada, destinatários, falhas de aviso/consulta, concorrência e entrega Socket.IO real;
- rejeita payloads com tipos inválidos e conteúdo acima de 65.535 bytes UTF-8 antes de chegar ao MySQL;
- força leituras concorrentes de reservas e testa aviso único, estoque e cancelamento com leitura desatualizada;
- conecta clientes WebSocket ao Socket.IO real para testar `notification`, `notification_read`, `notifications_read_all` e `notification_deleted` em duas sessões do dono, sem entrega a outro usuário, anônimo ou JWT inválido/já expirado;
- confirma que a sessão é desconectada quando o JWT vence;
- verifica recuperação por GET de uma notificação criada offline e entrega de novos eventos após reconectar;
- remove os dados sintéticos no final.

Se `google-auth-library` não estiver instalada, o caso de cadastro é marcado como `SKIP` e o restante da suíte continua. Rode `npm install` para executar a cobertura completa.

Os casos de disputa recusam banco que já tenha admins ativos antes de criar suas próprias fixtures, pois o comportamento real notificaria essas pessoas. Use banco descartável; a limpeza remove reviews/disputas por UUID de compra antes de excluir compras e usuários sintéticos.

## Limitações

- O gatilho de pagamento (`pagamento_confirmado`) já está integrado pelo módulo de pagamentos com split; review/disputa já têm API e integração de avisos.
- O documento de requisitos não define explicitamente os destinatários de notificações. A abertura por qualquer parte, originalmente inferida do RF10/schema, é o comportamento dos services que chegaram à main; esta integração não amplia suas permissões.
- Recusa e estorno de pagamento usam `sistema`, com destinatários/textos fixos descritos em [notification-delivery.md](notification-delivery.md).
- A suíte cobre integração com MySQL, mas não substitui testes de carga, segurança ou clientes reais.
- `join_conversation` agora valida identidade, UUID e participação; versões anteriores destes guias descreviam a implementação antiga.
- Socket.IO não oferece replay automático dos avisos offline: depois de reconectar, o cliente consulta `GET /notification/` ou `?read=nao`. Os eventos em tempo real não substituem essa leitura.
- A outbox participa da transação do domínio e sobrevive a reinícios. Não há entrega externa "exactly once": uma falha depois do envio e antes do registro de sucesso pode repetir um evento com o mesmo UUID.
- O worker pressupõe o Socket.IO inicializado, como em `src/server.js`, que registra sockets antes de iniciar o worker. Em um processo sem `io`, a notificação é persistida mas não emitida em tempo real; o cliente ainda a recupera por `GET /notification/`.
- JWT é validado no ingresso e a sessão é desconectada no `exp` do token. Revogação imediata de um token ainda válido (logout/troca de senha) não é propagada para sockets já conectados.
- Transporte real local não comprova integração com front/mobile, push com app fechado ou serviços SMTP/OAuth externos.
- O teste verifica a desconexão no vencimento com um token de curta duração; não mede precisão de relógio entre servidor e cliente.
