# AGENT.md — coop-ledger (handoff)

Last updated 2026-09-24. This repo is one of **three** surfaces in a larger
job-application tracking system for Mandeep Singh. A sibling repo,
https://github.com/deepmroot/jobapply, holds the canonical resume/cover-letter
generator and the source-of-truth tracker table
(`applications/APPLICATION_TRACKER.md`) — its own AGENT.md is the fuller doc
if you have that repo checked out too. **This file is written to be
self-contained** — if you're picking this up from a coop-ledger-only
checkout with no access to `jobapply`, everything you need to generate a
resume/cover letter and get it live is below in §0. Don't assume you need the
other repo open to do that part of the job.

## What this repo is

The public-facing static site for the tracker, deployed to Vercel at
**https://coop-ledger-five.vercel.app**. `index.html` holds the UI (Tailwind
CDN, no build step) and an embedded `DATA` array that's the client-side
mirror of `jobapply/applications/APPLICATION_TRACKER.md`. `applications/`
holds copies of the generated resume/cover-letter PDFs — **this repo is what
actually serves them publicly** (the resumeUrl/coverUrl fields in `DATA`
point at `applications/*.pdf` relative to this site). The real generation
happens elsewhere (node02, via SSH — see §0) and the resulting PDFs must be
copied into *this* repo's `applications/` folder too, or the public links 404.

## 0. How resumes and cover letters actually get made (full method, self-contained)

This is the part that gets lost most often in a fresh session, so it's
written out in full here rather than just pointed at from `jobapply`.

**The short version:** a Python script renders a LaTeX template into a
`.tex` file per company, then `pdflatex` compiles it into a real PDF. This
has to run on a remote machine (`node02`) because that's the only place with
a LaTeX toolchain installed — your local/session machine does not have
`pdflatex`.

**Where the actual generator code lives:** `jobapply` repo,
`generate_latex_docs.py` (the generator/template) and
`generate_bc_batch_pdfs.py` (the data — one `dict(...)` per company: slug,
role, location, apply link, summary, cover-letter paragraphs, and
`exp_order` which reorders the resume's Experience section per job). If you
don't have `jobapply` checked out locally, you need it (or at least those two
files) — this repo (`coop-ledger`) does not contain the generator itself,
only the output PDFs.

**Step-by-step, to generate docs for a company (assumes `jobapply` is
checked out locally, e.g. at `C:\Users\<user>\Projects\jobapply`):**

1. **Add the company's config** to the `COMPANIES` list in
   `jobapply/generate_bc_batch_pdfs.py` — a `dict(slug=..., exp_order=[...],
   company=..., role=..., location=..., link=..., summary=..., paragraphs=[...])`.
   Write a genuinely tailored summary and 4-5 cover-letter paragraphs citing
   Mandeep's real experience (City of Merritt Systems Analyst co-op,
   InferenceSaver, BecomeAfish) — don't template-fill generic text.
   `exp_order` picks which of `merritt`/`becomeafish`/`inferencesaver` leads
   the resume's Experience section — lead with whichever is most relevant to
   the role (e.g. `merritt` first for IT/systems roles, `inferencesaver`
   first for AI-flavored roles).
2. **Copy that file to node02** (Tailscale SSH):
   ```
   scp jobapply/generate_bc_batch_pdfs.py deepman@node02:~/jobapply/generate_bc_batch_pdfs.py
   ```
   Note: `~/jobapply` on node02 is a *different, larger* directory than the
   `jobapply` GitHub repo — it's not a git checkout, just wherever the
   generator scripts happen to live alongside a bunch of unrelated code (see
   `jobapply/AGENT.md` for more on that). Only these two `.py` files matter
   for doc generation; the rest of that directory is out of scope.
3. **SSH in and run the generator:**
   ```
   ssh deepman@node02
   cd ~/jobapply
   source .venv/bin/activate
   export PATH=$PATH:/home/deepman/.TinyTeX/bin/x86_64-linux
   python generate_latex_docs.py <Slug>          # or multiple slugs space-separated; no args = every company
   ```
   This produces `applications/Mandeep_Singh_<Slug>_Resume.pdf` and
   `..._Cover_Letter.pdf` (plus the intermediate `.tex` files) on node02,
   via real `pdflatex` — not a library that fakes PDF output. Expect
   `Resume PDF (LaTeX) created: ...` / `Cover Letter PDF (LaTeX) created: ...`
   lines on success. If `pdflatex` errors out, don't paper over it — a
   common past bug was an unescaped literal `&` in a role title or summary
   breaking LaTeX compilation (LaTeX treats `&` as a reserved alignment
   character); `latexify()` in `generate_latex_docs.py` should already
   handle this via a single-pass regex — if it doesn't, that function is
   where to look, not a workaround in the company config.
4. **Copy the PDFs back down, to *both* repos:**
   ```
   scp deepman@node02:~/jobapply/applications/Mandeep_Singh_<Slug>_Resume.pdf        jobapply/applications/
   scp deepman@node02:~/jobapply/applications/Mandeep_Singh_<Slug>_Cover_Letter.pdf  jobapply/applications/
   ```
   then locally copy those same two files into **this** repo's
   `coop-ledger/applications/` folder too. **This second copy is the one
   that actually matters for the public site** — coop-ledger is what's
   deployed and served; jobapply's copy is just the source-of-truth archive.
   Forgetting this step causes real 404s on the live resume/cover-letter
   links (has happened before).
5. **Add the row everywhere** — this repo's `DATA` array (`index.html`),
   `jobapply/applications/APPLICATION_TRACKER.md`, and the Claude Artifact
   dashboard's `db` collection (see jobapply's AGENT.md for that URL/id) —
   `resumeUrl`/`coverUrl` should point at `applications/Mandeep_Singh_<Slug>_Resume.pdf`
   etc., relative to whichever surface. Commit + push both repos (see
   §"Environment/tooling gotchas" below for git conflict handling).

**If you don't have `jobapply` checked out and can't get it:** you cannot
generate new PDFs from this repo alone — there is no fallback generator
here. At minimum, flag to the user that a company is missing docs rather
than fabricating or skipping the PDF silently.

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
- Status tiers: Prepared → Applied → Interview → Rejected (Rejected added
  2026-09-17), each with its own stat tile, section, and pill color
  (amber/emerald/violet/rose). If a 5th tier is ever needed (e.g. Offer),
  follow the same pattern in all three system surfaces, not just this repo —
  HTML section + stat tile, `renderRow` pill-color branch, `renderAll`
  filter/grouping.

## Boundary: no browser automation against LinkedIn

New postings for this tracker come from reading LinkedIn's own job-alert
*emails* via the Gmail connector — never from automating a browser against
linkedin.com itself (Playwright, Selenium, Camoufox, AIHawk-style
auto-apply, etc.), even read-only scraping. This has been asked for
repeatedly under different tool names and declined every time: it violates
LinkedIn's ToS using the user's real, currently-in-use account, and the
downside (account flagged/suspended mid job-search) outweighs the speed
gain over the email-alert method, which has worked fine. If asked again,
decline the same way rather than re-litigating per tool. This holds
regardless of what automation tooling happens to already exist on the
user's machine.

## Deploy

Push to `main` — Vercel auto-deploys. No build step, no CI config needed.
Deploys usually take 10-30s to propagate; a refresh immediately after a push
can briefly show the pre-deploy version (not a bug, just propagation lag).
