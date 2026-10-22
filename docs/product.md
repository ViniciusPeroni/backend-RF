# Contexto do produto e requisitos

## Resumo

Reaproveita Franca conecta empresas que geram materiais industriais reutilizáveis a pessoas, cooperativas, artesãos, instituições de ensino e organizações interessadas em reaproveitá-los. O produto mais amplo prevê web, aplicativo móvel e API; este repositório implementa apenas a API.

O TCC descreve objetivos futuros como reservas, negociações, pagamentos, chat, mapas, indicadores ambientais e classificação de materiais. Requisito, tabela ou enumeração no banco não prova que o fluxo está disponível. Use o status de implementação abaixo como snapshot do código.

## Regras refletidas no código atual

- Cadastro distingue contas `user`, `company` e `admin`; as rotas públicas removem `role` enviado no body e determinam o papel conforme o endpoint.
- Contas comuns/empresas são ativadas por OTP; os estados do schema incluem `awaitingForEmail`, `firstLogin`, `active` e `inactive`.
- Produtos são `sale` ou `donation`; venda requer preço e doação não aceita preço.
- Categorias e condições permitidas são enums da tabela `product`; não invente valores fora do schema/controller.
- O schema contém conversas, participantes e mensagens; o socket atual apenas entra na sala `join_conversation`, sem enviar/persistir mensagens.
- CPF/CNPJ são armazenados como HMAC para deduplicação e cifrados com AES-256-GCM; não devem ser armazenados em claro.

## Situação por capacidade

| Capacidade | Evidência atual no backend | Estado a comunicar |
|---|---|---|
| Cadastro e autenticação local | Rotas e controller de usuário; OTP | API implementada; integração completa depende do cliente e de SMTP configurado. |
| Login Google/LinkedIn | Rotas e código no controller | API presente; configuração de credenciais e testes externos são necessários. |
| Produtos | Listagem e operações autenticadas de CRUD | Rotas existem; revisar propriedade em update/delete e validar contrato de ponta a ponta. |
| Localização | Criação via POST | Operação presente; sem middleware JWT explícito na rota atual. |
| Logs | CRUD REST | Presente sem JWT explícito; requer revisão antes de uso público. |
| Notificações | Tabela e enum no schema | Sem controller/rota ou gatilho de notificação na revisão atual da `main`. |
| Chat | Evento Socket.IO `join_conversation` | Apenas entrada em sala pelo ID recebido; sem autenticação, persistência/envio de mensagem ou autorização de participação. |
| Compra/reserva/negociação | Tabelas no schema, sem rotas correspondentes | Planejado/não implementado como API. |
| Pagamento/comissão | Tabelas no schema, sem integração/rotas | Não afirmar pagamento disponível. |
| Disputa/review/impacto ambiental | Tabelas no schema, sem rotas correspondentes | Não afirmar fluxos disponíveis. |
| Mapas/classificação de materiais | Não confirmado nas rotas atuais | Não implementado como API. |

Este documento não constitui roadmap aprovado. Atualize os estados somente após verificar código e evidência executável.
