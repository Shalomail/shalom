# Shalom Mail para iOS

App nativo em SwiftUI, completo: tudo o que o app web faz, com a mesma criptografia, refeita em Swift e
conferida contra a do site por vetores de teste (`scripts/ios-vectors.ts` gera, os testes do Xcode conferem).
Decisão do Thomaz em 30/10/2026: nativo, não um site dentro de uma moldura.

## Base técnica

- iOS 17 ou mais novo, SwiftUI, projeto gerado pelo XcodeGen (`ios/project.yml`).
- Criptografia: CryptoKit (X25519, HKDF-SHA256, AES-256-GCM, Ed25519, SHA-256), libsodium pelo pacote Sodium
  (Argon2id, 128 MiB, 3 passadas, p=1, igual ao `web/src/lib/keys.ts`) e BigInt (assinatura cega RSA da
  entrega anônima). Compressão: gzip montado sobre o deflate do sistema.
- Chave privada: Keychain, só neste aparelho, aberta com Face ID (ou o código do iPhone).
- Rede: a mesma API do site (`/api`), com o cookie de sessão e o cabeçalho X-Shalom; caixa ao vivo pelo
  mesmo WebSocket (`/api/live`).
- E-mail aberto: WKWebView sem JavaScript, sem rede (regras de bloqueio do WebKit) e com CSP; imagens de fora
  só quando a pessoa pedir.
- Textos: os 15 idiomas do app web, convertidos de `web/src/i18n/*.ts` para o catálogo do Xcode.

## O que o app faz (paridade com o web)

1. Conta: entrar (endereço, senha, PIN e/ou código de duas etapas, códigos de recuperação), lembrar o aparelho,
   criar conta (nome, endereço com conferência de disponível, senha com medidor, Turnstile, termos), e-mail de
   recuperação obrigatório antes da primeira caixa, esqueci a senha, várias contas no mesmo aparelho, sair por
   inatividade.
2. Caixa: Entrada, Favoritos, Enviados, Rascunhos, Arquivo, Spam, Lixeira, contagens de não lidas, conversas
   agrupadas, páginas, puxar para atualizar, caixa ao vivo, busca, deslizar para arquivar/apagar/marcar,
   seleção de várias, fixar, favoritar.
3. Leitura: cabeçalho e corpo abertos no aparelho, remetente conferido (selo), conferir identidade pela
   impressão digital, aviso de remetente falso, anexos (ver, salvar, compartilhar), responder, responder a
   todos, encaminhar, mover, spam/não é spam, marcar como não lida, apagar.
4. Escrever: Para, Cc e Cco com sugestões dos contatos, assunto, texto com formatação, anexos (fotos e
   arquivos), imagem no texto, rascunho guardado lacrado, envio para conta Shalom (remetente lacrado e
   ingresso anônimo) e para fora (cópia lacrada em Enviados), fotos grandes reduzidas.
5. Configurações: nome e foto (recorte), senha, e-mail de recuperação, PIN, duas etapas (QR e códigos),
   tempo de inatividade, minha impressão digital, aparelhos conectados, convites (quando o cadastro fechar),
   caixas de agente (lista e chaves; a assinatura dos planos fica fora do app, regra 3.1.1 da Apple), tema
   claro/escuro e espectro, idioma, espaço (por pasta, maiores mensagens, apagar), apagar a conta.
6. Próprio do iPhone: Face ID para abrir, notificação de e-mail novo (sem conteúdo: só "Mensagem nova"),
   compartilhar para o Shalom (extensão), links de confirmação e senha nova abrindo no app.

## Fases

1. Base: projeto, criptografia com vetores do site, cliente da API, entrar (com segunda etapa), Face ID, caixa
   e leitura, pastas, caixa ao vivo.
2. Escrever: envio Shalom e para fora, rascunhos, anexos, contatos, responder/encaminhar, ações na lista, busca.
3. Conta completa: configurações inteiras, criar conta com Turnstile, recuperação, várias contas, espaço,
   apagar conta, temas, 15 idiomas.
4. Notificações (servidor manda o aviso sem conteúdo pelo APNs), extensão de compartilhar, ícones e imagens da
   loja, TestFlight.

## Conta da Apple (30/10/2026)

- Identificador `com.shalomail.app` ("Shalom Mail") registrado no time X Tech (2UNWMDD93S), com Push Notifications.
- App "Shalom Mail" criado no App Store Connect (SKU `shalomail-ios`, idioma principal inglês, dá para trocar),
  nome reservado; nada enviado para revisão.
- Notificações: o time já tem a chave de APNs Z83GAY27W4 ("OutfitMD Owner Push", vale para todos os apps, sandbox
  e produção). O arquivo `AuthKey_Z83GAY27W4.p8` está em ~/Downloads; na fase 4 ele vai para o Keychain
  (shalom-prod) e o servidor assina os avisos com ele. A Apple limita a duas chaves de APNs por time, e as duas
  vagas estão usadas.

## Avisos de mensagem nova (feito em 30/10/2026)

- Servidor (`worker/push.ts`, migração 0010): o app registra o token do aparelho em `/api/push/register`, ligado
  à sessão daquele iPhone. Sair, desconectar por outro aparelho, trocar a senha ou apagar a conta encerram o
  aviso; a Apple dizendo que o token não vale mais (410) também. Um aviso a cada 20 s por conta, sem conteúdo:
  só "Mensagem nova" no idioma da conta e as não lidas da Entrada no ícone. Dispara em e-mail de fora na
  Entrada (não no Spam) e em entrega entre contas Shalom.
- App (`Core/Session/Push.swift`): pergunta na primeira vez que a caixa abre, pede o token a cada abertura,
  chave por conta em Configurações, Avisos. Em DEBUG o token é do ambiente sandbox da Apple.
- Teste: `node scripts/run-ts.mjs scripts/smoke-push.ts` (Apple de mentira em 127.0.0.1:4498, chave de teste
  no .dev.vars) e `testNotifications` no Xcode.
- Para ligar em produção: a chave .p8 no Keychain numa linha só, depois o deploy (APNS_KEY_ID e APNS_TEAM já
  estão no wrangler.jsonc):
  `security add-generic-password -U -s shalom-prod -a APNS_KEY -w "$(tr -d '\n' < ~/Downloads/AuthKey_Z83GAY27W4.p8)"`
