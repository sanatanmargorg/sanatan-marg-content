import OpenAI from "openai";
import {
  SITE_URL,
  PLAY_STORE_URL,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
} from "../config.mjs";

let _client;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

const CATEGORIES = {
  en: [
    "Sanatan Dharma",
    "Rituals & Puja",
    "Festivals",
    "Scriptures",
    "Mantras & Chalisa",
    "Guides",
  ],
  hi: [
    "सनातन धर्म",
    "पूजा एवं अनुष्ठान",
    "त्योहार",
    "शास्त्र",
    "मंत्र एवं चालीसा",
    "मार्गदर्शिका",
  ],
};

const MINOR_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "nor",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "vs",
]);

function capitalizeTitle(text) {
  return text
    .split(" ")
    .map((word, i) => {
      const bare = word.toLowerCase().replace(/[^a-z]/g, "");
      if (i !== 0 && MINOR_WORDS.has(bare)) return word;
      if (/^[a-z]/.test(word))
        return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

const MASHED_MIN_LEN = 12;

export function mashedTokens(keyword) {
  return keyword
    .split(/\s+/)
    .filter((t) => t.length >= MASHED_MIN_LEN && !/[-_]/.test(t));
}

export function isNaturalPhrase(keyword) {
  return mashedTokens(keyword).length === 0;
}

const META_PATTERNS = [
  /\b(?:when|if|people|users|those|anyone|readers)\b[^.?!]{0,40}\bsearch(?:es|ing)?\s+for\b/i,
  /\bsearch(?:ing)?\s+for\s+\*{0,2}[a-z]/i,
  /\bthe\s+\S+\s+search(?:es)?\b/i,
  /\bsearch(?:es)?\s+(?:look|are looking)\b/i,
  /\bis\s+a\s+search\s+(?:term|query|phrase|keyword)\b/i,
  /\b(?:search|keyword)\s+(?:term|query|phrase)\b/i,
  /\bpeople\s+(?:who\s+)?(?:search|type|google)\b/i,
  /\bthis\s+(?:phrase|term|keyword)\s+(?:is|often|usually|signals|suggests)\b/i,
  /\btyped?\s+into\s+(?:google|a\s+search)/i,
  /\bsearch\s+(?:intent|volume|results\s+page)\b/i,
];

export function findMetaCommentary(article, keyword) {
  const hits = [];
  const headings = (article.body_markdown || "")
    .split("\n")
    .filter((l) => /^#{2,4}\s/.test(l));
  const surfaces = [
    ["title", article.title || ""],
    ["description", article.description || ""],
    ...headings.map((h) => ["heading", h]),
    ["body", article.body_markdown || ""],
  ];

  for (const [where, text] of surfaces) {
    for (const re of META_PATTERNS) {
      const m = text.match(re);
      if (m) hits.push(`${where}: "${m[0].trim()}"`);
    }
  }

  for (const token of mashedTokens(keyword)) {
    const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(article.title || ""))
      hits.push(`title contains mashed token "${token}"`);
    for (const h of headings) {
      if (re.test(h)) hits.push(`heading contains mashed token "${token}"`);
    }
  }

  return [...new Set(hits)];
}

const SYSTEM_PROMPT = `You are the SEO content editor for "Sanatan Marg", a free Hindu spiritual Android app for Sanatana Dharma.
Write accurate, respectful, genuinely useful articles for a global Hindu audience (India-first).
Hard rules:
- The ONLY product you represent or promote is "Sanatan Marg" (sanatanmarg.org). Generic names such as "Sanatan App", "Sanatana App", "Sanatani App" refer to DIFFERENT, unrelated apps — never claim Sanatan Marg is called or known as any of them, never impersonate them, and never name, review, link, or endorse any other specific app.
- App-discovery keywords like "sanatan app", "sanatan app download", "free sanatan app" or "best sanatan app" are high-intent searches from people looking for a Hindu spiritual app — capture that intent for our advantage. Write genuinely useful guidance (what to look for in a good Sanatan/Hindu app, key features, whether it is free, how to download and get started) and present Sanatan Marg as an excellent free choice. A "what to look for" or buyer's-guide framing is encouraged. Base every claim on Sanatan Marg's real features; do not fabricate or disparage details about other apps.
- NEVER invent scripture citations, shloka chapter/verse numbers, dates, or statistics. If unsure of an exact reference, describe it generally instead of fabricating specifics.
- Neutral, devotional-but-inclusive tone. No sectarian, political, or disparaging claims.
- Content must be original and substantive, not thin filler.

THE KEYWORD IS NOT THE TOPIC.
The keyword you are given is a raw search query copied from Google Search Console — it is
literally what a person typed. It may be lowercase, misspelled, or several words mashed into
one token (e.g. "hindusanatanapp"). It is data ABOUT your reader, not your subject matter.
- Your reader is the person who typed it. They already know what they searched for. Give them
  the answer; never describe, analyse, or narrate their search back to them.
- Write about the real-world topic BEHIND the query. Ask "what did this person actually want to
  know?" and write that article.
- ABSOLUTELY FORBIDDEN — these phrasings fail the article outright:
  "When people search for X…", "Understanding the X search", "What should X searches look for",
  "Searching for X?", "X is a search term / query / phrase", "people who search for X are
  looking for…", "this phrase often signals…", "high search intent", or any other sentence that
  makes searching, the query string, or SEO the subject.
- Headings and titles must read like a real magazine headline, never like a search string.
Return ONLY a JSON object — no markdown fences, no commentary.`;

function keywordHandling(keyword) {
  const mashed = mashedTokens(keyword);
  if (!mashed.length) {
    return `This query reads as a natural phrase, so it can appear verbatim in your prose.
- Use it in the title and meta description ONLY where it reads like normal writing. If forcing it
  in would make a sentence awkward, rephrase to the natural human wording instead — a clumsy
  exact-match phrase costs you more ranking than it gains.
- The topic (not the string) should be recognisable in the title, the opening paragraph, and at
  least one H2.`;
  }
  return `This query is NOT natural language — ${mashed.map((t) => `"${t}"`).join(", ")} ${
    mashed.length > 1 ? "are" : "is"
  } several words mashed into one token, exactly as the person typed it.
- It MUST NOT appear in the title, in the cover title, or in ANY heading. There is no way to fit
  it into a heading without making the heading about the search itself, which is banned.
- Spell it out as the natural human phrase (e.g. "hindusanatanapp" -> "Hindu Sanatan app") and use
  THAT wording throughout the article.
- The raw token may appear at most ONCE in the whole body, and only if it lands naturally. If it
  never appears, that is fine and preferred — Google matches this query to the page through the
  topic, the brand and the spelled-out phrase, not through the mashed string.
- Set "keyword_display" to the natural spelled-out phrase you chose.`;
}

function userPrompt({ keyword, relatedKeywords, existingSlugs, lang }) {
  const langLine =
    lang === "hi"
      ? `Write the ENTIRE article — title, description, body, and tags — in fluent, natural Hindi using Devanagari script. Keep the brand name "Sanatan Marg", the domain sanatanmarg.org, and the Google Play link exactly as-is. The "slug" field must still be Latin/ASCII.`
      : `Write the entire article in clear, natural English.`;
  const cats = CATEGORIES[lang];
  return `A real person typed this into Google: "${keyword}"
Write the article that best answers what they actually wanted.
${langLine}

How to handle this particular query:
${keywordHandling(keyword)}

Other queries these readers use — cover the ideas behind them where they genuinely fit, as
sections or FAQ questions. Do not list them, do not stuff them: ${relatedKeywords.join(", ") || "(none)"}.

Requirements:
- 1000-1400 words.
- Open by answering the reader's question directly, in the first two or three sentences, in plain
  language — no throat-clearing, no restating the question. This opening is what Google lifts for
  featured snippets and AI Overviews, so make it a complete, self-contained answer.
- Structure the body in Markdown starting at H2 ("## ..."). DO NOT include an H1 / a single "# " title line (the site renders the title separately).
- Make each H2 a question or a concrete promise a reader would actually type or click, and answer
  it in the first paragraph beneath it. Keep paragraphs short.
- Include at least one bulleted or numbered list, and use H3s for sub-points.
- Cover the topic thoroughly enough to stand alone: the practical how-to, the common mistakes, and
  the follow-up questions a curious reader would ask next. Depth is what ranks; filler is not.
- End the body with a Frequently Asked Questions section (an H2) containing 3-5 concise Q&A pairs
  (use "### question?" then a 2-4 sentence answer that could be quoted on its own).
- Naturally include 1-2 internal links using Markdown: the app site ${SITE_URL} and the Google Play page ${PLAY_STORE_URL}. If relevant, you may reference existing posts by linking to ${SITE_URL}/blog/<slug> using one of these slugs: ${existingSlugs.slice(0, 20).join(", ") || "(none yet)"}.
- Mention how the Sanatan Marg app helps with this topic once, naturally — not as an ad.

Return JSON with EXACTLY these fields:
{
  "keyword_display": "the natural, human way to say this query in prose (e.g. 'hindusanatanapp' -> 'Hindu Sanatan app'; 'how to do morning puja at home' -> itself). Same language as the article.",
  "title": "string, <= 60 chars, proper Title Case. A headline a human would click, built around the topic — NOT the raw query string, and never containing a mashed token.",
  "cover_title": "a short headline (<= 50 chars) printed on the article's cover image. It MUST NOT contain the phrase 'Sanatan App' — describe the topic generically instead (e.g. 'Choosing a Hindu Spiritual App'). Same language as the article.",
  "slug": "url-safe lowercase ASCII slug (a-z, 0-9, hyphens only), 3-8 words, <= 60 chars — ALWAYS Latin letters, even for Hindi articles",
  "description": "string, 150-160 chars. A compelling meta description that states the answer and earns the click. Must NOT mention searching, and must NOT open with 'Searching for...'.",
  "category": "one of: ${cats.join(" | ")}",
  "tags": ["3-6 short tags"],
  "body_markdown": "the full article body in Markdown, starting at ##"
}`;
}

const MAX_ATTEMPTS = 3;

async function draftArticle(messages) {
  const req = {
    model: OPENAI_MODEL,
    messages,
    response_format: { type: "json_object" },
  };
  if (OPENAI_REASONING_EFFORT) {
    req.reasoning_effort = OPENAI_REASONING_EFFORT;
  }
  const completion = await getClient().chat.completions.create(req);
  const raw = completion.choices[0].message.content;
  return { article: JSON.parse(raw), raw };
}

export async function generateArticle({
  keyword,
  relatedKeywords = [],
  existingSlugs = [],
  lang = "en",
}) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: userPrompt({ keyword, relatedKeywords, existingSlugs, lang }),
    },
  ];

  let article;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const drafted = await draftArticle(messages);
    article = drafted.article;

    const wordCount = (article.body_markdown || "").split(/\s+/).length;
    const problems = [];
    if (!article.title || !article.description || !article.body_markdown) {
      problems.push(
        "Output is missing one of: title, description, body_markdown.",
      );
    }
    if (article.body_markdown && wordCount < 500) {
      problems.push(
        `Article is only ${wordCount} words — it must be 1000-1400.`,
      );
    }
    problems.push(
      ...findMetaCommentary(article, keyword).map(
        (h) => `Meta-commentary — ${h}`,
      ),
    );

    if (!problems.length) break;

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `Article still failed quality checks after ${MAX_ATTEMPTS} attempts:\n  - ${problems.join("\n  - ")}`,
      );
    }
    console.warn(
      `[quality] attempt ${attempt} rejected:\n  - ${problems.join("\n  - ")}\n[quality] retrying...`,
    );
    messages.push(
      { role: "assistant", content: drafted.raw },
      {
        role: "user",
        content: `That draft is rejected. Problems found:
  - ${problems.join("\n  - ")}

Remember: the reader IS the person who typed the query. Never write about searching, the query
string, keywords, or SEO — write about the real-world topic they wanted. Rewrite the article
completely, fixing every problem above, and return the same JSON shape.`,
      },
    );
  }

  if (!CATEGORIES[lang].includes(article.category)) {
    article.category = CATEGORIES[lang][0];
  }
  if (!Array.isArray(article.tags) || article.tags.length === 0) {
    article.tags = [article.keyword_display || keyword];
  }
  if (lang === "en") {
    article.title = capitalizeTitle(article.title);
    if (article.cover_title)
      article.cover_title = capitalizeTitle(article.cover_title);
  }
  return article;
}
