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
- Envie JWT no handshake Socket.IO usando `auth: { token }` para receber eventos na sala individual `user:<uuid>`.
- `send_message` aceita `{ conversationId, type?, content?, id_answer? }`; a confirmação chega pelo callback e mensagens chegam como `new_message`.
- Notificações persistidas são emitidas como `notification`; leitura/exclusão sincronizam com `notification_read`, `notifications_read_all` e `notification_deleted`.
- Depois de reconectar, consulte `GET /notification/` (opcionalmente `?read=nao`): não há replay automático de eventos perdidos enquanto offline.
- Gatilhos automáticos atuais: mensagem nova, cadastro, ativação por OTP, criação de compra (`reserva_solicitada` para cada vendedor), aceite/recusa (`reserva_aceita`/`reserva_recusada` para o comprador), cancelamento (`sistema` para cada vendedor), review (`nova_review` para avaliado), disputa aberta (demais partes e admins ativos) e resolvida/rejeitada (todas as partes) e pagamento confirmado para comprador, vendedores e administradores ativos; o contrato está em [`notification-integration.md`](notification-integration.md).
- Teste de integração: `$env:RF_TEST_ALLOW_DB="1"; npm run test:notification` (MySQL de desenvolvimento; remove dados sintéticos ao final).
- `join_conversation` exige identidade autenticada, UUID válido e participação na conversa.

O JWT é validado no ingresso; expiração posterior não encerra a sessão automaticamente. A suíte exercita o transporte local, não substitui validação com web/mobile nem implantação com CORS adequado.
