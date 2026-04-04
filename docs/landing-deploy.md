# Landing Deployment

This repository now includes a minimal Cloudflare `wrangler` setup for the static landing page.

## Files

- `wrangler.toml` configures the Worker and binds the static assets directory.
- `src/landing-worker.js` serves `landing/landing.html` at `/`.
- `landing/landing.html` remains the source of truth for the page content.

## Local preview

```bash
npx wrangler dev
```

Then open the local URL that `wrangler` prints.

## Deploy

```bash
npx wrangler deploy
```

## Behavior

- `/` and `/index.html` return `landing/landing.html`
- other paths are served from the `landing/` asset directory
- HTML responses are marked with `Cache-Control: no-cache, max-age=0, must-revalidate`

## Notes

- If you want a custom domain, add it in Cloudflare after the first deploy.
- If the landing page starts referencing icons or images, place them in `landing/` so they are published with the asset bundle.
