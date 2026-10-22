# Convenções de idioma, dados e formatos

## Idioma e respostas

- Mensagens voltadas às pessoas usuárias devem ser em português brasileiro, objetivas e sem detalhes internos.
- Erros normalmente seguem `{ error: string }`; sucesso varia por endpoint, geralmente `{ message, ... }`. Preserve o contrato local.
- Não traduza nomes de campos/payload sem mudança coordenada nos consumidores.
- Não exponha stack trace, erro bruto do MySQL, token ou dados pessoais em resposta/log.

## Identificadores e formatos

- UUID aparece como string na API e é convertido em `BINARY(16)` no banco usando `src/utils/uuid.js`. Não passe string crua para query binária.
- Dinheiro deve preservar representação numérica/DECIMAL no contrato; formatação visual pertence ao cliente.
- Muitas datas são `DATETIME` geradas pelo MySQL. Não assuma UTC; documente timezone/semântica antes de mudar contrato.
- CEP/celular têm validações próprias; máscara visual não é validação de segurança.
- CPF/CNPJ devem ser normalizados/protegidos por `docService`, nunca registrados em claro.
- Use crases em SQL para nomes reservados como `user`, `table` e `read`.

Não há framework de tradução no backend. Siga o controller vizinho e confirme contratos reais antes de alterar formatos. Consulte [`api-contract.md`](api-contract.md).
