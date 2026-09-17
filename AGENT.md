# AGENT.md — coop-ledger (handoff)

Last updated 2026-09-17. This repo is one of **three** surfaces in a larger
job-application tracking system for Mandeep Singh. **The canonical, full
system doc lives in the sibling repo:**
https://github.com/deepmroot/jobapply/blob/main/AGENT.md — read that first.
This file covers only what's specific to *this* repo, for when you're working
from a coop-ledger-only checkout.

## What this repo is

The public-facing static site for the tracker, deployed to Vercel at
**https://coop-ledger-five.vercel.app**. `index.html` holds the UI (Tailwind
CDN, no build step) and an embedded `DATA` array that's the client-side
mirror of `jobapply/applications/APPLICATION_TRACKER.md`. `applications/`
holds copies of the generated resume/cover-letter PDFs (the real source is
generated in `jobapply` on node02 — see that repo's AGENT.md §1 — and must be
copied here manually, or the public resume/cover-letter links 404).

## Serverless functions (`api/`)

Two Vercel serverless functions, both requiring the `GITHUB_TOKEN` env var
(set in the Vercel project settings, not committed anywhere):

- **`mark-applied.js`** — POST `{company, evidence, date, emailLink?}`.
  Writes status/date/evidence back to both this repo's `index.html` and
  `jobapply/applications/APPLICATION_TRACKER.md` via the GitHub Contents API.
  Used by both the "check email" and "no confirmation email" buttons.
- **`remove-job.js`** — POST `{company}`. Deletes that company's row from
  both files (used by the Remove button). Handles the DATA-array
  trailing-comma edge case when the removed entry was the last one.

Both match rows by exact `company` string — **every company name in `DATA`
must be globally unique**, even across two postings at the same real company
(disambiguate with a suffix, e.g. `"Visier Solutions (Test Developer)"`).

## Client-side logic worth knowing before touching `index.html`

- `MATCH_TERMS` (Gmail verification per company) must be a **single word**,
  never a phrase mirroring the full legal company name — real confirmation
  emails often shorten it, and a multi-word term silently matches nothing.
  This was a real, previously-undetected bug (fixed 2026-09-16): the
  check-email button had never successfully matched for any multi-word
  company before the fix.
- Google OAuth (`GOOGLE_CLIENT_ID` in the `<script>` block) is in **Testing**
  mode in Google Cloud Console — mandeepsinghwani@gmail.com must stay listed
  as a test user or sign-in breaks with `access_denied`. Authorized JS
  origins: `https://deepmroot.github.io` and
  `https://coop-ledger-five.vercel.app`.
- Design system: Tailwind CDN, slate background, sky-blue/emerald/amber/violet
  accents, Fraunces + IBM Plex Sans/Mono fonts. A prior custom-CSS dark theme
  (amber-on-near-black) was rejected by the user as "hard to look at" — don't
  reintroduce custom CSS or a harsher palette here.
- Status tiers: Prepared → Applied → Interview, each with its own stat tile,
  section, and pill color. If a 4th tier is ever needed (Offer/Rejected),
  mirror the pattern used for Interview in all three system surfaces, not
  just this repo.

## Deploy

Push to `main` — Vercel auto-deploys. No build step, no CI config needed.
Deploys usually take 10-30s to propagate; a refresh immediately after a push
can briefly show the pre-deploy version (not a bug, just propagation lag).
