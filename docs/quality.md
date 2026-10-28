# Qualidade e verificação

## Estado das ferramentas

O `package.json` define `npm start` (`node --watch src/server.js`), `npm run start:dev` (requer `nodemon` global, não declarado no projeto), `npm run test:notification` e `npm run test:card`. Os dois scripts são integrações com MySQL, não uma suíte completa de testes. Não há scripts/configuração de lint, typecheck ou build para o backend inteiro. Não invente outros comandos de teste como `npm test`.

O carregamento de ambiente ocorre em `src/index.js`: tenta `dotenv-safe` e, em caso de erro, usa `dotenv`. Portanto, não assuma que a ausência/incompletude de `.env` sempre interrompe o boot; confira o comportamento no ambiente em questão. A conectividade MySQL é verificada, mas uma falha é registrada sem necessariamente impedir a inicialização.

## Verificações proporcionais

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
- para notificações, execute `$env:RF_TEST_ALLOW_DB="1"; npm run test:notification`. O script cria e remove dados sintéticos, mas exige um banco de desenvolvimento.
- para cartões, execute `$env:RF_TEST_ALLOW_DB="1"; npm run test:card`. Também cria e remove usuários sintéticos e cobre validação, ownership e não exposição de `payment_token`.

### Socket.IO e provedores externos

- A página `src/sockets/test/socket-test.html` testa somente conexão e `join_conversation`; ela não testa o handshake autenticado, `send_message` ou notificações.
- Separe comportamento simulado de entrega SMTP/OAuth real; não reporte integração externa sem evidência do provedor.
- Não conecte teste a dados pessoais ou produção.

## Níveis de evidência

| Verificação | O que sustenta | O que não sustenta |
|---|---|---|
| `node --check` | Sintaxe JS | Rota, SQL, auth ou comportamento |
| Inicialização | Processo e carregamento inicial | Conectividade funcional de todos endpoints |
| HTTP com banco | Cenário de rota exercitado | Outros cenários/clientes não testados |
| Socket/integração externa | Apenas eventos/serviços efetivamente exercitados | Segurança ou disponibilidade fora dos cenários |

## Relato de qualidade

Inclua comando exato, ambiente relevante sem segredos, resultado observado e cenários não cobertos. “Não há suíte automatizada completa” deve continuar explícito; o script de notificação é uma cobertura parcial e versionada. Consulte [`feature-readiness.md`](feature-readiness.md) para classificar a prontidão da funcionalidade e [`notification-integration.md`](notification-integration.md) para o contrato dos gatilhos.
