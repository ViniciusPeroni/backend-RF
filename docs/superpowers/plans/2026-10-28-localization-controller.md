# LocalizationController — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar o módulo de localização com CRUD do dono, visão pública de endereço de anúncio (RN10/RF14) e suporte a latitude/longitude, sem quebrar o contrato do POST existente.

**Architecture:** Rotas → controller → service → MySQL, no padrão do `cardController`. O dono gerencia as próprias localizações com JWT; a rota pública `GET /product/:productId` aplica a RN10 (endereço completo só para o dono ou comprador com reserva `accepted`/`completed`, antes disso só cidade/bairro com coordenadas arredondadas) usando um `optionalJWT` que decodifica token quando presente sem exigir login.

**Tech Stack:** Node.js/CommonJS, Express 4, MySQL 8 (`mysql2`), JWT (`jsonwebtoken`), sem dependências novas.

**Spec:** Decisões desta sessão + `docs/api-contract.md`, `docs/security-privacy.md`, RN10/RF14/RF15 da documentação do TCC (`C:\Users\User\Desktop\documentacao-tcc\documentacao.md`).

## Global Constraints

- Respostas em português brasileiro; erros `{ error: string }`, sucesso `{ message, ... }` (contrato local).
- UUID string na API → `BINARY(16)` no banco só via `src/utils/uuid.js`; ler com `BIN_TO_UUID()`.
- SQL com crases em `user`, `table`, `read`.
- **Nenhum commit/push sem autorização explícita do usuário** (AGENTS.md) — os passos de commit deste plano ficam para o final, sob autorização.
- Não alterar: `userController`, `productController`, `shopping*`, login Google, schema SQL, contratos de rotas existentes.
- `POST /localization/` mantém contrato atual (sem JWT, `userId` no corpo, resposta `{ message, id }` — documentado no TCC e consumido pelos irmãos).
- Validações existentes de `validateLocalization` (CEP 8 dígitos, estado sigla 2 letras, tamanhos) continuam valendo.
- Verificação proporcional: `node --check` em todo arquivo tocado; suíte de integração exige MySQL dev + `RF_TEST_ALLOW_DB=1` (se indisponível, reportar como não testado).

## Review Focus

1. **Vazamento de endereço (RN10):** comprador sem reserva aceita (ou anônimo) não pode receber `street`, `number`, `zipCode` nem coordenadas exatas — teste "visão pública anônima é mascarada" e "comprador com shopping pending é mascarado" (Task 2).
2. **Token inválido/expirado na rota pública:** não pode virar 401 nem liberar endereço — tratado como anônimo (mascarado) — teste "token inválido na visão pública responde mascarado e 200" (Task 2).
3. **Isolamento entre usuários:** localização de outro usuário responde 404 em GET/PUT/DELETE, sem revelar existência — testes "GET/PUT/DELETE de estranho respondem 404" (Task 1).
4. **Delete bloqueado por FK:** localização referenciada por `product` (`ON DELETE RESTRICT`) responde 409 com mensagem clara, nunca erro MySQL cru — teste "DELETE de localização usada por anúncio responde 409" (Task 1).
5. **Contrato do POST preservado:** `POST /` sem JWT continua aceitando `{userId, zipCode, ...}` e respondendo 201 `{message, id}`; `latitude`/`longitude` opcionais não quebram o `userController` que chama `createLocalization` — teste "POST cria localização sem lat/lng" (Task 1) + `node --check src/controllers/userController.js`.

---

### Task 1: CRUD do dono (service + controller + rotas + delete 409)

**Files:**
- Modify: `src/services/localizationService.js`
- Modify: `src/controllers/localizationController.js`
- Modify: `src/routes/modules/localizationRoutes.js`
- Test: `tests/localization.integration.js` (cria)

**Interfaces:**
- Consumes: `validateLocalization(data)` existente (estende com latitude/longitude opcionais), `src/utils/uuid.js` (`generateId`, `isValid`, `toBin`), `verifyJWT`.
- Produz (para Task 2 e consumidores):
  - `validateLocalization(data)` — retorna `string | null`; além dos campos atuais, valida `latitude` (número entre -90 e 90) e `longitude` (número entre -180 e 180) apenas quando presentes (`undefined`/`null`/`''` são aceitos como ausentes).
  - `createLocalization({ userId, zipCode, street, neighborhood, number, city, state, latitude, longitude }, dbConn)` — existente, passa a gravar `latitude`/`longitude` (opcionais, `NULL` quando ausentes).
  - `getLocalizationsByUser(userId)` → `Promise<Array<row>>` com `id`, `id_user` como string UUID (`BIN_TO_UUID`) e colunas `zip_code, street, neighborhood, number, city, state, latitude, longitude`.
  - `getLocalizationById(id, userId)` → `Promise<row|null>` (escopo do dono; `null` para localização de outro usuário).
  - `updateLocalization(id, userId, changes)` → `Promise<row|null>`; `changes` em chaves camel (`zipCode|zip_code`, `street`, `neighborhood`, `number`, `city`, `state`, `latitude`, `longitude`); monta SET dinâmico, `state` em maiúsculas, retorna linha atualizada.
  - `deleteLocalization(id, userId)` → `Promise<true|null>`; seleciona escopado antes do DELETE (404 se não for do dono); FK `ER_ROW_IS_REFERENCED_2` vira `err.status = 409` com mensagem `'Não é possível excluir: esta localização está vinculada a um ou mais anúncios.'`.
  - Controller: `getLocalizations`, `getLocalization`, `updateLocalization`, `deleteLocalization` (padrão `cardController`: `isValid` → 400, dono → 404, `err.status` propagado, 500 genérico).
  - Rotas (após as públicas, protegidas por `router.use(verifyJWT)`): `GET /`, `GET /:id`, `PUT /:id`, `DELETE /:id`; `POST /` mantido **antes** do `verifyJWT`, sem JWT.

- [ ] **Step 1: Escrever a suíte de integração falhando (casos do dono)**

Criar `tests/localization.integration.js` no padrão de `tests/card.integration.js` (guard `RF_TEST_ALLOW_DB=1`, `SECRET`, `SELECT 1`; app Express local montando `localizationRoutes`; `fetch`; JWT assinado local; limpeza em `finally`; `RESUMO: N PASS, N FAIL`):

- setup: 3 usuários sintéticos (`owner`, `stranger`, `admin`) direto no SQL; suffix por `Date.now()`.
- casos:
  1. `POST / sem token cria localização` → 201, body `{ message, id }` (contrato preservado, sem latitude/longitude).
  2. `POST / com CEP inválido` → 400 `{ error }`.
  3. `GET / sem token` → 401.
  4. `GET / lista apenas localizações do dono` → 200, array, `id` formato UUID, inclui `latitude`/`longitude` (null).
  5. `GET /:id de estranho` → 404.
  6. `PUT /:id do dono altera rua e CEP` → 200, resposta confirma valor novo.
  7. `PUT /:id sem campos` → 400.
  8. `PUT /:id com latitude fora de faixa (-91)` → 400.
  9. `PUT /:id de estranho` → 404.
  10. `PUT /:id com latitude/longitude válidos persiste` → 200 e valores conferem.
  11. `DELETE de localização livre` → 200; `GET /:id depois` → 404; `DELETE repetido` → 404.
  12. `DELETE de estranho` → 404 (Review Focus 3 — escopo de dono também no delete).
  13. `DELETE de localização vinculada a anúncio` → 409 com mensagem pt-BR, sem código cru do MySQL no corpo (Review Focus 4 — FK RESTRICT).
  14. `PUT /:id com latitude/longitude null` → 200 e coordenadas limpas para `null` (mesmo significado do POST).
- npm script `test:localization` em `package.json`.

- [ ] **Step 2: Rodar a suíte e confirmar falha**

Run: `$env:RF_TEST_ALLOW_DB="1"; npm run test:localization`
Expected: FAIL (rotas `GET /`, `PUT /:id`, `DELETE /:id` inexistentes → 404). Se MySQL indisponível, registrar e continuar com `node --check` como verificação, reportando no final.

- [ ] **Step 3: Implementar service**

`src/services/localizationService.js`: adicionar validação de latitude/longitude em `validateLocalization`; gravar lat/lng em `createLocalization`; implementar `getLocalizationsByUser`, `getLocalizationById`, `updateLocalization`, `deleteLocalization` conforme os blocos de Interfaces (SELECTs com `BIN_TO_UUID`, conversão `toBin` nos WHERE, crases em `` `user` ``).

- [ ] **Step 4: Implementar controller e rotas**

`src/controllers/localizationController.js`: adicionar os 4 handlers no padrão do `cardController` (validação de UUID do parâmetro, 404 como inexistente, `err.status` antes do 500, mensagens em pt-BR). `PUT` valida o estado final mesclado (`{ userId: req.userId, ...existentes, ...changes }` via `validateLocalization`) e recusa corpo sem campos aceitos.
`src/routes/modules/localizationRoutes.js`: montar `POST /` (inalterado) e, com `router.use(verifyJWT)`, os 4 handlers.

- [ ] **Step 5: Rodar a suíte e confirmar passagem**

Run: `$env:RF_TEST_ALLOW_DB="1"; npm run test:localization`
Expected: `RESUMO: N PASS, 0 FAIL`
Adicional: `node --check src/controllers/userController.js` (garante que a mudança em `createLocalization` não afeta quem o chama).

- [ ] **Step 6: Commit (somente com autorização)**

`git add src/services/localizationService.js src/controllers/localizationController.js src/routes/modules/localizationRoutes.js tests/localization.integration.js package.json` + `git commit -m "feat(localization): CRUD do dono com validacao e delete protegido"` — **aguardar autorização do usuário**.

---

### Task 2: Visão pública do anúncio (RN10/RF14) com `optionalJWT`

**Files:**
- Create: `src/middlewares/optionalJWT.js`
- Modify: `src/services/localizationService.js`
- Modify: `src/controllers/localizationController.js`
- Modify: `src/routes/modules/localizationRoutes.js`
- Test: `tests/localization.integration.js` (acrescenta casos)

**Interfaces:**
- Consumes: `getLocalizationById`/linhas de produto da Task 1, `verifyJWT` (padrão de decodificação).
- Produz:
  - `optionalJWT(req, res, next)` — sem header → `next()` anônimo; com token → `jwt.verify`; válido define `req.userId/req.role/req.userName`; inválido/expirado → `next()` anônimo (nunca 401).
  - `getLocationByProduct(productId, viewerId)` → `Promise<null | { productId, city, neighborhood, latitude, longitude, addressFull, street?, number?, zipCode?, state? }>`:
    - `null` se o produto não existir (404).
    - `addressFull = true` quando `viewerId` é dono do produto, dono da localização, ou tem `shopping` com `status IN ('accepted','completed')` ligado ao produto via `shopping_product`; senão `false`.
    - `false` → só `city`, `neighborhood` e `latitude`/`longitude` **arredondados para 2 casas** (`null` se ausentes); sem `street`/`number`/`zipCode`/`state`.
    - `true` → acrescenta `street`, `number`, `zipCode`, `state` e coordenadas exatas.
  - Controller: `getProductLocation(req, res)` → `isValid(productId)` → 400; `null` → 404 `'Localização do anúncio não encontrada.'`; senão 200 com o objeto.
  - Rota: `GET /product/:productId` com `optionalJWT`, **antes** de `router.use(verifyJWT)`.

- [ ] **Step 1: Acrescentar os casos da RN10 à suíte (falhando)**

Setup: inserir produto do `owner` apontando para a localização do dono (direto no SQL, como em `notification.integration.js`) + `shopping` (`status 'pending'`) do `buyer` com `shopping_product` ligado ao produto. Casos:
  1. `visão pública anônima é mascarada` → 200, `addressFull === false`, tem `city`/`neighborhood`, **não** tem `street`/`number`/`zipCode`/`state`, `latitude`/`longitude` com 2 casas (ou `null`).
  2. `token inválido na visão pública responde mascarado e 200` → mesmo corpo do anônimo.
  3. `comprador com shopping pending é mascarado` → `addressFull === false`.
  4. `comprador após aceite vê endereço completo` (atualizar `shopping.status` para `accepted` no teste) → `addressFull === true`, tem `street`/`number`/`zipCode`/`state`, coordenadas exatas iguais às gravadas.
  5. `dono vê endereço completo` → `addressFull === true`.
  6. `produto inexistente` → 404.
  7. `productId inválido` → 400.

- [ ] **Step 2: Rodar a suíte e confirmar falha**

Run: `$env:RF_TEST_ALLOW_DB="1"; npm run test:localization`
Expected: FAIL (rota `GET /product/:productId` inexistente).

- [ ] **Step 3: Implementar `optionalJWT`, service e rota**

Criar `src/middlewares/optionalJWT.js` (assinatura de `verifyJWT`, sem falha em token ruim); adicionar `getLocationByProduct` ao service (consulta produto → localização → `EXISTS` de shopping aceito do viewer; arredondamento só na resposta); handler `getProductLocation` no controller; montar a rota pública antes do `verifyJWT`.

- [ ] **Step 4: Rodar a suíte e confirmar passagem**

Run: `$env:RF_TEST_ALLOW_DB="1"; npm run test:localization`
Expected: `RESUMO: N PASS, 0 FAIL` (todos os casos das Tasks 1 e 2).

- [ ] **Step 5: Commit (somente com autorização)**

`git add src/middlewares/optionalJWT.js src/services/localizationService.js src/controllers/localizationController.js src/routes/modules/localizationRoutes.js tests/localization.integration.js` + `git commit -m "feat(localization): visao publica do anuncio com mascaramento RN10"` — **aguardar autorização**.

---

### Task 3: Documentação e verificação final

**Files:**
- Modify: `docs/api-contract.md`, `docs/security-privacy.md`, `docs/product.md`
- Modify: `docs/feature-readiness.md` (apenas se houver linha de localização a atualizar)

**Interfaces:**
- Consumes: contratos finais das Tasks 1–2.

- [ ] **Step 1: Atualizar documentos afetados**

- `api-contract.md`: listar os endpoints novos (`GET /localization/`, `GET /localization/:id`, `PUT /localization/:id`, `DELETE /localization/:id` com JWT; `GET /localization/product/:productId` com token opcional) e registrar a regra RN10 no comentário de mascaramento.
- `security-privacy.md`: ownership agora cobre leitura/edição/exclusão em `localization`; a lacuna de JWT no `POST /localization/` permanece (decisão pendente em `decisions.md`).
- `product.md`: atualizar a linha de Localização ("POST montado com validador") para o estado real.

- [ ] **Step 2: Verificação final**

Run: `node --check src/controllers/localizationController.js src/services/localizationService.js src/routes/modules/localizationRoutes.js src/middlewares/optionalJWT.js tests/localization.integration.js`
Expected: sem saída de erro.
Run: `$env:RF_TEST_ALLOW_DB="1"; npm run test:localization`
Expected: `0 FAIL` (ou registrar como não testado se MySQL indisponível).
Revisão do diff: nenhuma alteração fora de `src/{controllers,services,routes,middlewares}` de localização, `tests/localization.integration.js`, `package.json` (script de teste) e `docs/`.

- [ ] **Step 3: Commit final (somente com autorização)**

Docs + qualquer ajuste restante, mensagem `docs(localization): documenta endpoints e mascaramento RN10` — **aguardar autorização**.
