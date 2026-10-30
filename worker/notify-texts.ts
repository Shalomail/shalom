// Textos dos e-mails do sistema em cada idioma do site. {account}: o endereço Shalom da conta.
export type NotifyTexts = {
  dir?: 'rtl';
  confirm: { subject: string; preheader: string; title: string; intro: [string, string]; button: string; after: string };
  reset: { subject: string; preheader: string; title: string; intro: string; warning: string; button: string; after: string };
  copyLink: string;
  footer: string;
};

export const NOTIFY: Record<string, NotifyTexts> = {
  pt: {
    confirm: {
      subject: 'Confirme seu e-mail de recuperação', preheader: 'Confirme que este é o e-mail de recuperação de {account}.', title: 'Confirme seu e-mail de recuperação',
      intro: ['Este endereço foi escolhido como e-mail de recuperação da conta {account}.', 'Se um dia a senha for esquecida, é aqui que chega o link para criar uma nova. Confirme para deixar tudo pronto.'],
      button: 'Confirmar este e-mail', after: 'O link vale por 24 horas. Se você não reconhece esta conta, é só ignorar este e-mail: nada muda.',
    },
    reset: {
      subject: 'Criar uma senha nova no Shalom Mail', preheader: 'Pedido de senha nova para {account}. O link vale por 1 hora.', title: 'Criar uma senha nova',
      intro: 'Recebemos um pedido para criar uma senha nova para a conta {account}.',
      warning: 'Com a senha nova você volta a entrar e a receber e-mails normalmente, mas os e-mails guardados até agora não voltam. Eles estão trancados pela senha antiga, e ninguém tem cópia dela, nem o Shalom. Se você lembrar a senha, entre com ela em vez de usar este link.',
      button: 'Criar senha nova', after: 'O link vale por 1 hora e funciona uma vez só. Se não foi você, ignore este e-mail: a sua conta continua como está, com a mesma senha.',
    },
    copyLink: 'Se o botão não abrir, copie este endereço no navegador:',
    footer: 'Enviado pelo Shalom Mail para cuidar da conta {account}. Nunca pedimos sua senha por e-mail. Este endereço não recebe respostas.',
  },
  en: {
    confirm: {
      subject: 'Confirm your recovery email', preheader: 'Confirm this is the recovery email for {account}.', title: 'Confirm your recovery email',
      intro: ['This address was chosen as the recovery email for the account {account}.', 'If the password is ever forgotten, this is where the link to create a new one will arrive. Confirm to get everything ready.'],
      button: 'Confirm this email', after: "The link is valid for 24 hours. If you don't recognize this account, just ignore this email: nothing changes.",
    },
    reset: {
      subject: 'Create a new password for Shalom Mail', preheader: 'New password request for {account}. The link is valid for 1 hour.', title: 'Create a new password',
      intro: 'We received a request to create a new password for the account {account}.',
      warning: "With the new password you can sign in and receive email as usual, but the emails stored until now won't come back. They are locked by the old password, and no one has a copy of it, not even Shalom. If you remember your password, sign in with it instead of using this link.",
      button: 'Create new password', after: "The link is valid for 1 hour and works only once. If this wasn't you, ignore this email: your account stays as it is, with the same password.",
    },
    copyLink: "If the button doesn't open, copy this address into your browser:",
    footer: 'Sent by Shalom Mail to look after the account {account}. We never ask for your password by email. This address does not receive replies.',
  },
  es: {
    confirm: {
      subject: 'Confirma tu correo de recuperación', preheader: 'Confirma que este es el correo de recuperación de {account}.', title: 'Confirma tu correo de recuperación',
      intro: ['Esta dirección se eligió como correo de recuperación de la cuenta {account}.', 'Si algún día se olvida la contraseña, aquí llegará el enlace para crear una nueva. Confírmalo para dejar todo listo.'],
      button: 'Confirmar este correo', after: 'El enlace vale 24 horas. Si no reconoces esta cuenta, ignora este correo: no cambia nada.',
    },
    reset: {
      subject: 'Crea una contraseña nueva en Shalom Mail', preheader: 'Solicitud de contraseña nueva para {account}. El enlace vale 1 hora.', title: 'Crear una contraseña nueva',
      intro: 'Recibimos una solicitud para crear una contraseña nueva para la cuenta {account}.',
      warning: 'Con la contraseña nueva vuelves a entrar y a recibir correos con normalidad, pero los correos guardados hasta ahora no vuelven. Están cerrados con la contraseña anterior y nadie tiene una copia, ni siquiera Shalom. Si recuerdas tu contraseña, entra con ella en lugar de usar este enlace.',
      button: 'Crear contraseña nueva', after: 'El enlace vale 1 hora y funciona una sola vez. Si no fuiste tú, ignora este correo: tu cuenta sigue igual, con la misma contraseña.',
    },
    copyLink: 'Si el botón no abre, copia esta dirección en el navegador:',
    footer: 'Enviado por Shalom Mail para cuidar la cuenta {account}. Nunca pedimos tu contraseña por correo. Esta dirección no recibe respuestas.',
  },
  fr: {
    confirm: {
      subject: 'Confirmez votre e-mail de récupération', preheader: "Confirmez que c'est l'e-mail de récupération de {account}.", title: 'Confirmez votre e-mail de récupération',
      intro: ['Cette adresse a été choisie comme e-mail de récupération du compte {account}.', "Si le mot de passe est un jour oublié, c'est ici qu'arrivera le lien pour en créer un nouveau. Confirmez pour que tout soit prêt."],
      button: 'Confirmer cet e-mail', after: 'Le lien est valable 24 heures. Si vous ne reconnaissez pas ce compte, ignorez simplement cet e-mail : rien ne change.',
    },
    reset: {
      subject: 'Créer un nouveau mot de passe pour Shalom Mail', preheader: 'Demande de nouveau mot de passe pour {account}. Le lien est valable 1 heure.', title: 'Créer un nouveau mot de passe',
      intro: 'Nous avons reçu une demande de nouveau mot de passe pour le compte {account}.',
      warning: "Avec le nouveau mot de passe, vous pourrez vous reconnecter et recevoir des e-mails normalement, mais les e-mails conservés jusqu'ici ne reviendront pas. Ils sont verrouillés par l'ancien mot de passe, et personne n'en a de copie, pas même Shalom. Si vous vous souvenez de votre mot de passe, connectez-vous avec lui plutôt que d'utiliser ce lien.",
      button: 'Créer un nouveau mot de passe', after: "Le lien est valable 1 heure et ne fonctionne qu'une fois. Si ce n'était pas vous, ignorez cet e-mail : votre compte reste tel quel, avec le même mot de passe.",
    },
    copyLink: "Si le bouton ne s'ouvre pas, copiez cette adresse dans votre navigateur :",
    footer: "Envoyé par Shalom Mail pour le compte {account}. Nous ne demandons jamais votre mot de passe par e-mail. Cette adresse ne reçoit pas de réponses.",
  },
  de: {
    confirm: {
      subject: 'Bestätige deine Wiederherstellungs-E-Mail', preheader: 'Bestätige, dass dies die Wiederherstellungs-E-Mail für {account} ist.', title: 'Bestätige deine Wiederherstellungs-E-Mail',
      intro: ['Diese Adresse wurde als Wiederherstellungs-E-Mail für das Konto {account} gewählt.', 'Falls das Passwort einmal vergessen wird, kommt hier der Link für ein neues an. Bestätige, damit alles bereit ist.'],
      button: 'Diese E-Mail bestätigen', after: 'Der Link ist 24 Stunden gültig. Wenn du dieses Konto nicht kennst, ignoriere diese E-Mail einfach: Es ändert sich nichts.',
    },
    reset: {
      subject: 'Neues Passwort für Shalom Mail festlegen', preheader: 'Anfrage für ein neues Passwort für {account}. Der Link ist 1 Stunde gültig.', title: 'Neues Passwort festlegen',
      intro: 'Wir haben eine Anfrage erhalten, ein neues Passwort für das Konto {account} festzulegen.',
      warning: 'Mit dem neuen Passwort kannst du dich wieder anmelden und ganz normal E-Mails empfangen, aber die bisher gespeicherten E-Mails kommen nicht zurück. Sie sind mit dem alten Passwort verschlossen, und niemand hat eine Kopie davon, auch Shalom nicht. Wenn du dich an dein Passwort erinnerst, melde dich damit an, statt diesen Link zu nutzen.',
      button: 'Neues Passwort festlegen', after: 'Der Link ist 1 Stunde gültig und funktioniert nur einmal. Wenn du das nicht warst, ignoriere diese E-Mail: Dein Konto bleibt, wie es ist, mit demselben Passwort.',
    },
    copyLink: 'Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:',
    footer: 'Von Shalom Mail für das Konto {account} gesendet. Wir fragen nie per E-Mail nach deinem Passwort. Diese Adresse empfängt keine Antworten.',
  },
  it: {
    confirm: {
      subject: 'Conferma la tua email di recupero', preheader: "Conferma che questa è l'email di recupero di {account}.", title: 'Conferma la tua email di recupero',
      intro: ["Questo indirizzo è stato scelto come email di recupero dell'account {account}.", 'Se un giorno la password venisse dimenticata, qui arriverà il link per crearne una nuova. Conferma per avere tutto pronto.'],
      button: 'Conferma questa email', after: 'Il link vale 24 ore. Se non riconosci questo account, ignora questa email: non cambia nulla.',
    },
    reset: {
      subject: 'Crea una nuova password per Shalom Mail', preheader: 'Richiesta di nuova password per {account}. Il link vale 1 ora.', title: 'Crea una nuova password',
      intro: "Abbiamo ricevuto una richiesta di creare una nuova password per l'account {account}.",
      warning: 'Con la nuova password potrai accedere e ricevere email normalmente, ma le email salvate finora non torneranno. Sono chiuse con la vecchia password e nessuno ne ha una copia, nemmeno Shalom. Se ricordi la password, accedi con quella invece di usare questo link.',
      button: 'Crea una nuova password', after: "Il link vale 1 ora e funziona una sola volta. Se la richiesta non è tua, ignora questa email: il tuo account resta com'è, con la stessa password.",
    },
    copyLink: 'Se il pulsante non si apre, copia questo indirizzo nel browser:',
    footer: "Inviato da Shalom Mail per l'account {account}. Non chiediamo mai la tua password via email. Questo indirizzo non riceve risposte.",
  },
  ru: {
    confirm: {
      subject: 'Подтвердите резервный адрес', preheader: 'Подтвердите, что это резервный адрес для {account}.', title: 'Подтвердите резервный адрес',
      intro: ['Этот адрес выбран резервным для аккаунта {account}.', 'Если пароль когда-нибудь забудется, сюда придёт ссылка для создания нового. Подтвердите, чтобы всё было готово.'],
      button: 'Подтвердить адрес', after: 'Ссылка действует 24 часа. Если вы не узнаёте этот аккаунт, просто проигнорируйте письмо: ничего не изменится.',
    },
    reset: {
      subject: 'Новый пароль для Shalom Mail', preheader: 'Запрос нового пароля для {account}. Ссылка действует 1 час.', title: 'Создайте новый пароль',
      intro: 'Мы получили запрос на создание нового пароля для аккаунта {account}.',
      warning: 'С новым паролем вы снова сможете входить и получать письма как обычно, но письма, сохранённые до этого момента, не вернутся. Они заперты старым паролем, и копии нет ни у кого, даже у Shalom. Если вы помните пароль, войдите с ним вместо этой ссылки.',
      button: 'Создать новый пароль', after: 'Ссылка действует 1 час и срабатывает один раз. Если это были не вы, проигнорируйте письмо: аккаунт останется как есть, с тем же паролем.',
    },
    copyLink: 'Если кнопка не открывается, скопируйте этот адрес в браузер:',
    footer: 'Отправлено Shalom Mail для аккаунта {account}. Мы никогда не просим пароль по почте. Этот адрес не принимает ответы.',
  },
  uk: {
    confirm: {
      subject: 'Підтвердіть резервну адресу', preheader: 'Підтвердіть, що це резервна адреса для {account}.', title: 'Підтвердіть резервну адресу',
      intro: ['Цю адресу обрано резервною для акаунта {account}.', 'Якщо пароль колись забудеться, сюди прийде посилання для створення нового. Підтвердіть, щоб усе було готово.'],
      button: 'Підтвердити адресу', after: 'Посилання дійсне 24 години. Якщо ви не впізнаєте цей акаунт, просто проігноруйте лист: нічого не зміниться.',
    },
    reset: {
      subject: 'Новий пароль для Shalom Mail', preheader: 'Запит нового пароля для {account}. Посилання дійсне 1 годину.', title: 'Створіть новий пароль',
      intro: 'Ми отримали запит на створення нового пароля для акаунта {account}.',
      warning: 'З новим паролем ви знову зможете входити й отримувати листи як звичайно, але листи, збережені досі, не повернуться. Вони замкнені старим паролем, і копії немає ні в кого, навіть у Shalom. Якщо ви пам’ятаєте пароль, увійдіть із ним замість цього посилання.',
      button: 'Створити новий пароль', after: 'Посилання дійсне 1 годину і спрацьовує один раз. Якщо це були не ви, проігноруйте лист: акаунт залишиться як є, з тим самим паролем.',
    },
    copyLink: 'Якщо кнопка не відкривається, скопіюйте цю адресу в браузер:',
    footer: 'Надіслано Shalom Mail для акаунта {account}. Ми ніколи не просимо пароль поштою. Ця адреса не приймає відповідей.',
  },
  tr: {
    confirm: {
      subject: 'Kurtarma e-postanızı onaylayın', preheader: 'Bunun {account} için kurtarma e-postası olduğunu onaylayın.', title: 'Kurtarma e-postanızı onaylayın',
      intro: ['Bu adres, {account} hesabının kurtarma e-postası olarak seçildi.', 'Parola bir gün unutulursa, yenisini oluşturma bağlantısı buraya gelir. Her şeyin hazır olması için onaylayın.'],
      button: 'Bu e-postayı onayla', after: 'Bağlantı 24 saat geçerlidir. Bu hesabı tanımıyorsanız bu e-postayı yok sayın: hiçbir şey değişmez.',
    },
    reset: {
      subject: 'Shalom Mail için yeni parola oluşturun', preheader: '{account} için yeni parola isteği. Bağlantı 1 saat geçerlidir.', title: 'Yeni parola oluşturun',
      intro: '{account} hesabı için yeni parola oluşturma isteği aldık.',
      warning: "Yeni parolayla yeniden giriş yapabilir ve e-postaları her zamanki gibi alabilirsiniz, ancak şimdiye kadar saklanan e-postalar geri gelmez. Eski parolayla kilitlidirler ve kimsede kopyası yoktur, Shalom'da bile. Parolanızı hatırlıyorsanız bu bağlantı yerine onunla giriş yapın.",
      button: 'Yeni parola oluştur', after: 'Bağlantı 1 saat geçerlidir ve yalnızca bir kez çalışır. Bu isteği siz yapmadıysanız bu e-postayı yok sayın: hesabınız aynı parolayla olduğu gibi kalır.',
    },
    copyLink: 'Düğme açılmazsa bu adresi tarayıcınıza kopyalayın:',
    footer: 'Shalom Mail tarafından {account} hesabı için gönderildi. Parolanızı asla e-postayla istemeyiz. Bu adres yanıt almaz.',
  },
  he: {
    dir: 'rtl',
    confirm: {
      subject: 'אשרו את כתובת השחזור שלכם', preheader: 'אשרו שזו כתובת השחזור של {account}.', title: 'אשרו את כתובת השחזור שלכם',
      intro: ['הכתובת הזו נבחרה ככתובת השחזור של החשבון {account}.', 'אם הסיסמה תישכח מתישהו, לכאן יגיע הקישור ליצירת סיסמה חדשה. אשרו כדי שהכול יהיה מוכן.'],
      button: 'אישור הכתובת', after: 'הקישור בתוקף 24 שעות. אם אינכם מזהים את החשבון, פשוט התעלמו מההודעה: שום דבר לא ישתנה.',
    },
    reset: {
      subject: 'יצירת סיסמה חדשה ב-Shalom Mail', preheader: 'בקשה לסיסמה חדשה עבור {account}. הקישור בתוקף שעה אחת.', title: 'יצירת סיסמה חדשה',
      intro: 'קיבלנו בקשה ליצור סיסמה חדשה לחשבון {account}.',
      warning: 'עם הסיסמה החדשה תוכלו להיכנס ולקבל הודעות כרגיל, אבל ההודעות שנשמרו עד עכשיו לא יחזרו. הן נעולות בסיסמה הישנה, ולאף אחד אין עותק שלה, גם לא ל-Shalom. אם אתם זוכרים את הסיסמה, היכנסו איתה במקום להשתמש בקישור.',
      button: 'יצירת סיסמה חדשה', after: 'הקישור בתוקף שעה אחת ועובד פעם אחת בלבד. אם לא אתם ביקשתם, התעלמו מההודעה: החשבון נשאר כמו שהוא, עם אותה סיסמה.',
    },
    copyLink: 'אם הכפתור לא נפתח, העתיקו את הכתובת הזו לדפדפן:',
    footer: 'נשלח על ידי Shalom Mail עבור החשבון {account}. לעולם לא נבקש את הסיסמה שלכם בדואר. הכתובת הזו לא מקבלת תשובות.',
  },
  ar: {
    dir: 'rtl',
    confirm: {
      subject: 'أكّد بريد الاسترداد الخاص بك', preheader: 'أكّد أن هذا هو بريد الاسترداد للحساب {account}.', title: 'أكّد بريد الاسترداد الخاص بك',
      intro: ['تم اختيار هذا العنوان بريدًا للاسترداد للحساب {account}.', 'إذا نُسيت كلمة المرور يومًا، سيصل إلى هنا رابط إنشاء كلمة مرور جديدة. أكّده ليكون كل شيء جاهزًا.'],
      button: 'تأكيد هذا البريد', after: 'الرابط صالح لمدة 24 ساعة. إذا لم تتعرف على هذا الحساب، فتجاهل هذه الرسالة: لن يتغير شيء.',
    },
    reset: {
      subject: 'إنشاء كلمة مرور جديدة في Shalom Mail', preheader: 'طلب كلمة مرور جديدة للحساب {account}. الرابط صالح لمدة ساعة.', title: 'إنشاء كلمة مرور جديدة',
      intro: 'تلقينا طلبًا لإنشاء كلمة مرور جديدة للحساب {account}.',
      warning: 'بكلمة المرور الجديدة يمكنك الدخول واستقبال الرسائل كالمعتاد، لكن الرسائل المحفوظة حتى الآن لن تعود. فهي مقفلة بكلمة المرور القديمة، ولا يملك أحد نسخة منها، ولا حتى Shalom. إذا كنت تتذكر كلمة المرور، فادخل بها بدلًا من استخدام هذا الرابط.',
      button: 'إنشاء كلمة مرور جديدة', after: 'الرابط صالح لمدة ساعة ويعمل مرة واحدة فقط. إذا لم تكن صاحب الطلب، فتجاهل هذه الرسالة: يبقى حسابك كما هو بكلمة المرور نفسها.',
    },
    copyLink: 'إذا لم يفتح الزر، انسخ هذا العنوان في المتصفح:',
    footer: 'أُرسلت من Shalom Mail للعناية بالحساب {account}. لا نطلب كلمة المرور عبر البريد أبدًا. هذا العنوان لا يستقبل الردود.',
  },
  hi: {
    confirm: {
      subject: 'अपना रिकवरी ईमेल पुष्टि करें', preheader: 'पुष्टि करें कि यह {account} का रिकवरी ईमेल है।', title: 'अपना रिकवरी ईमेल पुष्टि करें',
      intro: ['यह पता खाते {account} के रिकवरी ईमेल के रूप में चुना गया है।', 'अगर कभी पासवर्ड भूल जाएँ, तो नया बनाने का लिंक यहीं आएगा। सब कुछ तैयार रखने के लिए पुष्टि करें।'],
      button: 'यह ईमेल पुष्टि करें', after: 'लिंक 24 घंटे तक मान्य है। अगर आप इस खाते को नहीं पहचानते, तो इस ईमेल को अनदेखा करें: कुछ नहीं बदलेगा।',
    },
    reset: {
      subject: 'Shalom Mail के लिए नया पासवर्ड बनाएँ', preheader: '{account} के लिए नए पासवर्ड का अनुरोध। लिंक 1 घंटे तक मान्य है।', title: 'नया पासवर्ड बनाएँ',
      intro: 'हमें खाते {account} के लिए नया पासवर्ड बनाने का अनुरोध मिला है।',
      warning: 'नए पासवर्ड से आप फिर से साइन इन कर सकेंगे और ईमेल सामान्य रूप से पाएँगे, लेकिन अब तक सहेजे गए ईमेल वापस नहीं आएँगे। वे पुराने पासवर्ड से बंद हैं, और किसी के पास उसकी कॉपी नहीं है, Shalom के पास भी नहीं। अगर आपको पासवर्ड याद है, तो इस लिंक के बजाय उससे साइन इन करें।',
      button: 'नया पासवर्ड बनाएँ', after: 'लिंक 1 घंटे तक मान्य है और सिर्फ़ एक बार काम करता है। अगर यह अनुरोध आपने नहीं किया, तो इस ईमेल को अनदेखा करें: आपका खाता उसी पासवर्ड के साथ जैसा है वैसा रहेगा।',
    },
    copyLink: 'अगर बटन न खुले, तो यह पता अपने ब्राउज़र में कॉपी करें:',
    footer: 'खाते {account} की देखभाल के लिए Shalom Mail द्वारा भेजा गया। हम कभी ईमेल पर आपका पासवर्ड नहीं माँगते। यह पता जवाब नहीं लेता।',
  },
  zh: {
    confirm: {
      subject: '确认你的恢复邮箱', preheader: '确认这是 {account} 的恢复邮箱。', title: '确认你的恢复邮箱',
      intro: ['这个地址已被设为账户 {account} 的恢复邮箱。', '如果哪天忘了密码，创建新密码的链接会发到这里。请确认，让一切准备就绪。'],
      button: '确认此邮箱', after: '链接 24 小时内有效。如果你不认识这个账户，忽略这封邮件即可，不会有任何变化。',
    },
    reset: {
      subject: '为 Shalom Mail 创建新密码', preheader: '{account} 的新密码请求。链接 1 小时内有效。', title: '创建新密码',
      intro: '我们收到了为账户 {account} 创建新密码的请求。',
      warning: '使用新密码后，你可以照常登录和收信，但目前保存的邮件不会回来。它们被旧密码锁住，没有人有副本，包括 Shalom。如果你还记得密码，请直接用它登录，而不要使用这个链接。',
      button: '创建新密码', after: '链接 1 小时内有效，且只能使用一次。如果这不是你本人的请求，请忽略这封邮件：你的账户保持不变，密码也不变。',
    },
    copyLink: '如果按钮无法打开，请把这个地址复制到浏览器：',
    footer: '由 Shalom Mail 为账户 {account} 发送。我们绝不会通过邮件索要你的密码。此地址不接收回复。',
  },
  ja: {
    confirm: {
      subject: '復旧用メールアドレスの確認', preheader: 'これが {account} の復旧用メールアドレスであることを確認してください。', title: '復旧用メールアドレスを確認してください',
      intro: ['このアドレスは、アカウント {account} の復旧用メールアドレスとして設定されました。', 'パスワードを忘れたときは、新しいパスワードを作るためのリンクがここに届きます。準備のために確認してください。'],
      button: 'このメールアドレスを確認', after: 'リンクの有効期限は24時間です。このアカウントに心当たりがない場合は、このメールを無視してください。何も変わりません。',
    },
    reset: {
      subject: 'Shalom Mail の新しいパスワードを作成', preheader: '{account} の新しいパスワードのリクエストです。リンクの有効期限は1時間です。', title: '新しいパスワードを作成',
      intro: 'アカウント {account} の新しいパスワードを作成するリクエストを受け付けました。',
      warning: '新しいパスワードで再びサインインしてメールを受け取れますが、これまでに保存されたメールは戻りません。古いパスワードで鍵がかかっていて、そのコピーは誰も持っていません。Shalom も同じです。パスワードを覚えている場合は、このリンクではなくそのパスワードでサインインしてください。',
      button: '新しいパスワードを作成', after: 'リンクの有効期限は1時間で、使えるのは1回だけです。心当たりがない場合はこのメールを無視してください。アカウントは同じパスワードのまま変わりません。',
    },
    copyLink: 'ボタンが開かない場合は、このアドレスをブラウザにコピーしてください：',
    footer: 'アカウント {account} の管理のために Shalom Mail から送信されました。パスワードをメールでお聞きすることはありません。このアドレスは返信を受け付けていません。',
  },
  ko: {
    confirm: {
      subject: '복구 이메일을 확인해 주세요', preheader: '{account}의 복구 이메일이 맞는지 확인해 주세요.', title: '복구 이메일을 확인해 주세요',
      intro: ['이 주소가 계정 {account}의 복구 이메일로 설정되었어요.', '비밀번호를 잊어버리면 새 비밀번호를 만드는 링크가 여기로 와요. 준비를 위해 확인해 주세요.'],
      button: '이 이메일 확인', after: '링크는 24시간 동안 유효해요. 이 계정을 모른다면 이 이메일을 무시하세요. 아무것도 바뀌지 않아요.',
    },
    reset: {
      subject: 'Shalom Mail 새 비밀번호 만들기', preheader: '{account}의 새 비밀번호 요청이에요. 링크는 1시간 동안 유효해요.', title: '새 비밀번호 만들기',
      intro: '계정 {account}의 새 비밀번호를 만들어 달라는 요청을 받았어요.',
      warning: '새 비밀번호로 다시 로그인하고 평소처럼 메일을 받을 수 있지만, 지금까지 저장된 메일은 돌아오지 않아요. 예전 비밀번호로 잠겨 있고, 그 사본은 누구에게도 없어요. Shalom에도요. 비밀번호가 기억난다면 이 링크 대신 그 비밀번호로 로그인하세요.',
      button: '새 비밀번호 만들기', after: '링크는 1시간 동안 유효하고 한 번만 쓸 수 있어요. 본인이 요청하지 않았다면 이 이메일을 무시하세요. 계정은 같은 비밀번호로 그대로 유지돼요.',
    },
    copyLink: '버튼이 열리지 않으면 이 주소를 브라우저에 복사하세요:',
    footer: '계정 {account} 관리를 위해 Shalom Mail에서 보냈어요. 이메일로 비밀번호를 묻는 일은 절대 없어요. 이 주소로는 답장을 받지 않아요.',
  },
};

export const notifyTexts = (lang: string | null | undefined) => NOTIFY[lang ?? ''] ?? NOTIFY.en;
