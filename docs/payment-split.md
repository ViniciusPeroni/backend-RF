# Split de pagamentos 1:1

O módulo de pagamento aceita dois modos, sem alterar as rotas de compra ou os clientes. O preço e os vendedores vêm do banco; `split_payment`, recebedor e comissão enviados no JSON do cliente são ignorados.

| `.env` | Comportamento de uma nova cobrança |
|---|---|
| `split_payment=false` | Orders API atual, na conta da credencial principal; não exige segunda conta nem OAuth. |
| `split_payment=true` | Payments API, com Access Token OAuth do vendedor e `application_fee` calculada pelo backend. Uma compra por vendedor. |

O padrão é false. Somente as strings `true` e `false` são aceitas. Vendedor sem vínculo, configuração incompleta ou compra com múltiplos vendedores impedem a cobrança com split; não há queda silenciosa para recebimento na conta do marketplace.

Cada cobrança com split guarda vendedor, conexão, ambiente, recebedor e comissão em `payment_split`. Consultas, webhook, cancelamento e estorno usam esse vínculo histórico, mesmo depois de desligar a flag. Trocar a flag, conta ou credencial não converte um pendente: consulte/sincronize antes de criar outra tentativa. O hash inclui a impressão SHA-256 da credencial principal, sem armazenar seu valor. Pendentes criados antes dessa proteção podem responder 409 ao repetir o cadastro; suas rotas de consulta e sincronização continuam disponíveis.

## Configuração

Execute a migração aditiva `src/mysql-init/migration_payment_split.sql`, além das migrações de gateway e distribuição. Ela cria `payment_seller_account`, `payment_oauth_state` e `payment_split`, sem alterar dados existentes. Nunca execute RFScript.sql em um banco com dados importantes.

Depois execute **uma vez** `src/mysql-init/migration_payment_account_disconnect.sql`. Ela adiciona `disconnected_at`, preserva os registros existentes e permite somente uma conexão ativa por vendedor/ambiente. As conexões anteriores permanecem identificadas separadamente para os pagamentos históricos. A migração já foi aplicada no banco local usado nesta implementação.

```dotenv
PAYMENT_PROVIDER=mercado_pago
MERCADO_PAGO_ENV=production
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_PUBLIC_KEY=
MERCADO_PAGO_WEBHOOK_SECRET=
PAYMENT_WEBHOOK_URL=
PAYMENT_COMMISSION_PERCENT=5
split_payment=false
MERCADO_PAGO_CLIENT_ID=
MERCADO_PAGO_CLIENT_SECRET=
MERCADO_PAGO_REDIRECT_URI=
PAYMENT_TOKEN_ENCRYPTION_KEY=
```

Access Token e Public Key devem ser da aplicação do marketplace. O Client ID e Client Secret vêm dos detalhes dessa mesma aplicação, criada em **Pagamentos online → Checkout API → Marketplace**. Não use credenciais de outra aplicação ou conta. Para testar, use credenciais de teste e `MERCADO_PAGO_ENV=test`; não use dados de teste com credenciais produtivas. Contas reais exigem o Client ID, inclusive sem split, para distinguir a credencial produtiva do campo `test_access_token` da aplicação. Para exercitar o OAuth de um vendedor distinto no sandbox, são necessárias contas de teste apropriadas ao cenário.

`PAYMENT_TOKEN_ENCRYPTION_KEY` deve conter 64 caracteres hexadecimais aleatórios. Guarde-a com o `.env` em local seguro. Não a envie ao frontend nem a rotacione sem migrar as credenciais criptografadas; perdê-la exige reconectar os vendedores. A preparação local gera essa chave apenas quando não existem credenciais anteriores e não altera as chaves do Mercado Pago.

Cadastre na aplicação a Redirect URL `https://SEU_BACKEND/api/reaproveitafranca/payment/mercado-pago/oauth/callback` e use exatamente a mesma URL em `MERCADO_PAGO_REDIRECT_URI`. Habilite PKCE no fluxo de autorização da aplicação. O backend usa `state` aleatório, expiração de dez minutos, consumo único e PKCE S256. O callback retorna JSON, sem tokens e sem redirecionamento arbitrário. O mobile poderá abrir a URL de autorização no navegador e consultar o vínculo ao voltar.

Configure o webhook HTTPS `https://SEU_BACKEND/api/reaproveitafranca/payment/webhook/mercado-pago`, com tópicos **Order (Mercado Pago)** e **Pagamentos**, no ambiente correspondente. `PAYMENT_WEBHOOK_URL` pode informar essa URL explicitamente para novas cobranças de split; sem ela, configure a entrega pelo painel. Copie a assinatura secreta para `MERCADO_PAGO_WEBHOOK_SECRET`. A API não cria um endereço público sozinha. Sem webhook externo, `/sync` continua consultando o provedor, mas não há confirmação automática de entrega externa.

## Rotas adicionais

Todas exigem JWT, exceto o callback OAuth. O vínculo é sempre do usuário autenticado, sem `userId` escolhido no body. A conta local deve estar ativa. O início da autorização aceita no máximo dez requisições por minuto por usuário.

| Método e rota | Retorno |
|---|---|
| `GET /payment/configuration` | Ambiente, flag, Public Key válida e presença das configurações; nunca Access Token, segredo ou chave de criptografia. Não comprova habilitação externa. |
| `POST /payment/mercado-pago/connect` | `authorization_url` para o vendedor autorizar o marketplace no Mercado Pago. |
| `GET /payment/mercado-pago/account` | `connected`, `environment`, `credentials_expired`; somente o próprio vínculo. |
| `DELETE /payment/mercado-pago/account` | Desvincula a conexão ativa do usuário autenticado no ambiente atual. Retorna `connected=false`, `historical_payments_preserved=true` e `provider_authorization_revoked=false`. |
| `GET /payment/mercado-pago/oauth/callback` | Troca código de autorização por credenciais e confirma o vínculo, sem devolver tokens. |

Tokens de acesso e renovação ficam criptografados com AES-256-GCM e contextos autenticados por registro. A renovação é serializada sob lock para evitar dois usos simultâneos do refresh token. Uma mesma conta Mercado Pago não pode ser vinculada a dois vendedores locais. O recebedor precisa ser distinto do marketplace; não é permitida a troca silenciosa do recebedor de uma conexão existente.

## Desvincular e trocar a conta

`DELETE /payment/mercado-pago/account` usa exclusivamente o usuário do JWT, ignora IDs fornecidos no body e pode ser repetido com HTTP 200. Não depende de uma chamada ao Mercado Pago. A desconexão desativa novas cobranças e invalida autorizações OAuth iniciadas antes dela, inclusive callbacks que ainda estavam trocando o código. Uma criação preparada anteriormente revalida o vínculo na transação; operações já iniciadas podem terminar e precisam ser conciliadas.

Essa operação é local: não revoga a permissão no Mercado Pago, não cancela cobranças já emitidas e não apaga os pagamentos. As credenciais históricas continuam criptografadas para consulta, webhook, cancelamento e estorno dos registros anteriores enquanto a autorização do provedor continuar válida. Se o titular revogar a autorização no Mercado Pago, essas operações podem exigir nova autorização da mesma conta.

Após desvincular, gere uma nova `authorization_url` e autorize a conta desejada. Outra conta cria um vínculo separado; reautorizar uma conta histórica do mesmo vendedor reutiliza seu vínculo, sem sobrescrever o recebedor de pagamentos antigos. A conta externa continua reservada ao vendedor local original, inclusive quando seu vínculo está desativado.

```bash
curl --request DELETE '{{baseUrl}}/payment/mercado-pago/account' --header 'Authorization: Bearer {{jwtVendedor}}'
curl '{{baseUrl}}/payment/mercado-pago/account' --header 'Authorization: Bearer {{jwtVendedor}}'
```

Criação, consulta, `/sync`, `/cancel` e `/refund` mantêm as rotas de [payments.md](payments.md). O campo `checkout.provider_api` vale `payments` no split; `provider_order_id` é null, e `provider_payment_id` contém o ID da Payments API. Pix continua retornando QR e PNG; crédito/débito continuam exigindo token do SDK, nunca número/CVV no backend. Habilitação dos meios e contas é responsabilidade do Mercado Pago.

`payer` aceita `email`, `first_name`, `last_name` e, opcionalmente, `identification: { type: "CPF" ou "CNPJ", number: "somente dígitos" }`, quando solicitado pelo checkout. A identificação é encaminhada ao provedor; não é gravada em claro no vínculo ou no checkout e não é devolvida na resposta. Nunca inclua esse documento em logs ou exemplos com dados reais.

## Comissão, confirmação e falhas

O padrão de 5% é calculado em centavos sobre o total da compra. Para R$ 50,00, a comissão solicitada é R$ 2,50 e o vendedor recebe R$ 47,50 **antes das tarifas do Mercado Pago**. `application_fee` é um valor monetário, não o percentual 5.

No modo sem split, o plano é informativo: `split_enabled=false`, `transfers_executed=false` e `settlement_status=disabled`. No split pendente, o status é `awaiting_payment`. A aprovação exige confirmação de valor, BRL, ambiente, método, recebedor e valor da comissão do provedor; então o status é `provider_confirmed` e a comissão é registrada uma única vez em `commission`. Isso confirma a aplicação do split pelo provedor, não saque bancário ou disponibilidade imediata do saldo. Estorno integral confirmado zera a comissão líquida local e preserva o registro; parciais/chargebacks exigem conciliação administrativa.

Uma falha técnica/402 ou rejeição ambígua nunca é considerada ausência de cobrança. A API consulta a referência externa e salva o resultado real. Se não houver confirmação, mantém pendente e bloqueia novo POST até conciliar. Cancelamento e estorno consultam o provedor antes de repetir uma operação inconclusiva. As transições não rebaixam aprovação por resposta atrasada; estoque não é reposto duas vezes.

Webhooks de Orders e Payments usam HMAC e consulta autenticada ao recurso. `user_id` no webhook Payments pode localizar uma conexão quando o ID ainda não foi salvo, mas o resultado do GET e o vínculo local devem coincidir; nenhum status do body aprova uma compra. Notificações de confirmação vão para comprador, vendedores e administradores ativos apenas na transição real pending → approved. O evento é enfileirado em `notification_retry` na mesma transação financeira e enviado depois do commit. Falha de envio não desfaz o pagamento; falha ao gravar a outbox impede o commit local e exige nova conciliação (não significa ausência de cobrança externa). Recusa/estorno e critérios de liberação: [notification-delivery.md](notification-delivery.md).

## Postman

Variáveis: `baseUrl=http://localhost:5000/api/reaproveitafranca`, `jwtVendedor`, `jwt`, `jwtAdmin`, `compraId` e `pagamentoId`.

```bash
curl '{{baseUrl}}/payment/configuration' --header 'Authorization: Bearer {{jwt}}'
curl --request POST '{{baseUrl}}/payment/mercado-pago/connect' --header 'Authorization: Bearer {{jwtVendedor}}'
curl '{{baseUrl}}/payment/mercado-pago/account' --header 'Authorization: Bearer {{jwtVendedor}}'
```

Abra `authorization_url` no navegador e autorize a conta do vendedor. Depois confira `connected=true`. A autorização e as verificações do Mercado Pago precisam ser concluídas pelo titular. Somente então habilite `split_payment=true`, reinicie a API e use uma compra nova com itens desse vendedor.

```bash
curl --request POST '{{baseUrl}}/payment/create' --header 'Authorization: Bearer {{jwt}}' --header 'Content-Type: application/json' --data '{"id_shopping":"{{compraId}}","method":"pix"}'
curl '{{baseUrl}}/payment/{{pagamentoId}}/checkout' --header 'Authorization: Bearer {{jwt}}'
curl --request POST '{{baseUrl}}/payment/{{pagamentoId}}/sync' --header 'Authorization: Bearer {{jwt}}'
```

Cancelamento/estorno movimentam a cobrança real se as credenciais forem produtivas. Execute testes financeiros apenas em contas de teste ou com valores e destinatários expressamente combinados.

## Recusas e disponibilidade do vendedor

O vínculo OAuth e a entrega do webhook confirmam a integração técnica. A conta do vendedor também precisa estar liberada pelo Mercado Pago para receber vendas. Uma recusa `rejected_by_biz_rule` deve ser consultada no provedor; eventuais pendências de identidade ou restrições da conta são regularizadas pelo titular no Mercado Pago.

Antes de criar uma cobrança com split, a API consulta a conta recebedora. Se `status.sell.allow=false` com `rejected_by_regulations`, responde HTTP 409 com `provider_code=seller_account_restricted`, sem criar outro registro de pagamento ou enviar uma cobrança. O vínculo OAuth continua disponível, assim como a consulta e a conciliação dos pagamentos anteriores. `connected=true` confirma o vínculo, não a habilitação para vender. Esse bloqueio não pode ser resolvido alterando o destinatário de um pagamento existente ou desabilitando o split.

Quando o código `13253` vem acompanhado de `Collector user without key enabled for QR render`, a API orienta cadastrar uma chave Pix na conta recebedora, registra a rejeição definitiva e permite outra tentativa após a correção. O mesmo código sem essa confirmação mantém a conciliação e bloqueia novo POST automático.

QR Code, PNG e link Pix são disponibilizados somente para pagamentos pendentes sem mediação/chargeback. Um pagamento recusado permanece sem instruções para pagamento, mesmo quando o provedor inclui um QR no retorno.

## Testes automatizados

```powershell
$env:RUN_PAYMENT_DB_TESTS='1'
node scripts/test-payment-suite.js
```

O runner cria um banco temporário vazio, usa somente as instruções CREATE/ALTER de tabelas do schema versionado, executa as suítes de pagamento, cartão, localização e notificação e remove esse banco. Não executa DROP/USE do RFScript.sql, não copia dados reais e não altera o banco local. Precisa de MySQL de desenvolvimento e permissão para criar esse banco temporário; é bloqueado com NODE_ENV=production.

As chamadas financeiras e OAuth nos testes de pagamento são interceptadas. Aprovação e recusa com split, comissão, renovação, webhook, concorrência, erro 402, timeout, cancelamento e estorno são testados com HTTP/MySQL reais e respostas sintéticas do Mercado Pago. Essa evidência não substitui o teste externo entre duas contas autorizadas, nem a entrega do webhook por HTTPS.

Última execução da suíte após a desvinculação: 95 cenários de pagamento, 52 de cartão, 26 de localização e 108 de notificações aprovados (281 no total, sem falhas ou casos pulados). O banco temporário foi removido. Além da cobertura financeira anterior, foram exercitados autenticação e isolamento do usuário, desconexão idempotente sem acesso ao provedor, bloqueio de novas cobranças, troca/reautorização de conta com histórico preservado, invalidação de callbacks em andamento, concorrência e isolamento de ambiente.

No ambiente local, o split foi habilitado após vínculo OAuth produtivo, consulta autenticada da conta e simulação externa do webhook com HTTP 200. A primeira tentativa financeira expressamente autorizada foi recusada pelo Mercado Pago com `rejected_by_biz_rule`; a consulta da conta recebedora indicou `status.sell.allow=false` e `rejected_by_regulations`. A regularização da conta pelo titular e a validação de uma transação aprovada continuam pendentes. O código genérico de recusa não identifica a pendência específica.

## Testes externos de cartão

Em 03/11/2026, os cartões oficiais foram tokenizados diretamente no Mercado Pago. Na Payments API, a credencial `test_access_token` da aplicação confirmou Mastercard e Visa à vista aprovados, Mastercard recusado por saldo insuficiente e Mastercard em processamento (`pending_contingency`). Criação HTTP 201 e consulta HTTP 200, sempre com `live_mode=false`. São testes do provedor sem divisão financeira; não equivalem a uma cobrança com OAuth de outro vendedor ou a uma chamada completa ao backend com split.

Limites encontrados: o Visa de teste não permite 3 parcelas por ser identificado como internacional (`10114`); o Elo débito tokeniza, mas sua cobrança retornou `10102` / `No result found for the given parameters`. A consulta de meios da conta lista débito como `testing`; não foi confirmada aprovação externa de débito. Houve uma resposta transitória `2006` na tokenização/cobrança do cenário de recusa; em tentativa posterior com novo token de teste, a recusa por saldo insuficiente foi confirmada. Esses resultados não autorizam repetir cobranças reais sem conciliação.

A Orders API retornou `invalid_credentials` com essa credencial de teste da aplicação. Ela não foi trocada por uma credencial produtiva para fazer o teste passar. O modo sem split continua usando Orders; para seu teste externo completo, é necessária uma credencial de teste habilitada para Orders. A restrição é distinta do ambiente de teste da Payments API usado acima.

Diagnóstico externo opt-in, com banco temporário e sem alterar a `.env`:

```powershell
$env:RUN_PAYMENT_DB_TESTS='1'
$env:RUN_MERCADO_PAGO_CARD_TESTS='1'
node scripts/test-payment-cards-live.js
```

O script obtém `test_access_token` da aplicação, confirma a correspondência antes das chamadas e usa somente cartões/documento fictícios oficiais. Os resultados distinguem `PASS`, `FAIL` e `BLOCKED_BY_PROVIDER`; ausência de falha técnica não significa aprovação de todos os meios. `PAYMENT_SKIP_ORDERS_TEST=1` permite limitar o diagnóstico à Payments API. A `.env` produtiva e os vínculos de vendedores existentes permanecem preservados.

Referências oficiais: [split 1:1](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace), [configuração OAuth](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration), [PKCE](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation), [Payments API](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/create-payment/post), [limitação da migração para Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/migrate-payments-to-orders).
