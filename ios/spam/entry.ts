// A regra de spam do aparelho (shared/spam.ts), a mesma do site e do CLI, empacotada para o JavaScriptCore do
// app. Gerado por scripts/ios-spam.mjs em ios/ShalomMail/Resources/spam.js.
import { contentScore, SPAM_THRESHOLD, type Readable } from '../../shared/spam';

(globalThis as { shalomSpam?: unknown }).shalomSpam = (m: Readable) => ({ spam: contentScore(m).score >= SPAM_THRESHOLD });
