import OpenAI from "openai";
import {
  SITE_URL,
  PLAY_STORE_URL,
  OPENAI_MODEL,
  OPENAI_REASONING_EFFORT,
} from "../config.mjs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CATEGORIES = {
  en: [
    "Sanatan Dharma",
    "Rituals & Puja",
    "Festivals",
    "Scriptures",
    "Mantras & Chalisa",
    "Guides",
  ],
  hi: ["सनातन धर्म", "पूजा एवं अनुष्ठान", "त्योहार", "शास्त्र", "मंत्र एवं चालीसा", "मार्गदर्शिका"],
};

export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

const SYSTEM_PROMPT = `You are the SEO content editor for "Sanatan Marg", a free Hindu spiritual Android app for Sanatana Dharma.
Write accurate, respectful, genuinely useful articles for a global Hindu audience (India-first).
Hard rules:
- The ONLY product you represent or promote is "Sanatan Marg" (sanatanmarg.org). Generic names such as "Sanatan App", "Sanatana App", "Sanatani App" refer to DIFFERENT, unrelated apps — never claim Sanatan Marg is called or known as any of them, never impersonate them, and never name, review, link, or endorse any other specific app.
- App-discovery keywords like "sanatan app", "sanatan app download", "free sanatan app" or "best sanatan app" are high-intent searches from people looking for a Hindu spiritual app — capture that intent for our advantage. Write genuinely useful guidance (what to look for in a good Sanatan/Hindu app, key features, whether it is free, how to download and get started) and present Sanatan Marg as an excellent free choice. A "what to look for" or buyer's-guide framing is encouraged. Base every claim on Sanatan Marg's real features; do not fabricate or disparage details about other apps.
- NEVER invent scripture citations, shloka chapter/verse numbers, dates, or statistics. If unsure of an exact reference, describe it generally instead of fabricating specifics.
- Neutral, devotional-but-inclusive tone. No sectarian, political, or disparaging claims.
- Content must be original and substantive, not thin filler.
Return ONLY a JSON object — no markdown fences, no commentary.`;

function userPrompt({ keyword, relatedKeywords, existingSlugs, lang }) {
  const langLine =
    lang === "hi"
      ? `Write the ENTIRE article — title, description, body, and tags — in fluent, natural Hindi using Devanagari script. Keep the brand name "Sanatan Marg", the domain sanatanmarg.org, and the Google Play link exactly as-is. The "slug" field must still be Latin/ASCII.`
      : `Write the entire article in clear, natural English.`;
  const cats = CATEGORIES[lang];
  return `Write a blog post optimised for the search keyword: "${keyword}".
${langLine}
Related keywords to weave in naturally where relevant: ${relatedKeywords.join(", ") || "(none)"}.

Requirements:
- 1000-1400 words.
- Put the primary keyword in the title, the meta description, the first 100 words, and at least one H2 heading.
- Structure the body in Markdown starting at H2 ("## ..."). DO NOT include an H1 / a single "# " title line (the site renders the title separately).
- Use short paragraphs, at least one bulleted or numbered list, and clear H2/H3 subheadings.
- End the body with a Frequently Asked Questions section (an H2) containing 2-3 concise Q&A pairs (use "### question?" then the answer).
- Naturally include 1-2 internal links using Markdown: the app site ${SITE_URL} and the Google Play page ${PLAY_STORE_URL}. If relevant, you may reference existing posts by linking to ${SITE_URL}/blog/<slug> using one of these slugs: ${existingSlugs.slice(0, 20).join(", ") || "(none yet)"}.
- Mention how the Sanatan Marg app helps with this topic once, naturally — not as an ad.

Return JSON with EXACTLY these fields:
{
  "title": "string, <= 60 chars, includes the keyword",
  "slug": "url-safe lowercase ASCII slug (a-z, 0-9, hyphens only), 3-8 words, <= 60 chars — ALWAYS Latin letters, even for Hindi articles",
  "description": "string, 150-160 chars, includes the keyword, compelling meta description",
  "category": "one of: ${cats.join(" | ")}",
  "tags": ["3-6 short tags"],
  "body_markdown": "the full article body in Markdown, starting at ##"
}`;
}

export async function generateArticle({
  keyword,
  relatedKeywords = [],
  existingSlugs = [],
  lang = "en",
}) {
  const req = {
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt({ keyword, relatedKeywords, existingSlugs, lang }) },
    ],
    response_format: { type: "json_object" },
  };
  if (OPENAI_REASONING_EFFORT) {
    req.reasoning_effort = OPENAI_REASONING_EFFORT;
  }

  const completion = await client.chat.completions.create(req);
  const article = JSON.parse(completion.choices[0].message.content);

  const wordCount = (article.body_markdown || "").split(/\s+/).length;
  if (!article.title || !article.description || !article.body_markdown) {
    throw new Error("Model output missing required fields.");
  }
  if (wordCount < 500) {
    throw new Error(`Article too short (${wordCount} words) — likely low quality.`);
  }
  if (!CATEGORIES[lang].includes(article.category)) {
    article.category = CATEGORIES[lang][0];
  }
  if (!Array.isArray(article.tags) || article.tags.length === 0) {
    article.tags = [keyword];
  }
  return article;
}
