import fs from "node:fs";
import { JWT } from "google-auth-library";
import { GSC } from "../config.mjs";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function loadCredentials() {
  const raw = process.env.GSC_CREDENTIALS;
  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return JSON.parse(fs.readFileSync(path, "utf8"));
  throw new Error(
    "No Search Console credentials. Set GSC_CREDENTIALS (JSON) or GOOGLE_APPLICATION_CREDENTIALS (file path).",
  );
}

async function authedGet(client, url) {
  const { token } = await client.getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GSC GET ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function authedPost(client, url, body) {
  const { token } = await client.getAccessToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GSC POST ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

export function getClient() {
  const creds = loadCredentials();
  return new JWT({ email: creds.client_email, key: creds.private_key, scopes: [SCOPE] });
}

export async function resolveSiteUrl(client) {
  if (GSC.siteUrl) return GSC.siteUrl;
  const { siteEntry = [] } = await authedGet(
    client,
    "https://www.googleapis.com/webmasters/v3/sites",
  );
  const verified = siteEntry.filter((s) => s.permissionLevel !== "siteUnverifiedUser");
  const match =
    verified.find((s) => s.siteUrl.includes("sanatanmarg.org")) || verified[0];
  if (!match) {
    throw new Error(
      "The service account has no Search Console properties. Add its email as a user in Search Console → Settings → Users and permissions.",
    );
  }
  return match.siteUrl;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

export async function fetchKeywordOpportunities(client, siteUrl) {
  const lookback = GSC.lookbackDays;
  const minImpr = GSC.minImpressions;
  const minPos = GSC.minPosition;
  const maxPos = GSC.maxPosition;

  const data = await authedPost(
    client,
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      startDate: isoDaysAgo(lookback),
      endDate: isoDaysAgo(1),
      dimensions: ["query"],
      rowLimit: 500,
      dataState: "all",
    },
  );

  const rows = (data.rows || [])
    .map((r) => ({
      keyword: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }))
    .filter(
      (r) => r.impressions >= minImpr && r.position >= minPos && r.position <= maxPos,
    );

  for (const r of rows) r.score = r.impressions * Math.min(r.position, 20);
  rows.sort((a, b) => b.score - a.score);
  return rows;
}
