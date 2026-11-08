# Guia de implementação e liberação dos pagamentos

Referência: código e configurações inspecionados em **02/11/2026**. Backend: `backend-RF`, branch `feature/bryan/PaymentController`. Este guia cobre o pagamento completo: backend, Mercado Pago, vínculo do vendedor, mobile, operação e validação externa.

Atualização de 03/11/2026: a situação abaixo incorpora o vínculo OAuth, o teste externo do webhook e os testes de cartões descritos em [payment-split.md](payment-split.md#testes-externos-de-cartão). Os demais critérios continuam sendo requisitos de liberação, não comprovação de funcionamento em produção.

**Pronto para liberar** significa cumprir os critérios de aceite abaixo. Ter credenciais produtivas, gerar um QR Code ou passar nos testes locais não comprova, sozinho, o funcionamento do split, do webhook ou do aplicativo em produção.

## 1. Situação atual

| Parte | Situação comprovada |
|---|---|
| Pix, crédito/débito tokenizados, consultas, cancelamento e estorno | Código implementado; cenários locais com provedor interceptado aprovados. A habilitação dos meios depende da conta Mercado Pago. |
| Split 1:1, OAuth, credenciais criptografadas e renovação | Implementados e testados com respostas sintéticas do provedor. |
| Comissão de 5%, conciliação, estoque e notificações | Implementados e exercitados nos testes locais. |
| Credencial principal de produção | Autenticação confirmada por consulta GET ao Mercado Pago, sem cobrança. |
| Testes automatizados | 281 aprovados: 95 de pagamentos, 52 de cartões, 26 de localização e 108 de notificações. |
| Configuração local | Produção com `split_payment=true`, OAuth e assinatura/URL de webhook preenchidos. Não comprova liberação financeira. |
| Banco local | Ainda sem `localization.latitude`/`longitude`; `user.password`/`cellphone` exigidos, diferentemente do schema versionado. |
| Mobile | `package.json` declara Expo `^58.0.0`; `AGENTS.md` ainda exige consultar SDK 54. Integração de pagamento não foi implementada nesta tarefa. |
| Vínculo real, divisão do dinheiro e webhook externo | Vínculo OAuth e simulação externa de webhook HTTP 200 confirmados. Conta vendedora bloqueada para vendas; transação aprovada e divisão financeira continuam pendentes. |
| Cartões externos no sandbox | Payments API: Mastercard/Visa aprovados, recusa e processamento confirmados com `live_mode=false`. Débito sem aprovação; credencial atual de teste recusada pela Orders API. |

Detalhes técnicos existentes: [pagamentos](payments.md), [split e OAuth](payment-split.md), [contrato da API](api-contract.md).

## 2. Fechar as regras antes de integrar as telas

Responsáveis: Bryan e equipe do projeto.

| Decisão | Comportamento atual e decisão necessária |
|---|---|
| Quem recebe | Com split: vendedor recebe o pagamento e a plataforma recebe a comissão. Sem split: a conta principal recebe o valor; não há repasse automático posterior. |
| Base dos 5% | O código calcula 5% sobre o total bruto da compra. R$ 50,00 geram R$ 2,50 de comissão e R$ 47,50 para o vendedor antes das tarifas do Mercado Pago. Confirmar essa regra com a equipe. |
| Quantos vendedores | Split 1:1 exige uma compra por vendedor. O carrinho precisa separar empresas; o backend bloqueia uma cobrança com múltiplos vendedores nesse modo. |
| Momento do pagamento | Hoje a API só cria pagamento para compra `pending`, e a aprovação a torna `accepted`. A rota de compras também permite aceite pelo vendedor. Se o fluxo exigir aceite antes de pagar, será necessário alinhar essa regra no backend e no mobile. |
| Cancelamento | Cancelar a compra localmente não cancela automaticamente a cobrança. O fluxo precisa usar o cancelamento/estorno do pagamento e tratar dinheiro confirmado depois do cancelamento local. |
| Doação | Compra com total zero não deve abrir cobrança; o fluxo deve seguir como reserva/doação. |
| Revisão administrativa | Aprovação após cancelamento, chargeback e estorno parcial exigem um procedimento de conciliação, sem reaproveitar o status como se fosse uma nova compra. |

**Aceite:** regras registradas, estados coerentes nos dois módulos e testes para pagamento antes/depois do aceite conforme a decisão. Ajustes no módulo de compras exigem autorização específica; não foram feitos por este guia.

## 3. Preparar banco e ambiente de validação

Responsável: backend/infraestrutura.

1. Fazer backup do banco que contém dados importantes.
2. Comparar seu schema com o código recebido da main. Corrigir a ausência das coordenadas e validar a política de campos de usuário com quem mantém autenticação/localização.
3. Aplicar as migrações aditivas de pagamentos no ambiente de destino:
   - `src/mysql-init/migration_payment_gateway.sql`;
   - `src/mysql-init/migration_payment_distribution.sql`;
   - `src/mysql-init/migration_payment_split.sql`.
   - Depois, uma vez: `src/mysql-init/migration_payment_account_disconnect.sql`.
4. Conferir FKs, índices e tabelas `payment`, `payment_gateway`, `payment_distribution`, `payment_split`, `payment_seller_account`, `payment_oauth_state` e `commission`.
5. Separar homologação e produção: banco, credenciais, aplicação/contas e configuração do cliente. Não alternar as credenciais para reutilizar um pagamento antigo em outro ambiente.

**Não executar `RFScript.sql` no banco existente:** o arquivo remove o banco antes de recriá-lo. O runner de testes usa apenas CREATE/ALTER de tabelas em um banco temporário novo, não esse procedimento destrutivo.

**Aceite:** cadastro, endereço, produto e compra podem ser criados pela API do ambiente real de validação; não apenas por INSERT de fixtures.

## 4. Disponibilizar o backend por HTTPS

Responsáveis: infraestrutura e Bryan.

Definir um hostname estável para o backend. Exemplo ilustrativo: `https://api.seudominio.com`. Substituir o domínio de exemplo em todas as configurações.

Pode-se usar hospedagem permanente ou Cloudflare Tunnel com hostname estável. Um Quick Tunnel serve para verificações temporárias, mas o roteiro de liberação deve usar uma URL estável. Um túnel para o PC só funciona enquanto PC, backend, banco e túnel estiverem disponíveis. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

| Uso | URL pública |
|---|---|
| Base REST | `https://api.seudominio.com/api/reaproveitafranca` |
| Callback OAuth | `https://api.seudominio.com/api/reaproveitafranca/payment/mercado-pago/oauth/callback` |
| Webhook | `https://api.seudominio.com/api/reaproveitafranca/payment/webhook/mercado-pago` |

Antes de implantar:

- Fixar uma versão de Node/dependências validada; os testes atuais rodaram em Node 24.21.0, com `package-lock.json`.
- Conferir a diferença de caixa entre o import `./db/testConnect` e o arquivo `src/db/testconnect.js` antes de usar Linux.
- Revisar a configuração global de CORS e a origem do Socket.IO; o servidor atual contém configuração de localhost. Aplicar as origens corretas para os clientes web e testar o mobile separadamente.
- Configurar processo persistente, reinício após falha e acesso ao MySQL.
- Permitir ao provedor alcançar webhook/callback; uma tela de login do proxy/Cloudflare Access no caminho impediria a entrega.
- Manter JWT nas rotas do aplicativo e HMAC no webhook. Publicar HTTPS não significa remover essas validações.

Os ajustes de servidor fora do módulo de pagamentos precisam de autorização antes da implementação.

**Aceite:** acessar a API de outra rede; confirmar que as rotas protegidas exigem autenticação e que o callback/webhook chegam à aplicação sem bloqueio do proxy. Usar a URL pública no Postman e no dispositivo, sem depender de `localhost` do PC.

## 5. Configurar a aplicação Marketplace

Responsável: titular da conta da plataforma, com acompanhamento de Bryan.

No Mercado Pago Developers, criar/configurar uma aplicação em **Pagamentos online → Checkout API → Marketplace**, conforme as opções disponíveis. A conta da plataforma e as contas dos vendedores precisam atender às verificações exigidas pelo Mercado Pago. [Configuração oficial](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration), [pré-requisitos](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites).

Manter Access Token, Public Key, Client ID e Client Secret da mesma aplicação da plataforma. Cada vendedor autoriza essa aplicação por OAuth; não entrega uma `.env` própria.

Se for necessário criar uma aplicação diferente da atual, planejar primeiro as cobranças antigas. O backend usa uma configuração principal e um segredo de webhook por instância; trocar esses valores não preserva automaticamente a validação de eventos de outra aplicação. Conciliar os pagamentos anteriores ou preparar suporte explícito à coexistência antes da mudança.

Configurar a Redirect URL exatamente como a URL HTTPS do callback e habilitar PKCE no fluxo de autorização. A autorização do titular e as verificações de identidade são feitas no próprio Mercado Pago.

**Aceite:** aplicação correta, credenciais coerentes e fluxo OAuth real concluído na etapa 7. A mera presença dos campos não comprova que o Marketplace está habilitado.

## 6. Preencher a `.env` da plataforma

Responsável: backend/infraestrutura. Não copiar o modelo abaixo sobre uma `.env` válida; preencher apenas os campos necessários e preservar as chaves existentes.

```dotenv
NODE_ENV=production
PAYMENT_PROVIDER=mercado_pago
MERCADO_PAGO_ENV=production
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_PUBLIC_KEY=
MERCADO_PAGO_CLIENT_ID=
MERCADO_PAGO_CLIENT_SECRET=
MERCADO_PAGO_REDIRECT_URI=https://api.seudominio.com/api/reaproveitafranca/payment/mercado-pago/oauth/callback
MERCADO_PAGO_WEBHOOK_SECRET=
PAYMENT_WEBHOOK_URL=https://api.seudominio.com/api/reaproveitafranca/payment/webhook/mercado-pago
PAYMENT_TOKEN_ENCRYPTION_KEY=
PAYMENT_COMMISSION_PERCENT=5
split_payment=false
```

| Campo | Origem/uso |
|---|---|
| Access Token e Public Key | Credenciais da aplicação da plataforma no ambiente escolhido. Somente a Public Key pode ir ao SDK do cliente. |
| Client ID e Client Secret | Detalhes da aplicação Marketplace; usados pelo backend no OAuth. |
| Redirect URI | Mesma URL cadastrada na aplicação, incluindo caminho e HTTPS. |
| Webhook Secret | Assinatura secreta da aplicação, obtida na configuração de notificações. Não é o Access Token. |
| Token Encryption Key | Chave local de 64 caracteres hexadecimais. Já foi preparada no ambiente local; preservar e fazer backup. |
| Commission Percent | Percentual da regra aprovada, atualmente 5. |
| Split Payment | `false` para recebimento centralizado; `true` para split real com vendedores vinculados. |

Access Token de vendedor, refresh token e conta recebedora por empresa ficam no banco, vinculados ao usuário e criptografados. **Não criar variáveis por empresa, nem colocar credenciais privadas no mobile.** A chave de criptografia precisa acompanhar o backup das credenciais; rotacioná-la sem migração impede abrir os tokens existentes.

Reiniciar a API e consultar `GET /payment/configuration` com JWT. Conferir modo, Public Key, `oauth_configured`, `webhook_configured` e `webhook_url_configured`. Esses campos verificam configuração local; `external_validation_required` não é uma aprovação de produção.

**Aceite:** valores coerentes com o ambiente e com a mesma aplicação, sem segredos no Git, no app ou nos registros de teste.

## 7. Vincular uma empresa piloto

Responsáveis: empresa titular da conta e backend/mobile.

1. Entrar no RF como usuário da empresa vendedora, com conta local ativa.
2. Consultar `GET /payment/mercado-pago/account` usando o JWT desse usuário.
3. Chamar `POST /payment/mercado-pago/connect` e abrir `authorization_url` no navegador.
4. Autorizar o Marketplace na conta Mercado Pago que pertence à empresa piloto, distinta da conta da plataforma.
5. Deixar o callback HTTPS trocar o código e salvar as credenciais. Não preencher tokens do vendedor manualmente na `.env`.
6. Ao voltar ao aplicativo, consultar novamente o status do próprio vínculo.

`connected=true` indica que há um vínculo salvo; não prova sozinho que a autorização continua válida. Validar uma operação autenticada do vendedor e o comportamento de renovação/reautorização. O ambiente retornado pelo provedor deve ser compatível com a configuração; não remover essa proteção para fazer um teste passar.

**Aceite:** conta correta vinculada ao usuário correto; outra empresa não enxerga o vínculo; nenhum token é devolvido ao cliente; renovação/reautorização funciona; um novo pagamento usa o recebedor esperado.

## 8. Validar o webhook externo

Responsáveis: backend/infraestrutura e Bryan.

No painel da aplicação, configurar a URL de webhook e os tópicos **Order (Mercado Pago)**, para o modo sem split, e **Pagamentos**, para o split. Selecionar o ambiente correspondente, salvar e preencher a assinatura secreta na `.env`. [Notificações de Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).

Testar em duas etapas:

1. **Entrega e autenticação:** o provedor alcança a URL e a aplicação valida a assinatura. Um teste com ID inventado pode falhar na consulta do recurso; não representa aprovação de um pagamento.
2. **Evento de pagamento existente:** usar um recurso legítimo do ambiente correto; conferir entrega aceita, consulta autenticada ao Mercado Pago e atualização do registro local correspondente.

Confirmar também evento repetido, aprovação com app fechado, indisponibilidade temporária do backend e recuperação depois da volta. Um status enviado manualmente no body nunca deve aprovar a compra.

**Aceite:** evidência de entrega pelo Mercado Pago e mudança correta no banco sem apertar `/sync` manualmente. `/sync` deve funcionar como recuperação, não ser confundido com comprovação de webhook.

## 9. Completar os pontos de integração e operação

Responsáveis: backend e equipe responsável pelos módulos afetados. Os itens abaixo são trabalho de implementação/implantação ou decisão; não estão concluídos só porque este guia existe.

| Ponto | Entrega necessária |
|---|---|
| Compra e pagamento | Alinhar aceite, cobrança, cancelamento e conclusão conforme a etapa 2; impedir que o cliente use uma rota local para aparentar cancelamento financeiro concluído. |
| Pendências sem webhook | Implementar rotina de reconciliação periódica ou operação equivalente persistente, com consultas ao provedor, backoff e tratamento de indisponibilidade. Nunca criar nova cobrança como retry dessa rotina. |
| Revisão administrativa | Disponibilizar uma forma autorizada de localizar `needs_review`, cobranças inconclusivas e divergências, com procedimento de resolução. Não marcar como recusado apenas por timeout ou consulta inconclusiva. |
| Avisos após falha | Definir e testar recuperação de notificações. O estado financeiro está transacionado, mas ainda não há outbox/retry garantido entre commit e aviso. |
| Troca/revogação de vínculo | `DELETE /payment/mercado-pago/account` desativa a conexão local e invalida links OAuth anteriores. Nova autorização permite trocar a conta sem mudar o recebedor histórico. Revogação no provedor é separada; credenciais históricas ficam criptografadas para conciliação e estorno enquanto válidas. |
| Autenticação forte do cartão | Validar os cenários de autenticação adicional/3DS que o checkout escolhido exigir e propagar a ação necessária ao cliente. Os testes atuais não comprovam esse fluxo externo. |
| Suporte a falhas | Registrar IDs locais/externos, código e horário suficientes para investigar, sem CPF, CVV, cartão, JWT ou credenciais. Testar recuperação de banco e chave de criptografia. |

**Aceite:** demonstração de recuperação após queda e de tratamento de exceção financeira, sem cobrança, comissão, notificação de confirmação ou reposição de estoque duplicadas.

## 10. Implementar o mobile

Responsáveis: Bryan e implementação mobile, após autorização para editar esse projeto.

### Preparar a versão e o checkout

O mobile inspecionado declara Expo 58, React Native 0.88.1 e React 19.3.0. Seu AGENTS.md ainda aponta SDK 54; alinhar a orientação e a documentação versionada antes de instalar SDKs ou escrever a integração. As URLs v54 consultadas redirecionaram para `latest`, portanto não devem ser tratadas como confirmação da versão 54. Não foi feita alteração no mobile para resolver essa diferença.

Selecionar a tokenização de cartão oficialmente compatível com a versão real do projeto e fazer uma prova de compilação no dispositivo. Se exigir código nativo, validar uma development build. Instruções de Checkout Pro/Preferences não são automaticamente compatíveis com os endpoints atuais de Checkout Transparente/Payments.

### Versão da empresa

- Exibir estado da conta Mercado Pago e ação para conectar/reautorizar.
- Chamar `/payment/mercado-pago/connect` com o JWT da empresa e abrir a URL no navegador do sistema.
- Ao retornar ao app, consultar `/payment/mercado-pago/account`; fechar o navegador não significa que houve autorização.
- Para retorno automático, implementar um deep link de conclusão separado do callback OAuth, fixo/permitido pelo backend. O callback atual retorna JSON e não faz esse redirecionamento.
- Mostrar vínculo pendente/indisponível sem pedir Access Token ou Client Secret ao vendedor.

### Versão do comprador

- Criar/reutilizar a compra e consultar pagamentos existentes antes de abrir nova cobrança.
- Separar o carrinho por empresa para split 1:1; identificar total e vendedor.
- Consultar configuração da API; usar apenas Public Key no SDK.
- Pix: mostrar QR Code, código copiável, estado e confirmação real pela API.
- Crédito/débito: tokenizar no componente/SDK aprovado e enviar somente token, método e parcelas. Confirmar os meios de débito realmente habilitados na conta.
- Ao retomar o app, recuperar o pagamento pelo ID e chamar `/sync` quando necessário.
- Exibir pendente, aprovado, recusado, cancelado/estornado e revisão. `provider_status`/`status_detail` ajudam a distinguir cancelamento de recusa, pois ambos usam `refused` no modelo local.
- Só mostrar sucesso a partir do estado aprovado confirmado pelo backend. Ler o QR ou voltar do navegador não confirma o recebimento.
- Após timeout/402, recuperar a tentativa existente. Token de cartão não deve virar dado persistido em AsyncStorage; perda da sessão exige consulta/conciliação antes de iniciar outra tentativa.

**Aceite:** fluxo em dispositivo real, app fechado/reaberto e retorno do navegador, sem depender do Postman. Validar cada plataforma que fizer parte da entrega.

## 11. Executar a matriz de aceite

Primeiro rodar os testes automatizados em desenvolvimento:

```powershell
$env:RUN_PAYMENT_DB_TESTS='1'
node scripts/test-payment-suite.js
```

Depois executar os cenários externos em homologação. Os testes locais com provedor interceptado já passaram; a coluna externa abaixo continua pendente até registrar evidência do Mercado Pago e do dispositivo.

| Cenário externo | Resultado exigido |
|---|---|
| Pix sem split | QR válido no ambiente correto e confirmação pela API. |
| Crédito sem split | Tokenização real, aprovação e consulta coerentes. |
| Débito habilitado | Método permitido pela conta, cobrança/consulta e tratamento de recusa; não considerar concluído apenas por aceitar `debit_card` no JSON. |
| Vínculo do vendedor | Autorização real, callback, associação correta e reautorização. |
| Pix com split | Uma cobrança, vendedor correto, comissão da plataforma conferida e status confirmado. |
| Crédito/débito com split | Mesmo contrato financeiro, incluindo autenticação adicional se exigida. |
| Vendedor sem vínculo | Erro antes de cobrar, sem fallback silencioso para outra conta. |
| Repetição e concorrência | Mesmo pagamento/tentativa; nenhum débito duplicado. |
| Timeout/erro ambíguo | Consulta e conciliação antes de uma nova tentativa. |
| Webhook repetido | Sem segunda comissão, confirmação ou reposição de estoque. |
| App/backend fora do ar | Recuperação consistente ao voltar; não depende de manter a tela aberta. |
| Cancelamento pendente | Cancelamento confirmado pelo provedor e estoque devolvido uma vez. |
| Estorno integral | Confirmação no provedor, comissão líquida local zerada e estoque coerente. |
| Estorno recusado | Sem falso sucesso local; indicar pendência ao administrador. |
| Aprovação após cancelamento local | Manter revisão e registrar o resultado financeiro real. |
| Outro usuário/conta/ambiente | Acesso ou operação bloqueados sem alterar a cobrança. |
| Alterar `split_payment` | Novas tentativas seguem a flag; pagamentos antigos conservam o vínculo original. |

Registrar para cada cenário: ambiente, versão do código, IDs da compra/pagamento/recurso, horário, resultado esperado/obtido e evidência sem dados pessoais ou segredos. Conferir a divisão no Mercado Pago, não apenas `checkout.distribution`: esse objeto também contém o plano calculado pelo nosso backend.

Qualquer teste financeiro produtivo precisa combinar previamente conta recebedora, valor máximo e operação. A autorização para criar este guia ou executar testes automatizados não autoriza movimentar dinheiro real.

## 12. Liberar a produção

Responsáveis: Bryan, titular das contas e operação.

1. Concluir os aceites anteriores, incluindo a integração mobile.
2. Revisar o diff e integrar a branch pelo fluxo da equipe; as últimas alterações de pagamentos ainda precisam de commit/revisão antes da publicação.
3. Implantar o backend e aplicar as migrações no banco de destino, com backup e chave de criptografia preservada.
4. Conferir configuração produtiva da mesma aplicação e entrega externa dos dois tópicos de webhook.
5. Vincular os vendedores piloto e verificar se estão aptos. A flag é global: ativá-la afeta novas cobranças de todos os vendedores desse ambiente.
6. Ativar `split_payment=true` somente quando os vendedores envolvidos estiverem vinculados e os testes externos tiverem passado.
7. Executar uma validação produtiva controlada e autorizada; conferir pagamento, destinatários, comissão, webhook e retorno no dispositivo.
8. Monitorar pendências e ter alguém responsável pela conciliação e pelos estornos.

Se for preciso desligar novas divisões, `split_payment=false` preserva o tratamento histórico dos splits já criados, mas muda o destino financeiro de novas cobranças para a conta principal. Não usar essa troca como se fosse um rollback neutro: alinhar o recebimento com os vendedores. Suspender novas vendas pode ser mais adequado enquanto uma falha financeira é investigada.

### Checklist final

- [ ] Regras de reserva, pagamento, comissão e cancelamento aprovadas e implementadas.
- [ ] Banco de destino compatível, migrações e restauração verificadas.
- [ ] API HTTPS estável e processo persistente.
- [ ] Aplicação Marketplace e credenciais coerentes.
- [ ] OAuth real, conta correta e retorno ao aplicativo validados.
- [ ] Webhooks reais de Orders e Payments recebidos e autenticados.
- [ ] Pix, crédito e débito previstos na entrega comprovados no provedor.
- [ ] Split e comissão conferidos nas contas, além do nosso banco.
- [ ] Cancelamento, estorno e falhas sem efeitos duplicados comprovados.
- [ ] Mobile validado em dispositivo e retomada da sessão.
- [ ] Reconciliação, revisão administrativa e recuperação operacional disponíveis.
- [ ] Revisão da branch, publicação e validação produtiva autorizada concluídas.

Esses itens representam os critérios de liberação; não foram marcados automaticamente pelos testes locais.

## Referências

- [Configuração de Marketplace e OAuth](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration).
- [Integração de split 1:1](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace).
- [Pré-requisitos e disponibilidade do modelo](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites).
- [Notificações de Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications).
- [PKCE](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation).
- [Expo: documentação e seleção de versão](https://docs.expo.dev/).
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).
