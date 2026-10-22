# Integração da API com clientes

O workspace contém aplicações independentes, com repositórios, dependências e processos próprios. Esta tarefa documental cobre só o backend; não altere `FrontEnd-RF/` ou `Mobile-RF/` sem autorização específica.

## Antes de mudar contrato

1. Confirme rota/evento em `apiRoutes.js`, módulo de rotas e middleware.
2. Confirme auth, papel, ownership, validação, status/resposta no controller e efeitos no service/DB/socket.
3. Confira schema e formatos de UUID/datas.
4. Atualize `api-contract.md` apenas para comportamento observado.
5. Informe clientes impactados com método/path ou evento, token, payload, resposta e erros.
6. Exercite integração ponta a ponta quando ambiente e cliente estiverem disponíveis; declare o que não foi coberto.

Não crie contrato porque existe tabela no schema ou porque um cliente parece esperar determinada operação. Mudança em backend não autoriza edição automática do cliente.

## Chat e notificações

- Origem CORS fixa em `http://localhost:3000` no servidor observado.
- Socket.IO implementa apenas `join_conversation`, que coloca socket na sala pelo ID recebido, sem auth ou validação de participante.
- Não há evento de envio de mensagem nem evento/gatilho de notificação documentado.
- Tabela `notification` não é uma API.

Não conecte dados privados a esse socket sem resolver autenticação e autorização no servidor.
