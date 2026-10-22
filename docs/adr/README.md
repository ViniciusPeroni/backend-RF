# Registros de decisões arquiteturais (ADR)

Use ADR para decisão duradoura, transversal, custosa de reverter ou que altere instruções futuras. Não crie ADR para implementação rotineira de endpoint.

## Processo

1. Consulte [decisions.md](../decisions.md) e ADRs existentes.
2. Crie arquivo sequencial, por exemplo `0001-pool-mysql.md`.
3. Registre status (`Proposta`, `Aceita`, `Depreciada` ou `Substituída`) e data `AAAA-MM-DD`.
4. Descreva contexto, opções, decisão, consequências e evidência/código relacionado.
5. Ao substituir uma decisão, preserve o documento anterior e aponte para o novo.
6. Atualize docs de arquitetura/contrato e `AGENTS.md` somente se instruções/fatos duráveis mudarem e houver autorização para editar esse arquivo.

## Modelo

```markdown
# ADR-NNNN: Título curto

- Status: Proposta
- Data: AAAA-MM-DD

## Contexto
Problema ou restrição que exige decisão.

## Opções consideradas
Alternativas viáveis e trade-offs.

## Decisão
Escolha e escopo explicitamente excluído.

## Consequências
Benefícios, custos, riscos, manutenção e migrações.

## Evidências e links
Arquivos, schema, contrato ou discussão relevante.
```
