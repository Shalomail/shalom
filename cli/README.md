# shalom

Give your AI agents a real, end-to-end encrypted email address.

`shalom` is the command line for [Shalom Mail](https://shalomail.com). Each agent gets its own `@shalomail.com` mailbox. It receives, reads and sends real email, from Shalom or from anywhere, and every command speaks JSON. The mailbox's private key is created on the agent's machine and never leaves it: the server stores mail sealed and cannot read it.

## Start

```sh
npm install -g shalomail       # Node.js 20 or newer
shalom login                   # opens shalomail.com to connect this terminal
shalom agents create yourname-bot   # creates yourname-bot@shalomail.com
```

No global install? `npx shalomail <command>` works anywhere, for example `npx shalomail login`. The command answers to both `shalom` and `shalomail`.

On a machine without a browser (SSH, server), `shalom login --no-browser` prints the link and the code: open it on any device where you are signed in to Shalom and confirm. For CI, `shalom login --key -` reads an API key created on the AI agents page from standard input (for example `printf %s "$SHALOM_API_KEY" | shalom login --key -`), so it stays out of your shell history; `SHALOM_API_KEY` in the environment also works.

## Use it from code

```js
import { Agent } from 'shalomail';

const agent = Agent.fromToken(process.env.SHALOM_AGENT_TOKEN);
for await (const msg of agent.watch()) {
  await agent.reply(msg.id, { text: `Got it: ${msg.subject}` });
}
```

Full SDK and HTTP API reference: https://shalomail.com/developers/

## Read, reply and send

```sh
shalom inbox --json
shalom read 3f9c2a1b --json
shalom reply 3f9c2a1b --text "Got it, thanks."
shalom send --to ana@example.com --subject "Weekly report" \
  --text-file report.md --attach report.pdf
```

Ids can be shortened to their first 8 characters. Text can also come from standard input.

## React to every new email

```sh
shalom watch --exec "python agent.py" --mark-read
```

`watch` waits for new mail and runs your program once per message, with the message as JSON on standard input: `id`, `from`, `to`, `cc`, `subject`, `date`, `text`, `html`, `messageId`, `verifiedSender` and `attachments`. The environment also gets `SHALOM_MESSAGE_ID`, `SHALOM_FROM` and `SHALOM_SUBJECT`. With `--mark-read`, a message is marked read only after your program exits with 0, and messages still unread when `watch` restarts are handed to it again. In the SDK, `agent.watch({ includeUnread: true })` does the same.

```python
# agent.py
import json, subprocess, sys
msg = json.load(sys.stdin)
answer = f"Hi {msg['from']['name'] or 'there'}, we received: {msg['subject']}"
subprocess.run(["shalom", "reply", msg["id"], "--text", answer], check=True)
```

## Run it on a server

```sh
shalom agents export yourname-bot@shalomail.com   # prints SHALOM_AGENT_TOKEN
SHALOM_AGENT_TOKEN=shalom_agent_... shalom inbox --json
```

Store the token as a secret: it contains the mailbox's private key. On servers, prefer mounting it as a file and pointing `SHALOM_AGENT_TOKEN_FILE` to it; programs started by `watch --exec` never receive it.

## Commands

| Command | What it does |
| --- | --- |
| `shalom login` | Connects this terminal to your account in the browser (`--no-browser`, `--key`) |
| `shalom agents list` | Lists your agent mailboxes and your plan |
| `shalom agents create <name>` | Creates `<name>@shalomail.com`, with the private key on this machine |
| `shalom agents delete <address>` | Deletes the mailbox and all its mail (needs the mailbox saved on this machine); the address stays reserved for you |
| `shalom agents rotate <address>` | Issues a new API key for the mailbox, sealed to its private key |
| `shalom agents export <address>` | Prints `SHALOM_AGENT_TOKEN` |
| `shalom agents import <token>` | Saves an exported mailbox on this machine (`--yes` to replace one with other keys) |
| `shalom plan` / `shalom upgrade` | Shows your plan, or opens the plans page in the app |
| `shalom inbox` | Lists messages (`--folder`, `--limit`, `--unread`) |
| `shalom read <id>` | Opens a message (`--save-attachments <dir>`) |
| `shalom send` | Sends a message (`--to`, `--cc`, `--bcc`, `--subject`, `--text`, `--text-file`, `--html-file`, `--attach`) |
| `shalom reply <id>` | Replies in the same thread (`--all`) |
| `shalom move <id> --to <folder>` | Moves to inbox, archive, spam or trash |
| `shalom mark <id>` | `--read`, `--unread`, `--star`, `--unstar` |
| `shalom watch` | Waits for new mail (`--exec`, `--interval`, `--mark-read`) |

Every command accepts `--json`, `--as <address>` to pick the mailbox, and `--api <url>`.

## Security

- Each mailbox's private key stays in `~/.config/shalom` (folder 700, files 600) or in your `SHALOM_AGENT_TOKEN`.
- Your account key creates agent mailboxes and shows your plan. It cannot read or send for a mailbox, cannot delete one without that mailbox's own key, and cannot touch billing: plans are changed in the app.
- The keys of shalomail.com are built into the package, so a swapped server or an intercepted connection cannot fake a verified sender.
- Between Shalom addresses, mail is sealed end to end and the sender is verified. To other providers it goes as regular email.
- The encryption keys of Shalom contacts are pinned on first use, when you send to them or receive from them. If one changes, mail from that contact is no longer marked as verified (`verifiedSender: false`, `keyChanged: true`) and sending stops until you confirm with `--trust-new-key`.
- Text from emails (sender, subject, body, attachment names) is printed without terminal control characters, so a message cannot change your terminal.

## Plans

Free: 2 agent mailboxes. Agents 5: up to 5 for US$ 4.99 a month. Agents 12: up to 12 for US$ 9.99 a month. Unlimited: no mailbox limit, up to 250 new mailboxes a day, for US$ 49.90 a month. Subscribe on the AI agents page of the app (`shalom upgrade` opens it).

Docs: https://shalomail.com/en/agents/
