# Prontidão de funcionalidades e evidências

Uma tabela no banco, uma rota isolada ou um evento socket não comprovam um fluxo completo. Use rótulos de evidência, não percentuais sem critério.

## Vocabulário de status

- **Proposto:** requisito/ideia; implementação não verificada.
- **Schema disponível:** tabelas/colunas existem; não implica API.
- **API disponível:** rota ou evento existe; fluxo integrado não foi exercitado.
- **Integrado:** comportamento foi exercitado com banco/cliente relevante, incluindo sucesso e falhas importantes.
- **Pronto:** integrado, autorização e validação revisadas, operação observável e limitações conhecidas documentadas.
- **Bloqueado:** dependência ou decisão explícita impede avançar.

## Evidências a registrar

- Método/path ou evento e arquivo que o monta.
- Middleware, papel, usuário proprietário e validações.
- Request/ack/resposta e estados de erro observados.
- Persistência verificada em banco descartável quando necessária.
- Comando executado e resultado literal/resumido.
- Serviços externos, SMTP, OAuth ou sockets não testados no ambiente.
- Lacunas de segurança ou fluxo que limitam a prontidão.

## Modelo para atualização

```text
Status: Proposto | Schema disponível | API disponível | Integrado | Pronto | Bloqueado
Evidência: rota/evento, arquivos e cenário exercitado
Verificações: comandos e resultados
Limitações: comportamento não implementado ou não testado
Dependências: cliente, serviço externo ou decisão de produto
```

Mantenha desconhecidos como desconhecidos. Consulte [api-contract.md](api-contract.md) e [product.md](product.md) antes de declarar capacidade entregue.
