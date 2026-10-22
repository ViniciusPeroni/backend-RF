# Convenções de português e formatos

## Mensagens da API

- Mensagens voltadas a pessoas usuárias ficam em português brasileiro, concisas e sem detalhes internos do servidor.
- Erros HTTP seguem `{ error: string }`; sucessos seguem o formato já usado pelo endpoint, geralmente `{ message, ... }`.
- Não exponha stack traces, mensagens brutas do MySQL, token, CPF/CNPJ ou outros dados pessoais em resposta/log.
- Preserve nomes de campo do contrato em payloads e filtros; não traduza nomes de propriedades de API sem uma mudança coordenada.

## Dados e fronteiras

- UUID é exposto como string e convertido para `BINARY(16)` com `src/utils/uuid.js` no limite da aplicação.
- Valores monetários permanecem numéricos/DECIMAL na API e banco; formatação de exibição pertence aos clientes.
- Datas `DATETIME` são geradas pelo MySQL em diversas tabelas. Não suponha timezone UTC sem contrato explícito; documente a semântica antes de alterar.
- CEP e celular têm validações próprias; não trate formatação visual como validação de segurança.
- CPF/CNPJ são normalizados para HMAC/cifra através de `docService`; não registre o valor original.

Não há framework de tradução no backend. Siga as mensagens do controller próximo e mantenha os contratos técnicos estáveis.
