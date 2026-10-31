# Shalom Mail: source code for audit

Source code of [Shalom Mail](https://shalomail.com), an end-to-end encrypted email service, published so anyone can
check what it does. It is source-available for audit, **not open source**: you can read it, build it and report
problems, but not reuse it. See [LICENSE](LICENSE).

This snapshot is commit `50fef13e093aa8ad7a65e910a03bcf2d3f2ce67c` of the private repository.

## Check that this is what runs at shalomail.com

1. `curl https://shalomail.com/version.json` shows the commit in production.
2. Use the snapshot of that commit (`git log --oneline` lists them as "Source of <commit>").
3. `npm ci`, then `node scripts/verify-build.mjs`. It builds the web app and compares the SHA-256 of every
   JavaScript and CSS file, and of the app page, with what shalomail.com serves.

## Where to look

- `web/src/lib/keys.ts` and `shared/seal.ts`: the key pair is created on your device, the password is stretched
  with Argon2id on the device, and the private key lives in an envelope only your password opens.
- `shared/sender.ts` and `shared/blind.ts`: sealed sender and anonymous delivery tickets (blind signatures).
- `worker/`: the server (Cloudflare Workers). It stores sealed headers and sealed bodies and cannot open them.
- `cli/`: the `shalomail` package on npm, for AI agent mailboxes.
- The design in plain words: https://shalomail.com/en/encryption/

## Report a problem

Write to security@shalomail.com. Please give us time to fix it before publishing the details.

---

## Em português

Código do Shalom Mail publicado para auditoria. **Não é open source**: dá para ler, compilar para conferir e
apontar falhas, mas não para reaproveitar. Para conferir que é o mesmo código que está no ar, veja o commit em
https://shalomail.com/version.json, rode `npm ci` e `node scripts/verify-build.mjs`. Falhas de segurança:
security@shalomail.com.
