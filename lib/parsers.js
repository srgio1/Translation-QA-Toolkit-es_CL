// parsers.js — ports of listing_parser.py, discussion_parser.py and the parsing half of user_stats.py.
// BeautifulSoup -> DOMParser. get_text(sep, strip) semantics are reproduced by getText().
import { BASE_URL } from "./config.js";

export function parseHtml(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

/** bs4 get_text(separator=sep, strip=strip) */
export function getText(el, sep = "", strip = false) {
  if (!el) return "";
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
  const parts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tag = n.parentNode && n.parentNode.nodeName;
    if (tag === "SCRIPT" || tag === "STYLE") continue;
    let t = n.nodeValue;
    if (strip) { t = t.trim(); if (!t) continue; }
    parts.push(t);
  }
  return parts.join(sep);
}

const PROFILE_LOGIN_RE = /profiles\.wordpress\.org\/([^/]+)\/?/;
const LOGIN_IN_PARENS_RE = /\(([^()]+)\)\s*$/;

/** Real user_login from a meta <dd>: "Display Name (user_login)" or just "user_login". */
export function profileLogin(dd) {
  const text = getText(dd, " ", true);
  const m = LOGIN_IN_PARENS_RE.exec(text);
  if (m) return m[1].trim();
  if (text) return text;
  for (const a of dd.querySelectorAll("a[href]")) {
    const mm = PROFILE_LOGIN_RE.exec(a.getAttribute("href"));
    if (mm) return mm[1];
  }
  return "";
}

export function getTotalPages(html) {
  const doc = typeof html === "string" ? parseHtml(html) : html;
  const paging = doc.querySelector("div.paging");
  if (!paging) return 1;
  let max = 1;
  for (const a of paging.querySelectorAll("a[href]")) {
    const m = /[&?]page=(\d+)/.exec(a.getAttribute("href"));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export function parseComment(article) {
  const commentId = article.getAttribute("id") || "";
  const authorA = article.querySelector('a[href*="/profiles.wordpress.org/"]');
  const author = authorA ? getText(authorA, "", true) : "";
  const timeEl = article.querySelector("time");
  const date = timeEl ? (timeEl.getAttribute("datetime") || "").trim() : "";

  const content = article.querySelector("div.comment-content");
  let reasonTag = "", commentText = "", hopUrl = "";
  if (content) {
    const tip = content.querySelector("span.tooltip[title]");
    if (tip) reasonTag = getText(tip, "", true);
    const paragraphs = [];
    for (const p of content.querySelectorAll("p")) {
      const text = getText(p, " ", true);
      if (text.includes("Comment Reason:")) continue;
      for (const a of p.querySelectorAll("a[href]")) {
        if (/is being discussed here/i.test(a.textContent)) {
          let href = a.getAttribute("href");
          if (href.startsWith("/")) href = BASE_URL + href;
          hopUrl = href;
          break;
        }
      }
      paragraphs.push(text);
    }
    commentText = paragraphs.join(" ").trim();
  }

  let snapshot = "";
  const footer = article.querySelector("footer");
  if (footer) {
    const em = footer.querySelector("em");
    if (em) {
      const a = em.querySelector("a");
      snapshot = a ? getText(a, "", true) : getText(em, "", true);
    }
  }
  return {
    comment_id: commentId, author, date, reason_tag: reasonTag, comment_text: commentText,
    translation_snapshot: snapshot, discussion_hop_url: hopUrl,
  };
}

export function parseDiscussionPage(html) {
  const doc = typeof html === "string" ? parseHtml(html) : html;
  const out = [];
  for (const li of doc.querySelectorAll('li[class*="rejection-feedback"]')) {
    const article = li.querySelector("article.comment");
    if (article) out.push(parseComment(article));
  }
  return out;
}

export function parseListingPage(html, pageNum = 1, log = () => {}) {
  const doc = typeof html === "string" ? parseHtml(html) : html;
  const entries = [];
  const editors = new Map();
  for (const tr of doc.querySelectorAll("tr.editor")) {
    const r = tr.getAttribute("row");
    if (r && !editors.has(r)) editors.set(r, tr);
  }

  for (const preview of doc.querySelectorAll("tr.preview.status-changesrequested")) {
    const rowAttr = preview.getAttribute("row") || "";
    if (!rowAttr || !rowAttr.includes("-")) continue;
    const cut = rowAttr.indexOf("-");
    const originalId = rowAttr.slice(0, cut), translationId = rowAttr.slice(cut + 1);
    const editor = editors.get(rowAttr);
    if (!editor) { log("WARNING", `No editor row found for row=${rowAttr}`); continue; }

    const rawSpan = editor.querySelector('span.original-raw[aria-hidden="true"]');
    const originalRaw = rawSpan ? getText(rawSpan, "", true) : "";
    const textarea = editor.querySelector('textarea[name^="translation["]');
    const translationText = textarea ? getText(textarea, "", true) : "";

    const references = [];
    const refsUl = editor.querySelector("ul");
    if (refsUl) for (const li of refsUl.querySelectorAll("li")) {
      const a = li.querySelector("a");
      if (a) references.push(getText(a, "", true));
    }

    let translatedBy = "", lastUpdatedBy = "", dateAdded = "", dateModified = "";
    const meta = editor.querySelector('div.meta[id^="sidebar-div-meta-"]');
    if (meta) for (const dl of meta.querySelectorAll("dl")) {
      const dt = dl.querySelector("dt"), dd = dl.querySelector("dd");
      if (!dt || !dd) continue;
      const label = getText(dt, "", true).toLowerCase();
      if (label.includes("translated by")) translatedBy = profileLogin(dd);
      else if (label.includes("last updated")) lastUpdatedBy = profileLogin(dd);
      else if (label.includes("added")) dateAdded = getText(dd, "", true);
      else if (label.includes("last modified")) dateModified = getText(dd, "", true);
    }

    const comments = [];
    let hopUrl = "";
    const disc = editor.querySelector('div.meta.discussion[id^="sidebar-div-discussion-"]');
    if (disc) for (const article of disc.querySelectorAll("article.comment")) {
      const c = parseComment(article);
      comments.push(c);
      if (c.discussion_hop_url && !hopUrl) hopUrl = c.discussion_hop_url;
    }

    entries.push({
      original_id: originalId, translation_id: translationId, original_raw: originalRaw,
      translation_text: translationText, references, translated_by: translatedBy,
      last_updated_by: lastUpdatedBy, date_added: dateAdded, date_modified: dateModified,
      discussion_comments: comments, discussion_hop_url: hopUrl, hop_comments: [],
      source_page: pageNum, fetch_error: false,
    });
  }
  log("INFO", `Page ${pageNum}: ${entries.length} entries parsed`);
  return entries;
}

// ---- user_stats.py parsing half -------------------------------------------------
const COUNT_RE = /\(([\d.,\s]+)\)/;

export function extractCount(a) {
  const m = COUNT_RE.exec(getText(a, " ", true));
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : null;
}

export function parseSingleStatusCount(html, status, username) {
  const doc = parseHtml(html);
  for (const a of doc.querySelectorAll("a[href]")) {
    let u;
    try { u = new URL(a.getAttribute("href"), BASE_URL); } catch { continue; }
    const s = u.searchParams.getAll("filters[status]");
    const l = u.searchParams.getAll("filters[user_login]");
    if (s.length === 1 && s[0] === status && l.length === 1 && l[0] === username) {
      const c = extractCount(a);
      if (c !== null) return c;
    }
  }
  return null;
}

export function countRows(html) {
  return parseHtml(html).querySelectorAll("tr.preview").length;
}
