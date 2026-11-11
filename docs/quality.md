# Qualidade e verificação

## Estado das ferramentas

O `package.json` define `npm start` (`node --watch src/server.js`), `npm run start:dev` (requer `nodemon` global, não declarado no projeto), `npm run test:notification`, `npm run test:card` e `npm run test:localization`. Os três scripts são integrações com MySQL, não uma suíte completa de testes. Há também um teste específico de pagamentos em `scripts/test-payment-integration.js`. Não há scripts/configuração de lint, typecheck ou build para o backend inteiro. Não invente outros comandos de teste como `npm test`.

No PowerShell, somente em banco de desenvolvimento:

```powershell
$env:RUN_PAYMENT_DB_TESTS='1'
node scripts/test-payment-suite.js
```

O runner de pagamentos cria um banco temporário vazio com as tabelas do schema versionado, executa pagamentos, cartões, localização e notificações e remove esse banco ao final. Não executa DROP/USE do RFScript.sql no banco existente. O teste específico de pagamentos aplica somente migrações aditivas e cria fixtures exclusivas. Usa HTTP/MySQL reais e intercepta chamadas financeiras e OAuth ao Mercado Pago; não valida o split externo nem movimenta dinheiro. É bloqueado com `NODE_ENV=production`.

O carregamento de ambiente ocorre em `src/index.js`: tenta `dotenv-safe` e, em caso de erro, usa `dotenv`. Portanto, não assuma que a ausência/incompletude de `.env` sempre interrompe o boot; confira o comportamento no ambiente em questão. A conectividade MySQL é verificada, mas uma falha é registrada sem necessariamente impedir a inicialização.

## Verificações proporcionais

### Notificações: canais e outbox

- `npm run test:notification:unit`: política financeira, ordem transacional/rollback, payloads, criptografia, SMTP/FCM interceptados e timeout com destruição do socket.
- `$env:RF_TEST_ALLOW_DB='1'; npm run test:notification`: banco temporário, incluindo migrações de outbox/canais, ownership, preferências opt-in, dispositivos, backoff/dead-letter e barreiras concorrentes de lease/exclusão.
- Para acrescentar regressão de cartões/pagamentos/localização/logs no mesmo banco temporário: `$env:RF_NOTIFICATION_REGRESSION='1'` antes do comando acima. Pagamentos usam provedor interceptado, sem cobranças externas.
- Não confundir resultados locais com envio/recebimento real: roteiro de configuração e validação em [notification-delivery.md](notification-delivery.md).
- Na verificação desta etapa, 74 testes unitários e 349 integrações passaram (171 notificações, 52 cartões, 100 pagamentos, 26 localização). `npm audit` ainda aponta avisos nas dependências existentes, inclusive Nodemailer e a cadeia `node-pre-gyp`/`tar`; revisar antes de produção. Nenhum `audit fix` amplo foi aplicado.

### Dependências auditadas

- `bcrypt` `^6.0.0`, `nodemailer` `^10.5.0`, `mongoose` `^7.8.13` e `follow-redirects` `1.16.3` (atualizado por `npm audit fix` pontual) deixam `npm audit` sem avisos. Não foi usado `npm audit fix --force`.
- O `bcrypt` 6 distribui binário pré-compilado (`prebuildify`) e remove `@mapbox/node-pre-gyp` e `tar` da árvore. Hashes `$2b$` de custo 10 gerados no `bcrypt` 5 continuam verificáveis no 6; a compatibilidade foi conferida com um hash gravado antes do upgrade e comparado depois, sem alterar o custo nem o prefixo.
- `nodemailer` 10 exige Node.js 20 ou superior e mantém as APIs usadas pelo transporte (`createTransport`, gancho `getSocket`, `sendMail` e `close()`). O projeto roda em Node 22+.
- Reexecução após o upgrade: 74 unitários de notificação, 29 de `test/`, 15 de `test:log`, 370 integrações em banco temporário (171 notificações, 52 cartões, 100 pagamentos interceptados, 26 localização, 21 logs) e os três grupos de autenticação, sem falhas. Nenhuma dessas verificações comprova entrega externa de e-mail/push.

### JavaScript alterado

```powershell
node --check src/controllers/arquivoController.js
```

Repita para cada arquivo JS alterado. Isso verifica sintaxe, não consulta SQL ou comportamento HTTP.

### API e banco

Com `.env` local seguro e banco descartável/de desenvolvimento:

- inicialize com `npm start` e confirme logs, porta e conectividade;
- faça requisições HTTP à rota real, incluindo sucesso, payload inválido, UUID inválido, não encontrado e falhas de autenticação/autorização pertinentes;
- confirme persistência e isolamento por usuário com dados sintéticos;
- limite tentativas de login: `authLimiter` e cooldown de OTP podem bloquear testes repetidos.
- para notificações, execute `$env:RF_TEST_ALLOW_DB="1"; npm run test:notification`. O wrapper `scripts/test-notification-suite.js` cria um banco temporário `rf_notification_test_<hex>`, executa a suíte com Node.js 22+ (WebSocket nativo) e remove o banco no final, sem tocar no banco do `.env`. Cobre validação, ownership, paginação/filtros, fila de retry, expiração de JWT no socket, gatilhos existentes e concorrência (aceite único, recusa/cancelamento sem dupla reposição de estoque e revalidação de pending).
- para cartões, execute `$env:RF_TEST_ALLOW_DB="1"; npm run test:card`. Também cria e remove usuários sintéticos e cobre validação, ownership e não exposição de `payment_token`.
- para localização, execute `$env:RF_TEST_ALLOW_DB="1"; npm run test:localization`. Cria e remove dados sintéticos e cobre CRUD do dono, coordenadas e mascaramento do endereço do anúncio.

### Socket.IO e provedores externos

- A página `src/sockets/test/socket-test.html` testa somente conexão e `join_conversation`; ela não testa o handshake autenticado, `send_message` ou notificações.
- Separe comportamento simulado de entrega SMTP/OAuth real; não reporte integração externa sem evidência do provedor.
- A suíte de notificações mantém casos com IO simulado e também sobe Socket.IO real no servidor HTTP local: verifica os quatro eventos de notificação em duas sessões do dono, isolamento de outro usuário/anônimo/JWT inválido ou já expirado, reconexão e recuperação HTTP de avisos persistidos offline. `tests/helpers/notificationSocketClient.js` implementa somente o transporte WebSocket Engine.IO v4/namespace padrão para teste, sem polling/retry e sem nova dependência.
- Cadastro tem envio de OTP substituído no teste; não exercita SMTP/OAuth reais. O teste de falha de notificação injeta uma rejeição do serviço para comprovar que a compra continua confirmada.
- `tests/helpers/reviewDisputeNotifications.js`, chamado pela mesma suíte de notificações, cobre os avisos de review e disputa, destinatários/admins ativos, rejeição de acessos indevidos, concorrência, leitura obsoleta na edição e falhas de aviso/consulta. Usa HTTP, MySQL e entrega Socket.IO reais; só injeta falhas ou intercala operações para reproduzir cenários específicos.
- Abertura de disputa avisa todos os admins ativos: os novos cenários recusam banco que já possua admins ativos fora das fixtures. Use banco descartável. A limpeza remove reviews/disputas por UUID de compra antes de excluir compras/usuários sintéticos.
- Não conecte teste a dados pessoais ou produção.

## Níveis de evidência

| Verificação | O que sustenta | O que não sustenta |
|---|---|---|
| `node --check` | Sintaxe JS | Rota, SQL, auth ou comportamento |
| Inicialização | Processo e carregamento inicial | Conectividade funcional de todos endpoints |
| HTTP com banco | Cenário de rota exercitado | Outros cenários/clientes não testados |
| Socket/integração externa | Apenas eventos/serviços efetivamente exercitados | Segurança ou disponibilidade fora dos cenários |

## Relato de qualidade

Inclua comando exato, ambiente relevante sem segredos, resultado observado e cenários não cobertos. Não há suíte automatizada completa; os testes de pagamento, notificação, cartão e localização são coberturas parciais e versionadas. Consulte [`feature-readiness.md`](feature-readiness.md) para classificar a prontidão da funcionalidade e [`notification-integration.md`](notification-integration.md) para o contrato dos gatilhos.
