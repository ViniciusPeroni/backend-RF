# Qualidade e verificação do backend

## Comandos disponíveis

O `package.json` não configura suíte de testes, lint, typecheck ou build. Não use `npm test` como se existisse. O comando de execução é `npm start`; `npm run start:dev` depende de `nodemon` global.

Verificação de sintaxe para arquivos JavaScript alterados:

```bash
node --check src/controllers/arquivoController.js
node --check src/services/arquivoService.js
```

Essa verificação não comprova consulta SQL, middleware, configuração de banco nem comportamento HTTP.

## Roteiro de verificação por mudança

- Inicie com `.env` de desenvolvimento e banco descartável/local; confirme a conexão nos logs.
- Exercite os métodos/paths reais com HTTP e credenciais de teste, incluindo sucesso, validação, UUID inválido, não encontrado, não autenticado e sem permissão quando aplicável.
- Para operações de banco, confirme a persistência e o escopo de usuário com dados sintéticos.
- Para Socket.IO, teste handshake sem/ com token, autorização da conversa, callback, eventos enviados e persistência.
- Para e-mail e provedores sociais, diferencie integração simulada de entrega/provedor real. Nunca reporte envio real sem evidência.
- Revise status e diff final. Não execute o schema destrutivo contra banco com dados importantes.

## Relato de evidências

Informe comandos exatos e resultado. Distinga validação de sintaxe, smoke test de carregamento, HTTP contra banco real, teste Socket.IO e integração com serviço externo. Indique ambiente indisponível ou cenários não cobertos. Teste temporário não significa que o projeto possui suíte permanente.
