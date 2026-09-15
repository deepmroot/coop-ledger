// Vercel serverless function. Holds GITHUB_TOKEN server-side (set in
// Vercel project env vars) — never shipped to the browser. The public
// page POSTs here instead of writing to GitHub directly.

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

function escapeJsString(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function updateLedgerHtml(content, company, status, date, evidence, emailLink) {
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    if (line.includes(`company: "${company}"`)) {
      found = true;
      let l = line;
      // (?:[^"\\]|\\.)* correctly skips escaped quotes (\") inside the string
      // instead of stopping at them — a plain [^"]* treats \" as a terminator
      // and truncates mid-string, corrupting the line.
      const STR = '(?:[^"\\\\]|\\\\.)*';
      l = l.replace(new RegExp(`status:\\s*"${STR}"`), `status: "${status}"`);
      l = l.replace(new RegExp(`date:\\s*"${STR}"`), `date: "${date}"`);
      l = l.replace(new RegExp(`evidence:\\s*"${STR}"`), `evidence: "${escapeJsString(evidence)}"`);
      if (emailLink) {
        const emailLinkRe = new RegExp(`emailLink:\\s*"${STR}"`);
        if (emailLinkRe.test(l)) {
          l = l.replace(emailLinkRe, `emailLink: "${emailLink}"`);
        } else {
          l = l.replace(/\s*\},\s*$/, `, emailLink: "${emailLink}" },`);
        }
      }
      return l;
    }
    return line;
  });
  if (!found) throw new Error(`Company "${company}" not found in coop-ledger index.html`);
  return updated.join("\n");
}

function updateTrackerMd(content, company, status, date, evidence) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`| ${company} |`)) {
      found = true;
      const parts = line.split("|");
      // [0]="" [1]=Company [2]=Role [3]=Status [4]=Date [5]=Evidence [6]=Files [7]=""
      parts[3] = ` **${label}** `;
      parts[4] = ` ${date} `;
      parts[5] = ` ${evidence} `;
      return parts.join("|");
    }
    return line;
  });
  if (!found) throw new Error(`Company "${company}" not found in APPLICATION_TRACKER.md`);
  return updated.join("\n");
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
    const { company, evidence, date, emailLink } = req.body || {};
    if (!company || !evidence || !date) {
      res.status(400).json({ error: "company, evidence, and date are required" });
      return;
    }

    const ledger = await getFile("coop-ledger", "index.html");
    const newLedgerContent = updateLedgerHtml(ledger.content, company, "applied", date, evidence, emailLink || "");
    await putFile("coop-ledger", "index.html", newLedgerContent, ledger.sha, `Mark ${company} as applied`);

    const tracker = await getFile("jobapply", "applications/APPLICATION_TRACKER.md");
    const newTrackerContent = updateTrackerMd(tracker.content, company, "applied", date, evidence);
    await putFile("jobapply", "applications/APPLICATION_TRACKER.md", newTrackerContent, tracker.sha, `Mark ${company} as applied`);

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
