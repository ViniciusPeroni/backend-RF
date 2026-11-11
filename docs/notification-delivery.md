# Entrega confiável de notificações

## Escopo e decisões desta etapa

O backend mantém os nove tipos existentes. Recusa e estorno usam `sistema`, sem adicionar valores ao ENUM:

| Evento confirmado pelo serviço financeiro | Destinatários | Título |
|---|---|---|
| `pending` → `approved` | comprador, vendedores, administradores ativos | Pagamento confirmado |
| transição real para `refused` | somente comprador | Pagamento recusado |
| transição real para `refunded` | comprador, vendedores, administradores ativos | Pagamento estornado |

São decisões técnicas/produto assumidas nesta execução a pedido de prosseguir sem perguntas. Não mudam quem pode pagar, conciliar, cancelar ou estornar. Respostas atrasadas e estados repetidos não criam novo aviso. Textos não incluem razões do gateway, documentos, valores de cartão ou resolução livre de disputa.

## Outbox transacional

`notificationOutboxService.enqueue(conn, data)` grava em `notification_retry` usando a conexão da operação de domínio. Cadastro, ativação OTP, reservas, review, disputa, mensagem e mudanças financeiras confirmam o estado e o envelope na mesma transação. Se o enfileiramento não for possível, a operação não confirma: não se aceita um estado sem seu evento durável. O consumo de OTP também participa da transação da ativação.

Depois do commit e de liberar a conexão, `flush(entries)` tenta persistir/emitir imediatamente. Falhas nessa fase não desfazem o domínio e permanecem recuperáveis pelo worker. O UUID é reutilizado no retry, portanto não são criadas duas linhas da mesma notificação. O INSERT da notificação e o agendamento dos canais externos também são atômicos.

Tentativas de entrega têm backoff. Falhas definitivas permanecem em `notification_retry.failed_in` para revisão, em vez de sumirem. O worker ignora linhas falhadas e usa lease para separar lotes entre consumidores. Não há endpoint público para reprocessar filas: diagnostique a causa e faça operação administrativa controlada, nunca recrie indiscriminadamente eventos financeiros.

Isso oferece processamento **ao menos uma vez**, não entrega exatamente uma vez: uma queda depois de emitir/enviar e antes de registrar sucesso pode repetir o evento externo. Clientes devem deduplicar por `notification.id` e recuperar o estado pelo GET ao reconectar. Um retorno de sucesso de SMTP/FCM indica aceitação pelo provedor, não leitura do destinatário.

## Migrações de bancos existentes

Aplicar uma vez e na ordem, com backup e ambiente confirmado:

1. `src/mysql-init/migration_notification_retry.sql` (se a fila ainda não existir).
2. `src/mysql-init/migration_notification_outbox.sql` (campos de falha definitiva e lease).
3. `src/mysql-init/migration_notification_channels.sql` (preferências, dispositivos e entregas).

O `RFScript.sql` contém as estruturas para novos bancos, mas é destrutivo e **não deve ser executado em banco com dados**. Esta etapa não altera a `.env`, não aplica migrações no banco local existente e não movimenta dinheiro.

## Critérios de liberação externa

### Configuração dos canais

As opções estão comentadas em `.env.example` para não se tornarem obrigatórias no `dotenv-safe`. Não habilitar durante testes com dados reais:

- E-mail: `NOTIFICATION_EMAIL_ENABLED=true`, `NOTIFICATION_SMTP_HOST`, `NOTIFICATION_SMTP_PORT=465` (TLS implícito) ou `587` (STARTTLS obrigatório), `NOTIFICATION_SMTP_USER`, `NOTIFICATION_SMTP_PASS`, `NOTIFICATION_EMAIL_FROM` (endereço simples, sem nome de exibição).
- Push: `NOTIFICATION_PUSH_ENABLED=true`, `FCM_PROJECT_ID` e Application Default Credentials do Google (`GOOGLE_APPLICATION_CREDENTIALS` apontando para arquivo protegido fora do repositório, ou identidade de workload no ambiente). Usar projeto Firebase próprio e habilitar FCM HTTP v1.
- Dispositivos: `NOTIFICATION_TOKEN_KEY` com 32 bytes aleatórios em hexadecimal (64 caracteres). Não reutilizar chaves de documentos/pagamentos; preservar para restauração. Troca sem migração invalida leitura e deduplicação de tokens existentes.

Nenhum canal externo envia título/conteúdo livre: o texto é sempre “Você tem uma nova notificação no Reaproveita Franca.” O usuário consulta os detalhes autenticado na API. Ambos os canais dependem de flag global **e** preferência individual. Ativar uma flag ou preferência não envia notificações antigas que não foram agendadas.

### Contrato autenticado

Todos usam o JWT e o usuário do token, nunca `id_user` do body:

| Método/path (prefixo da API) | Corpo | Resposta |
|---|---|---|
| `GET /notification/preferences` | — | `{ "email": false, "push": false }` por padrão |
| `PUT /notification/preferences` | `{ "email": true, "push": false }` (ambos booleanos) | preferências salvas |
| `PUT /notification/devices/:id` | `{ "token": "token-do-FCM", "platform": "android" }` | `{ id, platform, active }`, sem token |
| `DELETE /notification/devices/:id` | nenhum | 204; outro titular/inexistente: 404 |

`:id` é UUID gerado/preservado pelo cliente para a instalação. Plataformas: `android`, `ios`, `web`. Máximo de dez dispositivos, tokens até 4096 bytes, criptografados com AES-GCM e hash HMAC para deduplicação. Mesmo token/ID já pertencente a outro usuário retorna 409: faça a desvinculação autenticada no logout antes de cadastrar em outra conta. A rotação do token cancela avisos pendentes para o token anterior. Opt-out cancela entregas ainda pendentes; envios já aceitos pelo provedor não podem ser recolhidos.

A fila `notification_delivery` separa os destinos: falha no e-mail não deve impedir tentativa de push e vice-versa. Cada tentativa revalida preferência, conta ativa, existência da notificação e vínculo do dispositivo; uma troca do e-mail cadastrado não encaminha backlog para a nova caixa. Tokens inválidos terminais do FCM desativam somente o dispositivo correspondente. Após cinco tentativas a entrega permanece `failed` para revisão. Credenciais inválidas também exigem correção operacional: não há envio “automático garantido” sem configuração válida.

### Checklist de implantação

- Configurar SMTP e Firebase/FCM com segredos fora do Git; criar chave própria de criptografia de dispositivos e preservar essa chave nos backups.
- Integrar preferências e registro/remoção de dispositivos nos clientes; solicitar permissão do sistema operacional, renovar token e remover vínculo no logout.
- Testar dispositivos reais em primeiro plano, segundo plano e app fechado, incluindo permissão negada e token revogado.
- Testar e-mail em caixa de teste autorizada, TLS e opt-out. Não enviar fixtures a contas reais.
- Aplicar migrações no ambiente certo e verificar worker/filas, reinício durante entrega, isolamento por usuário e monitoramento de falhas definitivas.
- Revisar e integrar o código antes da implantação. Merge, publicação e edição dos projetos web/mobile exigem autorização própria.

Sem essas evidências não é correto marcar o módulo como validado em produção ou prometer que nunca precisará de manutenção.

## Verificação local

`npm run test:notification:unit` não exige banco nem credenciais. `RF_TEST_ALLOW_DB=1 npm run test:notification` cria/remove banco descartável e exercita migrações, HTTP, Socket.IO e filas; os transportes SMTP/FCM são substituídos por interceptações. `RF_NOTIFICATION_REGRESSION=1` acrescenta cartões, pagamentos interceptados, localização e logs no mesmo banco temporário. Nunca usar `NODE_ENV=production`.

Os testes não consultam provedores financeiros reais nem enviam e-mails/push externos. Migrações e configurações do banco existente continuam sem alteração até uma execução operacional autorizada.
