// Textos que só existem no app de iOS (o resto vem do app web, web/src/i18n). Mesmas regras: Português do
// Brasil é a origem, {nome} é trocado pelo valor, nunca travessão. Cada chave nas 15 línguas.
type T = Record<string, string>;
type Entry = Record<'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ru' | 'uk' | 'tr' | 'he' | 'ar' | 'hi' | 'zh' | 'ja' | 'ko', string>;

const ios: Record<string, Entry> = {
  'ios.unlock': {
    pt: 'Desbloquear', en: 'Unlock', es: 'Desbloquear', fr: 'Déverrouiller', de: 'Entsperren', it: 'Sblocca', ru: 'Разблокировать', uk: 'Розблокувати',
    tr: 'Kilidi aç', he: 'ביטול נעילה', ar: 'فتح القفل', hi: 'अनलॉक करें', zh: '解锁', ja: 'ロックを解除', ko: '잠금 해제',
  },
  'ios.unlockReason': {
    pt: 'Abrir a chave dos seus e-mails neste iPhone', en: 'Open the key to your email on this iPhone', es: 'Abrir la clave de tus correos en este iPhone',
    fr: 'Ouvrir la clé de vos e-mails sur cet iPhone', de: 'Den Schlüssel zu deinen E-Mails auf diesem iPhone öffnen', it: 'Aprire la chiave delle tue email su questo iPhone',
    ru: 'Открыть ключ к вашей почте на этом iPhone', uk: 'Відкрити ключ до вашої пошти на цьому iPhone', tr: 'Bu iPhone\'da e-postalarınızın anahtarını açın',
    he: 'פתיחת המפתח למיילים שלכם באייפון הזה', ar: 'فتح مفتاح بريدك على هذا الـ iPhone', hi: 'इस iPhone पर अपने ईमेल की कुंजी खोलें',
    zh: '在这台 iPhone 上打开你的邮件密钥', ja: 'この iPhone でメールの鍵を開く', ko: '이 iPhone에서 메일 키 열기',
  },
  'ios.locked': {
    pt: 'Shalom Mail está trancado', en: 'Shalom Mail is locked', es: 'Shalom Mail está bloqueado', fr: 'Shalom Mail est verrouillé', de: 'Shalom Mail ist gesperrt',
    it: 'Shalom Mail è bloccato', ru: 'Shalom Mail заблокирован', uk: 'Shalom Mail заблоковано', tr: 'Shalom Mail kilitli', he: 'Shalom Mail נעול',
    ar: 'Shalom Mail مقفل', hi: 'Shalom Mail लॉक है', zh: 'Shalom Mail 已锁定', ja: 'Shalom Mail はロックされています', ko: 'Shalom Mail이 잠겨 있습니다',
  },
  'ios.lockedText': {
    pt: 'A chave dos seus e-mails fica guardada neste iPhone e só abre com você.', en: 'The key to your email is stored on this iPhone and only opens with you.',
    es: 'La clave de tus correos se guarda en este iPhone y solo se abre contigo.', fr: 'La clé de vos e-mails est gardée sur cet iPhone et ne s’ouvre qu’avec vous.',
    de: 'Der Schlüssel zu deinen E-Mails liegt auf diesem iPhone und öffnet sich nur mit dir.', it: 'La chiave delle tue email resta su questo iPhone e si apre solo con te.',
    ru: 'Ключ к вашей почте хранится на этом iPhone и открывается только вами.', uk: 'Ключ до вашої пошти зберігається на цьому iPhone і відкривається лише вами.',
    tr: 'E-postalarınızın anahtarı bu iPhone\'da saklanır ve yalnızca sizinle açılır.', he: 'המפתח למיילים שלכם שמור באייפון הזה ונפתח רק איתכם.',
    ar: 'مفتاح بريدك محفوظ على هذا الـ iPhone ولا يُفتح إلا بك.', hi: 'आपके ईमेल की कुंजी इसी iPhone पर रहती है और सिर्फ़ आपसे खुलती है।',
    zh: '你的邮件密钥保存在这台 iPhone 上，只有你能打开。', ja: 'メールの鍵はこの iPhone に保存され、あなたにしか開けません。', ko: '메일 키는 이 iPhone에 저장되며 본인만 열 수 있습니다.',
  },
  'ios.signOutHere': {
    pt: 'Sair desta conta', en: 'Sign out of this account', es: 'Salir de esta cuenta', fr: 'Se déconnecter de ce compte', de: 'Von diesem Konto abmelden',
    it: 'Esci da questo account', ru: 'Выйти из этого аккаунта', uk: 'Вийти з цього акаунта', tr: 'Bu hesaptan çık', he: 'יציאה מהחשבון הזה',
    ar: 'الخروج من هذا الحساب', hi: 'इस खाते से साइन आउट करें', zh: '退出此账户', ja: 'このアカウントからサインアウト', ko: '이 계정에서 로그아웃',
  },
  'ios.showImages': {
    pt: 'Mostrar imagens', en: 'Show images', es: 'Mostrar imágenes', fr: 'Afficher les images', de: 'Bilder anzeigen', it: 'Mostra immagini',
    ru: 'Показать изображения', uk: 'Показати зображення', tr: 'Görselleri göster', he: 'הצגת תמונות', ar: 'عرض الصور', hi: 'चित्र दिखाएँ',
    zh: '显示图片', ja: '画像を表示', ko: '이미지 표시',
  },
  'ios.imagesBlocked': {
    pt: 'Imagens de fora bloqueadas: elas avisam quem enviou que você abriu.', en: 'Outside images blocked: they tell the sender you opened the email.',
    es: 'Imágenes externas bloqueadas: avisan a quien envió que lo abriste.', fr: 'Images externes bloquées : elles signalent à l’expéditeur que vous avez ouvert l’e-mail.',
    de: 'Externe Bilder blockiert: Sie verraten dem Absender, dass du die E-Mail geöffnet hast.', it: 'Immagini esterne bloccate: dicono al mittente che hai aperto l’email.',
    ru: 'Внешние изображения заблокированы: они сообщают отправителю, что вы открыли письмо.', uk: 'Зовнішні зображення заблоковано: вони повідомляють відправника, що ви відкрили лист.',
    tr: 'Dış görseller engellendi: gönderene e-postayı açtığınızı bildirirler.', he: 'תמונות חיצוניות נחסמו: הן מודיעות לשולח שפתחתם את המייל.',
    ar: 'حُجبت الصور الخارجية: فهي تُخبر المرسل بأنك فتحت الرسالة.', hi: 'बाहरी चित्र रोके गए: वे भेजने वाले को बताते हैं कि आपने ईमेल खोला।',
    zh: '已拦截外部图片：它们会告诉发件人你打开了邮件。', ja: '外部画像をブロックしました。開封したことが送信者に伝わるためです。', ko: '외부 이미지를 차단했습니다. 메일을 열었다는 사실이 보낸 사람에게 전달되기 때문입니다.',
  },
  'ios.retry': {
    pt: 'Tentar de novo', en: 'Try again', es: 'Intentar de nuevo', fr: 'Réessayer', de: 'Erneut versuchen', it: 'Riprova', ru: 'Повторить', uk: 'Повторити',
    tr: 'Tekrar dene', he: 'לנסות שוב', ar: 'إعادة المحاولة', hi: 'फिर से कोशिश करें', zh: '重试', ja: '再試行', ko: '다시 시도',
  },
  'ios.keepDraft': {
    pt: 'Guardar rascunho e fechar', en: 'Save draft and close', es: 'Guardar borrador y cerrar', fr: 'Enregistrer le brouillon et fermer', de: 'Entwurf speichern und schließen',
    it: 'Salva bozza e chiudi', ru: 'Сохранить черновик и закрыть', uk: 'Зберегти чернетку й закрити', tr: 'Taslağı kaydet ve kapat', he: 'שמירת טיוטה וסגירה',
    ar: 'حفظ المسودة والإغلاق', hi: 'ड्राफ़्ट सहेजें और बंद करें', zh: '保存草稿并关闭', ja: '下書きを保存して閉じる', ko: '임시 저장 후 닫기',
  },
  'ios.lock.title': {
    pt: 'Trancar o app', en: 'Lock the app', es: 'Bloquear la app', fr: 'Verrouiller l’app', de: 'App sperren', it: 'Blocca l’app',
    ru: 'Блокировать приложение', uk: 'Блокувати застосунок', tr: 'Uygulamayı kilitle', he: 'נעילת האפליקציה', ar: 'قفل التطبيق',
    hi: 'ऐप लॉक करें', zh: '锁定应用', ja: 'アプリをロック', ko: '앱 잠금',
  },
  'ios.lock.now': {
    pt: 'Ao sair do app', en: 'When leaving the app', es: 'Al salir de la app', fr: 'En quittant l’app', de: 'Beim Verlassen der App',
    it: 'All’uscita dall’app', ru: 'При выходе из приложения', uk: 'Під час виходу із застосунку', tr: 'Uygulamadan çıkınca', he: 'ביציאה מהאפליקציה',
    ar: 'عند مغادرة التطبيق', hi: 'ऐप से बाहर जाते ही', zh: '离开应用时', ja: 'アプリを離れたとき', ko: '앱을 나갈 때',
  },
  'ios.lock.desc': {
    pt: 'Fora do app por mais tempo que isso, o Face ID é pedido de novo ao voltar.',
    en: 'After being away from the app for longer than this, Face ID is asked again when you come back.',
    es: 'Si estás fuera de la app más tiempo que esto, se vuelve a pedir Face ID al volver.',
    fr: 'Après une absence plus longue que cela, Face ID est redemandé à votre retour.',
    de: 'Warst du länger als das außerhalb der App, wird beim Zurückkehren erneut Face ID verlangt.',
    it: 'Se resti fuori dall’app più di così, al ritorno viene richiesto di nuovo Face ID.',
    ru: 'Если вы отсутствовали в приложении дольше этого времени, при возвращении снова потребуется Face ID.',
    uk: 'Якщо ви були поза застосунком довше, ніж цей час, після повернення знову знадобиться Face ID.',
    tr: 'Uygulamadan bundan uzun süre uzak kalırsanız dönüşte Face ID yeniden istenir.',
    he: 'אם יצאתם מהאפליקציה ליותר מזה, Face ID יידרש שוב כשתחזרו.',
    ar: 'إذا ابتعدت عن التطبيق أطول من ذلك، يُطلب Face ID مجددًا عند العودة.',
    hi: 'इससे ज़्यादा देर ऐप से बाहर रहने पर लौटते समय फिर से Face ID माँगा जाएगा।',
    zh: '离开应用超过这个时间，回来时会再次要求面容 ID。', ja: 'これより長くアプリを離れると、戻ったときに Face ID を再度求めます。',
    ko: '이보다 오래 앱을 떠나 있으면 돌아올 때 Face ID를 다시 요청합니다.',
  },
  'ios.about.title': {
    pt: 'Sobre', en: 'About', es: 'Acerca de', fr: 'À propos', de: 'Info', it: 'Informazioni', ru: 'О приложении', uk: 'Про застосунок',
    tr: 'Hakkında', he: 'אודות', ar: 'حول', hi: 'परिचय', zh: '关于', ja: '情報', ko: '정보',
  },
  'ios.about.privacy': {
    pt: 'Política de privacidade', en: 'Privacy policy', es: 'Política de privacidad', fr: 'Politique de confidentialité', de: 'Datenschutzerklärung',
    it: 'Informativa sulla privacy', ru: 'Политика конфиденциальности', uk: 'Політика конфіденційності', tr: 'Gizlilik politikası', he: 'מדיניות פרטיות',
    ar: 'سياسة الخصوصية', hi: 'गोपनीयता नीति', zh: '隐私政策', ja: 'プライバシーポリシー', ko: '개인정보 처리방침',
  },
  'ios.about.terms': {
    pt: 'Termos de uso', en: 'Terms of use', es: 'Términos de uso', fr: 'Conditions d’utilisation', de: 'Nutzungsbedingungen', it: 'Termini d’uso',
    ru: 'Условия использования', uk: 'Умови використання', tr: 'Kullanım koşulları', he: 'תנאי שימוש', ar: 'شروط الاستخدام', hi: 'उपयोग की शर्तें',
    zh: '使用条款', ja: '利用規約', ko: '이용약관',
  },
  'ios.about.help': {
    pt: 'Ajuda', en: 'Help', es: 'Ayuda', fr: 'Aide', de: 'Hilfe', it: 'Aiuto', ru: 'Помощь', uk: 'Допомога',
    tr: 'Yardım', he: 'עזרה', ar: 'المساعدة', hi: 'सहायता', zh: '帮助', ja: 'ヘルプ', ko: '도움말',
  },
  'ios.push.title': {
    pt: 'Avisos', en: 'Notifications', es: 'Avisos', fr: 'Notifications', de: 'Mitteilungen', it: 'Notifiche', ru: 'Уведомления', uk: 'Сповіщення',
    tr: 'Bildirimler', he: 'התראות', ar: 'الإشعارات', hi: 'सूचनाएँ', zh: '通知', ja: '通知', ko: '알림',
  },
  'ios.push.toggle': {
    pt: 'Avisar quando chegar mensagem', en: 'Notify me of new mail', es: 'Avisar cuando llegue un mensaje', fr: 'Me prévenir des nouveaux messages',
    de: 'Bei neuer Nachricht benachrichtigen', it: 'Avvisami dei nuovi messaggi', ru: 'Сообщать о новых письмах', uk: 'Повідомляти про нові листи',
    tr: 'Yeni ileti gelince bildir', he: 'להודיע כשמגיעה הודעה', ar: 'نبّهني عند وصول رسالة', hi: 'नया संदेश आने पर बताएँ',
    zh: '收到新邮件时通知我', ja: '新着メッセージを知らせる', ko: '새 메일이 오면 알림',
  },
  'ios.push.desc': {
    pt: 'O aviso diz só "Mensagem nova", sem remetente nem assunto. Ele passa pela Apple, que fica sabendo que houve um aviso e quando, mas nada da mensagem.',
    en: 'The notification only says "New message", with no sender or subject. It goes through Apple, which learns that a notification happened and when, but nothing about the message.',
    es: 'El aviso solo dice "Mensaje nuevo", sin remitente ni asunto. Pasa por Apple, que sabe que hubo un aviso y cuándo, pero nada del mensaje.',
    fr: 'La notification dit seulement « Nouveau message », sans expéditeur ni objet. Elle passe par Apple, qui sait qu’il y a eu une notification et quand, mais rien du message.',
    de: 'Die Mitteilung sagt nur „Neue Nachricht“, ohne Absender und Betreff. Sie läuft über Apple, das erfährt, dass es eine Mitteilung gab und wann, aber nichts über die Nachricht.',
    it: 'La notifica dice solo "Nuovo messaggio", senza mittente né oggetto. Passa da Apple, che sa che c’è stata una notifica e quando, ma niente del messaggio.',
    ru: 'В уведомлении только «Новое сообщение», без отправителя и темы. Оно идёт через Apple: Apple знает, что уведомление было и когда, но ничего о самом письме.',
    uk: 'У сповіщенні лише «Нове повідомлення», без відправника й теми. Воно йде через Apple: Apple знає, що сповіщення було і коли, але нічого про сам лист.',
    tr: 'Bildirim yalnızca "Yeni ileti" der; gönderen ya da konu yoktur. Apple üzerinden gider; Apple bir bildirim olduğunu ve ne zaman olduğunu bilir, iletiyle ilgili hiçbir şeyi bilmez.',
    he: 'ההתראה אומרת רק "הודעה חדשה", בלי שולח ובלי נושא. היא עוברת דרך Apple, שיודעת שהייתה התראה ומתי, אבל שום דבר על ההודעה.',
    ar: 'لا يقول الإشعار إلا "رسالة جديدة"، بلا مرسل ولا موضوع. يمر عبر Apple، التي تعرف أن إشعارًا حدث ومتى، لكن لا شيء عن الرسالة.',
    hi: 'सूचना में सिर्फ़ "नया संदेश" लिखा होता है, न भेजने वाला न विषय। यह Apple से होकर जाती है, जिसे पता चलता है कि सूचना आई और कब, पर संदेश के बारे में कुछ नहीं।',
    zh: '通知只显示“新邮件”，没有发件人和主题。它经过 Apple，Apple 知道有过一条通知以及时间，但不知道邮件的任何内容。',
    ja: '通知に出るのは「新着メッセージ」だけで、差出人も件名も出ません。通知は Apple を経由し、Apple に伝わるのは通知があったことと時刻だけで、メッセージの中身は伝わりません。',
    ko: '알림에는 "새 메시지"만 표시되고 보낸 사람이나 제목은 나오지 않습니다. 알림은 Apple을 거치며, Apple은 알림이 있었다는 사실과 시각만 알 뿐 메시지 내용은 알지 못합니다.',
  },
  'ios.push.denied': {
    pt: 'Os avisos do Shalom Mail estão desligados nos Ajustes do iPhone.', en: 'Shalom Mail notifications are turned off in iPhone Settings.',
    es: 'Los avisos de Shalom Mail están desactivados en los Ajustes del iPhone.', fr: 'Les notifications de Shalom Mail sont désactivées dans les Réglages de l’iPhone.',
    de: 'Mitteilungen von Shalom Mail sind in den iPhone-Einstellungen ausgeschaltet.', it: 'Le notifiche di Shalom Mail sono disattivate nelle Impostazioni dell’iPhone.',
    ru: 'Уведомления Shalom Mail выключены в настройках iPhone.', uk: 'Сповіщення Shalom Mail вимкнено в параметрах iPhone.',
    tr: 'Shalom Mail bildirimleri iPhone Ayarlar’da kapalı.', he: 'ההתראות של Shalom Mail כבויות בהגדרות האייפון.',
    ar: 'إشعارات Shalom Mail مطفأة في إعدادات الـ iPhone.', hi: 'Shalom Mail की सूचनाएँ iPhone की सेटिंग में बंद हैं।',
    zh: 'Shalom Mail 的通知已在 iPhone 设置中关闭。', ja: 'Shalom Mail の通知は iPhone の設定でオフになっています。', ko: 'iPhone 설정에서 Shalom Mail 알림이 꺼져 있습니다.',
  },
  'ios.push.openSettings': {
    pt: 'Abrir os Ajustes', en: 'Open Settings', es: 'Abrir Ajustes', fr: 'Ouvrir les Réglages', de: 'Einstellungen öffnen', it: 'Apri Impostazioni',
    ru: 'Открыть настройки', uk: 'Відкрити параметри', tr: 'Ayarlar’ı aç', he: 'פתיחת ההגדרות', ar: 'فتح الإعدادات', hi: 'सेटिंग खोलें',
    zh: '打开设置', ja: '設定を開く', ko: '설정 열기',
  },
};

export default ios;
export type { Entry, T };
