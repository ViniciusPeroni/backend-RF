# Qualidade e verificação

## Estado das ferramentas

O `package.json` define somente `npm start` (`node --watch src/server.js`) e `npm run start:dev` (requer `nodemon` global, não declarado no projeto). Não há lint, build, typecheck ou comando `npm test`. Há um teste específico de pagamentos em `scripts/test-payment-integration.js`.

No PowerShell, somente em banco de desenvolvimento:

```powershell
$env:RUN_PAYMENT_DB_TESTS='1'
node scripts/test-payment-integration.js
```

O teste aplica somente a migração aditiva, cria fixtures exclusivas e remove-as ao final. Usa HTTP/MySQL reais e intercepta chamadas externas ao Mercado Pago; não valida o ambiente do provedor nem movimenta dinheiro. É bloqueado com `NODE_ENV=production`.

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

### Socket.IO e provedores externos

- A página `src/sockets/test/socket-test.html` pode ajudar no teste manual de conexão, mas o evento atualmente documentado não autentica nem valida participação.
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

Inclua comando exato, ambiente relevante sem segredos, resultado observado e cenários não cobertos. Há teste específico de pagamentos, mas não suíte geral do backend. Consulte [`feature-readiness.md`](feature-readiness.md) para classificar a prontidão da funcionalidade.
