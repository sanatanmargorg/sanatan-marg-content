import { getClient, resolveSiteUrl, fetchKeywordOpportunities } from "./lib/gsc.mjs";

async function main() {
  console.log("→ Authenticating with the service-account key ...");
  const client = getClient();

  console.log("→ Resolving your Search Console property ...");
  const siteUrl = await resolveSiteUrl(client);
  console.log(`✅ Connected to: ${siteUrl}\n`);

  console.log("→ Fetching keyword opportunities (content gaps) ...");
  const rows = await fetchKeywordOpportunities(client, siteUrl);

  if (!rows.length) {
    console.log(
      "⚠️  No rows matched the filters yet. This is normal for a new/low-traffic site.\n" +
        "   The generator will use its fallback keyword list until GSC has more data.\n" +
        "   You can loosen filters via GSC_MIN_IMPRESSIONS / GSC_MIN_POSITION in .env.",
    );
    return;
  }

  console.log(`✅ Top ${Math.min(15, rows.length)} keyword opportunities:\n`);
  console.log("   impr   pos    ctr%   keyword");
  console.log("   ----   ----   ----   ---------------------------------");
  for (const r of rows.slice(0, 15)) {
    console.log(
      `   ${String(r.impressions).padStart(4)}   ${r.position.toFixed(1).padStart(4)}   ${(r.ctr * 100).toFixed(1).padStart(4)}   ${r.keyword}`,
    );
  }
  console.log("\n✅ Credentials + permissions are working. You're ready to generate posts.");
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  console.error(
    "Common fixes:\n" +
      " • Enable 'Google Search Console API' in the Cloud project.\n" +
      " • In Search Console → Settings → Users and permissions, add the service-account email as a user.\n" +
      " • Make sure GSC_CREDENTIALS (or GOOGLE_APPLICATION_CREDENTIALS) is set.",
  );
  process.exitCode = 1;
});
