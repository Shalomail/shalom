# Ficha da App Store (Shalom Mail para iOS)

Levantada na auditoria de loja de 31/10/2026. O que está aqui vai no App Store Connect; o que é código já está no app.

## Antes de enviar

- Conta de demonstração: duas contas em produção, criadas pelo Thomaz. Nas duas: e-mail de recuperação definido, PIN e
  duas etapas desligados, senha fácil de digitar. Na caixa da principal: algumas mensagens, uma vinda da outra conta
  Shalom (selo verde) e uma vinda de fora. A segunda serve para o revisor testar envio e apagar conta.
- Data: depois da migração de conta Cloudflare de 8/11 (com manutenção ligada, o revisor não entra).
- Criptografia de exportação (05/11, decisão do Thomaz): o app declara YES (`ITSAppUsesNonExemptEncryption` em
  ios/project.yml). No App Store Connect: "Standard encryption algorithms instead of, or in addition to, using or
  accessing the encryption within Apple's operating system", e que não vai para a França. Sem a França (fora com a
  União Europeia na 1.0), a Apple não pede documento. Para incluir a França depois: declaração à ANSSI.
- Build de loja: archive e export com assinatura de distribuição; conferir `aps-environment` = production no .ipa
  (`codesign -d --entitlements - ShalomMail.app`).

## Dados gerais

- Nome: Shalom Mail
- Subtítulo (até 30): EN "End-to-end encrypted email"; PT "E-mail criptografado"
- Palavras-chave EN: `email,encrypted,secure,private,privacy,e2ee,inbox,encryption,confidential,mailbox`
- Palavras-chave PT (96 de 100): `seguro,privado,privacidade,criptografia,segurança,sigilo,proteção,correio,caixa de entrada,email`
- Categoria: Produtividade (secundária: Utilidades)
- Preço: grátis, sem compras no app
- Copyright: 2026 X TECH A.I FUND HOLDING E PARTICIPACOES LTDA
- Privacidade: https://shalomail.com/en/privacy/ (pt-BR: https://shalomail.com/privacidade/)
- Suporte: https://shalomail.com/en/faq/ (pt-BR: https://shalomail.com/perguntas-frequentes/)
- Marketing: https://shalomail.com/
- No texto da loja, não citar preço nem planos dos agentes, nem "assine no site" (3.1.3(f) e 3.1.1(a)); sem nomes de
  outros serviços nas palavras-chave (2.3.7); nada de "100% anônimo" ou "irrastreável".

## Textos da loja

Colar como está. Sem preço, sem plano e sem nome de outro serviço. A criptografia de ponta a ponta aparece só onde
vale (entre contas Shalom).

### Texto promocional (até 170)

- EN: Your emails stay locked, and only your password opens them. Military-grade encryption, no ads and no tracking.
- PT: Seus e-mails ficam trancados, e só a sua senha abre. Criptografia de padrão militar, sem anúncio e sem rastreio.

### Descrição EN

```
Shalom Mail is encrypted email with your own @shalomail.com address. Your stored emails are locked with a key that only your password unlocks, and not even we can open them.

Military-grade encryption
Every email is locked with AES-256 before it is stored. Between Shalom accounts, a message is locked on the sender's device and opens only on yours, with a green badge that confirms who sent it.

Works with any email
Send to and receive from any email service. End-to-end encryption applies between Shalom accounts. Email from other services is locked as soon as it reaches Shalom, and email you send to them goes out as regular email, because they need to be able to read it.

Only you get in
Face ID to open the app, a sign-in PIN, two-step verification and a list of connected devices where you can end any session.

Scam warnings
When a sender isn't who they claim to be, the app warns you and keeps links and images off. What looks like a scam goes to Spam.

No ads, no tracking
No ads, no analytics SDK and no selling of data. New mail notifications say only "New message", with no sender or subject.

Every account comes with 1 GB. You need a Shalom Mail account, which you can create in the app. Add a recovery email so you can get back in if you forget your password.

Privacy: https://shalomail.com/en/privacy/
Terms: https://shalomail.com/en/terms/
```

### Descrição PT

```
O Shalom Mail é um e-mail criptografado com o seu próprio endereço @shalomail.com. Seus e-mails guardados ficam trancados com uma chave que só a sua senha destrava, e nem a gente consegue abrir.

Criptografia de padrão militar
Cada e-mail é trancado com AES-256 antes de ser guardado. Entre contas Shalom, a mensagem é trancada no aparelho de quem envia e só abre no seu, com um selo verde que confirma quem mandou.

Funciona com qualquer e-mail
Mande e receba de qualquer serviço de e-mail. A criptografia de ponta a ponta vale entre contas Shalom. O e-mail que vem de outros serviços é trancado assim que chega ao Shalom, e o que você manda para eles sai como e-mail comum, porque eles precisam conseguir ler.

Só você entra
Face ID para abrir o app, PIN de entrada, verificação em duas etapas e a lista de aparelhos conectados, onde você encerra qualquer sessão.

Aviso de golpe
Quando o remetente não é quem aparece, o app avisa e deixa links e imagens desligados. O que parece golpe vai para o Spam.

Sem anúncio, sem rastreio
Sem anúncio, sem SDK de análise e sem venda de dados. Os avisos de mensagem nova dizem só "Mensagem nova", sem remetente nem assunto.

Cada conta tem 1 GB. Você precisa de uma conta Shalom Mail, que cria no próprio app. Cadastre um e-mail de recuperação para voltar a entrar se esquecer a senha.

Privacidade: https://shalomail.com/privacidade/
Termos: https://shalomail.com/termos/
```

## Disponibilidade

Todos os países, menos os 27 da União Europeia (até a declaração de comerciante da DSA estar feita e aprovada no
App Store Connect) e a China continental (exige número ICP). Sem a União Europeia, a França também fica de fora, o que
simplifica a exportação de criptografia na 1.0.

## Rótulo de privacidade

Sem rastreamento. Todos os itens ligados à pessoa, finalidade App Functionality (o mesmo que
ios/ShalomMail/PrivacyInfo.xcprivacy):

- Contact Info, Name: o nome da conta.
- Contact Info, Email Address: o endereço Shalom e o e-mail de recuperação.
- User Content, Photos or Videos: a foto de perfil (opcional).
- User Content, Emails or Text Messages: os e-mails e anexos. A Apple pede para declarar mensagens privadas entre
  pessoas, mesmo cifradas. Ficam guardados lacrados com a chave da pessoa; o e-mail de outros serviços passa aberto pelo
  servidor no momento em que chega, e o que vai para fora, durante o envio.
- Identifiers, User ID: id e endereço da conta.
- Identifiers, Device ID: o token de aviso da Apple, só com avisos ligados.
- Other Data: tipo de aparelho e início e último uso de cada sessão (lista de Aparelhos).

Não declarados: IP (só em contadores contra abuso, até 1 hora), compras (fora do app), diagnóstico (não há SDK de análise nem de
falhas), contatos (as sugestões saem dos e-mails, não da agenda).

## Classificação etária

Questionário obrigatório (o novo, desde 31/01/2026). Todos os descritores de conteúdo: nenhum. Controle parental: não. Acesso irrestrito à web: não (links abrem no Safari).
Conteúdo de usuários: não. Rede social: não. Mensagens e chat: sim. Publicidade: não. Resultado 4+; se o painel deixar,
13+ (os Termos proíbem menores de 13).

## Imagens

- Ícone: o 1024 do app (fundo azul, logo branca, sem transparência).
- Capturas de iPhone (só iPhone): seis por idioma em brand/app-store/pt-BR e brand/app-store/en, PNG sem
  transparência, em dois tamanhos: 6.3-1206x2622 (iPhone com Dynamic Island de tela média, o único obrigatório pela
  página de especificações da Apple em 05/11/2026) e 6.9-1320x2868 (tela grande, opcional). Ordem dos nomes: caixa,
  conversa com o selo verde, escrever, segurança, spam e o logo com três iPhones. As telas saem do StoreShots no tema claro
  (brand/app-store/capturas) e vão para o iPhone 17 Pro com título por `node scripts/store-images.mjs`.

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
