// Vercel serverless function. Holds GITHUB_TOKEN server-side (set in
// Vercel project env vars) — never shipped to the browser. The public
// page POSTs here instead of writing to GitHub directly.
//
// Deletes a company's row from coop-ledger/index.html (the DATA array)
// and from jobapply/applications/APPLICATION_TRACKER.md (the table row) —
// for job postings that got pulled/closed before applying, or that the
// user otherwise wants dropped from tracking.

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "deepmroot";

async function getFile(repo, path) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`GET ${repo}/${path} failed: ${r.status}`);
  const json = await r.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { content, sha: json.sha };
}

async function putFile(repo, path, content, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha,
      branch: "main",
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${repo}/${path} failed: ${r.status} ${t}`);
  }
  return r.json();
}

function removeFromLedgerHtml(content, company) {
  const lines = content.split("\n");
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`company: "${company}"`)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) throw new Error(`Company "${company}" not found in coop-ledger index.html`);

  // The last entry in the DATA array has no trailing comma. If we're
  // removing it, the new last entry (previously second-to-last) needs its
  // trailing comma stripped or the array becomes invalid JS.
  const wasLastEntry = !lines[idx].trim().endsWith(",");
  lines.splice(idx, 1);
  if (wasLastEntry) {
    for (let i = idx - 1; i >= 0; i--) {
      if (lines[i].trim() !== "") {
        lines[i] = lines[i].replace(/,\s*$/, "");
        break;
      }
    }
  }
  return lines.join("\n");
}

function removeFromTrackerMd(content, company) {
  const lines = content.split("\n");
  const filtered = lines.filter((line) => !line.startsWith(`| ${company} |`));
  if (filtered.length === lines.length) {
    throw new Error(`Company "${company}" not found in APPLICATION_TRACKER.md`);
  }
  return filtered.join("\n");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  if (!GITHUB_TOKEN) {
    res.status(500).json({ error: "Server not configured (missing GITHUB_TOKEN)" });
    return;
  }
  try {
    const { company } = req.body || {};
    if (!company) {
      res.status(400).json({ error: "company is required" });
      return;
    }

    const ledger = await getFile("coop-ledger", "index.html");
    const newLedgerContent = removeFromLedgerHtml(ledger.content, company);
    await putFile("coop-ledger", "index.html", newLedgerContent, ledger.sha, `Remove ${company} from tracker`);

    const tracker = await getFile("jobapply", "applications/APPLICATION_TRACKER.md");
    const newTrackerContent = removeFromTrackerMd(tracker.content, company);
    await putFile("jobapply", "applications/APPLICATION_TRACKER.md", newTrackerContent, tracker.sha, `Remove ${company} from tracker`);

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
