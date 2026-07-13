import { Resvg } from "@resvg/resvg-js";

function escapeXml(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapTitle(title, maxChars = 20, maxLines = 4) {
  const words = title.trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\W*$/, "") + "…";
  }
  return lines;
}

export function generateCoverPng(title, { site = "sanatanmarg.org", category } = {}) {
  const lines = wrapTitle(title);
  const lineHeight = 76;
  const firstY = 330 - (lines.length - 1) * (lineHeight / 2);
  const tspans = lines
    .map(
      (l, i) =>
        `<tspan x="600" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(l)}</tspan>`,
    )
    .join("");

  const eyebrow = category
    ? `<text x="600" y="150" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="700" letter-spacing="5" fill="rgba(255,255,255,0.92)">${escapeXml(
        category.toUpperCase(),
      )}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fb923c"/>
      <stop offset="0.55" stop-color="#f97316"/>
      <stop offset="1" stop-color="#b45309"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1040" cy="120" r="220" fill="rgba(255,255,255,0.08)"/>
  <circle cx="160" cy="560" r="180" fill="rgba(255,255,255,0.06)"/>
  <rect x="28" y="28" width="1144" height="574" rx="28" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
  ${eyebrow}
  <text x="600" y="${firstY}" text-anchor="middle" font-family="sans-serif" font-size="62" font-weight="800" fill="#ffffff">${tspans}</text>
  <text x="600" y="562" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="rgba(255,255,255,0.96)">${escapeXml(site)}</text>
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: true, defaultFontFamily: "sans-serif" },
  });
  return resvg.render().asPng();
}
