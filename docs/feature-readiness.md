# Prontidão de funcionalidades e critérios de evidência

Use este vocabulário em tarefas, revisão documental e relatórios. Não use percentuais sem critério reproduzível.

## Estados

| Estado | Significado | Evidência mínima |
|---|---|---|
| **Proposto** | Requisito ou ideia ainda não confirmado no código | Referência do requisito; sem alegar implementação |
| **Schema disponível** | Estrutura de banco existe | Tabela/coluna/enum localizado; sem inferir endpoint |
| **API disponível** | Rota ou evento está montado | Arquivo, método/path/evento e middleware confirmados |
| **Integrado** | Fluxo foi exercitado no contexto relevante | Cenários de sucesso e falhas importantes, com banco/cliente quando necessário |
| **Pronto** | Fluxo integrado com controles revistos e limitações documentadas | Evidência de integração + auth/ownership/validação/observabilidade revisadas |
| **Bloqueado** | Dependência ou decisão impede avanço | Bloqueio e responsável/decisão necessários descritos |

Um estado alto não pode ser inferido de um baixo. Uma tabela, enum, controller isolado ou teste de sintaxe não prova um fluxo completo.

## Checklist para agentes

- [ ] Confirme arquivo e método/path/evento real.
- [ ] Registre middleware, papel e verificação de propriedade do recurso.
- [ ] Confirme validação, payload, status e forma de sucesso/erro no controller.
- [ ] Confirme efeito no banco/socket se aplicável.
- [ ] Execute os cenários pertinentes em ambiente seguro; anote o comando e resultado.
- [ ] Declare SMTP, OAuth, MySQL ou cliente não disponível como limitação, sem alegar integração.
- [ ] Atualize apenas os documentos cujo fato verificado mudou.

## Modelo de registro

```text
Estado: Proposto | Schema disponível | API disponível | Integrado | Pronto | Bloqueado
Evidência de implementação: arquivo + método/path/evento
Autorização e validação: middleware, papel, propriedade e entradas verificadas
Verificações: comandos/cenários e resultados observados
Limitações: casos não exercitados e lacunas conhecidas
Dependências/bloqueios: ambiente, cliente, serviço externo ou decisão
```

Consulte [`api-contract.md`](api-contract.md), [`product.md`](product.md) e [`quality.md`](quality.md). Registre desconhecidos como desconhecidos.
