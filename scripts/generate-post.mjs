import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getClient, resolveSiteUrl, fetchKeywordOpportunities } from "./lib/gsc.mjs";
import { generateArticle, slugify } from "./lib/generate.mjs";
import { generateCoverPng } from "./lib/cover.mjs";
import { SITE_URL, REPO, POST_LANG, HINDI_EVERY, COVER_IMAGE } from "./config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARTICLES_DIR = path.join(ROOT, "articles");
const IMAGES_DIR = path.join(ROOT, "images");
const LEDGER = path.join(ROOT, "data", "used-keywords.json");
const PREVIEW_DIR = path.join(ROOT, "_preview");

const DRY = process.argv.includes("--dry-run");
const kwFlagIdx = process.argv.indexOf("--keyword");
const FORCED_KEYWORD = kwFlagIdx !== -1 ? process.argv[kwFlagIdx + 1] : null;
const langFlagIdx = process.argv.indexOf("--lang");
const RUN_POST_LANG = langFlagIdx !== -1 ? process.argv[langFlagIdx + 1] : POST_LANG;

const FALLBACK_KEYWORDS = {
  en: [
    "how to do morning puja at home",
    "hanuman chalisa meaning and benefits",
    "what is panchang and how to read it",
    "significance of japa mala in hinduism",
    "bhagavad gita key teachings for daily life",
    "how to observe ekadashi vrat",
  ],
  hi: [
    "घर पर सुबह की पूजा कैसे करें",
    "हनुमान चालीसा का अर्थ और लाभ",
    "पंचांग क्या है और कैसे पढ़ें",
    "जप माला का महत्व",
    "भगवद् गीता के प्रमुख उपदेश",
    "एकादशी व्रत कैसे करें",
  ],
};

function detectLang(text) {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  if (/[ఀ-౿]/.test(text)) return null;
  return "en";
}

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch {
    return [];
  }
}

function existingSlugs() {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith(".md")) out.push(prefix + entry.name.replace(/\.md$/, ""));
    }
  };
  walk(ARTICLES_DIR, "");
  return out;
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function trailingEnglish(ledger) {
  let n = 0;
  for (let i = ledger.length - 1; i >= 0; i--) {
    if (ledger[i].lang === "hi") break;
    n++;
  }
  return n;
}

function resolveRunLang(ledger) {
  if (RUN_POST_LANG === "en" || RUN_POST_LANG === "hi") return RUN_POST_LANG;
  return trailingEnglish(ledger) >= HINDI_EVERY ? "hi" : "auto";
}

async function pickKeyword(ledger, mode) {
  if (FORCED_KEYWORD) {
    const lang = mode !== "auto" ? mode : detectLang(FORCED_KEYWORD) || "en";
    return { keyword: FORCED_KEYWORD, related: [], lang };
  }

  const used = new Set(ledger.map((e) => normalize(e.keyword)));
  let opportunities = [];
  try {
    const client = getClient();
    const siteUrl = await resolveSiteUrl(client);
    console.log(`[gsc] property: ${siteUrl}`);
    opportunities = await fetchKeywordOpportunities(client, siteUrl);
    console.log(`[gsc] ${opportunities.length} candidate queries after filtering`);
  } catch (err) {
    console.warn(`[gsc] could not fetch keywords (${err.message}); using fallback list.`);
  }

  const fresh = opportunities
    .map((o) => ({ ...o, lang: detectLang(o.keyword) }))
    .filter((o) => o.lang && !used.has(normalize(o.keyword)))
    .filter((o) => mode === "auto" || o.lang === mode);

  if (fresh.length) {
    const top = fresh[0];
    console.log(
      `[pick] "${top.keyword}" [${top.lang}]  (impr=${top.impressions}, pos=${top.position.toFixed(1)}, ctr=${(top.ctr * 100).toFixed(1)}%)`,
    );
    const related = fresh
      .filter((o) => o.lang === top.lang)
      .slice(1, 6)
      .map((o) => o.keyword);
    return { keyword: top.keyword, related, lang: top.lang };
  }

  const lang = mode === "hi" ? "hi" : "en";
  const fallback = FALLBACK_KEYWORDS[lang].find((k) => !used.has(normalize(k)));
  if (!fallback) throw new Error("No unused keywords left (GSC + fallback exhausted).");
  console.log(`[pick] fallback keyword [${lang}]: "${fallback}"`);
  return { keyword: fallback, related: [], lang };
}

function uniqueSlug(base, taken) {
  let slug = base || "post";
  let i = 2;
  while (taken.includes(slug)) slug = `${base}-${i++}`;
  return slug;
}

function writeFileEnsured(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set.");

  const ledger = readLedger();
  const slugs = existingSlugs();

  const mode = resolveRunLang(ledger);
  if (mode === "hi" && RUN_POST_LANG === "auto") {
    console.log(
      `[lang] ${trailingEnglish(ledger)} English post(s) since the last Hindi one → forcing Hindi (1 per ${HINDI_EVERY})`,
    );
  }
  const { keyword, related, lang } = await pickKeyword(ledger, mode);

  const sameLangSlugs = slugs.filter((sl) =>
    lang === "hi" ? sl.startsWith("hi/") : !sl.startsWith("hi/"),
  );

  console.log(`[openai] generating ${lang} article for "${keyword}" ...`);
  const article = await generateArticle({
    keyword,
    relatedKeywords: related,
    existingSlugs: sameLangSlugs,
    lang,
  });

  const base = slugify(article.slug || "") || slugify(article.title) || `post-${Date.now()}`;
  const slug = uniqueSlug(lang === "hi" ? `hi/${base}` : base, slugs);

  let coverImage;
  if (COVER_IMAGE) {
    const imgBuf = generateCoverPng(article.title, { category: article.category });
    const rel = `${slug}.png`;
    if (DRY) {
      writeFileEnsured(path.join(PREVIEW_DIR, rel), imgBuf);
    } else {
      writeFileEnsured(path.join(IMAGES_DIR, rel), imgBuf);
      coverImage = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.name}/${REPO.branch}/images/${rel}`;
    }
  }

  const frontmatter = {
    title: article.title,
    description: article.description,
    date: new Date().toISOString().slice(0, 10),
    author: "Sanatan Marg",
    category: article.category,
    tags: article.tags,
    lang,
    ...(coverImage ? { coverImage } : {}),
  };

  const fileContents = matter.stringify(article.body_markdown.trim() + "\n", frontmatter);
  const urlPath = `${SITE_URL}/blog/${slug}`;

  if (DRY) {
    writeFileEnsured(path.join(PREVIEW_DIR, `${slug}.md`), fileContents);
    console.log(`\n✅ DRY RUN — wrote preview for _preview/${slug}.md`);
    console.log(`   Lang:  ${lang}`);
    console.log(`   Title: ${article.title}`);
    console.log(`   URL:   ${urlPath}`);
    console.log(`   Words: ~${article.body_markdown.split(/\s+/).length}`);
    return;
  }

  writeFileEnsured(path.join(ARTICLES_DIR, `${slug}.md`), fileContents);
  ledger.push({ keyword, slug, lang, date: frontmatter.date });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");

  console.log(`\n✅ Wrote articles/${slug}.md`);
  console.log(`   Live (within ~1h): ${urlPath}`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.stack || err.message}`);
  process.exitCode = 1;
});
