# Quote form maintenance

The website is served by the Cloudflare Worker `james-property-solutions-llc`.
Both `jamespropertysolution.com` and `www.jamespropertysolution.com` are custom
domains for that Worker. It publishes static assets from this repository.
The separate `jps-quote-worker.contact-f52.workers.dev` Worker owns the quote
API, database, image storage, SMS verification, and business policy.

`assets/quote-form.js` implements the website's customer quote flow:

1. Submit contact details, a description, and 2–10 photos to `/api/quote`.
2. For `pending_verification`, collect the SMS code and POST it to
   `/api/quote/verify`; resends use `/api/quote/verify/send`.
3. Render a price only for a complete `quote_sent` response.
4. Require explicit cancellation-policy consent before POSTing to
   `/api/quote/confirm` with `policy_agreed: true` and the payment method.
5. After an `accepted` response, offer a text/call link to schedule with Patrick.

API text must be escaped before insertion into HTML. Keep errors outside
`quote-fields`, since that section is hidden during verification and acceptance.
Do not automatically retry timed-out submissions: the server may have received
them. Keep the displayed cancellation terms aligned with the API policy; the
website does not define or alter that policy.

Run checks from the repository root:

```sh
node --test tests/quote-form.test.mjs
node scripts/identity-consistency-guard.mjs --strict --local-only
node scripts/build-site.mjs
npx wrangler deploy --dry-run
```

Regression tests use mocked API responses and do not create production leads,
send SMS, or accept real quotes. Check the live page and external JavaScript
after deployment. Full SMS verification requires a controlled real phone test.

`scripts/build-site.mjs` copies only four public assets to `dist/`. A generated
`.assetsignore` allowlist excludes any stale files. Development files and the
local-only lead finder are not public assets. Build before deploying with
`npx wrangler deploy`; preserve this allowlist when adding tooling.
