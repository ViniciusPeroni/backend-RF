# Confirmação pendente e cadastro de empresa com Google

- `POST /user/login`: somente depois de validar a senha, uma conta `awaitingForEmail` recebe HTTP 403 com `code: EMAIL_VERIFICATION_REQUIRED` e `verification: { id, email }`. Não retorna JWT. Conta inativa e senha incorreta não recebem esses dados. Clientes antigos continuam recebendo o campo `error`.
- O cliente pode usar o identificador retornado nas rotas existentes `POST /otp/enviar` e `POST /otp/verificar`. Elas só aceitam contas aguardando confirmação; não reativam contas inativas. Há limite de dez tentativas por IP em quinze minutos, além do intervalo de trinta segundos entre reenvios por conta. Confirmar o código não cria sessão: o usuário entra novamente com a senha.
- `POST /user/create/empresa/google`: multipart, campos de empresa iguais ao cadastro comum, exceto `email` e `password`; inclui `idToken` e foto opcional. O servidor verifica assinatura, audiência, validade e e-mail verificado do token Google. Usa o e-mail do provedor, ignora papel/senha enviados e fixa `company`.
- CNPJ, CPF do responsável, nome da empresa, celular e endereço continuam obrigatórios. Usuário, documentos criptografados e endereço são criados em uma transação. Documentos, e-mail ou vínculo Google existentes resultam em conflito, sem converter contas pessoais ou deixar registros parciais.
- Sucesso retorna HTTP 201 no formato de login (`token`, `user`, `mustChangePassword: false`). A conta começa ativa, sem senha local; o e-mail já foi verificado pelo Google.
- `POST /user/login/google` aceita `accountType: company` para entrar em empresa existente. Nessa modalidade, identidade desconhecida retorna 404 e conta pessoal retorna 403; não cria uma conta pessoal como efeito da tentativa de login empresarial. Sem esse campo, preserva o fluxo pessoal anterior.
- Sem migração nova. Requer as colunas de login social já existentes (`google_id`, senha anulável), `GOOGLE_CLIENT_ID`, `SECRET` e as chaves de documentos previamente configuradas. Não altera LinkedIn nem pagamentos.

## Verificação reproduzível

Na raiz da API, em PowerShell:

```powershell
$env:RF_AUTH_TEST_ALLOW_DB='1'
npm run test:auth
```

O teste cria um banco exclusivo com nome aleatório, remove o seed administrativo e não executa o schema destrutivo no banco configurado. Ao terminar, exclui somente o banco temporário. Usa HTTP, transações MySQL, criptografia e JWT reais. SMTP e verificação externa Google são substitutos controlados: o teste não comprova entrega real do e-mail nem configurações do Google Cloud.
