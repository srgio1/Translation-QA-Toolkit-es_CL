// pipeline.js — port of pipeline.py + user_stats.fetch_user_counts + stats_only.py.
// Stages: 1 listing pages -> 2 discussion pages (+1 hop) -> 3 categorize -> 4 per-translator stats.
// Results stay in memory / IndexedDB; CSVs are optional downloads.
import { discussionUrl, listingUrl, userStatusUrl } from "./config.js";
import { buildTranslatorSummary, categorizeEntry } from "./categorize.js";
import { countRows, getTotalPages, parseDiscussionPage, parseListingPage,
         parseSingleStatusCount } from "./parsers.js";
import { StopError } from "./fetcher.js";
import { toCsv } from "./csv.js";

export const DETAIL_FIELDS = [
  "original_id", "translation_id", "original_raw", "translation_text",
  "translated_by", "last_updated_by", "date_added", "date_modified",
  "categories", "reason_tags", "comment_text_clean", "references",
  "source_page", "fetch_error",
];
export const SUMMARY_FIELDS = [
  "translator", "total_flagged", "glossary_count", "style_guide_count",
  "bad_quality_ai_count", "other_count", "fetch_errors",
  "current_count", "changes_requested_count", "total_count",
  "pct_current", "pct_changes_requested", "user_stats_fetch_error",
];

const pyBool = (b) => (b ? "True" : "False");
const pyFloat = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Flatten an entry exactly like _flatten_entry (so memory path == CSV round-trip). */
export function flattenEntry(e) {
  return {
    original_id: e.original_id, translation_id: e.translation_id, original_raw: e.original_raw,
    translation_text: e.translation_text, translated_by: e.translated_by,
    last_updated_by: e.last_updated_by, date_added: e.date_added, date_modified: e.date_modified,
    categories: (e.categories || []).join(", "), reason_tags: (e.reason_tags || []).join(", "),
    comment_text_clean: e.comment_text_clean || "", references: (e.references || []).join(" | "),
    source_page: String(e.source_page), fetch_error: pyBool(e.fetch_error),
  };
}

export function flattenSummary(s) {
  return {
    ...s,
    fetch_errors: s.fetch_errors,
    pct_current: pyFloat(s.pct_current ?? 0),
    pct_changes_requested: pyFloat(s.pct_changes_requested ?? 0),
    user_stats_fetch_error: pyBool(s.user_stats_fetch_error),
  };
}

export const timestamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** CSV files named like the Python tool, so qa_report.py keeps working with them. */
export function runToCsvFiles(run) {
  const files = [];
  for (const [translator, rows] of Object.entries(run.rows)) {
    const safe = translator.replace(/[^\w-]/g, "_");
    files.push({ name: `${run.project}_${run.subproject}_${safe}_qa_${run.ts}.csv`,
                 text: toCsv(DETAIL_FIELDS, rows) });
  }
  files.push({ name: `${run.project}_${run.subproject}_summary_${run.ts}.csv`,
               text: toCsv(SUMMARY_FIELDS, run.summaries.map(flattenSummary)) });
  return files;
}

// ---------------------------------------------------------------------------
export async function fetchUserCounts(fetcher, ctx, username, force, log = () => {}) {
  const counts = {};
  let fetchError = false;
  for (const status of ["current", "changesrequested"]) {
    const url = userStatusUrl({ ...ctx, status, username });
    const html = await fetcher.fetchUrl(url, { force });
    if (!html) {
      log("WARNING", `Failed to fetch status=${status} for user=${username}`);
      fetchError = true; counts[status] = 0; continue;
    }
    let count = parseSingleStatusCount(html, status, username);
    if (count === null) {
      log("WARNING", `Tab not found for status=${status} user=${username} — counting rows`);
      const total = getTotalPages(html), first = countRows(html);
      if (total <= 1) count = first;
      else {
        const last = await fetcher.fetchUrl(`${url}&page=${total}`, { force });
        count = last ? (total - 1) * first + countRows(last) : null;
      }
      if (count === null) { fetchError = true; count = 0; }
    }
    counts[status] = count;
  }
  const current = counts.current, changes = counts.changesrequested, total = current + changes;
  if (total === 0 && !fetchError) {
    log("WARNING", `User "${username}" has 0 strings in both statuses. The login is probably wrong ` +
        `(check the text in parentheses on the translation's 'Translated by' line).`);
    fetchError = true;
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const out = {
    username, current_count: current, changes_requested_count: changes, total_count: total,
    pct_current: total ? r1((current / total) * 100) : 0,
    pct_changes_requested: total ? r1((changes / total) * 100) : 0, fetch_error: fetchError,
  };
  log("INFO", `User stats: ${username} -> current=${current} changesrequested=${changes} ` +
      `total=${total} (${out.pct_current.toFixed(1)}% approved)`);
  return out;
}

export function applyUserCounts(summaries, userCounts) {
  for (const s of summaries) {
    const st = userCounts[s.translator];
    if (st) {
      Object.assign(s, {
        current_count: st.current_count, changes_requested_count: st.changes_requested_count,
        total_count: st.total_count, pct_current: st.pct_current,
        pct_changes_requested: st.pct_changes_requested, user_stats_fetch_error: st.fetch_error,
      });
    } else {
      Object.assign(s, {
        current_count: 0, changes_requested_count: 0, total_count: 0, pct_current: 0,
        pct_changes_requested: 0, user_stats_fetch_error: s.translator !== "unknown",
      });
    }
  }
}

async function statsStage(fetcher, ctx, usernames, force, log, progress, isStopped, from = 88, span = 7) {
  const out = {};
  for (let i = 0; i < usernames.length; i++) {
    if (isStopped()) { log("INFO", `Stop requested — halting user stats after ${i}/${usernames.length}`); break; }
    log("INFO", `User stats ${i + 1}/${usernames.length}: ${usernames[i]}`);
    out[usernames[i]] = await fetchUserCounts(fetcher, ctx, usernames[i], force, log);
    progress(from + ((i + 1) / Math.max(usernames.length, 1)) * span, `Translator stats ${i + 1}/${usernames.length}`);
  }
  return out;
}

/** "Refresh translator stats only" (stats_only.py): re-run Stage 4 on a stored run. */
export async function refreshStats({ run, fetcher, force = true, log = () => {}, progress = () => {}, signal }) {
  const ctx = { project: run.project, subproject: run.subproject, locale: run.locale };
  const users = run.summaries.map((s) => s.translator).filter((t) => t !== "unknown");
  const stopped = () => !!signal?.aborted;
  let counts;
  try { counts = await statsStage(fetcher, ctx, users, force, log, progress, stopped, 0, 100); }
  catch (e) { if (!(e instanceof StopError)) throw e; counts = {}; }
  const summaries = run.summaries.map((s) => ({ ...s }));
  // keep previous numbers for users that were not refreshed (e.g. stopped early)
  applyUserCounts(summaries, counts);
  return { ...run, summaries };
}

// ---------------------------------------------------------------------------
export async function runPipeline({ project, subproject, locale, force = false, fetcher,
                                    signal, log = () => {}, progress = () => {} }) {
  const stopped = () => !!signal?.aborted;
  const ctx = { project, subproject, locale };
  const ts = timestamp();
  const allEntries = [];

  try {
    // ---- Stage 1
    log("INFO", `=== Stage 1: Listing pages — project: ${project} (${subproject}, ${locale}) ===`);
    const page1 = await fetcher.fetchUrl(listingUrl({ ...ctx, page: 1 }), { force });
    if (!page1) {
      log("ERROR", "Could not fetch listing page 1. Aborting.");
      return null;
    }
    const totalPages = getTotalPages(page1);
    log("INFO", `Total listing pages: ${totalPages}`);
    for (let p = 1; p <= totalPages; p++) {
      if (stopped()) { log("INFO", `Stop requested — halting after page ${p - 1}`); break; }
      const html = p === 1 ? page1 : await fetcher.fetchUrl(listingUrl({ ...ctx, page: p }), { force });
      if (!html) { log("WARNING", `Failed to fetch page ${p} — skipping`); continue; }
      allEntries.push(...parseListingPage(html, p, log));
      progress((p / totalPages) * 30, `Listing ${p}/${totalPages}`);
    }
    log("INFO", `Stage 1 complete: ${allEntries.length} total entries`);

    // ---- Stage 2 (discussion pages are not in the listing HTML; one-hop follow)
    log("INFO", "=== Stage 2: Discussion pages ===");
    const hopCache = new Map();
    for (let i = 0; i < allEntries.length; i++) {
      if (stopped()) { log("INFO", `Stop requested at entry ${i + 1}/${allEntries.length}`); break; }
      const entry = allEntries[i];
      const url = discussionUrl({ ...ctx, originalId: entry.original_id });
      log("INFO", `Discussion ${i + 1}/${allEntries.length}: orig=${entry.original_id}`);
      const html = await fetcher.fetchUrl(url, { force });
      if (!html) {
        log("WARNING", `Failed to fetch discussion for orig=${entry.original_id}`);
        entry.fetch_error = true; continue;
      }
      const comments = parseDiscussionPage(html);
      entry.discussion_comments = comments;
      const hop = comments.find((c) => c.discussion_hop_url)?.discussion_hop_url || "";
      if (hop) {
        entry.discussion_hop_url = hop;
        if (hopCache.has(hop)) entry.hop_comments = hopCache.get(hop);
        else {
          log("INFO", `Following hop: ${hop}`);
          const hopHtml = await fetcher.fetchUrl(hop, { force });
          if (hopHtml) {
            const hc = parseDiscussionPage(hopHtml);
            hopCache.set(hop, hc); entry.hop_comments = hc;
          } else { log("WARNING", `Failed to fetch hop URL: ${hop}`); entry.fetch_error = true; }
        }
      }
      progress(30 + ((i + 1) / allEntries.length) * 55, `Discussion ${i + 1}/${allEntries.length}`);
    }
    log("INFO", "Stage 2 complete");
  } catch (e) {
    if (!(e instanceof StopError)) throw e;
    log("INFO", "Stopped — using what was collected so far.");
  }

  // ---- Stage 3
  log("INFO", "=== Stage 3: Categorization ===");
  progress(85, "Categorizing…");
  allEntries.forEach(categorizeEntry);
  const summaries = buildTranslatorSummary(allEntries);

  // ---- Stage 4
  log("INFO", "=== Stage 4: Per-translator status counts ===");
  progress(88, "Fetching translator stats…");
  const users = [...new Set(allEntries.map((e) => e.translated_by).filter(Boolean))].sort();
  let counts = {};
  try { counts = await statsStage(fetcher, ctx, users, force, log, progress, stopped); }
  catch (e) { if (!(e instanceof StopError)) throw e; }
  applyUserCounts(summaries, counts);
  log("INFO", "Stage 4 complete");

  const rows = {};
  for (const e of allEntries) (rows[e.translated_by || "unknown"] ||= []).push(flattenEntry(e));
  progress(100, "Done");
  return {
    id: `${project}_${subproject}_${ts}`, project, subproject, locale, ts,
    createdAt: Date.now(), stopped: stopped(), summaries, rows,
  };
}
