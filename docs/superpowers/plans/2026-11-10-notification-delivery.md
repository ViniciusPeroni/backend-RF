# Notification delivery implementation plan

**Goal:** concluir as lacunas de backend de notificações sem confundir testes locais com entrega externa.
**Architecture:** outbox transacional reutiliza `notification_retry`; os serviços gravam o aviso na conexão da operação e o envio imediato/worker usa o mesmo UUID. Canais SMTP e FCM possuem fila própria, preferências opt-in e dispositivos vinculados ao JWT. Avisos financeiros usam `sistema` para recusa/estorno, sem dados do gateway.
**Tech Stack:** CommonJS, MySQL 8, Express 4, Nodemailer, Firebase HTTP v1 com Google Auth já instalado.
**Decisões técnicas delegadas pelo usuário:** SMTP existente, FCM, comprador em recusa; comprador/vendedores/admins ativos em estorno. Não alterar permissões nem estados financeiros.

## Restrições
- Sem merge, commit/push novos, envio a pessoas reais, cobrança externa ou edição web/mobile.
- Provedores desabilitados por padrão; ativação requer configuração e preferências explícitas.
- Testes MySQL somente em banco temporário; não aplicar schema destrutivo nem migrações ao banco local nesta etapa.
- Não prometer 100% externo: dispositivos, credenciais e implantação permanecem dependências.

## Tarefas
- [x] Escrever testes falhando para preferências/dispositivos/canais; implementar endpoints, criptografia de tokens e fila com retries independentes.
- [x] Escrever testes falhando para recusa/estorno; ligar ao commit financeiro sem duplicatas.
- [x] Escrever testes falhando para outbox/rollback/recuperação; adicionar `enqueue(conn, data)` e envio pelo mesmo UUID.
- [x] Integrar outbox aos gatilhos de compras, review/disputa, mensagens e cadastro/OTP sem alterar regras de negócio.
- [x] Verificar migrações em banco temporário, integração HTTP/Socket.IO e segurança, syntax/diff e revisão independente.
- [x] Documentar configuração, limitações externas e roteiro de liberação. Não mover Trello para DONE sem evidência externa.

## Revisão prioritária
Rollback não deixa avisos; commit sem controller é recuperável; reprocessamento não duplica linhas; opt-out bloqueia envio; tokens e mensagens sensíveis não aparecem em logs; falha de um canal não bloqueia outros.

## Evidências

- Unitários: `npm run test:notification:unit` — 74 PASS / 0 FAIL.
- Runner temporário com `RF_NOTIFICATION_REGRESSION=1`: 171 notificações, 52 cartões, 100 pagamentos e 26 localização, sem falhas/skip.
- Migrações de outbox/canais exercitadas em banco temporário. Nenhuma alteração no banco local existente.
- As credenciais locais recusaram acesso; para não trocar senha/`.env`, foi inicializada instância MySQL descartável em loopback, porta 33317, com datadir exclusivo no diretório temporário aprovado.
- Revisões independentes: corrigidas duas corridas de ressurreição após DELETE com barreiras de concorrência, resumo UTF-8 excessivo de reserva e timeout SMTP que não destruía o socket. Releituras não identificaram bloqueadores restantes nesses pontos.
- Syntax: 31 arquivos JavaScript verificados; `git diff --check` sem erros.
- Auditoria: avisos preexistentes nas dependências (`nodemailer`, `@mapbox/node-pre-gyp`, `tar` na árvore instalada; o lock também aponta `mongoose` e `follow-redirects`). Não foi aplicado `npm audit fix` nem upgrade amplo fora do escopo. Requer revisão de dependências antes de implantação.
- `qrcode`, já declarado no projeto, precisou ser restaurado em `node_modules` para executar os testes de pagamentos. Sem alteração de versão declarada/lock.
- Sem SMTP/FCM externo, app real, cobrança, commit/push ou merge nesta etapa. Permanecem configuração dos provedores, integração dos clientes, aplicação de migrações no ambiente de destino e validação externa.
