# Event invitations

`pnpm events invite <slug>` reads the local event Markdown and sends its validated
details to the Worker. D1 supplies recipient emails, tags and opt-outs. No new
database migration or event sync is required. The updated Worker must be deployed
before using the command.

## Configure and preview

Add audience tags and an optional plain-text introduction to frontmatter:

```yaml
inviteTags: [member]
inviteMessage: |-
  Bring a laptop and a task you would like to automate.

  All experience levels are welcome.
```

`inviteTags` selects people matching any listed tag, separately from topic `tags`.
Tags must be unique, lowercase and present in D1. Missing or empty invitation tags
block the command. The event must be published and not yet started.

`inviteMessage` preserves paragraphs and line breaks. Event title, schedule,
location, event page and platform links are added automatically. Do not repeat
the signup link in the introduction. Times use the event timezone or labeled UTC.
Invitation fields are excluded from public event JSON.

The command uses the same `AINOOGA_API_TOKEN` and `AINOOGA_API_URL` as poll commands.
It loads `.env` by default or an explicit ignored environment file. Existing shell
variables take precedence. The API defaults to `https://ainooga.org`.

```sh
pnpm events --env-file .env.prod.local invite 2026-10-17-autonomous-agents --dry-run
```

Dry-run returns recipient count and rendered subject, text and HTML. It sends no
emails, performs no writes and lists no addresses. Review the preview and ensure
the linked event page is available before sending. Remove `--dry-run` to send.
Changing local content changes the next invitation without syncing D1.

## Recipients and delivery

Explicit `event_invites.subscribed=false` excludes a person and all email aliases.
People without a preference and already registered people are included. Newsletter
preferences do not affect event invitations. Emails are trimmed, lowercased and
deduplicated. Each address receives its own message from `noreply@ainooga.org`,
with replies to `contact@ainooga.org`. Subscriptions and participation are unchanged.

Sending returns `{ recipients, accepted, failed }`; failures give a nonzero CLI
exit. Acceptance means provider acceptance, not inbox delivery. Sends run five
at a time with ten-second provider timeouts and no automatic retries. Repeating
the command sends again to the current audience. After a timeout or lost response,
check Cloudflare Email Sending activity before rerunning. Publishing, syncing and
previewing never send invitations.
