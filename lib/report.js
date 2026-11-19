// report.js — port of qa_report.py. Detection rules come from rules.toml, wording from sentences_xx.toml.
import { parse as parseToml } from "./toml.js";

export const LANGS = ["en", "es"];
export const LANGUAGES = {
  es_CL: "Spanish (Chile)", es_ES: "Spanish (Spain)", es_MX: "Spanish (Mexico)",
  es_AR: "Spanish (Argentina)", es_CO: "Spanish (Colombia)", pt_BR: "Portuguese (Brazil)",
  pt_PT: "Portuguese (Portugal)", fr_FR: "French (France)", de_DE: "German",
  it_IT: "Italian", nl_NL: "Dutch", pl_PL: "Polish", ru_RU: "Russian",
};
export const SUMMARY_RE = /^(?<prefix>.+)_summary_(?<ts>\d{8}_\d{6})\.csv$/;
export const PROJECT_RE = /^(?<slug>.+)_(?<branch>stable-readme|dev-readme|stable|dev)$/;
const PAIR_RE = /“([^”]+)”\s*→\s*“([^”]+)”/g;
const GLOSS_RE = /“([^”]+)”\s*(?:–>|->|→|=>)\s*(.+?)(?=;\s|\.\s|\.$|$)/g;
const WORD_RE = /\p{L}+/gu;
const OPENERS = " \t“”\"'‘’«»([{*_-";

// ---------------------------------------------------------------- small helpers (Python parity)
export const fmt = (text, ctx) => text.replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? String(ctx[k]) : m));
export const cap1 = (s) => s.slice(0, 1).toUpperCase() + s.slice(1);
const cpLen = (s) => Array.from(s).length;
export const plural = (n, ui) => `${n} ${n === 1 ? ui.string_one : ui.string_many}`;

/** Python f"{x:.1f}" (round-half-even on exact ties) */
function fixed1(x) {
  const x4 = x * 4;
  if (Number.isInteger(x4) && x4 % 2 !== 0) {         // the only exact ties at 1 decimal are odd/4
    const t = Math.floor(x * 10);
    return ((t % 2 === 0 ? t : t + 1) / 10).toFixed(1);
  }
  return x.toFixed(1);
}
export const pct = (part, whole, dec = ".") => `${fixed1(whole ? (100 * part) / whole : 0)}%`.replace(".", dec);

export function toInt(v, def = 0) {
  if (v === null || v === undefined) return def;
  const s = String(v).trim();
  if (s === "") return def;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}
const humanList = (items, na = "n/a") => { items = items.filter(Boolean); return items.length ? items.join(", ") : na; };

const inc = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const mostCommon = (m, n) => { const a = [...m.entries()].sort((x, y) => y[1] - x[1]); return n == null ? a : a.slice(0, n); };

const reCache = new Map();
function rx(p) {
  if (!reCache.has(p)) {
    try { reCache.set(p, new RegExp(p, "i")); }
    catch (e) { throw new Error(`Invalid regular expression in rules.toml: ${p} (${e.message})`); }
  }
  return reCache.get(p);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Python html.unescape (entities only, tags are left alone). */
export function unescapeHtml(s) {
  s = s || "";
  if (!s.includes("&")) return s;
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

// ---------------------------------------------------------------- difflib.SequenceMatcher.ratio()
function seqRatio(aStr, bStr) {
  const a = Array.from(aStr), b = Array.from(bStr);
  const la = a.length, lb = b.length;
  if (la + lb === 0) return 1;
  const b2j = new Map();
  b.forEach((ch, j) => { if (!b2j.has(ch)) b2j.set(ch, []); b2j.get(ch).push(j); });
  if (lb >= 200) {                                    // autojunk
    const ntest = Math.floor(lb / 100) + 1;
    for (const [ch, idx] of [...b2j]) if (idx.length > ntest) b2j.delete(ch);
  }
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0, j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matches) / (la + lb);
}
const similar = (a, b, th = 0.75) => seqRatio(a.toLowerCase(), b.toLowerCase()) >= th;

// ---------------------------------------------------------------- bank / language
export function loadBank(rulesText, wordingText) {
  const rules = parseToml(rulesText), words = parseToml(wordingText);
  const byKey = Object.fromEntries((words.issues || []).map((i) => [i.key, i]));
  const issues = rules.issues.map((rule) => {
    if (!byKey[rule.key]) throw new Error(`The wording file is missing an [[issues]] block with key = "${rule.key}"`);
    return { ...rule, ...byKey[rule.key] };
  });
  return { ...words, settings: rules.settings, tiers: rules.tiers, usted_to_tu: rules.usted_to_tu || {}, issues };
}

const WB = (alts) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alts})(?![\\p{L}\\p{N}_])`, "giu");
const ES_MARK = WB("hola|gracias|traducci[oó]n|traducciones|est[aá]n?|usando|t[eé]rminos|glosario|ustedeo|may[uú]sculas|comillas|cambios sugeridos|por traducir");
const EN_MARK = WB("hi|hello|thanks|thank|translation|translations|this|terms|glossary|using|following|please|suggested changes");

export function detectReportLang(rows) {
  let es = 0, en = 0;
  for (const r of rows) {
    const text = (r.comment_text_clean || "").replace(/https?:\/\/\S+/g, "");
    es += (text.match(ES_MARK) || []).length;
    en += (text.match(EN_MARK) || []).length;
  }
  return es > en ? "es" : "en";
}

// ---------------------------------------------------------------- classification
export function splitComments(text) {
  const out = [], seen = new Set();
  for (let frag of (text || "").split(/\s*\|\|\s*/)) {
    frag = frag.replace(/\s*Comment Reasons:.*$/, "").trim();
    if (frag && !seen.has(frag)) { seen.add(frag); out.push(frag); }
  }
  return out;
}

function classify(row, issues, unmatched) {
  const keys = [];
  const tags = (row.reason_tags || "").split(",").map((t) => t.trim()).filter(Boolean);
  for (const frag of splitComments(row.comment_text_clean || "")) {
    let matched = false;
    for (const iss of issues) {
      if ((iss.comment_patterns || []).some((p) => rx(p).test(frag))) {
        matched = true;
        if (!keys.includes(iss.key)) keys.push(iss.key);
      }
    }
    if (!matched && issues.some((iss) => (iss.recognized_patterns || []).some((p) => rx(p).test(frag)))) matched = true;
    if (!matched && !/^(?:Please use our glossary.*)$/.test(frag)) inc(unmatched, frag.slice(0, 140));
  }
  for (const iss of issues) {
    if (keys.includes(iss.key)) continue;
    if ((iss.tag_patterns || []).some((p) => tags.some((t) => rx(p).test(t)))) keys.push(iss.key);
  }
  return keys;
}

function glossaryPairs(row) {
  const out = [], seen = new Set();
  for (let frag of splitComments(row.comment_text_clean || "")) {
    frag = frag.replace(/https?:\/\/\S+/g, "");
    if (!/glosari|glossary/i.test(frag)) continue;
    for (const m of frag.matchAll(GLOSS_RE)) {
      const key = m[1].toLowerCase() + "\u0000" + m[2].toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push([m[1].trim(), m[2].trim()]); }
    }
  }
  return out;
}
const norm = (s) => s.toLowerCase().replace(/[-\s]/g, "");
const glossaryForRow = (row, pairs) => {
  const src = norm(unescapeHtml(row.original_raw || ""));
  return pairs.filter(([t]) => src.includes(norm(t)));
};

const isUpper = (ch) => /\p{Lu}/u.test(ch);
function midSentenceWords(text) {
  text = unescapeHtml(text || "");
  const out = [];
  for (const m of text.matchAll(WORD_RE)) {
    const w = m[0], chars = Array.from(w);
    if (chars.length < 2 || !isUpper(chars[0]) || chars.slice(1).some(isUpper)) continue;
    let end = m.index;
    while (end > 0 && OPENERS.includes(text[end - 1])) end--;
    if (end === 0 || ".!?¿¡:…|\n".includes(text[end - 1])) continue;
    out.push(w);
  }
  return out;
}
function midSentenceCaps(translation, ignore) {
  const seen = new Set(), out = [];
  for (const w of midSentenceWords(translation)) {
    if (!ignore.has(w) && !seen.has(w.toLowerCase())) { seen.add(w.toLowerCase()); out.push(w); }
  }
  return out;
}
const hasWord = (text, word) => new RegExp(`(?<!\\p{L})${escapeRe(word)}(?!\\p{L})`, "iu").test(text);

function ustedPairs(row, mapping) {
  const text = unescapeHtml(row.translation_text || "");
  const out = [], seen = new Set();
  for (const [, a, b] of (row.comment_text_clean || "").matchAll(PAIR_RE)) {
    if (hasWord(text, a) && !seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); out.push([a.toLowerCase(), b.toLowerCase()]); }
  }
  for (const [usted, tu] of Object.entries(mapping)) {
    if (!seen.has(usted.toLowerCase()) && hasWord(text, usted)) { seen.add(usted.toLowerCase()); out.push([usted.toLowerCase(), tu.toLowerCase()]); }
  }
  return out;
}

// ---------------------------------------------------------------- text pieces
function cleanCell(text, limit) {
  text = unescapeHtml(text || "").replace(/\n/g, " ").trim().replace(/\s+/g, " ");
  const cps = Array.from(text);
  if (cps.length > limit) text = cps.slice(0, limit - 1).join("").trimEnd() + "…";
  return "`" + text.replace(/`/g, "'").replace(/\|/g, "\\|") + "`";
}
const mdCell = (t) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");
const fmtDate = (d, months) => `${d.d} ${months[d.m - 1]} ${d.y}`;

export function detectLanguage(rows) {
  const codes = new Map();
  for (const r of rows) for (const m of (r.comment_text_clean || "").matchAll(/\b([a-z]{2,3}_[A-Z]{2})\b/g)) inc(codes, m[1]);
  return codes.size ? mostCommon(codes, 1)[0][0] : "";
}
export function defaultLanguagePair(rows, ui, languages) {
  const code = detectLanguage(rows);
  if (!code) return ui.language_pair_nocode;
  return ui.language_pair.replace("{name}", (languages || LANGUAGES)[code] || code).replace("{code}", code);
}
export function defaultReviewer(rows) {
  if (!rows.length) return "";
  const c = new Map();
  for (const r of rows) inc(c, r.last_updated_by || "");
  return mostCommon(c, 1)[0][0];
}
export const dateFromTs = (ts) => ({ y: +ts.slice(0, 4), m: +ts.slice(4, 6), d: +ts.slice(6, 8) });
export const parseIsoDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };

export function pdfFilename(prefix, username, d) {
  const slug = prefix.replace(/_(stable-readme|dev-readme|stable|dev)$/, "");
  const safe = (s) => s.replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/g, "");
  const p = (n, w) => String(n).padStart(w, "0");
  return `QA_report_${safe(slug)}_${safe(username)}_${d.y}${p(d.m, 2)}${p(d.d, 2)}.pdf`;
}

/** Filename-based pairing, same rules as discover() — works on a list of {name} objects. */
export function discoverFiles(files) {
  const jobs = [];
  const sums = files.filter((f) => SUMMARY_RE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const s of sums) {
    const m = SUMMARY_RE.exec(s.name), suffix = `_qa_${m.groups.ts}.csv`, pre = m.groups.prefix + "_";
    for (const q of files.filter((f) => f.name.startsWith(pre) && f.name.endsWith(suffix) && f.name.length >= pre.length + suffix.length)
                         .sort((a, b) => a.name.localeCompare(b.name))) {
      jobs.push({ summary: s, qa: q, user: q.name.slice(pre.length, q.name.length - suffix.length),
                  prefix: m.groups.prefix, ts: m.groups.ts });
    }
  }
  return jobs;
}

// ---------------------------------------------------------------- the report
/**
 * @param summary  summary row of the translator (object)
 * @param rowsIn   detail rows (objects with the CSV columns)
 * @param args     {name, reviewer, project, locale, status, submitted, reviewed, date:{y,m,d}} (all optional)
 * @param pick     (variants[]) => one variant   (Math.random based in the UI)
 * @returns {text, fname, unmatched: [[fragment, count], ...]}
 */
export function buildReport(summary, rowsIn, user, prefix, ts, bank, args, pick) {
  const rows = rowsIn.map((r) => ({ ...r }));
  const st = bank.settings, ui = bank.ui, dec = ui.decimal;
  const P = (part, whole) => pct(part, whole, dec);
  const issues = bank.issues;
  const issueByKey = Object.fromEntries(issues.map((i) => [i.key, i]));
  issueByKey.other = { key: "other", ...bank.other };
  const ustedMap = bank.usted_to_tu || {};
  const capsIgnore = new Set(st.caps_ignore || []);
  const languages = { ...LANGUAGES, ...(bank.languages || {}) };

  const unmatched = new Map();
  for (const r of rows) {
    r._issues = classify(r, issues, unmatched);
    if (!r._issues.length) r._issues = ["other"];
    r._gl = glossaryForRow(r, glossaryPairs(r));
    r._ust = r._issues.includes("formal_address") ? ustedPairs(r, ustedMap) : [];
    const cap = r._issues.includes("capitalization");
    r._caps = cap ? midSentenceCaps(r.translation_text, capsIgnore) : [];
    r._carry = cap ? midSentenceWords(r.original_raw).length > 0 : false;
  }

  // ---- core numbers
  const changes = rows.length || toInt(summary.changes_requested_count);
  const approved = toInt(summary.current_count);
  const total = toInt(summary.total_count) || approved + changes;
  const submitted = args.submitted || total;
  const reviewed = args.reviewed || total;
  const rated = approved + changes || reviewed;
  const pctChangesVal = rated ? (100 * changes) / rated : 0;

  // ---- issue stats
  const counts = new Map();
  for (const r of rows) for (const k of r._issues) inc(counts, k);
  const order = Object.fromEntries(issues.map((i, n) => [i.key, n]));
  const ranked = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || (order[a] ?? 99) - (order[b] ?? 99));
  const cnt = (k) => counts.get(k) || 0;
  const tagCounter = new Map();
  for (const r of rows) for (const t of (r.reason_tags || "").split(",")) if (t.trim()) inc(tagCounter, t.trim());

  const glCount = new Map(), glApproved = new Map(), glLabel = new Map();
  for (const r of rows) for (const [term, appr] of r._gl) {
    const key = term.toLowerCase();
    inc(glCount, key);
    if (!glLabel.has(key)) glLabel.set(key, term);
    if (!glApproved.has(key)) glApproved.set(key, new Map());
    inc(glApproved.get(key), appr);
  }
  const termsTxt = mostCommon(glCount).map(([k]) => `“${glLabel.get(k)}”`).join(", ") || ui.na;

  const pairCounter = new Map(), pairVal = new Map();
  for (const r of rows) for (const pr of r._ust) {
    const k = pr[0] + "\u0000" + pr[1]; pairVal.set(k, pr); inc(pairCounter, k);
  }
  const corrections = humanList(mostCommon(pairCounter, st.top_corrections).map(([k]) => `“${pairVal.get(k)[0]}” → “${pairVal.get(k)[1]}”`), ui.na);

  const capCounter = new Map();
  for (const r of rows) for (const w of r._caps) inc(capCounter, w);
  const capWords = humanList(mostCommon(capCounter, st.top_words).map(([w]) => `“${w}”`), ui.na);
  const carry = rows.filter((r) => r._carry).length;

  const ictx = (key) => {
    const n = cnt(key);
    return { count: n, count_strings: plural(n, ui), pct_flagged: P(n, changes), pct_reviewed: P(n, rated),
             corrections, terms: termsTxt, cap_words: capWords, carryover_count: carry,
             carryover_pct: P(carry, n), tags: [...tagCounter.keys()].join(", ") || ui.na };
  };

  const code = detectLanguage(rows);
  const languageName = languages[code] || code || ui.target_language;
  const language = args.locale || defaultLanguagePair(rows, ui, languages);
  const contributor = args.name ? `${args.name} (${user})` : user;
  const reviewer = args.reviewer || defaultReviewer(rows);
  const pm = PROJECT_RE.exec(prefix);
  const project = args.project || (pm ? `${pm.groups.slug} (${pm.groups.branch})` : prefix);
  const d = args.date || dateFromTs(ts);
  const status = (ui.status_map || {})[args.status] ?? args.status;

  const top = ranked[0] ?? null, second = ranked[1] ?? null;
  const union2 = rows.filter((r) => r._issues.includes(top) || (second && r._issues.includes(second))).length;
  const ctx = {
    contributor, reviewer, project, language, locale_name: languageName,
    total, submitted, reviewed, approved, changes, rated,
    pct_approved: P(approved, rated), pct_changes: P(changes, rated), pct_sample: P(reviewed, submitted),
    flagged: changes,
    top_issue: top ? issueByKey[top].short : "", top_issue_count: top ? cnt(top) : 0,
    top_issue_pct: top ? P(cnt(top), changes) : "", second_issue: second ? issueByKey[second].short : "",
    top2_pct: P(union2, changes),
  };

  const purpose = fmt(pick(bank.purpose[reviewed === submitted ? "full" : "sample"]), ctx);

  const tier = changes === 0 ? "perfect" : bank.tiers.find((t) => pctChangesVal < t.max_pct).name;
  const parts = [fmt(pick(bank.overview[tier]), ctx)];
  if (top) {
    if (ranked.length === 1) parts.push(fmt(pick(bank.focus.single_issue), ctx));
    else if (union2 / changes >= st.concentration_threshold) parts.push(fmt(pick(bank.focus.concentration), ctx));
    else parts.push(fmt(pick(bank.focus[cnt(top) / changes >= st.dominant_threshold ? "dominant" : "spread"]), ctx));
  }
  for (const k of ranked) {
    if (issueByKey[k].finding_note) {
      if (k === "capitalization" && carry < st.carryover_min_share * cnt(k)) continue;
      parts.push(fmt(pick(issueByKey[k].finding_note), { ...ctx, ...ictx(k) }));
    }
  }
  const findings = parts.map(cap1).join(" ");

  // ---- tables
  const statusTbl = [`| ${ui.col_status[0]} | ${ui.col_status[1]} | ${ui.col_status[2]} |`, "| --- | --- | --- |",
    `| ${ui.row_approved} | ${approved} | ${P(approved, rated)} |`,
    `| ${ui.row_changes} | ${changes} | ${P(changes, rated)} |`];
  const catTbl = [`| ${ui.col_category[0]} | ${ui.col_category[1]} | ${ui.col_category[2]} |`, "| --- | --- | --- |"];
  for (const k of ranked) {
    const c = ictx(k);
    catTbl.push(`| ${mdCell(issueByKey[k].label)} | ${c.count} (${c.pct_flagged}) | ${mdCell(fmt(issueByKey[k].rule, c))} |`);
  }

  // ---- examples
  const limit = st.max_example_chars, nEx = st.max_examples;
  const concrete = (r, k) => (k === "formal_address" && r._ust.length) || (k === "glossary" && r._gl.length) ||
    (k === "capitalization" && r._caps.length);
  const pools = {};
  for (const k of ranked) {
    const pool = rows.filter((r) => r._issues.includes(k));
    const short = new Set(pool.filter((r) => cpLen(r.original_raw) <= limit && cpLen(r.translation_text) <= limit));
    const key = (r) => [!concrete(r, k), !short.has(r), cpLen(r.original_raw)];
    pool.sort((x, y) => { const a = key(x), b = key(y); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Number(a[i]) - Number(b[i]); return 0; });
    const cands = [];
    for (const r of pool) {
      if (!cands.some((c) => similar(r.original_raw, c.original_raw))) cands.push(r);
      if (cands.length >= 4) break;
    }
    pools[k] = cands;
  }
  const picked = [], used = new Set();
  for (let round = 0; round < nEx; round++) {
    for (const k of ranked) {
      if (picked.length >= nEx) break;
      const nxt = pools[k].find((r) => !used.has(r.original_id));
      if (nxt) { used.add(nxt.original_id); picked.push([k, nxt]); }
    }
  }
  const exTbl = [`| ${ui.col_examples[0]} | ${ui.col_examples[1]} | ${ui.col_examples[2]} |`, "| --- | --- | --- |"];
  for (const [k, r] of picked) {
    let obs = fmt(pick(issueByKey[k].observation), ictx(k));
    if (k === "formal_address" && r._ust.length) obs += ` ${ui.suggested}: ` + r._ust.slice(0, 2).map(([a, b]) => `“${a}” → “${b}”`).join(", ") + ".";
    if (k === "glossary" && r._gl.length) obs += ` ${ui.approved_label}: ` + r._gl.slice(0, 2).map(([t, a]) => `“${t}” → ${a}`).join("; ") + ".";
    if (k === "capitalization" && r._caps.length) obs += ` ${ui.lowercase_label}: ` + r._caps.slice(0, 2).map((w) => `“${w}”`).join(", ") + ".";
    exTbl.push(`| ${cleanCell(r.original_raw, limit)} | ${cleanCell(r.translation_text, limit)} | ${mdCell(obs)} |`);
  }

  // ---- glossary table
  const gs = bank.glossary_section;
  let glossBlock = [];
  if (gs && glCount.size) {
    glossBlock = ["## " + gs.heading, "", pick(gs.intro), "",
      `| ${ui.col_glossary[0]} | ${ui.col_glossary[1]} | ${ui.col_glossary[2]} |`, "| --- | --- | --- |"];
    for (const [key, n] of mostCommon(glCount, st.max_glossary_terms))
      glossBlock.push(`| ${mdCell(glLabel.get(key))} | ${mdCell(mostCommon(glApproved.get(key), 1)[0][0])} | ${n} |`);
    glossBlock.push("");
  }

  // ---- areas + checklist
  const areas = ranked.map((k) => `- **${cap1(issueByKey[k].short)}**: ${fmt(pick(issueByKey[k].action), ictx(k))}`);
  const checklist = [];
  for (const k of ranked) { const c = pick(issueByKey[k].checklist); checklist.push(`- [ ] **${c.item}**: ${fmt(c.step, ictx(k))}`); }
  for (const c of bank.checklist_general || []) checklist.push(`- [ ] **${c.item}**: ${c.step}`);

  const md = [
    `# ${ui.title}`, "",
    `- **${ui.m_contributor}:** ${contributor}`, `- **${ui.m_project}:** ${project}`,
    `- **${ui.m_pair}:** ${language}`, `- **${ui.m_status}:** ${status}`,
    `- **${ui.m_submitted}:** ${submitted}`, `- **${ui.m_reviewed}:** ${reviewed}`,
    `- **${ui.m_reviewer}:** ${reviewer}`, `- **${ui.m_date}:** ${fmtDate(d, ui.months)}`, "",
    `## ${ui.h_purpose}`, "", purpose, "",
    `## ${ui.h_findings}`, "", findings, "", ...statusTbl, "",
    `## ${ui.h_categories}`, "", ...catTbl, "", fmt(ui.footnote, { changes }), "",
    `## ${ui.h_examples}`, "", ...exTbl, "",
    ...glossBlock,
    `## ${ui.h_areas}`, "", ...areas, "",
    `## ${ui.h_checklist}`, "", ...checklist, "",
  ];
  return { text: md.join("\n"), fname: `QA_report_${prefix}_${user}_${ts.slice(0, 8)}_${ui.lang}.md`,
           unmatched: mostCommon(unmatched, 5) };
}
