// Topic-relevance gate for keyword selection.
//
// Google Search Console hands back EVERY query the site got impressions for — including
// off-theme ones the site only surfaced for by accident (e.g. a place name mentioned once
// in passing). Without a gate, the pipeline will happily write a full article on whatever
// ranks, which is how a "samardung sikkim" travel guide ended up on a Sanatan Dharma site.
//
// This module is the hard gate: a keyword is eligible ONLY if it is recognizably about
// Hinduism / Sanatana Dharma. It is deliberately fail-closed — when in doubt, reject. A
// missed on-theme keyword just means we pick the next candidate (or a fallback); a missed
// OFF-theme keyword means a published article that does not belong on the site.

// On-theme vocabulary. Lowercase, ASCII. Kept broad enough that genuine dharmic queries pass,
// narrow enough that unrelated queries (travel, tech, geography, commerce) do not.
export const EN_LEXICON = [
  // Core identity
  "sanatan", "sanatana", "sanatani", "dharma", "dharmic", "hindu", "hinduism", "vedic",
  // Worship & ritual
  "puja", "pooja", "aarti", "arti", "havan", "hawan", "yagna", "yajna", "yagya", "abhishek",
  "abhishekam", "sankalp", "prasad", "prasadam", "naivedya", "tilak", "diya", "deepak",
  "ritual", "rituals", "worship", "offering", "sacred", "holy", "spiritual", "spirituality",
  "devotion", "devotional", "bhakti", "faith",
  // Chanting & sound
  "mantra", "mantras", "chalisa", "stotra", "stotram", "shloka", "sloka", "shlok", "sloka",
  "bhajan", "kirtan", "japa", "jaap", "mala", "rudraksha", "om", "aum", "gayatri",
  "chant", "chanting", "recite", "recitation",
  // Fasting, vows, observances
  "vrat", "vrata", "upvas", "fast", "fasting", "ekadashi", "pradosh", "purnima", "amavasya",
  "sankashti", "chaturthi", "ashtami", "navami", "tithi", "muhurat", "muhurta", "panchang",
  "panchangam", "shubh", "auspicious", "nakshatra",
  // Deities
  "bhagwan", "bhagavan", "ishvara", "ishwar", "deity", "deities", "god", "goddess", "devi",
  "dev", "devta", "avatar", "ram", "rama", "sita", "krishna", "radha", "gopal", "vishnu",
  "narayan", "narayana", "shiv", "shiva", "shankar", "mahadev", "parvati", "durga", "kali",
  "lakshmi", "laxmi", "saraswati", "ganesh", "ganesha", "ganpati", "hanuman", "bajrangbali",
  "brahma", "surya", "chandra", "kartik", "kartikeya", "murugan", "indra", "yama", "kuber",
  "annapurna", "gauri", "shakti", "navdurga", "ganga", "yamuna", "nandi", "garuda",
  "jagannath", "balaji", "venkateshwara", "vitthal", "khatu", "shyam", "sai",
  // Scriptures & philosophy
  "gita", "bhagavad", "geeta", "veda", "vedas", "upanishad", "upanishads", "purana", "puranas",
  "ramayan", "ramayana", "mahabharat", "mahabharata", "manusmriti", "shastra", "shastras",
  "sutra", "smriti", "shruti", "granth", "scripture", "scriptures",
  "karma", "moksha", "dharma", "atma", "atman", "brahman", "yoga", "dhyana", "dhyan",
  "meditation", "sadhana", "sadhna", "tapasya", "guru", "sanskar", "sanskara",
  "reincarnation", "rebirth", "soul", "chakra", "kundalini", "ayurveda", "jyotish", "astrology",
  "kundli", "horoscope", "rashi", "zodiac",
  // Festivals
  "festival", "festivals", "diwali", "deepavali", "holi", "navratri", "navaratri", "dussehra",
  "dasara", "vijayadashami", "raksha", "rakhi", "rakshabandhan", "janmashtami", "ramnavami",
  "ramanavami", "mahashivratri", "shivratri", "ganeshchaturthi", "durgapuja", "karwachauth",
  "karva", "chhath", "makar", "sankranti", "pongal", "baisakhi", "vaisakhi", "gudi", "padwa",
  "ugadi", "onam", "vishu", "guru", "purnima", "hanumanjayanti", "krishnajanmashtami",
  "govardhan", "bhaidooj", "dhanteras", "vasant", "basant", "saraswatipuja", "kumbh", "mela",
  // Temples, pilgrimage, sacred places
  "temple", "temples", "mandir", "mandira", "tirth", "tirtha", "teerth", "yatra", "pilgrimage",
  "dham", "jyotirlinga", "jyotirling", "shaktipeeth", "peeth", "ashram", "matth", "math",
  "ghat", "kshetra", "darshan", "parikrama", "pradakshina",
  "kashi", "varanasi", "kedarnath", "badrinath", "gangotri", "yamunotri", "ayodhya", "mathura",
  "vrindavan", "haridwar", "rishikesh", "prayagraj", "prayag", "ujjain", "dwarka", "rameshwaram",
  "rameswaram", "tirupati", "vaishno", "amarnath", "somnath", "kailash", "mansarovar", "puri",
  "shirdi", "trimbakeshwar", "mahakaleshwar", "omkareshwar", "bhimashankar", "grishneshwar",
  "kaustubh", "chardham", "shabarimala", "kamakhya", "vindhyachal",
  // People / roles
  "pandit", "purohit", "brahmin", "sadhu", "sant", "swami", "rishi", "muni", "acharya",
  "maharaj", "bhakt", "devotee", "yogi", "yogini",
];

// Hindi (Devanagari) on-theme vocabulary. Matched by substring because Hindi compounds words
// (e.g. "शिवपूजा"), so a whole-word rule would miss too much.
export const HI_LEXICON = [
  "सनातन", "धर्म", "हिंदू", "हिन्दू", "पूजा", "पूजन", "आरती", "मंत्र", "चालीसा", "स्तोत्र",
  "श्लोक", "भजन", "कीर्तन", "जप", "माला", "व्रत", "उपवास", "एकादशी", "पूर्णिमा", "अमावस्या",
  "पंचांग", "मुहूर्त", "तिथि", "भगवान", "देवी", "देवता", "अवतार", "राम", "सीता", "कृष्ण", "राधा",
  "विष्णु", "नारायण", "शिव", "शंकर", "महादेव", "पार्वती", "दुर्गा", "काली", "लक्ष्मी", "सरस्वती",
  "गणेश", "गणपति", "हनुमान", "ब्रह्मा", "सूर्य", "शक्ति", "गंगा", "गीता", "वेद", "उपनिषद", "पुराण",
  "रामायण", "महाभारत", "शास्त्र", "कर्म", "मोक्ष", "आत्मा", "योग", "ध्यान", "साधना", "गुरु",
  "ज्योतिष", "कुंडली", "राशि", "त्योहार", "त्यौहार", "दिवाली", "दीपावली", "होली", "नवरात्रि",
  "दशहरा", "रक्षाबंधन", "जन्माष्टमी", "रामनवमी", "शिवरात्रि", "छठ", "मकर", "संक्रांति", "कुंभ",
  "मेला", "मंदिर", "तीर्थ", "यात्रा", "धाम", "ज्योतिर्लिंग", "दर्शन", "आश्रम", "काशी", "अयोध्या",
  "मथुरा", "वृंदावन", "हरिद्वार", "ऋषिकेश", "केदारनाथ", "बद्रीनाथ", "उज्जैन", "तिरुपति", "वैष्णो",
  "पंडित", "साधु", "संत", "स्वामी", "ऋषि", "भक्त", "भक्ति", "प्रसाद", "हवन", "यज्ञ",
];

const EN_SET = new Set(EN_LEXICON);

function normalize(s) {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

// Does a single ASCII token hit the English lexicon?
//  - exact match, or
//  - the token STARTS WITH a lexicon word (>=4 chars) — catches inflections like
//    "puja"->"pujan", "hanuman"->"hanumanji", "mandir"->"mandiram", or
//  - the token CONTAINS a lexicon word (>=5 chars) — catches mashed queries where several
//    words are jammed together, e.g. "hindusanatanapp" contains "sanatan".
// The length floors keep short, ambiguous roots ("ram", "om", "dev") to exact/prefix matches
// only, so a place like "rampur" or a word like "program" is NOT counted as on-theme.
function tokenHitsEnglish(token) {
  if (EN_SET.has(token)) return true;
  for (const term of EN_LEXICON) {
    if (term.length >= 4 && token.startsWith(term)) return true;
    if (term.length >= 5 && token.includes(term)) return true;
  }
  return false;
}

// True when the keyword is recognizably about Hinduism / Sanatana Dharma.
export function isOnTopic(keyword) {
  const norm = normalize(keyword);
  if (!norm) return false;

  // Devanagari present → check the Hindi lexicon by substring (Hindi compounds words).
  if (/[ऀ-ॿ]/.test(norm)) {
    if (HI_LEXICON.some((term) => norm.includes(term))) return true;
  }

  const tokens = norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.some((t) => /[a-z]/.test(t) && tokenHitsEnglish(t));
}
