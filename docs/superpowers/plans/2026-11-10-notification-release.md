# Notification release verification plan

**Goal:** resolver alertas de dependências e verificar bloqueios reais de implantação sem inventar credenciais nem evidência externa.
**Architecture:** preservar APIs de hash e transporte; atualizar somente dependências afetadas e lock compatível. Migrações do destino dependem de acesso autenticado, backup e schema confirmado. Provedores seguem desligados até configuração/teste autorizado.
**Tech stack:** Node 22+, CommonJS, bcrypt, Nodemailer, MySQL 8, SMTP e FCM existentes.

- [x] Verificar configuração sem expor valores: Firebase/chave de dispositivos ausentes; canais desligados.
- [x] Verificar banco com leitura: conexão recusada (`ER_ACCESS_DENIED_ERROR`), sem alterar senha/`.env`.
- [x] Registrar compatibilidade de hash bcrypt anterior e transporte CommonJS com testes sem rede.
- [x] Corrigir dependências auditadas, evitando `npm audit fix --force` ou alterações de regras de autenticação.
- [x] Verificar audit, unitários e regressões HTTP/MySQL em instância descartável; revisar diff.
- [ ] Registrar evidências e bloqueios de credenciais/dispositivos/autorização de clientes. Não mover card para DONE sem validação externa.

## Evidências

- Dependências: `bcrypt` 6.0.0, `nodemailer` 10.5.0, `mongoose` 7.8.13 e `follow-redirects` 1.16.3. `npm audit` passou de 5 avisos (1 crítico) para zero. `@mapbox/node-pre-gyp` e `tar` saíram da árvore.
- Hashes: baseline `$2b$` de custo 10 gravado com bcrypt 5.1.1 e verificado com bcrypt 6.0.0 (senha correta aceita, senhas erradas recusadas, novo hash no mesmo prefixo/custo).
- Nodemailer 10 mantém `createTransport`, o gancho `getSocket` e `close()`; exige Node 20+ e o projeto usa Node 22+.
- Suítes após o upgrade: 74 unitários de notificação, 29 de `test/`, 15 de `test:log`, 370 integrações em MySQL descartável (171 notificações, 52 cartões, 100 pagamentos interceptados, 26 localização, 21 logs) e 3 grupos de autenticação.
- SMTP: sonda descartável com servidor local sem STARTTLS exercitou o Nodemailer 10 real pelo gancho `getSocket` (uma conexão, EHLO enviado) e o erro foi classificado como `SMTP_TRANSIENT` não terminal, como esperado para retry. Não houve entrega externa real.

## Bloqueios externos

- Banco de destino recusa as credenciais configuradas: migrações de retry/outbox/canais não podem ser aplicadas sem senha válida e autorização.
- `FCM_PROJECT_ID`, credenciais do Google e `NOTIFICATION_TOKEN_KEY` ausentes; SMTP dedicado não configurado (`NOTIFICATION_SMTP_*`). Sem isso não há entrega real de e-mail/push.
- Integração e validação em `FrontEnd-RF/` e `Mobile-RF/` dependem de autorização nos projetos irmãos.

## Limites

Sem alterações nos projetos irmãos, mudança de senha do banco, exposição de credenciais, cobrança ou envio indiscriminado a pessoas reais. Nunca executar `RFScript.sql` no banco existente.
