# Registros de decisões arquiteturais (ADR)

Use um Architecture Decision Record (ADR) para registrar decisões arquiteturais duradouras, transversais, custosas de reverter ou que alterem instruções futuras. Não crie ADR para implementação rotineira de endpoint.

## Processo

1. Consulte [decisions.md](../decisions.md) e os ADRs existentes neste diretório.
2. Crie arquivo sequencial, por exemplo `0001-pool-mysql.md`.
3. Registre status (`Proposta`, `Aceita`, `Depreciada` ou `Substituída`) e data `AAAA-MM-DD`.
4. Descreva contexto, opções, decisão, consequências e evidência/código relacionado.
5. Ao substituir uma decisão, preserve o documento anterior e aponte para o novo.
6. Atualize os guias de arquitetura/contrato relacionados. Atualize `AGENTS.md` somente quando instruções duráveis mudarem; nunca faça commit ou push sem autorização.

Não invente consenso: marque como `Proposta` até a equipe aceitar. Um ADR não substitui evidência de implementação nem altera sozinho o código.

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
