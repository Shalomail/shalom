// Boas-vindas: a primeira mensagem da caixa, deixada no cadastro, no idioma de quem criou a conta.
// Vai como mensagem Shalom de verdade (remetente lacrado da Equipe, equipe@ é endereço reservado), para
// chegar com o cadeado verde e não cair no aviso de remetente falso. A chave da Equipe sai da CERT_KEY:
// é a mesma em todo deploy, e os aparelhos que a fixarem não estranham na próxima mensagem.
import { fromB64, publicKeyOf, toB64 } from '../shared/seal';
import { sealFromSender, signCert } from '../shared/sender';
import { pack } from '../shared/pack';
import type { MessageHead } from '../shared/head';
import { boxOf } from './box';
import type { Env } from './env';
import { loadKeys } from './keys';
import { hmac } from './util';

type Welcome = { dir?: 'rtl'; subject: string; hello: string; lines: [string, string]; tipsTitle: string; tips: [string, string, string]; end: string; sign: string };

// {n}: primeiro nome de quem criou a conta.
const TEXTS: Record<string, Welcome> = {
  pt: {
    subject: 'Shalom, {n}. Sua caixa está pronta.', hello: 'Shalom, {n}.',
    lines: ['Shalom quer dizer paz, e é isso que a gente quer para a sua caixa de entrada.', 'Tudo o que fica guardado aqui é trancado com uma chave que nasceu no seu aparelho e não sai dele. Nem a gente consegue abrir.'],
    tipsTitle: 'Três coisas para começar:',
    tips: ['Entre contas Shalom, a mensagem vai de ponta a ponta. Repare no cadeado verde.', 'Para quem usa outro e-mail, ela chega normalmente, como qualquer e-mail.', 'Guarde bem a sua senha. Se esquecer, o e-mail de recuperação devolve a conta, mas o que estava guardado até ali não volta.'],
    end: 'Que a sua caixa fique em paz.', sign: 'Equipe Shalom Mail',
  },
  en: {
    subject: 'Shalom, {n}. Your inbox is ready.', hello: 'Shalom, {n}.',
    lines: ["Shalom means peace, and that's what we want for your inbox.", 'Everything stored here is locked with a key that was created on your device and never leaves it. Not even we can open it.'],
    tipsTitle: 'Three things to get started:',
    tips: ['Between Shalom accounts, messages are end-to-end encrypted. Look for the green lock.', 'People on other email services receive your messages as usual.', "Keep your password safe. If you forget it, your recovery email gets your account back, but what was stored until then can't be recovered."],
    end: 'May your inbox be at peace.', sign: 'The Shalom Mail team',
  },
  es: {
    subject: 'Shalom, {n}. Tu bandeja está lista.', hello: 'Shalom, {n}.',
    lines: ['Shalom significa paz, y eso es lo que queremos para tu bandeja de entrada.', 'Todo lo que se guarda aquí queda cerrado con una llave que nació en tu dispositivo y nunca sale de él. Ni siquiera nosotros podemos abrirlo.'],
    tipsTitle: 'Tres cosas para empezar:',
    tips: ['Entre cuentas Shalom, el mensaje va cifrado de extremo a extremo. Fíjate en el candado verde.', 'Quien usa otro correo lo recibe con normalidad.', 'Guarda bien tu contraseña. Si la olvidas, el correo de recuperación te devuelve la cuenta, pero lo guardado hasta entonces no se recupera.'],
    end: 'Que tu bandeja esté en paz.', sign: 'El equipo de Shalom Mail',
  },
  fr: {
    subject: 'Shalom, {n}. Votre boîte est prête.', hello: 'Shalom, {n}.',
    lines: ["Shalom signifie paix, et c'est ce que nous souhaitons pour votre boîte de réception.", "Tout ce qui est conservé ici est verrouillé par une clé créée sur votre appareil, qui ne le quitte jamais. Même nous ne pouvons pas l'ouvrir."],
    tipsTitle: 'Trois choses pour commencer :',
    tips: ['Entre comptes Shalom, les messages sont chiffrés de bout en bout. Repérez le cadenas vert.', 'Les personnes sur un autre service de messagerie reçoivent vos e-mails normalement.', "Gardez bien votre mot de passe. Si vous l'oubliez, l'e-mail de récupération vous rend le compte, mais ce qui était conservé jusque-là ne revient pas."],
    end: 'Que votre boîte reste en paix.', sign: "L'équipe Shalom Mail",
  },
  de: {
    subject: 'Shalom, {n}. Dein Postfach ist bereit.', hello: 'Shalom, {n}.',
    lines: ['Shalom bedeutet Frieden, und genau das wünschen wir deinem Posteingang.', 'Alles, was hier gespeichert ist, wird mit einem Schlüssel verschlossen, der auf deinem Gerät entstanden ist und es nie verlässt. Nicht einmal wir können es öffnen.'],
    tipsTitle: 'Drei Dinge für den Anfang:',
    tips: ['Zwischen Shalom-Konten sind Nachrichten Ende-zu-Ende-verschlüsselt. Achte auf das grüne Schloss.', 'Wer einen anderen E-Mail-Dienst nutzt, bekommt deine Nachrichten ganz normal.', 'Bewahre dein Passwort gut auf. Wenn du es vergisst, holt dir die Wiederherstellungs-E-Mail das Konto zurück, aber was bis dahin gespeichert war, lässt sich nicht wiederherstellen.'],
    end: 'Möge in deinem Postfach Frieden herrschen.', sign: 'Dein Shalom-Mail-Team',
  },
  it: {
    subject: 'Shalom, {n}. La tua casella è pronta.', hello: 'Shalom, {n}.',
    lines: ['Shalom significa pace, ed è quello che vogliamo per la tua casella di posta.', 'Tutto ciò che resta salvato qui è chiuso con una chiave nata sul tuo dispositivo, che non lo lascia mai. Nemmeno noi possiamo aprirlo.'],
    tipsTitle: 'Tre cose per iniziare:',
    tips: ['Tra account Shalom, i messaggi sono cifrati end-to-end. Cerca il lucchetto verde.', 'Chi usa un altro servizio di posta riceve i tuoi messaggi normalmente.', "Custodisci bene la password. Se la dimentichi, l'email di recupero ti restituisce l'account, ma ciò che era salvato fino ad allora non torna."],
    end: 'Che la tua casella resti in pace.', sign: 'Il team di Shalom Mail',
  },
  ru: {
    subject: 'Шалом, {n}. Ваш ящик готов.', hello: 'Шалом, {n}.',
    lines: ['Шалом означает «мир», и именно его мы желаем вашему почтовому ящику.', 'Всё, что хранится здесь, заперто ключом, который создан на вашем устройстве и никогда его не покидает. Даже мы не можем это открыть.'],
    tipsTitle: 'Три вещи для начала:',
    tips: ['Между аккаунтами Shalom письма защищены сквозным шифрованием. Ищите зелёный замок.', 'Люди с другой почтой получают ваши письма как обычно.', 'Храните пароль надёжно. Если вы его забудете, резервный адрес вернёт вам аккаунт, но сохранённые до этого письма восстановить не получится.'],
    end: 'Пусть в вашем ящике будет мир.', sign: 'Команда Shalom Mail',
  },
  uk: {
    subject: 'Шалом, {n}. Ваша скринька готова.', hello: 'Шалом, {n}.',
    lines: ['Шалом означає «мир», і саме його ми бажаємо вашій поштовій скриньці.', 'Усе, що зберігається тут, замкнено ключем, який створено на вашому пристрої і який ніколи його не залишає. Навіть ми не можемо це відкрити.'],
    tipsTitle: 'Три речі для початку:',
    tips: ['Між акаунтами Shalom листи захищені наскрізним шифруванням. Шукайте зелений замок.', 'Люди з іншою поштою отримують ваші листи як звичайно.', 'Бережіть пароль. Якщо ви його забудете, резервна адреса поверне вам акаунт, але збережені до того листи не відновляться.'],
    end: 'Хай у вашій скриньці буде мир.', sign: 'Команда Shalom Mail',
  },
  tr: {
    subject: 'Şalom, {n}. Kutunuz hazır.', hello: 'Şalom, {n}.',
    lines: ['Şalom barış demek; gelen kutunuz için dilediğimiz de tam olarak bu.', 'Burada saklanan her şey, cihazınızda oluşturulan ve oradan hiç çıkmayan bir anahtarla kilitlenir. Biz bile açamayız.'],
    tipsTitle: 'Başlamak için üç şey:',
    tips: ['Shalom hesapları arasında mesajlar uçtan uca şifrelidir. Yeşil kilide dikkat edin.', 'Başka bir e-posta hizmeti kullananlar mesajlarınızı her zamanki gibi alır.', 'Parolanızı iyi saklayın. Unutursanız kurtarma e-postası hesabınızı geri verir, ancak o zamana kadar saklananlar geri gelmez.'],
    end: 'Kutunuz huzurla dolsun.', sign: 'Shalom Mail ekibi',
  },
  he: {
    dir: 'rtl', subject: 'שלום, {n}. התיבה שלכם מוכנה.', hello: 'שלום, {n}.',
    lines: ['שלום הוא גם השם שלנו וגם מה שאנחנו מאחלים לתיבת הדואר שלכם.', 'כל מה שנשמר כאן נעול במפתח שנוצר במכשיר שלכם ולעולם לא יוצא ממנו. אפילו אנחנו לא יכולים לפתוח.'],
    tipsTitle: 'שלושה דברים כדי להתחיל:',
    tips: ['בין חשבונות Shalom ההודעות מוצפנות מקצה לקצה. חפשו את המנעול הירוק.', 'מי שמשתמשים בשירות דואר אחר מקבלים את ההודעות כרגיל.', 'שמרו היטב על הסיסמה. אם תשכחו אותה, כתובת השחזור תחזיר לכם את החשבון, אבל מה שנשמר עד אז לא יחזור.'],
    end: 'שתהיה שלווה בתיבה שלכם.', sign: 'צוות Shalom Mail',
  },
  ar: {
    dir: 'rtl', subject: 'شالوم يا {n}. صندوقك جاهز.', hello: 'شالوم يا {n}.',
    lines: ['شالوم تعني السلام، وهذا ما نتمناه لصندوق بريدك.', 'كل ما يُحفظ هنا مقفل بمفتاح أُنشئ على جهازك ولا يغادره أبدًا. حتى نحن لا نستطيع فتحه.'],
    tipsTitle: 'ثلاثة أشياء للبدء:',
    tips: ['بين حسابات Shalom تكون الرسائل مشفرة من الطرف إلى الطرف. ابحث عن القفل الأخضر.', 'من يستخدم خدمة بريد أخرى يتلقى رسائلك كالمعتاد.', 'احتفظ بكلمة المرور جيدًا. إذا نسيتها، يعيد إليك بريد الاسترداد حسابك، لكن ما كان محفوظًا حتى ذلك الحين لا يعود.'],
    end: 'ليكن صندوقك في سلام.', sign: 'فريق Shalom Mail',
  },
  hi: {
    subject: 'शालोम, {n}. आपका इनबॉक्स तैयार है।', hello: 'शालोम, {n}।',
    lines: ['शालोम का अर्थ है शांति, और यही हम आपके इनबॉक्स के लिए चाहते हैं।', 'यहाँ जो कुछ भी सहेजा जाता है, वह एक ऐसी कुंजी से बंद होता है जो आपके डिवाइस पर बनी और कभी उससे बाहर नहीं जाती। हम भी इसे नहीं खोल सकते।'],
    tipsTitle: 'शुरू करने के लिए तीन बातें:',
    tips: ['Shalom खातों के बीच संदेश एंड-टू-एंड एन्क्रिप्टेड होते हैं। हरे ताले पर ध्यान दें।', 'दूसरी ईमेल सेवा इस्तेमाल करने वालों को आपके संदेश सामान्य रूप से मिलते हैं।', 'अपना पासवर्ड संभालकर रखें। भूल जाने पर रिकवरी ईमेल आपका खाता लौटा देता है, लेकिन तब तक सहेजा गया कुछ भी वापस नहीं आता।'],
    end: 'आपका इनबॉक्स शांति में रहे।', sign: 'Shalom Mail टीम',
  },
  zh: {
    subject: 'Shalom，{n}。你的收件箱已准备好。', hello: 'Shalom，{n}。',
    lines: ['Shalom 的意思是和平，这正是我们对你收件箱的期望。', '这里保存的一切都由一把在你设备上生成、永远不会离开它的密钥锁住。连我们也打不开。'],
    tipsTitle: '开始前的三件事：',
    tips: ['Shalom 账户之间的邮件采用端到端加密。留意绿色的锁。', '使用其他邮箱的人会照常收到你的邮件。', '请妥善保管密码。如果忘记，恢复邮箱可以帮你找回账户，但之前保存的内容无法恢复。'],
    end: '愿你的收件箱安宁。', sign: 'Shalom Mail 团队',
  },
  ja: {
    subject: 'Shalom、{n}さん。受信箱の準備ができました。', hello: 'Shalom、{n}さん。',
    lines: ['Shalom は「平和」という意味です。それこそ、私たちがあなたの受信箱に願うことです。', 'ここに保存されるものはすべて、あなたの端末で生まれ、そこから出ることのない鍵で守られています。私たちにも開けません。'],
    tipsTitle: 'はじめに知っておきたい3つのこと：',
    tips: ['Shalom アカウント同士のメールはエンドツーエンドで暗号化されます。緑の鍵マークが目印です。', 'ほかのメールサービスを使う相手にも、いつもどおり届きます。', 'パスワードは大切に保管してください。忘れた場合は復旧用メールでアカウントを取り戻せますが、それまでに保存されていた内容は戻りません。'],
    end: 'あなたの受信箱が平和でありますように。', sign: 'Shalom Mail チーム',
  },
  ko: {
    subject: 'Shalom, {n}님. 받은편지함이 준비됐어요.', hello: 'Shalom, {n}님.',
    lines: ['Shalom은 평화라는 뜻이에요. 저희가 당신의 받은편지함에 바라는 것도 바로 그거예요.', '여기에 저장되는 모든 것은 당신의 기기에서 만들어져 절대 기기를 떠나지 않는 키로 잠겨요. 저희도 열 수 없어요.'],
    tipsTitle: '시작하기 전에 알아 둘 세 가지:',
    tips: ['Shalom 계정끼리는 메일이 종단간 암호화돼요. 초록색 자물쇠를 확인하세요.', '다른 메일 서비스를 쓰는 사람에게도 평소처럼 전달돼요.', '비밀번호를 잘 보관하세요. 잊어버리면 복구 이메일로 계정을 되찾을 수 있지만, 그때까지 저장된 내용은 돌아오지 않아요.'],
    end: '당신의 받은편지함에 평화가 함께하길.', sign: 'Shalom Mail 팀',
  },
};

const enc = new TextEncoder();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64Lines = (bytes: Uint8Array) => toB64(bytes).replace(/.{1,76}/g, '$&\r\n');
const encodedWord = (s: string) => `=?UTF-8?B?${toB64(enc.encode(s))}?=`;

// Chave da Equipe: derivada da CERT_KEY, estável entre deploys e na mudança de conta.
async function teamKey(env: Env) {
  const secret = (await hmac(env.CERT_KEY, 'shalom-team-sender-v1')).subarray(0, 32);
  return { secret, publicKey: publicKeyOf(secret) };
}

function body(t: Welcome, name: string) {
  const fill = (s: string) => s.replace('{n}', name);
  const text = [fill(t.hello), '', ...t.lines.flatMap(l => [l, '']), t.tipsTitle, ...t.tips.map(x => `• ${x}`), '', t.end, '', t.sign].join('\n');
  const dir = t.dir ? ` dir="${t.dir}"` : '';
  const html = `<!doctype html><html${dir}><head><meta charset="utf-8"></head><body${dir}>
<div${dir} style="max-width:560px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65">
<p style="margin:0 0 18px;font-size:22px;line-height:1.3;font-weight:600">${esc(fill(t.hello))}</p>
${t.lines.map(l => `<p style="margin:0 0 14px">${esc(l)}</p>`).join('\n')}
<p style="margin:22px 0 8px;font-weight:600">${esc(t.tipsTitle)}</p>
<ol style="margin:0 0 18px;padding-inline-start:22px">${t.tips.map(x => `<li style="margin:0 0 8px">${esc(x)}</li>`).join('')}</ol>
<p style="margin:22px 0 4px">${esc(t.end)}</p>
<p style="margin:0;font-weight:600">${esc(t.sign)}</p>
</div></body></html>`;
  return { text, html };
}

export async function leaveWelcome(env: Env, user: { id: string; address: string; name: string; publicKey: string }, lang: string) {
  const t = TEXTS[lang] ?? TEXTS.en;
  const first = (user.name.trim().split(/\s+/)[0] || user.address.split('@')[0]).slice(0, 40);
  const subject = t.subject.replace('{n}', first);
  const from = { name: 'Shalom Mail', address: `equipe@${env.MAIL_DOMAIN}` };
  const now = new Date();
  const id = crypto.randomUUID();
  const { text, html } = body(t, first);
  const boundary = `shalom-${id}`;
  const mime = [
    `From: ${encodedWord(from.name)} <${from.address}>`,
    `To: ${user.name ? `${encodedWord(user.name)} ` : ''}<${user.address}>`,
    `Subject: ${encodedWord(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <boas-vindas-${id}@${env.MAIL_DOMAIN}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(enc.encode(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(enc.encode(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const head: MessageHead = {
    from, to: [{ name: user.name, address: user.address }], subject, date: now.toISOString(),
    snippet: t.lines[0].slice(0, 160), attachments: 0, auth: 'pass', e2e: true,
  };
  const team = await teamKey(env);
  const at = Date.now();
  const cert = signCert({ a: from.address, k: toB64(team.publicKey), i: at, e: at + 7 * 24 * 3600 * 1000 }, loadKeys(env).cert);
  const recipient = fromB64(user.publicKey);
  const sealedHead = await sealFromSender(recipient, team.secret, cert, enc.encode(JSON.stringify(head)), 'head');
  const raw = await sealFromSender(recipient, team.secret, cert, await pack(enc.encode(mime)), 'raw');
  await env.BLOBS.put(`m/${user.id}/${id}`, raw);
  await boxOf(env, user.id).add({ id, folder: 'inbox', seen: false, size: raw.length, sender: null, head: sealedHead });
}
