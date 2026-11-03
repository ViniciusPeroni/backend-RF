# Plano: Checkout Pro e confirmação de pagamento

**Goal:** integrar o checkout Mercado Pago em sandbox até o cliente conseguir iniciar uma cobrança, receber o status confirmado pelo webhook e consultar o resultado pela API.

**Architecture:** `paymentService` valida shopping e persiste pagamentos locais; `mercadoPagoService` encapsula chamadas REST; controllers/rotas protegem checkout e consulta por JWT/ownership. Webhook valida HMAC, consulta o pagamento no Mercado Pago e aplica estado idempotente antes de gerar comissão.

**Tech stack:** Node.js/CommonJS, Express 4, MySQL 8, Axios existente e `node:test`.

**Spec path:** decisões confirmadas nesta conversa e instruções em `AGENTS.md`; comportamento atual em `src/mysql-init/RFScript.sql` e `docs/api-contract.md`.

## Global constraints

- “Checkout Pro, inicialmente em sandbox.”
- “O dinheiro vai para a conta da plataforma; sem split ou repasse automático nesta etapa.”
- “Comissão de 8% sobre o valor total pago.”
- “A compra precisa estar `accepted` pelo vendedor antes de iniciar o checkout.”
- “O cliente escolhe Pix, débito ou crédito; `account_money` também deve ser aceito.”
- “Comissão permanece registrada para auditoria se houver estorno.”
- “Compra de valor zero (somente doações) não deve ser enviada ao Mercado Pago.”
- Nunca confiar em preço/total enviado pelo cliente; usar dados persistidos.
- Não executar `RFScript.sql` em banco com dados importantes; não usar credenciais reais nos testes.
- Um componente por commit; Conventional Commit em inglês; push somente para a branch de feature.

## Review focus

1. Checkout de shopping de outro usuário ou não `accepted` — teste deve negar e não chamar Mercado Pago.
2. Total zero ou método inválido — teste deve negar antes de criar preferência.
3. Preferência repetida/retomada — teste deve reutilizar preferência pendente e evitar novo pagamento.
4. Webhook inválido ou pagamento divergente — teste deve negar sem atualizar banco nem comissão.
5. Webhook repetido/fora de ordem — teste deve manter estado consistente e não duplicar comissão; estorno preserva registro.

## Tarefas

### 1. Criar checkout de forma segura

**Files:** `src/services/mercadoPagoService.js`, `src/services/paymentService.js`, `test/mercadoPagoService.test.js`, `test/paymentService.test.js`, `.env.example`, `.env` local (somente placeholders), `docs/architecture.md`, `docs/product.md`.

**Interface:** `paymentService.createCheckout({ userId, shoppingId, method })` retorna `{ id, status, method, checkoutUrl }`; `mercadoPagoService.getPreference(preferenceId)` e `getPaymentMethods()` encapsulam GETs oficiais.

- [x] Testar compra alheia, status diferente de `accepted`, total zero e método não permitido.
- [x] Testar preferência criada com itens/valor derivados do banco, `external_reference` local e filtragem de métodos, permitindo saldo Mercado Pago.
- [x] Testar retomada idempotente da preferência pendente.
- [x] Implementar transação/locking e persistência da referência de preferência; manter todos os erros sanitizados.
- [x] Rodar `node --test test/paymentService.test.js test/mercadoPagoService.test.js` e `node --check` nos arquivos alterados.
- [ ] Commit semântico da unidade de checkout.

### 2. Expor checkout e status para o cliente

**Files:** `src/controllers/paymentController.js`, `src/routes/modules/paymentRoutes.js`, `src/routes/apiRoutes.js`, testes de rota, `docs/api-contract.md`, `docs/security-privacy.md`.

**Interface:** `POST /payment/checkout` recebe `{ shoppingId, method }`; `GET /payment/:paymentId` retorna status somente ao comprador dono (ou admin). JWT obrigatório.

- [x] Testar JWT ausente, resposta com URL e status.
- [x] Implementar controller e rotas; valores nunca vêm do body.
- [x] Rodar testes de rota e sintaxe; atualizar contrato.
- [ ] Commit semântico da API de checkout/status.

### 3. Processar notificações Mercado Pago

**Files:** serviço de webhook, controller/rota, `.env.example`, `.env` local (placeholders), testes e docs de segurança/contrato.

**Interface:** `POST /payment/webhook` recebe notificação pública, valida `x-signature`, `x-request-id` e `data.id`, consulta `mercadoPagoService.getPayment(id)` e atualiza o pagamento local por `external_reference`.

- [x] Testar assinatura ausente/inválida, ID divergente, valor/moeda divergentes e aprovação/estorno.
- [x] Processar eventos repetidos por associação de ID externo única; gerar comissão idempotente na aprovação e preservar registro em estorno.
- [x] Implementar validação HMAC com comparação em tempo constante, consulta ao Mercado Pago e atualização transacional.
- [x] Configurar `MP_WEBHOOK_SECRET` e `MP_NOTIFICATION_URL` sem inserir credenciais.
- [x] Rodar testes, `node --check` e `git diff --check`; webhook real não foi exercitado por falta de credenciais/configuração.
- [ ] Commit semântico da integração de webhook.

### 4. Fechamento

- [x] Atualizar o status de capacidades/documentação apenas com comportamento verificado.
- [x] Rodar todos os testes `node:test` do repositório e revisar diff/segurança.
- [ ] Commit da documentação final se houver alteração independente; push somente para `feature/leonardo/commission-controller`.
