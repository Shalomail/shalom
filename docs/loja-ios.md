# Ficha da App Store (Shalom Mail para iOS)

Levantada na auditoria de loja de 31/10/2026. O que está aqui vai no App Store Connect; o que é código já está no app.

## Antes de enviar

- Conta de demonstração: duas contas em produção, criadas pelo Thomaz. Nas duas: e-mail de recuperação definido, PIN e
  duas etapas desligados, senha fácil de digitar. Na caixa da principal: algumas mensagens, uma vinda da outra conta
  Shalom (selo verde) e uma vinda de fora. A segunda serve para o revisor testar envio e apagar conta.
- Data: depois da migração de conta Cloudflare de 8/11 (com manutenção ligada, o revisor não entra).
- Criptografia de exportação: decisão do Thomaz (de preferência com advogado). Hoje o app declara NO
  (`ITSAppUsesNonExemptEncryption` em ios/project.yml). O caminho mais seguro é YES, "algoritmo padrão além da
  criptografia do sistema", e decidir a França (tirar da disponibilidade na 1.0 ou fazer a declaração à ANSSI).
- Build de loja: archive e export com assinatura de distribuição; conferir `aps-environment` = production no .ipa
  (`codesign -d --entitlements - ShalomMail.app`).

## Dados gerais

- Nome: Shalom Mail
- Subtítulo (até 30): EN "End-to-end encrypted email"; PT "E-mail criptografado"
- Palavras-chave EN: `email,encrypted,secure,private,privacy,e2ee,inbox,encryption,confidential,mailbox`
- Categoria: Produtividade (secundária: Utilidades)
- Preço: grátis, sem compras no app
- Copyright: 2026 X TECH A.I FUND HOLDING E PARTICIPACOES LTDA
- Privacidade: https://shalomail.com/en/privacy/ (pt-BR: https://shalomail.com/privacidade/)
- Suporte: https://shalomail.com/en/faq/ (pt-BR: https://shalomail.com/perguntas-frequentes/)
- Marketing: https://shalomail.com/
- No texto da loja, não citar preço nem planos dos agentes, nem "assine no site" (3.1.3(f) e 3.1.1(a)); sem nomes de
  outros serviços nas palavras-chave (2.3.7); nada de "100% anônimo" ou "irrastreável".

## Rótulo de privacidade

Sem rastreamento. Todos os itens ligados à pessoa, finalidade App Functionality (o mesmo que
ios/ShalomMail/PrivacyInfo.xcprivacy):

- Contact Info, Name: o nome da conta.
- Contact Info, Email Address: o endereço Shalom e o e-mail de recuperação.
- User Content, Photos or Videos: a foto de perfil (opcional).
- Identifiers, User ID: id e endereço da conta.
- Identifiers, Device ID: o token de aviso da Apple, só com avisos ligados.
- Other Data: tipo de aparelho e início e último uso de cada sessão (lista de Aparelhos).

Não declarados: e-mails e anexos (guardados lacrados com a chave da pessoa; o que vai para fora passa aberto só durante o
envio), IP (só em contadores contra abuso, até 1 hora), compras (fora do app), diagnóstico (não há SDK de análise nem de
falhas), contatos (as sugestões saem dos e-mails, não da agenda).

## Classificação etária

Todos os descritores de conteúdo: nenhum. Controle parental: não. Acesso irrestrito à web: não (links abrem no Safari).
Conteúdo de usuários: não. Rede social: não. Mensagens e chat: sim. Publicidade: não. Resultado 4+; se o painel deixar,
13+ (os Termos proíbem menores de 13).

## Imagens

- Ícone: o 1024 do app (fundo branco, logo azul, sem transparência).
- Capturas de iPhone (só iPhone): 1206x2622 (iPhone 17 do simulador) e o tamanho grande 1320x2868 (as mesmas ampliadas
  para 1320x2870, cortando 2 px). De 1 a 10, mostrando caixa, leitura com o selo verde, escrever e segurança.

## Notas de revisão (inglês)

> Shalom Mail is a free end-to-end encrypted email service (shalomail.com). The app is a native client; all encryption
> happens on the device.
>
> Demo account: [address]@shalomail.com, password [password]. PIN and two-step verification are off and a recovery email
> is already set. The inbox has sample messages, including one from another Shalom account (green end-to-end badge) and
> one from an outside provider.
>
> To test sending, write to [second]@shalomail.com (password [password]) or to any outside address.
>
> Face ID is used only to unlock the account key stored in the Keychain when "Remember on this device" is on.
> Notifications carry no content, only "New message".
>
> Sign up is open in the app. Before the first mailbox we ask for a recovery email, because with end-to-end encryption it
> is the only way to regain access after a forgotten password.
>
> Account deletion: Settings > Delete account (password and typing the address). Please test deletion with a new account
> or with the second demo account.
>
> "AI agents" and "API keys" in Settings list mailboxes the user creates from their own computer with our command-line
> tool. The app sells nothing and has no purchase links; paid plans for extra agent mailboxes are a web service
> (guideline 3.1.3(f)). The app sends no data to AI services.

## TestFlight externo

Descrição do beta, e-mail de retorno, "What to Test", a URL da política e a mesma conta de demonstração.
