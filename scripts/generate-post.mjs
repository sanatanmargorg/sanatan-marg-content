import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getClient, resolveSiteUrl, fetchKeywordOpportunities } from "./lib/gsc.mjs";
import { generateArticle, slugify, mashedTokens } from "./lib/generate.mjs";
import { generateCoverPng } from "./lib/cover.mjs";
import { isOnTopic } from "./lib/relevance.mjs";
import { SITE_URL, REPO, POST_LANG, HINDI_EVERY, COVER_IMAGE, DEDUP } from "./config.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ARTICLES_DIR = path.join(ROOT, "articles");
const IMAGES_DIR = path.join(ROOT, "images");
const LEDGER_DIR = path.join(ROOT, "data", "used-keywords");
const PENDING_DIR = path.join(ROOT, ".pending-ledger");
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

// The ledger is one JSON file per published post rather than a single array, so that the daily
// review PRs waiting in the queue never collide: each PR adds exactly one new file and merges
// cleanly whatever order they're merged in. Filenames are date-prefixed, so sorting by name
// yields chronological order — trailingEnglish() depends on that.
function readEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return null; // a half-written or hand-edited entry shouldn't kill the run
      }
    })
    .filter((e) => e && typeof e.keyword === "string");
}

function readLedger() {
  const entries = readEntries(LEDGER_DIR);
  // Keywords claimed by daily PRs that are open but not merged yet. Every run branches from
  // main, so without these the run can't see what yesterday's un-merged PR already took and
  // would re-pick the same top query. The workflow drops them into a gitignored scratch dir.
  const claimed = new Set(entries.map((e) => normalize(e.keyword)));
  for (const entry of readEntries(PENDING_DIR)) {
    if (claimed.has(normalize(entry.keyword))) continue;
    claimed.add(normalize(entry.keyword));
    entries.push(entry);
  }
  return entries;
}

function existingPosts() {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith(".md")) {
        const slug = prefix + entry.name.replace(/\.md$/, "");
        let title = slug;
        try {
          const parsed = matter(fs.readFileSync(path.join(dir, entry.name), "utf8"));
          if (parsed.data?.title) title = String(parsed.data.title);
        } catch {
          // fall back to the slug as the title if frontmatter can't be parsed
        }
        out.push({ slug, title });
      }
    }
  };
  walk(ARTICLES_DIR, "");
  return out;
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// Words that describe how someone searches, not WHAT they searched for. Two keywords that differ
// only by these are the same intent (e.g. "sanatan app" vs "free sanatan app download").
const TOPIC_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with", "from", "by",
  "how", "what", "why", "when", "which", "do", "does", "is", "are", "can", "should",
  "your", "my", "me", "i", "best", "top", "good", "free", "online", "download", "downloads",
  "install", "app", "apps", "application", "guide", "guides", "near", "vs",
]);

// Significant topic words for a keyword: lowercased, stopwords and very short words dropped.
// Devanagari tokens are kept whole (Hindi keywords rarely collide with English ones).
function topicTokens(keyword) {
  return normalize(keyword)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((t) => !TOPIC_STOPWORDS.has(t))
    .filter((t) => t.length >= 3 || /[ऀ-ॿ]/.test(t));
}

// Two content words are "the same" if equal, or if the shorter (>=6 chars) is a full prefix of
// the longer — catches spelling variants ("sanatan"/"sanatani", "hanuman"/"hanumanji") without
// collapsing merely similar words ("panchang"/"panchami", neither of which prefixes the other).
function tokenMatch(x, y) {
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 6) return false;
  return x.startsWith(y) || y.startsWith(x);
}

// True when every significant word of `sig` is a substring of some mashed token (e.g. the words
// of "sanatan app" both live inside "hindusanatanapp").
function mashedContains(mashed, sig) {
  if (!sig.length) return false;
  return mashed.some((m) => sig.every((t) => m.includes(t)));
}

// "X app" discovery queries: matches "app", "apps", "application" as a standalone word.
const APP_INTENT = /\b(?:apps?|application)\b/i;

// Return the prior keyword whose topic the candidate duplicates, or null if it's genuinely new.
function clustersWith(keyword, priorKeywords) {
  const a = topicTokens(keyword);
  const aMashed = mashedTokens(keyword);
  const aIsApp = APP_INTENT.test(keyword);
  for (const prior of priorKeywords) {
    const b = topicTokens(prior);
    if (a.length && b.length) {
      const inter = a.filter((x) => b.some((y) => tokenMatch(x, y))).length;
      const union = a.length + b.length - inter;
      const jaccard = union ? inter / union : 0;
      const smaller = Math.min(a.length, b.length);
      const subset = inter === smaller && smaller >= 2;
      // Two "find me an app" queries about the same brand/topic ("sanatan app" vs "sanatana
      // dharma app") are one intent even when an extra descriptor word drags the Jaccard down.
      const appDup = aIsApp && APP_INTENT.test(prior) && inter >= 1;
      if (jaccard >= DEDUP.jaccard || subset || appDup) return prior;
    }
    if (mashedContains(aMashed, b) || mashedContains(mashedTokens(prior), a)) return prior;
  }
  return null;
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
    // A human picked this one explicitly, so honour it — but warn if it looks off-theme so a
    // typo or a stray copy-paste doesn't silently publish an unrelated article.
    if (!isOnTopic(FORCED_KEYWORD)) {
      console.warn(
        `[relevance] WARNING: forced keyword "${FORCED_KEYWORD}" does not look on-topic for Sanatan Dharma. Proceeding because it was passed explicitly.`,
      );
    }
    return { keyword: FORCED_KEYWORD, related: [], lang };
  }

  const used = new Set(ledger.map((e) => normalize(e.keyword)));
  const priorKeywords = ledger.map((e) => e.keyword);
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

  // Skip candidates that are off-theme (GSC returns every query the site surfaced for, including
  // unrelated ones) or that just re-target an already-published topic (doorway-page guard), and
  // pick the first genuinely distinct, on-topic query instead.
  let top = null;
  for (const o of fresh) {
    if (!isOnTopic(o.keyword)) {
      console.log(`[relevance] skip "${o.keyword}" [${o.lang}] — not about Sanatan Dharma`);
      continue;
    }
    const dup = clustersWith(o.keyword, priorKeywords);
    if (dup) {
      console.log(`[dedup] skip "${o.keyword}" [${o.lang}] — same topic as existing "${dup}"`);
      continue;
    }
    top = o;
    break;
  }

  if (top) {
    console.log(
      `[pick] "${top.keyword}" [${top.lang}]  (impr=${top.impressions}, pos=${top.position.toFixed(1)}, ctr=${(top.ctr * 100).toFixed(1)}%)`,
    );
    const related = fresh
      .filter((o) => o.lang === top.lang && o.keyword !== top.keyword)
      .filter((o) => isOnTopic(o.keyword))
      .filter((o) => !clustersWith(o.keyword, [...priorKeywords, top.keyword]))
      .slice(0, 5)
      .map((o) => o.keyword);
    return { keyword: top.keyword, related, lang: top.lang };
  }

  const lang = mode === "hi" ? "hi" : "en";
  const fallback = FALLBACK_KEYWORDS[lang].find(
    (k) => !used.has(normalize(k)) && !clustersWith(k, priorKeywords),
  );
  if (!fallback) throw new Error("No unused, distinct keywords left (GSC + fallback exhausted).");
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
  const posts = existingPosts();
  // Ledger slugs cover posts claimed by still-open PRs too, which aren't on disk here — without
  // them two pending PRs could pick the same slug and collide on the article file at merge.
  const slugs = [...new Set([...posts.map((p) => p.slug), ...ledger.map((e) => e.slug)])].filter(
    Boolean,
  );

  const mode = resolveRunLang(ledger);
  if (mode === "hi" && RUN_POST_LANG === "auto") {
    console.log(
      `[lang] ${trailingEnglish(ledger)} English post(s) since the last Hindi one → forcing Hindi (1 per ${HINDI_EVERY})`,
    );
  }
  const { keyword, related, lang } = await pickKeyword(ledger, mode);

  const sameLangPosts = posts.filter((p) =>
    lang === "hi" ? p.slug.startsWith("hi/") : !p.slug.startsWith("hi/"),
  );

  console.log(`[openai] generating ${lang} article for "${keyword}" ...`);
  const article = await generateArticle({
    keyword,
    relatedKeywords: related,
    existingPosts: sameLangPosts,
    lang,
  });

  const base = slugify(article.slug || "") || slugify(article.title) || `post-${Date.now()}`;
  const slug = uniqueSlug(lang === "hi" ? `hi/${base}` : base, slugs);

  let coverImage;
  if (COVER_IMAGE) {
    const imgBuf = generateCoverPng(article.cover_title || article.title, {
      category: article.category,
    });
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
    ...(Array.isArray(article.faq) && article.faq.length ? { faq: article.faq } : {}),
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
  const entry = { keyword, slug, lang, date: frontmatter.date };
  const entryFile = `${entry.date}-${slug.replace(/\//g, "-")}.json`;
  writeFileEnsured(path.join(LEDGER_DIR, entryFile), JSON.stringify(entry, null, 2) + "\n");

  console.log(`\n✅ Wrote articles/${slug}.md`);
  console.log(`   Live (within ~1h): ${urlPath}`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.stack || err.message}`);
  process.exitCode = 1;
});
