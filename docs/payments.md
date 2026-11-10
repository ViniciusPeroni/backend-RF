# Pagamentos — Mercado Pago Orders

## Configuração

1. Em https://www.mercadopago.com.br/developers/panel/app crie uma aplicação para pagamentos online / Checkout Transparente (Orders API).
2. Selecione **Teste** e copie o Access Token para o `.env` local. Não use uma credencial de produção nos testes. O prefixo do token não comprova o ambiente; confira o seletor no painel.
3. Configure:

```dotenv
PAYMENT_PROVIDER=mercado_pago
MERCADO_PAGO_ENV=test
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_SECRET=
PAYMENT_COMMISSION_PERCENT=5
split_payment=false
```

4. Execute as migrações aditivas `src/mysql-init/migration_payment_gateway.sql`, `src/mysql-init/migration_payment_distribution.sql`, `src/mysql-init/migration_payment_split.sql` e, uma vez após esta última, `src/mysql-init/migration_payment_account_disconnect.sql` no banco configurado. **Não execute RFScript.sql** em banco existente.
5. Reinicie a API. O padrão continua `simulated`; esse provedor é bloqueado com `NODE_ENV=production`.
6. Publique uma URL HTTPS de desenvolvimento para a API e configure no painel o tópico **Orders**, ambiente Teste, com URL `https://SEU_HOST/api/reaproveitafranca/payment/webhook/mercado-pago`. Copie a assinatura secreta desse webhook para o `.env` e reinicie. Localhost não recebe chamadas externas.

Credenciais do backend nunca vão para o cliente. A Public Key de teste é usada pelo SDK para tokenizar cartões. Use somente cartões oficiais de teste: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/test-cards .

O modo padrão `split_payment=false` mantém o pagamento com uma conta. Para split real 1:1, OAuth do vendedor, novas variáveis e roteiro de ativação, consulte [payment-split.md](payment-split.md). As credenciais de produção não habilitam o split nem o webhook externo automaticamente.

## Contrato

Prefixo: `/api/reaproveitafranca`. Todas as rotas abaixo exigem JWT, exceto webhook.

| Método e rota | Comportamento |
|---|---|
| POST /payment/create | `{ id_shopping, method, payer?, token?, payment_method_id?, installments? }`; 201 novo ou 200 repetição pendente |
| GET /payment/:id | Pagamento local; mantém o contrato anterior |
| GET /payment/shopping/:shoppingId | Pagamentos locais da compra; mantém o contrato anterior |
| GET /payment/:id/checkout | `{ payment, checkout }`, dados persistidos sem chamada externa |
| POST /payment/:id/sync | Consulta Orders no Mercado Pago e atualiza banco; busca pela referência local se o ID externo ainda não foi salvo; retorna `{ payment, checkout }` |
| POST /payment/:id/cancel | Cancela pendente no Mercado Pago e consulta confirmação |
| POST /payment/:id/refund | Reembolso total; somente admin; compra ainda não concluída |
| POST /payment/:id/simulate | Somente provedor simulado fora de produção; `{ status: "approved" ou "refused" }`; exige dono do pagamento |
| POST /payment/webhook/mercado-pago | HMAC x-signature + x-request-id + query data.id; consulta autenticada da order; não confia no status do body |

Métodos locais: `pix`, `credit_card`, `debit_card`. Pix retorna `checkout.qr_code`, `qr_code_base64` (PNG sem prefixo) e `ticket_url`, quando disponíveis. Cartões exigem token gerado pelo SDK e `payment_method_id` informado pelo Mercado Pago. Débito depende dos meios habilitados na conta; a documentação brasileira lista débito virtual Caixa. Não prometa qualquer bandeira de débito. Nunca envie PAN/CVV ao backend. `id_card` permanece NULL para pagamentos avulsos.

`payer.email` pode ser enviado para o ambiente de testes; caso ausente usa o e-mail cadastrado do comprador. `payer.first_name: "APRO"` é o cenário de Pix documentado pelo Mercado Pago. Não existe valor ou status informado pelo cliente: o preço vem da compra no banco. O modo de teste do Mercado Pago pode aprovar o Pix automaticamente; não é necessário pagar o QR Code.

## Repetição, falhas e estados

- O ID local é a chave de idempotência da criação. Somente o hash do pedido é persistido, nunca token do cartão ou dados do pagador. Após timeout, repita exatamente os mesmos dados (incluindo o token original). Mudança de dados/provedor/ambiente com pagamento pendente retorna 409.
- Erro HTTP 400/422 de validação reconhecida registra recusa local; uma nova tentativa pode corrigir os dados. Rejeições ambíguas exigem conciliação antes de nova cobrança. Em timeout/5xx mantém pendente, pois a cobrança pode existir. Não crie outra tentativa até recuperar a resposta.
- Pendentes legados sem vínculo de provedor retornam 409; trocar a configuração não converte uma simulação em cobrança real.
- `processed/accredited` confirma pagamento `approved` e compra `accepted`. A retirada/entrega e a conclusão não são confirmadas pelo webhook.
- Falha/recusa deixa compra pendente e permite nova tentativa; estoque continua reservado. Cancelamento/expiração confirmados e reembolso integral cancelam compra e devolvem estoque uma única vez. Notificações repetidas não duplicam a devolução. Respostas atrasadas não rebaixam estados finais.
- As alterações de compras recebidas da `main` restringem a rota genérica de status ao admin ou ao vendedor único dos itens, conforme o status solicitado. Cancelar uma compra localmente ainda não cancela a cobrança no Mercado Pago. Use cancelamento/reembolso do pagamento; uma aprovação posterior ao cancelamento local retorna `checkout.needs_review: true` para reconciliação/reembolso administrativo, sem reabrir a compra nem baixar estoque novamente. Essa pendência de integração com compras impede considerar o conjunto pronto para produção.
- A comissão planejada usa `PAYMENT_COMMISSION_PERCENT`, padrão de 5%, sobre o valor dos itens no banco. O plano é persistido atomicamente em `payment_distribution` quando o pagamento é criado e retornado em `checkout.distribution`. Percentual e valores históricos não mudam ao repetir a requisição. O cálculo usa centavos e conserva a soma entre fornecedores, inclusive no arredondamento.
- Com split desligado, o plano é informativo: `transfers_executed=false` e `settlement_status=disabled`; não há desconto ou repasse automático. Com split ligado, a Payments API usa OAuth do vendedor e `application_fee`, sem enviar esse campo para Orders. A aprovação só é aceita com recebedor, valor e comissão compatíveis; registra a comissão e retorna `provider_confirmed`. Estorno integral confirmado zera a comissão líquida local. Valores dos fornecedores são anteriores às tarifas do provedor; detalhes em [payment-split.md](payment-split.md).
- A API consulta a conta do Access Token e exige coerência com `MERCADO_PAGO_ENV` antes de criar o pagamento. Para uma conta real, exige `MERCADO_PAGO_CLIENT_ID`, consulta a aplicação e compara a credencial com `test_access_token`; isso permite a credencial de teste da aplicação sem exigir que seu titular seja um usuário fictício e impede usá-la em `production`. Usuários de teste continuam aceitos somente em `test`. O hash considera a conta recebedora, impressão da credencial principal e vínculo do split. Pendentes anteriores à proteção de credencial podem exigir consulta/sincronização em vez de repetir o cadastro. Registros antigos não são convertidos por trocar a chave, flag ou ambiente.
- Uma consulta externa 404 retorna conflito local 409 com `provider_code: order_not_found`, evitando tratar troca de conta como indisponibilidade. Após 402 na criação, a API busca a order por `external_reference` (ID local), com intervalo de datas obrigatório, e consulta seu detalhe antes de atualizar o banco. Exige uma única order, referência, valor e método compatíveis. Não envia outra cobrança nessa conciliação.
- Se a order confirmar falha, persiste IDs externos, `refused` e motivo em `checkout.status_detail`; a resposta 402 inclui `payment_id`, `provider_order_id`, `payment_status`, `status_detail` e `reconciliation_required: false`. A compra continua pendente com estoque reservado, permitindo uma nova tentativa após corrigir a causa.
- Se a consulta após 402 falhar ou ainda não localizar a order, mantém o pagamento pendente e grava `reconciliation_required` no vínculo. A resposta inclui `payment_id` e `reconciliation_required: true`. Repetir o cadastro desse pendente só consulta a order; não reenvia o POST externo. Use `/payment/:id/sync` até confirmar o resultado. Essa rota também recupera pagamentos anteriores que ficaram sem o ID da order. Timeouts/5xx na criação continuam permitindo repetição com a mesma chave/dados.
- Reembolsos parciais, chargebacks e salvamento de cartões não têm fluxo de gestão implementado; os detalhes externos não equivalem a reembolso integral.
- A transição real de pendente para aprovado notifica comprador, vendedores e administradores ativos pelo serviço existente, depois do commit. Chamadas repetidas/concorrentes não geram outra confirmação. Falha ao notificar não desfaz o pagamento; o aviso entra em `notification_retry` e é reprocessado pelo worker. Uma queda antes de qualquer tentativa de gravar/enfileirar o aviso ainda pode perdê-lo.

## cURLs para importar no Postman

Variáveis: `baseUrl` = `http://localhost:5000/api/reaproveitafranca`, `email`, `password`, `jwt`, `jwtOutroUsuario`, `jwtAdmin`, `produtoId`, `compraId`, `pagamentoId`, `emailPagadorTeste`, `cardToken`, `paymentMethodId`. Use compras diferentes para cenários de cancelamento, recusa e reembolso. A compra deve pertencer ao usuário do JWT.

Login (salve `token` como `jwt`):

```bash
curl --request POST '{{baseUrl}}/user/login' --header 'Content-Type: application/json' --data '{"email":"{{email}}","password":"{{password}}"}'
```

Criar compra (salve `shopping.id` como `compraId`; use produto de teste de outro usuário):

```bash
curl --request POST '{{baseUrl}}/shopping/create' --header 'Authorization: Bearer {{jwt}}' --header 'Content-Type: application/json' --data '{"items":[{"id_product":"{{produtoId}}","quantity":1}]}'
```

Pix (salve `payment.id` como `pagamentoId`; repetir o mesmo pedido deve reutilizar o pendente):

```bash
curl --request POST '{{baseUrl}}/payment/create' --header 'Authorization: Bearer {{jwt}}' --header 'Content-Type: application/json' --data '{"id_shopping":"{{compraId}}","method":"pix","payer":{"email":"{{emailPagadorTeste}}","first_name":"APRO"}}'
```

Cartão: use nova compra e token de cartão de teste gerado pelo SDK/Public Key. Para débito, substitua `method` por `debit_card`, use o método realmente retornado pelo Mercado Pago e parcelas 1:

```bash
curl --request POST '{{baseUrl}}/payment/create' --header 'Authorization: Bearer {{jwt}}' --header 'Content-Type: application/json' --data '{"id_shopping":"{{compraId}}","method":"credit_card","token":"{{cardToken}}","payment_method_id":"{{paymentMethodId}}","installments":1,"payer":{"email":"{{emailPagadorTeste}}"}}'
```

Consultas e sincronização:

```bash
curl '{{baseUrl}}/payment/{{pagamentoId}}' --header 'Authorization: Bearer {{jwt}}'
curl '{{baseUrl}}/payment/shopping/{{compraId}}' --header 'Authorization: Bearer {{jwt}}'
curl '{{baseUrl}}/payment/{{pagamentoId}}/checkout' --header 'Authorization: Bearer {{jwt}}'
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/sync' --header 'Authorization: Bearer {{jwt}}'
```

Após erro 402, use `payment_id` da resposta como `pagamentoId`. Para tentativas antigas sem esse campo, consulte `/payment/shopping/{{compraId}}` e copie o ID local. Sincronize e consulte o checkout pelas chamadas acima; não crie nova compra para tentar recuperar uma cobrança anterior. A chave Pix deve estar cadastrada na conta recebedora para oferecer Pix em produção; uma falha `processing_error` é genérica e, sozinha, não comprova ausência da chave.

Cancelamento e reembolso são operações distintas. Para testes use somente credenciais de teste, em compras preparadas para cada cenário:

```bash
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/cancel' --header 'Authorization: Bearer {{jwt}}'
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/refund' --header 'Authorization: Bearer {{jwtAdmin}}'
```

Acesso negado (401 sem JWT, 404 para pagamento de outro usuário, 403 para reembolso sem admin):

```bash
curl '{{baseUrl}}/payment/{{pagamentoId}}/checkout'
curl '{{baseUrl}}/payment/{{pagamentoId}}/checkout' --header 'Authorization: Bearer {{jwtOutroUsuario}}'
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/refund' --header 'Authorization: Bearer {{jwt}}'
```

Webhook sem assinatura deve retornar 401 após configurar a assinatura secreta; antes disso 503. Um status falso no body não aprova pagamento:

```bash
curl --request POST '{{baseUrl}}/payment/webhook/mercado-pago?data.id=ORDTESTE&type=order' --header 'Content-Type: application/json' --data '{"type":"order","data":{"id":"ORDTESTE","status":"processed"}}'
```

Enquanto a conta é verificada, com `PAYMENT_PROVIDER=simulated`, é possível confirmar/recusar exclusivamente pagamentos simulados. Aprovação atualiza compra para `accepted`; não há cobrança ou transferência. Repetir o mesmo resultado é idempotente; trocar resultado final retorna 409. A rota é bloqueada com `NODE_ENV=production` ou provedor real:

```bash
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/simulate' --header 'Authorization: Bearer {{jwt}}' --header 'Content-Type: application/json' --data '{"status":"approved"}'
```

Teste da pendência já existente em compras, somente com compra/credenciais de teste: crie pagamento pendente, cancele a compra pela rota abaixo e consulte o pagamento após aprovação no provedor. Deve manter a compra cancelada e retornar `needs_review: true`; o admin pode reembolsar sem duplicar a devolução de estoque.

```bash
curl --request PATCH '{{baseUrl}}/shopping/{{compraId}}/cancel' --header 'Authorization: Bearer {{jwt}}'
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/sync' --header 'Authorization: Bearer {{jwt}}'
```

Visualização do QR Code no Postman, aba Scripts / Post-response; depois abra Visualization:

```javascript
const body = pm.response.json();
pm.visualizer.set('{{#if qr}}<img src="data:image/png;base64,{{qr}}" width="320" />{{else}}Sem QR Code pendente nesta resposta.{{/if}}', { qr: body.checkout?.qr_code_base64 });
```

## Verificação

Use `RUN_PAYMENT_DB_TESTS=1` e `node scripts/test-payment-suite.js` para executar pagamentos e as integrações recebidas da main em banco temporário. O runner remove esse banco ao final. O script específico `scripts/test-payment-integration.js` usa HTTP local e fixtures próprias; intercepta todo acesso financeiro/OAuth ao Mercado Pago, sem movimentar dinheiro nem comprovar integração externa. Nunca execute testes contra banco de produção.

Última validação local após implementar a desvinculação: 281 cenários aprovados, sendo 95 de pagamentos. Os fluxos de crédito e débito com split cobrem aprovação, recusa/nova tentativa, parcelas, confirmação posterior por webhook, recuperação de timeout e estorno integral sem duplicar comissão ou reposição de estoque. A desconexão e troca de conta preservam o histórico financeiro. Para os resultados externos e limites atuais das credenciais, veja [payment-split.md](payment-split.md#testes-externos-de-cartão).

Validação realizada em 29/10/2026:

- Correção do 402: 35 cenários locais aprovados, com HTTP/MySQL reais e Mercado Pago interceptado. Cobrem Pix/crédito com order criada apesar do 402, persistência do motivo, recuperação sem ID externo, autorização do proprietário, busca indisponível, bloqueio de reenvio e rejeição de orders duplicadas/divergentes. Fixtures removidas ao final.
- A tentativa Pix de produção que motivou a correção foi conciliada por três GETs externos: `failed/processing_error`, pagamento local `refused`, IDs externos salvos, sem QR Code. Compra e estoque preservados; nenhum POST externo ou nova cobrança. Isso confirma a conciliação dessa falha, não o recebimento de um Pix em produção.
- 25 cenários locais aprovados com HTTP/MySQL reais e transporte do Mercado Pago interceptado.
- Credencial autenticada pela API do Mercado Pago e confirmada como usuário de teste.
- Pix: criação 201, QR Code e PNG retornados, checkout/listagem/sincronização 200 e repetição com o mesmo ID. O pagamento estava pendente na consulta; não foi comprovada aprovação automática do Pix.
- Crédito Mastercard de teste: tokenização 201, criação 201 com pagamento aprovado, recuperação e sincronização 200.
- Débito Elo de teste: tokenização 201; cobrança recusada pelo Mercado Pago com `payment_method_not_allowed_for_collector`, tratada pela API local como 422.
- Dados sintéticos locais removidos após os testes; nenhuma cobrança de produção.

Pendências: assinatura secreta e URL pública para validar o webhook externo; habilitação do débito na conta; validação externa de cancelamento/reembolso e do ciclo completo do Pix. A existência das rotas não comprova esses cenários no provedor.

Documentação oficial: [Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix), [cartões](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/cards), [webhooks](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications), [teste Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/integration-test/pix), [buscar order](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api/search-order/get), [status da transação](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/status/transaction-status), [requisitos Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/overview?scope=prod).

HMAC conferido com o [validador do SDK oficial](https://github.com/mercadopago/sdk-nodejs/blob/master/src/utils/webhook/index.ts): `id:{data.id};request-id:{x-request-id};ts:{ts};`, preservando a caixa do ID recebido. Comparação em tempo constante; notificações repetidas usam consulta atual do provedor e transições locais idempotentes.
