# Operação de agentes de IA

Este guia define como trabalhar neste backend com um agente principal e, quando autorizado e útil, especialistas. Complementa `AGENTS.md`; não autoriza mudanças de escopo, acesso a segredos, execução destrutiva, commits ou pushes.

## Princípios

1. **Evidência antes de afirmação:** código e schema atuais prevalecem sobre estas notas; valide antes de declarar comportamento.
2. **Escopo mínimo:** não implemente funcionalidades futuras, não altere clientes irmãos e não adicione dependências sem necessidade aprovada.
3. **Segurança por padrão:** considere autenticação, papel, propriedade do recurso, validação e exposição de dados para toda rota/evento.
4. **Contexto sob demanda:** comece em `AGENTS.md` e `docs/README.md`; carregue apenas os guias necessários à tarefa.
5. **Entrega verificável:** informe arquivos/contratos alterados, comandos executados, resultado e limitações restantes.

## Papéis

### Agente principal

- É responsável pelo entendimento do pedido, definição de escopo, integração de contribuições e resposta final.
- Confere estado do repositório e mudanças preexistentes antes de editar.
- Mantém contratos e decisões coerentes entre rotas, banco e documentação.
- Não delega decisão de produto, autorização ou segurança sem trazer a decisão ao usuário.

### Especialista (uso condicional)

Delegue apenas tarefas independentes e bem delimitadas, como revisão de segurança, inspeção de schema/consultas ou revisão documental. Forneça objetivo, arquivos permitidos, contexto essencial e formato de evidência. O especialista não deve editar arquivos fora do escopo nem integrar mudanças por conta própria. O agente principal revisa toda contribuição.

Não use especialistas para tarefas pequenas, sequenciais, com arquivos compartilhados ou quando a delegação custar mais contexto que a tarefa. Não inicie trabalho paralelo sem autorização do usuário ou instrução aplicável que peça delegação.

Perfis úteis (não são agentes permanentes nem autorização para executar tarefas):

| Perfil | Escopo típico | Saída esperada |
|---|---|---|
| Segurança | Revisão somente leitura de auth, ownership, PII e abuso | Riscos priorizados com arquivos/linhas e cenários de impacto |
| Banco de dados | Inspeção de schema, UUIDs, SQL e efeito de persistência | Restrições confirmadas e implicações; sem executar schema destrutivo |
| Contrato/API | Comparação de rota, middleware, controller e consumidor | Método/path, auth, payload/resposta confirmados e discrepâncias |
| Revisor final | Leitura independente do diff contra objetivo e evidências | Achados acionáveis; não altera arquivos |

Brief de delegação: `Objetivo`, `Contexto`, `Arquivos permitidos`, `Não fazer`, `Pergunta específica`, `Formato da resposta`. Prefira especialistas somente leitura quando o objetivo for análise.

## Ciclo de trabalho

### 1. Preparar

- Reformule o resultado esperado e o limite (backend, documentação, API, banco etc.).
- Inspecione `git status --short`; preserve alterações existentes.
- Leia o mapa em [`README.md`](README.md), depois os guias relevantes. Integração com clientes exige leitura contratual; edição desses projetos exige autorização explícita e suas próprias instruções.
- Identifique dependências externas, dados de teste e comandos realmente disponíveis em `package.json`.

### 2. Investigar e planejar

- Rastreie a implementação: `src/routes/apiRoutes.js` → módulo de rota → middleware → controller → service/DB; Socket.IO parte de `src/sockets/`.
- Confira `src/mysql-init/RFScript.sql` para semântica e restrições. Schema não comprova API.
- Liste comportamento esperado observável: método/path ou evento, auth, papel/proprietário, payload, persistência, sucesso e falha.
- Pergunte em pt-BR quando houver decisão bloqueadora de regra, privacidade, contrato, custo ou serviço externo. Não pergunte por detalhes reversíveis que o padrão resolve.

### 3. Implementar

- Faça alterações localizadas e alinhadas ao módulo vizinho. Prefira rotas → controllers → services → banco quando apropriado.
- Converta UUID string para `BINARY(16)` na fronteira; nunca envie UUID cru para coluna binária.
- Preserve respostas e mensagens em pt-BR. Não exponha stack trace, query, segredo ou PII.
- Para documentação, rotule separadamente requisito, schema disponível, API disponível e integração/teste verificados.
- Não execute `RFScript.sql` contra dados que importam.

### 4. Verificar e revisar

- Use apenas comandos presentes ou justificáveis; o projeto não possui suíte, lint, typecheck ou build configurados.
- Rode `node --check` nos arquivos JavaScript alterados quando aplicável.
- Exercite HTTP/socket e persistência somente em ambiente seguro disponível; não confunda sintaxe ou startup com teste de contrato.
- Revise autorização (inclusive propriedade), dados sensíveis, erros, arquivos alterados e links/documentação.

### 5. Entregar

Relate em português: resumo, arquivos/rotas/eventos afetados, verificações exatas e resultados, dependências/ambientes não disponíveis e limitações conhecidas. Nunca diga que um teste passou sem executá-lo. Não faça commit nem push sem autorização explícita.

## Critério para especialistas

Use uma contribuição especializada quando ela reduzir risco ou permitir trabalho realmente independente. Para cada contribuição, o agente principal deve:

1. conferir se a análise responde ao escopo dado e cita evidências;
2. validar as conclusões no código/schema quando alterarem contrato ou segurança;
3. resolver divergências explicitamente, sem mesclar recomendações incompatíveis;
4. incluir no relatório apenas conclusões confirmadas.
