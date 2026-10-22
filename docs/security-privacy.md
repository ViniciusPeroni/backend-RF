# Segurança e privacidade do backend

O backend é a fronteira de autorização e validação para os clientes. Cada rota e evento precisa verificar identidade, propriedade e papel conforme a operação; middleware no cliente não substitui isso.

## Segredos e dados pessoais

- Não inclua `.env`, senhas, JWTs, chaves, CPF/CNPJ, e-mails, telefone ou endereço em commits, exemplos ou logs.
- `DOCUMENT_ENC_KEY` e `DOCUMENT_HMAC_KEY` precisam ser chaves hexadecimais de 32 bytes. A rotação pode impedir a leitura dos documentos existentes e quebrar a deduplicação.
- CPF/CNPJ devem passar por `services/docService.js`; não crie queries que persistam documentos em claro.
- Criação e listagem de documentos recebem `userId` do cliente e não conferem propriedade com o JWT; a leitura de metadados por ID também não confere dono. Descriptografia e exclusão estão restritas ao papel admin. Revise essa autorização antes de expor os endpoints.
- Evite registrar bodies, headers Authorization, tokens OAuth ou dados pessoais em mensagens de erro/log.
- Uploads passam pelo middleware `upload`; confira limites e tipos antes de ampliar os usos.

## JWT e autorização

- `verifyJWT` verifica assinatura com `SECRET`, aceita Bearer ou token cru e injeta ID, role e nome no request.
- Não confunda autenticação JWT com autorização por propriedade. Rotas de log/localização não têm JWT explícito no módulo atual; CRUD de produto update/delete também deve ser revisado quanto à propriedade.
- OTP enviar/verificar não exigem JWT no módulo atual e recebem o ID no body. Revise rate limiting, enumeração de IDs e abuso ao alterar esse fluxo.

## Socket.IO

- Na revisão atual da `main`, Socket.IO não valida JWT nem participação na conversa.
- `join_conversation` permite entrar em qualquer sala pelo ID sem autenticação ou checagem. Isso pode expor eventos privados; restrinja o evento antes de tratar o chat como seguro para produção.

## Configuração e dependências

- CORS de HTTP/Socket.IO está fixado em `http://localhost:3000`; ajuste por ambiente antes de implantação pública.
- Não habilite cron sem corrigir a chamada a `cleanUpMessages` inexistente.
- Não execute `RFScript.sql` em banco que contenha dados importantes: ele remove o banco `Reaproveita_Franca` antes de recriá-lo.
