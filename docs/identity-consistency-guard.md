# Identity Consistency Guard

Use this guard before finalizing contact/SEO/schema edits.

## What It Checks
- Business name appears as `James Property Solutions LLC`
- Visible phone appears as `(463) 324-9549`
- `tel:` links use only `tel:+14633249549`
- `sms:` links use only `sms:+14633249549`
- `mailto:` links use only `mailto:contact@jamespropertysolution.com`
- JSON-LD includes `"telephone": "+14633249549"`
- Old phone variants are absent
- Live identity signals match between:
  - `https://jamespropertysolution.com/`
  - `https://www.jamespropertysolution.com/`

## Run
```powershell
node .\scripts\identity-consistency-guard.mjs
```

## Result Behavior
- Exit `0`: all checks passed
- Exit `1`: one or more mismatches found (printed as explicit errors)

## Typical Use
```powershell
git diff -- index.html
node .\scripts\identity-consistency-guard.mjs
```
