# Fluxo de integração entre repositórios

O workspace Reaproveita Franca contém aplicações independentes. Não suponha dependências, build, publicação ou CI unificados.

| Aplicação | Projeto | Stack observada | Limite nesta tarefa |
|---|---|---|---|
| Web | `FrontEnd-RF/` | React, TypeScript, Vite | Leitura para verificar contrato; não editar em tarefa backend. |
| API | `backend-RF/` | Node.js, Express, MySQL, Socket.IO | Alterável quando esta for a tarefa autorizada. |
| Mobile | `Mobile-RF/` | Expo/React Native | Leitura para integração; seguir as instruções próprias antes de qualquer edição. |

## Mudança de contrato

1. Confirme rota real, auth, ownership, validação, status HTTP, formato e efeitos no banco/socket.
2. Atualize `docs/api-contract.md` somente com comportamento verificado.
3. Informe clientes afetados: método/path, token, payload, respostas, eventos e erros.
4. Não implemente compra, pagamento ou outra regra só porque há tabela no schema ou requisito no TCC.
5. Teste ponta a ponta quando o ambiente estiver disponível e descreva explicitamente o que não foi exercitado.

## Integração do chat/notificações

- Socket.IO usa origem fixa `http://localhost:3000` no servidor atual.
- Na revisão atual da `main`, não há autenticação Socket.IO, evento `send_message` ou evento de notificação implementados.
- O único evento atual é `join_conversation`, que adiciona o socket à sala pelo ID fornecido sem validar identidade ou participação; não o use para dados privados sem revisão de segurança.
- O schema contém tabela `notification`, mas ela ainda não possui rota/serviço nesta revisão.

Não atualize clientes com contratos hipotéticos. Se o contrato mudar, descreva a atualização necessária nos projetos consumidores, sem editar os repositórios irmãos sem autorização.
