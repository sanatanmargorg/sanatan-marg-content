export const SITE_URL = "https://sanatanmarg.org";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=app.sanatanmarg";

export const REPO = {
  owner: "sanatanmargorg",
  name: "sanatan-marg-content",
  branch: "main",
};

export const OPENAI_MODEL = "gpt-5.6-luna";
export const OPENAI_REASONING_EFFORT = "high";

export const POST_LANG = "auto";
export const HINDI_EVERY = 5;

// Anti-duplication (doorway-page guard): how similar a new keyword's topic may be
// to an already-published post before we treat it as the same intent and skip it.
// jaccard = overlap of significant topic words / union. Higher = stricter (fewer skips).
export const DEDUP = {
  jaccard: 0.6,
};

export const COVER_IMAGE = true;

export const COVER_BLOCKED_TERMS = ["sanatan apps", "sanatan app", "sanatanapp"];

export const GSC = {
  siteUrl: "",
  lookbackDays: 90,
  minImpressions: 8,
  minPosition: 4,
  maxPosition: 40,
};
