# Backend local pelo Cloudflare

O Node e o MySQL continuam neste PC. A integração de pagamentos, split, OAuth e desvinculação foi preservada. A configuração opcional `DB_SSL` preparada para Azure foi retirada; não há dependência de Azure ou Render no runtime. O import `testconnect` com caixa correta foi mantido. O estudo anterior está arquivado fora do repositório em `C:/Users/bryan/.codex/artifacts/payment-hosting-2026-11-05/azure-deployment-paused.md`.

## Iniciar

Na pasta `backend-RF`, mantenha o MySQL ligado e execute em um PowerShell:

```powershell
npm start
```

Em outro PowerShell, na mesma pasta:

```powershell
.\scripts\start-cloudflare.ps1
```

O script usa o executável oficial instalado, IPv4, HTTP/2, origem `http://127.0.0.1:5000` (ou `PORT` simples no `.env`), diagnóstico apenas em `127.0.0.1:20241` e logs em `logs/cloudflare/`, ignorados pelo Git. Não altera firewall, rede, credenciais ou `.env`. A opção `-Protocol quic` permite testar UDP quando necessário; `-CloudflaredPath` informa outra instalação oficial. Não inicie processos duplicados na porta de diagnóstico.

Mantenha o processo aberto. A API pode reiniciar sem reiniciar o túnel. Se a rede cair, aguarde a reconexão do processo antes de encerrá-lo. Reiniciar um Quick Tunnel gera outro hostname; o nome não se torna permanente porque está escrito na `.env`.

## Conferir antes de trocar URLs

```powershell
node scripts/check-cloudflare.js https://HOSTNAME-EXIBIDO.trycloudflare.com
```

O diagnóstico é somente leitura. Exige backend local respondendo como esperado, `/ready` 200 com conexão ativa e a mesma resposta da API por HTTPS. `healthy: true` confirma esse caminho. `configurationMatches: false` indica que `.env` ainda aponta para outro endereço ou caminho, mesmo que o túnel esteja saudável; por isso o comando sai com código 1 nesse caso. Sem argumento, verifica o host já configurado na `.env`.

Somente depois de confirmar o acesso externo, atualize:

```dotenv
MERCADO_PAGO_REDIRECT_URI=https://HOSTNAME/api/reaproveitafranca/payment/mercado-pago/oauth/callback
PAYMENT_WEBHOOK_URL=https://HOSTNAME/api/reaproveitafranca/payment/webhook/mercado-pago
```

Reinicie o backend após mudar `.env`; `node --watch` não garante recarregar esse arquivo. No Mercado Pago Developers, salve exatamente os mesmos endereços no callback OAuth e no webhook de produção. Use o evento de Pagamentos para Payments API/split e Order para Orders API/sem split. Confirme pela API da aplicação os campos `callback_urls` e `notifications_callback_url`, sem imprimir tokens. No Postman, ajuste `baseUrl` para a origem HTTPS, sem repetir o prefixo da API.

Gere um link OAuth novo após a mudança; não reaproveite callback com `code` ou `state` antigo. O teste de conexão não autoriza pagar, recriar cobrança recusada ou alterar o recebedor de pagamentos anteriores.

## Interpretar falhas

| Resultado | Significado / ação |
|---|---|
| Callback sem parâmetros retorna 400 e `Callback OAuth inválido.` | Esperado: a requisição chegou à API, mas não é uma autorização OAuth válida. |
| Configuração sem JWT retorna 401 | Esperado: rota protegida. |
| Webhook sem assinatura retorna 401 | Esperado: a assinatura continua obrigatória. |
| Origem local não responde / erro 502 de origem | Confira MySQL, `npm start`, porta e reinícios do backend. |
| `/ready` 503 ou zero conexões / erro Cloudflare 1033 | Processo sem conexão com a Cloudflare; reiniciar a API não corrige esse caminho. |
| Hostname não resolve | Confira o nome emitido pelo processo atual. Não reutilize endereços de túneis encerrados. |
| HTTP/2 e QUIC expiram na borda | Teste outra rede autorizada. O túnel exige saída 7844 TCP/UDP; acesso comum HTTPS na 443 não basta. |
| Aviso `X-Forwarded-For` do rate limit | Este backend confia somente em loopback. Use origem `127.0.0.1`; não defina `trust proxy=true`. |

Em 05/11/2026, na rede `pcbryan`, conexões TCP abriam, mas a negociação TLS de HTTP/2 e QUIC não terminava. Ao conectar ao hotspot autorizado de Bryan, os prechecks DNS, API, TCP/HTTP2 e UDP/QUIC passaram, e o acesso público funcionou. A evidência aponta para o caminho da rede anterior; não identifica o equipamento responsável. Não foi necessário reduzir validação de certificado, desativar antivírus ou abrir portas de entrada. Para usar a rede anterior, seu administrador precisa verificar a saída documentada pela Cloudflare.

O domínio próprio permitirá manter `api.seudominio.com.br` com um túnel nomeado após configurar DNS e conta Cloudflare. Isso evita mudanças de callback por reinício do conector, mas ainda exige PC, MySQL, API, internet e conector ativos. O domínio não hospeda o backend nem resolve falhas de saída da rede.

## Evidências de 05/11/2026

- `suite-cloudflare-repair.log`: 95 cenários de pagamentos, 52 cartões, 26 localização e 108 notificações; 281 aprovados, zero falhas. MySQL temporário e Mercado Pago interceptado; sem cobranças externas.
- `cloudflare-http-results.json`: sete verificações HTTP públicas (callback, autenticação, configuração, consulta de vínculo e webhook sem/com assinatura). O webhook assinado usa pagamento e recebedor fictícios, sem alterar vendas. Não comprova entrega originada pelo Mercado Pago nem liquidação financeira.
- Teste isolado da configuração real de proxy: MySQL acessível, loopback confiável e IP externo arbitrário não confiável. Nenhuma rota de diagnóstico foi adicionada à API.
- Após o titular salvar no painel, a API da aplicação Mercado Pago confirmou callback e webhook iguais à `.env`, PKCE ativo e aplicação sem bloqueio. O campo legado `notifications_topics` veio vazio; essa consulta não comprova a assinatura de eventos no painel moderno. Para conferir a entrega pelo provedor, use o simulador do próprio Developers e exija a resposta 200 do endpoint configurado.
- Artefatos locais em `C:/Users/bryan/.codex/artifacts/payment-hosting-2026-11-05/`. Logs de túnel usam nível info, sem cabeçalhos de autorização. A consulta de vínculo deve ser considerada pelo resultado atual, sem assumir que uma empresa está conectada.

## Fontes oficiais

- [Prechecks de conectividade](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/connectivity-prechecks/).
- [Portas e destinos de saída](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).
- [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
- [Express atrás de proxies](https://expressjs.com/en/guide/behind-proxies.html).
