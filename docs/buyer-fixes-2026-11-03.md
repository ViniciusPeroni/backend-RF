# Correções do comprador — 03/11/2026

Autorizadas pelo usuário para backend e frontend. Exclusões: LinkedIn e pagamento por cartão; cadastro de cartões em outra frente, não alterado.

## Contrato e comportamento

- GET `/api/reaproveitafranca/user/:id/photo`, abaixo de verifyJWT: somente titular ou admin; UUID inválido 400, outra conta 403, inexistente 404, sem imagem 204, imagem raster suportada 200. Bytes binários, MIME por assinatura PNG/JPEG/GIF/WebP, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. Formato armazenado não suportado 415. PUT do perfil valida raster e limite de 5 MB (415/413). Nunca usar token na URL. GET/PUT JSON do perfil conservam o contrato anterior.
- `listConversationsForUser`: alias `otherCp.id_user` corrigido. REST e Socket.IO usam a mesma consulta e o contador real. Frontend passou a mostrar erro/retry, sem lista recente fictícia/alternativa local.
- `/shopping-product/*`: identidade obrigatória no service; comprador dono da compra ou administrador, conforme regra do detalhe de shopping. Listas filtradas; individual alheio/inexistente 404; filtros UUID inválidos 400. Vendedor não ganha autorização para ler compras alheias. Não foi alterada a transição de status de vendedor/admin.
- Nenhuma migração necessária. Nenhuma mudança em OAuth, cartões ou gateway. Google continua dependente do Client ID público e da configuração externa, ausentes no ambiente observado.

## Verificação

- `node --check` nos seis arquivos JS alterados: passou.
- `node --test tests/buyer-read-access.test.js`: 5 testes passaram, sem conexão ao banco (identidade/escopo/admin/filtros/assinaturas de imagem). Esses testes unitários não substituem o teste de SQL real.
- Teste local do frontend `verify-api-buyer-fixes.cjs`, API/MySQL/Socket.IO reais contra banco descartável exclusivamente criado: leitura da foto após reload, bytes/MIME/cache, titular/admin/outra conta/anônimo, sem foto, usuário inexistente, UUID inválido, upload SVG rejeitado, itens de compra próprios/admin/alheios/filtros inválidos. Também passaram cadastro de reserva/estoque/cancelamento/doação, notificações, endereços, metadados de cartões existentes e envio/edição/exclusão/lista/saída de conversas, além de layouts 375/768/1280px. O teste não usa Google, LinkedIn ou pagamentos externos.
- Banco descartável removido após o teste. Banco do projeto preservado. Não executar RFScript.sql no banco existente.
- Frontend: build e lint focado passaram; lint global mantém erro/aviso preexistentes em Notification.tsx. Ambiente API local respondeu à nova rota na porta 5000.
- Alteração preexistente em src/index.js (testConnect → testconnect) preservada, sem nova edição de inicialização nesta tarefa. Sem commit/push novo.
