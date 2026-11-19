// categorize.js — port of categorize.py (pure data processing)
import { REASON_BAD_QUALITY, REASON_GLOSSARY, REASON_STYLE_GUIDE } from "./config.js";

const DISCUSSED_HERE = /The translation\s+.+?\s+is being discussed here\s*\.?\s*/gis;

const allComments = (e) => [...(e.discussion_comments || []), ...(e.hop_comments || [])];

function allReasonTags(entry) {
  return allComments(entry).map((c) => (c.reason_tag || "").trim()).filter(Boolean);
}

function cleanCommentText(comments) {
  const parts = [];
  for (const c of comments) {
    const text = (c.comment_text || "").trim();
    if (!text) continue;
    let cleaned = text.replace(DISCUSSED_HERE, "").trim();
    cleaned = cleaned.replace(/^\s*\.\s*$/, "").trim();
    if (cleaned) parts.push(cleaned);
  }
  return parts.join(" || ");
}

export function categorizeEntry(entry) {
  const tags = allReasonTags(entry);
  const cats = [];
  if (tags.includes(REASON_GLOSSARY)) cats.push("glossary");
  if (tags.includes(REASON_STYLE_GUIDE)) cats.push("style_guide");
  if (tags.includes(REASON_BAD_QUALITY)) cats.push("bad_quality_ai");
  if (!cats.length) cats.push("other");
  entry.comment_text_clean = cleanCommentText(allComments(entry));
  entry.categories = cats;
  entry.reason_tags = [...new Set(tags)];
  return entry;
}

export function buildTranslatorSummary(entries) {
  const groups = new Map();
  for (const e of entries) {
    const k = e.translated_by || "unknown";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const out = [];
  for (const [translator, g] of groups) {
    const count = (cat) => g.filter((e) => (e.categories || []).includes(cat)).length;
    out.push({
      translator, total_flagged: g.length,
      glossary_count: count("glossary"), style_guide_count: count("style_guide"),
      bad_quality_ai_count: count("bad_quality_ai"), other_count: count("other"),
      fetch_errors: g.filter((e) => e.fetch_error).length,
    });
  }
  out.sort((a, b) => b.total_flagged - a.total_flagged);
  return out;
}
