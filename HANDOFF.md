# Handoff — Pagamentos Mercado Pago (split 1:1), backend Reaproveita Franca

Atualizado em 07/11/2026. Branch `feature/bryan/PaymentController`, último commit `64d80e9`. **Nada desta etapa foi commitado.** Leia também `AGENTS.md` (regras e histórico) e `docs/payment-split.md` / `docs/cloudflare-local.md`.

## Objetivo

Concluir o módulo de pagamentos com Mercado Pago:

- `split_payment=false`: Orders API com a credencial do marketplace.
- `split_payment=true`: Payments API com o token OAuth do vendedor, split 1:1 e `application_fee` de 5%.

Nesta etapa:

1. Destravar o vínculo OAuth do vendedor. Antes, o split falhava com "sem permissão".
2. Validar Pix com split.
3. Deixar o fluxo de cartões pronto.

## Estado atual

| Item | Situação |
|---|---|
| Vínculo OAuth | Ativo: usuário `01a11c85-…` ↔ recebedor `386678534` (produção). O recebedor `1763794829` segue desvinculado; o token guardado dele retornava 401 (autorização revogada). |
| Pix real com split | **Funcionou** (confirmado por Bryan e no banco): `approved/accredited`, compra `accepted`, comissão 0.05 registrada, `needs_review=false`. O valor chegou às duas contas. |
| Cartões no sandbox (`live_mode=false`) | Mastercard e Visa aprovados, recusa por saldo, pendência (`in_process`) e **débito Elo aprovado**, todos pela Payments API. A Orders API segue bloqueada para credencial de teste (limitação conhecida). |
| Cartão real com split | **Não validado** (exige dinheiro real; Bryan testa manualmente). |
| Suíte local | `RUN_PAYMENT_DB_TESTS=1 node scripts/test-payment-suite.js`: **286 cenários, 0 falhas** (100 pagamentos, 52 cartões, 26 localização, 108 notificações). Banco temporário, Mercado Pago interceptado. |
| Infra | API local (`npm start`, porta 5000) + Quick Tunnel `https://corrected-reflect-bond-product.trycloudflare.com` (diagnóstico em `127.0.0.1:20241`). `.env` e painel do Mercado Pago apontam para ele. `check-cloudflare.js` retornou `healthy: true` e `configurationMatches: true`. Um `cloudflared` antigo (PID 11072, porta 20242) ficou rodando sem conexão; pode ser encerrado. |

URLs cadastradas no Mercado Pago Developers (mudam se o túnel reiniciar):

- Callback OAuth: `https://corrected-reflect-bond-product.trycloudflare.com/api/reaproveitafranca/payment/mercado-pago/oauth/callback`
- Webhook: `https://corrected-reflect-bond-product.trycloudflare.com/api/reaproveitafranca/payment/webhook/mercado-pago` (eventos Pagamentos e Order)

## Decisões tomadas

1. **Reversão e refazer no estilo do projeto.** A primeira rodada de correções foi desfeita a pedido de Bryan. A reversão foi feita trecho a trecho, sem `git checkout`, porque vários arquivos são untracked. As correções foram refeitas mínimas, seguindo o padrão de cada arquivo (`paymentError` + `providerDetails`), sem alterar status HTTP já fixados pelos testes.
2. **Diagnóstico explícito no OAuth/split.** Antes, 4 callbacks consumiram o `state` sem vincular nada nem registrar o motivo. Agora as respostas trazem `provider_code`/`provider_status`:
   - `seller_is_marketplace`, `collector_changed`, `user_linked_to_other_collector`, `collector_linked_to_other_user`;
   - `seller_authorization_revoked` (401/403 em `/users/me` do vendedor → 409);
   - código do `/oauth/token` (ex.: `invalid_grant`), com status mantido em 503.
   - O callback também registra status e código no log (nunca `code`, `state` ou tokens).
3. **Bloqueio de venda.** Qualquer `sell.allow=false` do recebedor bloqueia a cobrança antes de persistir o pagamento. Antes, só `rejected_by_regulations` bloqueava. A resposta devolve `seller_codes`.
4. **401/403 do split.** A mensagem aponta a autorização do vendedor e inclui `provider_message` do Mercado Pago. O status e a lógica de reconciliação não mudaram.
5. **Public key no cartão com split.** A doc oficial Split 1:1 (BR) manda tokenizar com a public key **do integrador** e cobrar com o access token **do vendedor**. O backend já faz isso via `GET /payment/configuration`; nenhuma mudança.
6. **Tipo de cartão na conciliação.** O catálogo produtivo lista `visa/master/elo` como `credit_card` **e** `prepaid_card` com o mesmo id. Antes, um cartão pré-pago enviado como crédito era cobrado e depois recusado localmente com 502, ficando `pending` para sempre. Agora `matchesMethod` aceita a família cartão (crédito/débito/pré-pago); Pix continua exigindo `bank_transfer`. Valor, referência, recebedor, ambiente e comissão continuam exigidos exatamente.
7. **Sem movimentação de dinheiro pelo agente.** Nenhuma cobrança, pagamento ou estorno real foi criado; os testes de cartão rodaram só em sandbox e no banco temporário.

## Arquivos alterados nesta etapa

| Arquivo | Mudança |
|---|---|
| `src/services/paymentAccountService.js` (untracked) | Helper `linkError`; `providerDetails` em `tokenRequest`, `getSellerAccount` e nos conflitos de vínculo; `assertCanReceive` bloqueia qualquer `sell.allow=false` e devolve `seller_codes`. |
| `src/controllers/paymentAccountController.js` (untracked) | Respostas de conta e callback incluem `providerDetails`; log do callback com status e código. |
| `src/services/providers/mercadoPagoSplitProvider.js` (untracked) | Mensagem e `provider_message` para 401/403; conciliação usa `mercadoPago.matchesMethod`. |
| `src/services/providers/mercadoPagoPaymentProvider.js` | `CARD_TYPES` + `matchesMethod` (exportada), usada em `normalizeOrder`. |
| `scripts/test-payment-integration.js` | Mocks `sellerAuthorizationRevoked`, `splitPolicyDenied`, `splitCardType` e lista de códigos em `sellerRegulatoryBlocked`. 5 cenários novos: bloqueio de venda com códigos, autorização revogada, 403 de política, pré-pago conciliado, cartão retornado como Pix rejeitado. Asserção `seller_is_marketplace` no teste existente. |
| `.env` (fora do Git) | Apenas `MERCADO_PAGO_REDIRECT_URI` e `PAYMENT_WEBHOOK_URL` trocados para o túnel atual. |
| `AGENTS.md` | Registro do estado de 07/11. |
| `HANDOFF.md` | Este arquivo. |

Os demais itens do `git status` (split, OAuth, desvinculação, migrações, docs, scripts Cloudflare) são de etapas anteriores e devem ser preservados.

## Próximos passos

1. **Cartão real com split** (Bryan, valor baixo, comprador diferente do vendedor e do marketplace):
   - tokenizar com a `public_key` `APP_USR-…` de `GET /payment/configuration`;
   - enviar `method` conforme o `payment_type_id` do SDK: `debit_card` para débito (ex.: `debelo`, 1 parcela), `credit_card` para crédito e pré-pago;
   - conferir `approved`, compra `accepted` e comissão; estorno via admin em `POST /payment/:id/refund`, se desejado.
2. Se algo falhar, ler `error`, `provider_code`, `provider_status`, `provider_message` e `status_detail` da resposta antes de repetir. Não criar nova cobrança sem conciliar a anterior (`POST /payment/:id/sync`).
3. **Documentação:** refletir os novos códigos de erro e a regra da família cartão em `docs/payments.md`, `docs/payment-split.md` e `docs/api-contract.md` (ainda não atualizados).
4. **Commit**, quando Bryan autorizar, incluindo os arquivos untracked de pagamentos.
5. Melhorias opcionais, não implementadas e a decidir:
   - 3DS e `X-meli-session-id` (device id) para a taxa de aprovação de cartões;
   - tratamento de pagamento cujo POST nunca chegou ao provedor (hoje a conciliação não o encerra sozinha);
   - reenvio de cartão com token novo após timeout retorna 409 por desenho, para não duplicar a cobrança.
6. **Infra:** o Quick Tunnel muda de hostname ao reiniciar. Se mudar, repetir `docs/cloudflare-local.md`: checar → atualizar `.env` → reiniciar a API → salvar no painel → gerar um OAuth novo. Um domínio fixo com túnel nomeado evitaria isso (discutido, não configurado).

## Fora do escopo, registrado para decisão

Não alterados por exigirem autorização fora de pagamentos:

- `src/index.js` aplica `cors()` aberto antes do CORS restrito de `server.js`, então o restrito não tem efeito;
- `src/cron.js` referencia `cleanUpMessages`, que não existe (o cron está desativado);
- lacunas de ownership em `shopping-product`, documentos e logs (ver `docs/security-privacy.md`).
