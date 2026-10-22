# Fluxo de trabalho para agentes

Este guia complementa `AGENTS.md`; as regras do repositório têm precedência. Não autoriza alterações em projetos irmãos, commits ou pushes.

## 1. Orientar-se

- Confirme a pasta/branch e leia `AGENTS.md` e `llms.txt`.
- Inspecione `git status` antes de editar; trate alterações preexistentes como trabalho do usuário.
- Consulte rotas, middleware, controller, service e schema pertinentes. Prefira implementação atual a comentários/documentação antiga.
- Verifique documentação e contratos dos clientes apenas quando necessário para integração; mantenha-os como leitura em tarefa restrita ao backend.

## 2. Definir o resultado

Para mudanças de comportamento, defina evidências observáveis: rota/evento, autenticação, papel/dono, payload, persistência, resposta/erro e efeitos em cliente. Identifique requisitos sem endpoint como bloqueios, não os invente.

## 3. Implementar de forma localizada

- Siga o fluxo rotas → controllers → services → banco quando adequado e os padrões do módulo vizinho.
- Converta UUID na fronteira; escape palavras SQL reservadas.
- Evite adicionar dependências, regras de negócio, eventos ou APIs públicas sem autorização/necessidade.
- Atualize documentação quando a implementação verificada ou decisão durável mudar.

## 4. Verificar e revisar

- Rode `node --check` nos arquivos JS alterados.
- Execute testes HTTP/Socket.IO contra banco isolado quando possível; nunca use o SQL inicial destrutivo em dados importantes.
- Revise erros, autorização, logs sensíveis e diff final. Reporte limitações com clareza.

## 5. Entregar

Resuma comportamento, arquivos/rotas, comandos/resultados e lacunas. Separe tabela existente, endpoint implementado, teste exercitado e integração de serviço externo. Não faça commit/push sem pedido explícito.

## Quando pedir decisão

Pergunte em pt-BR quando houver escolha que altere regra de negócio, contrato público, privacidade, custo ou integração externa. Para detalhes reversíveis e compatíveis com o padrão, implemente e registre a decisão relevante.
