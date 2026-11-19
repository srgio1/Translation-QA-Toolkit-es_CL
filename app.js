import { FETCH_DEFAULTS, SUBPROJECTS, listingUrl } from "./lib/config.js";
import { DEFAULT_FILES } from "./lib/defaults.js";
import { dbAll, dbClear, dbCount, dbDelete, dbPut } from "./lib/db.js";
import { Fetcher, detectSession } from "./lib/fetcher.js";
import { refreshStats, runPipeline, runToCsvFiles } from "./lib/pipeline.js";
import { parseCsv } from "./lib/csv.js";
import { mdToHtml } from "./lib/markdown.js";
import * as R from "./lib/report.js";

const api = globalThis.browser ?? globalThis.chrome;
const $ = (s) => document.querySelector(s);
const store = {
  get: async (k, d) => { const o = await api.storage.local.get(k); return o[k] ?? d; },
  set: (k, v) => api.storage.local.set({ [k]: v }),
};
const PAGES = { carta: [215.9, 279.4], oficio: [215.9, 330.0] };

// ================================================================== tabs
for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    for (const x of document.querySelectorAll(".tabs button")) x.setAttribute("aria-selected", String(x === b));
    for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== `tab-${b.dataset.tab}`;
  });
}
const showTab = (name) => document.querySelector(`.tabs button[data-tab="${name}"]`).click();

function download(name, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ================================================================== FETCH TAB
let abort = null;
let runs = [];
let lastRun = null;
let loggedIn = false;

$("#subproject").innerHTML = SUBPROJECTS.map((s) => `<option>${s}</option>`).join("");

const fetchFields = { slug: "#slug", subproject: "#subproject", locale: "#locale", delayMin: "#delayMin",
                      delayMax: "#delayMax", retries: "#retries", timeout: "#timeout" };

async function loadFetchForm() {
  const saved = await store.get("fetchForm", {});
  const v = { locale: FETCH_DEFAULTS.locale, delayMin: FETCH_DEFAULTS.delayMin, delayMax: FETCH_DEFAULTS.delayMax,
              retries: FETCH_DEFAULTS.maxRetries, timeout: FETCH_DEFAULTS.timeoutSec, subproject: "stable", slug: "", ...saved };
  for (const [k, sel] of Object.entries(fetchFields)) $(sel).value = v[k];
  updateUrlPreview();
}
function readFetchForm() {
  const v = {};
  for (const [k, sel] of Object.entries(fetchFields)) v[k] = $(sel).value.trim();
  return v;
}
function updateUrlPreview() {
  const v = readFetchForm();
  $("#urlPreview").textContent = v.slug && v.locale
    ? listingUrl({ project: v.slug, subproject: v.subproject, locale: v.locale, page: 1 })
    : "Enter a project slug to preview the listing URL.";
}
for (const sel of Object.values(fetchFields)) $(sel).addEventListener("input", () => { updateUrlPreview(); store.set("fetchForm", readFetchForm()); });

function log(level, msg) {
  const box = $("#log");
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  const line = document.createElement("div");
  line.className = level; line.textContent = `${new Date().toLocaleTimeString()}  ${level.padEnd(7)} ${msg}`;
  box.appendChild(line);
  while (box.childNodes.length > 3000) box.removeChild(box.firstChild);
  if (stick) box.scrollTop = box.scrollHeight;
}
const setProgress = (pct, label) => { $("#bar").style.width = `${pct}%`; $("#barLabel").textContent = label; };
$("#clearLog").addEventListener("click", () => { $("#log").textContent = ""; });

async function refreshCacheInfo() { $("#cacheInfo").textContent = `Cache: ${await dbCount("pages")} page(s)`; }
$("#clearCache").addEventListener("click", async () => {
  if (confirm("Delete all cached pages?")) { await dbClear("pages"); refreshCacheInfo(); log("INFO", "Cache cleared."); }
});

async function checkSession() {
  const el = $("#session");
  el.className = "session"; el.textContent = "Session: checking…";
  loggedIn = await detectSession();
  el.className = "session " + (loggedIn ? "on" : "off");
  el.textContent = loggedIn ? "translate.wordpress.org: logged in" : "translate.wordpress.org: not logged in (public pages only)";
}

function makeFetcher(v, signal) {
  return new Fetcher({
    delayMin: Math.max(0, parseFloat(v.delayMin) || 0), delayMax: Math.max(0, parseFloat(v.delayMax) || 0),
    maxRetries: parseInt(v.retries, 10) || 5, timeoutSec: parseInt(v.timeout, 10) || 20,
    signal, log, namespace: loggedIn ? "auth" : "anon",
  });
}

function setRunning(on) {
  $("#start").disabled = on; $("#stop").disabled = !on;
  $("#refreshStats").disabled = on; $("#toReport").disabled = on;
}

$("#start").addEventListener("click", async () => {
  const v = readFetchForm();
  if (!v.slug || !/^[\w-]+$/.test(v.slug)) { alert("Enter a project slug (letters, numbers, hyphens and underscores only)."); return; }
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(v.locale)) { alert("Locale should look like es-cl or pt-br."); return; }
  abort = new AbortController();
  setRunning(true); setProgress(0, "Running…");
  await checkSession();
  log("INFO", `Starting: ${v.slug} / ${v.subproject} / ${v.locale} (${loggedIn ? "logged-in session" : "public pages"})`);
  try {
    const run = await runPipeline({
      project: v.slug, subproject: v.subproject, locale: v.locale.toLowerCase(), force: $("#force").checked,
      fetcher: makeFetcher(v, abort.signal), signal: abort.signal, log, progress: setProgress,
    });
    if (run) { await saveRun(run); showResults(run); log("INFO", `Done. ${Object.keys(run.rows).length} translator(s).`); }
  } catch (e) {
    log("ERROR", `Pipeline error: ${e.message}`); console.error(e);
  } finally {
    abort = null; setRunning(false); refreshCacheInfo();
  }
});
$("#stop").addEventListener("click", () => { abort?.abort(); $("#stop").disabled = true; log("INFO", "Stop requested…"); });

function showResults(run) {
  lastRun = run;
  $("#results").hidden = false;
  $("#resultsTitle").textContent = `Results — ${run.project} (${run.subproject}, ${run.locale})${run.stopped ? " — stopped early" : ""}`;
  const head = ["Translator", "Flagged", "Glossary", "Style guide", "AI?", "Other", "Approved", "Changes req.", "Approved %"];
  const rows = run.summaries.map((s) => {
    const bad = s.user_stats_fetch_error ? ' class="bad" title="Stats could not be read"' : "";
    return `<tr><td>${esc(s.translator)}</td><td>${s.total_flagged}</td><td>${s.glossary_count}</td><td>${s.style_guide_count}</td>` +
      `<td>${s.bad_quality_ai_count}</td><td>${s.other_count}</td><td${bad}>${s.current_count}</td><td${bad}>${s.changes_requested_count}</td>` +
      `<td${bad}>${Number(s.pct_current).toFixed(1)}</td></tr>`;
  }).join("");
  $("#summaryTable").innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>`;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

$("#dlCsv").addEventListener("click", async () => {
  if (!lastRun) return;
  for (const f of runToCsvFiles(lastRun)) { download(f.name, f.text, "text/csv;charset=utf-8"); await new Promise((r) => setTimeout(r, 250)); }
});
$("#toReport").addEventListener("click", async () => {
  if (!lastRun) return;
  await rebuildSources(`run:${lastRun.id}`); showTab("report");
});
$("#refreshStats").addEventListener("click", async () => {
  if (!lastRun) return;
  abort = new AbortController(); setRunning(true); setProgress(0, "Refreshing stats…");
  await checkSession();
  const v = readFetchForm();
  try {
    const run = await refreshStats({ run: lastRun, fetcher: makeFetcher(v, abort.signal), force: true, log, progress: setProgress, signal: abort.signal });
    await saveRun(run); showResults(run); setProgress(100, "Done");
  } catch (e) { log("ERROR", `Stats error: ${e.message}`); }
  finally { abort = null; setRunning(false); }
});

async function saveRun(run) {
  await dbPut("runs", run);
  runs = (await dbAll("runs")).sort((a, b) => b.createdAt - a.createdAt);
  await rebuildSources(`run:${run.id}`);
}

// ================================================================== REPORT TAB
let imported = [];            // datasets from imported CSV files
let datasets = [];
const lastReport = { fname: "QA_report.md", pdfName: "QA_report.pdf", lang: null };
let dirty = false;

const dsFromRun = (run) => ({
  id: `run:${run.id}`, label: `${run.project} (${run.subproject}) — ${run.ts.slice(0, 8)} ${run.ts.slice(9, 15).replace(/(..)(..)(..)/, "$1:$2:$3")}`,
  prefix: `${run.project}_${run.subproject}`, ts: run.ts, runId: run.id,
  users: Object.keys(run.rows).map((u) => ({ user: u, summary: run.summaries.find((s) => s.translator === u) || {}, rows: run.rows[u] })),
});

async function rebuildSources(selectId) {
  datasets = [...runs.map(dsFromRun), ...imported];
  const sel = $("#source");
  const keep = selectId || sel.value;
  sel.innerHTML = datasets.length ? datasets.map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join("")
                                  : `<option value="">(no data yet — fetch or import CSVs)</option>`;
  if (datasets.some((d) => d.id === keep)) sel.value = keep;
  onSourceChange();
}
const currentDs = () => datasets.find((d) => d.id === $("#source").value);
const currentUser = () => currentDs()?.users.find((u) => u.user === $("#translator").value);

function onSourceChange() {
  const ds = currentDs();
  $("#translator").innerHTML = ds ? ds.users.map((u) => `<option>${esc(u.user)}</option>`).join("") : "";
  $("#deleteRun").hidden = !ds?.runId;
  if (ds) { const first = ds.users.find((u) => u.user !== "unknown") || ds.users[0]; if (first) $("#translator").value = first.user; }
  onTranslatorChange();
}

function onTranslatorChange() {
  const ds = currentDs(), u = currentUser();
  if (!ds || !u) return;
  const m = R.PROJECT_RE.exec(ds.prefix);
  const total = R.toInt(u.summary.total_count) || (R.toInt(u.summary.current_count) + u.rows.length);
  const d = R.dateFromTs(ds.ts), p = (n) => String(n).padStart(2, "0");
  $("#f_name").value = "";
  $("#f_reviewer").value = R.defaultReviewer(u.rows);
  $("#f_project").value = m ? `${m.groups.slug} (${m.groups.branch})` : ds.prefix;
  $("#f_language").value = "";
  $("#f_submitted").value = String(total);
  $("#f_reviewed").value = String(total);
  $("#f_date").value = `${d.y}-${p(d.m)}-${p(d.d)}`;
}
$("#source").addEventListener("change", () => { onSourceChange(); });
$("#translator").addEventListener("change", onTranslatorChange);

$("#csvFiles").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  const jobs = R.discoverFiles(files);
  if (!jobs.length) {
    alert("Could not find a *_summary_<date>.csv with a matching *_<username>_qa_<date>.csv.\nKeep the original file names from the export.");
    return;
  }
  const bySummary = new Map();
  for (const j of jobs) {
    const key = `${j.prefix}|${j.ts}`;
    if (!bySummary.has(key)) bySummary.set(key, { job: j, users: [] });
    const srows = parseCsv(await j.summary.text()).rows;
    bySummary.get(key).users.push({ user: j.user, summary: srows.find((r) => r.translator === j.user) || srows[0] || {},
                                    rows: parseCsv(await j.qa.text()).rows });
  }
  imported = imported.filter((d) => !bySummary.has(d.id.replace(/^csv:/, "")));
  for (const [key, { job, users }] of bySummary)
    imported.push({ id: `csv:${key}`, label: `CSV import — ${job.prefix} (${job.ts.slice(0, 8)})`, prefix: job.prefix, ts: job.ts, users });
  await rebuildSources(`csv:${[...bySummary.keys()][0]}`);
});

$("#deleteRun").addEventListener("click", async () => {
  const ds = currentDs();
  if (!ds?.runId || !confirm("Delete this stored run? (Cached pages are kept.)")) return;
  await dbDelete("runs", ds.runId);
  runs = runs.filter((r) => r.id !== ds.runId);
  if (lastRun?.id === ds.runId) { lastRun = null; $("#results").hidden = true; }
  await rebuildSources();
});

async function getBank(lang) {
  const saved = await store.get("files", {});
  const f = { ...DEFAULT_FILES, ...saved };
  return R.loadBank(f.rules, f[`sentences_${lang}`]);
}

const randomPick = (v) => v[Math.floor(Math.random() * v.length)];

async function generate() {
  const ds = currentDs(), u = currentUser();
  if (!ds || !u) { alert("Fetch feedback or import the CSV files first."); return; }
  if (dirty && !confirm("You edited the Markdown. Replace it with a new report?")) return;
  const num = (id) => { const s = $(id).value.trim(); if (!s) return null; const n = parseInt(s, 10); if (Number.isNaN(n)) throw new Error("Check the numbers and the date (YYYY-MM-DD)."); return n; };
  let args;
  try {
    const dateStr = $("#f_date").value.trim();
    const date = dateStr ? R.parseIsoDate(dateStr) : null;
    if (dateStr && !date) throw new Error("Check the numbers and the date (YYYY-MM-DD).");
    args = { name: $("#f_name").value.trim() || null, reviewer: $("#f_reviewer").value.trim() || null,
             project: $("#f_project").value.trim() || null, locale: $("#f_language").value.trim() || null,
             status: $("#f_status").value.trim() || "Completed", submitted: num("#f_submitted"), reviewed: num("#f_reviewed"), date };
  } catch (e) { alert(e.message); return; }
  try {
    const choice = $("#lang").value;
    const lang = choice === "auto" ? R.detectReportLang(u.rows) : choice;
    const how = choice === "auto" ? "auto-detected from the comments" : "chosen manually";
    const bank = await getBank(lang);
    const out = R.buildReport(u.summary, u.rows, u.user, ds.prefix, ds.ts, bank, args, randomPick);
    $("#md").value = out.text; dirty = false;
    lastReport.fname = out.fname; lastReport.lang = lang;
    lastReport.pdfName = R.pdfFilename(ds.prefix, u.user, args.date || R.dateFromTs(ds.ts));
    renderPreview();
    const w = $("#warn");
    const head = `Report language: ${lang === "es" ? "Español" : "English"} (${how}).`;
    w.textContent = "";
    w.append(head);
    if (out.unmatched.length) {
      w.append(document.createElement("br"), document.createElement("br"),
               "Comments not matched by any rule (add a pattern in Rules & wording if they matter):");
      for (const [frag, n] of out.unmatched) { w.append(document.createElement("br"), `• ${n}× ${frag}`); }
    } else w.append(document.createElement("br"), "All reviewer comments were recognised.");
  } catch (e) { alert(`Could not build the report\n\n${e.message}`); console.error(e); }
}
$("#generate").addEventListener("click", generate);
$("#md").addEventListener("input", () => { dirty = true; });

function renderPreview() {
  const rendered = document.querySelector('input[name="view"]:checked').value === "rendered";
  $("#md").hidden = rendered; $("#rendered").hidden = !rendered;
  if (rendered) { applyFont($("#rendered")); $("#rendered").innerHTML = mdToHtml($("#md").value); }
}
for (const r of document.querySelectorAll('input[name="view"]')) r.addEventListener("change", renderPreview);

const fontStack = () => { const f = $("#font").value.trim(); return f ? `"${f.replace(/"/g, "")}", "Liberation Sans", Arial, sans-serif` : ""; };
const applyFont = (el) => { el.style.fontFamily = fontStack(); };
$("#font").addEventListener("input", () => { store.set("pdfPrefs", { page: $("#page").value, font: $("#font").value }); if (!$("#rendered").hidden) renderPreview(); });
$("#page").addEventListener("change", () => store.set("pdfPrefs", { page: $("#page").value, font: $("#font").value }));

$("#copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#md").value); $("#copy").textContent = "Copied ✓"; }
  catch { $("#md").select(); document.execCommand("copy"); $("#copy").textContent = "Copied ✓"; }
  setTimeout(() => { $("#copy").textContent = "Copy to clipboard"; }, 1500);
});
$("#saveMd").addEventListener("click", () => { if ($("#md").value.trim()) download(lastReport.fname, $("#md").value); });

$("#exportPdf").addEventListener("click", () => {
  const md = $("#md").value.trim();
  if (!md) { alert("Generate the report first."); return; }
  const [w, h] = PAGES[$("#page").value];
  $("#printStyle").textContent = `@page { size: ${w}mm ${h}mm; margin: 20mm; }`;
  const root = $("#printRoot");
  applyFont(root); root.innerHTML = mdToHtml(md);
  const oldTitle = document.title;
  document.title = lastReport.pdfName.replace(/\.pdf$/i, "");      // Firefox proposes the page title as the PDF name
  const done = () => { document.title = oldTitle; root.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
});

// ================================================================== RULES TAB
async function loadRuleText() {
  const saved = await store.get("files", {});
  const key = $("#ruleFile").value;
  $("#ruleText").value = saved[key] ?? DEFAULT_FILES[key];
  setRuleMsg("");
}
function setRuleMsg(text, cls = "") { const m = $("#ruleMsg"); m.textContent = text; m.className = cls; }
$("#ruleFile").addEventListener("change", loadRuleText);
$("#ruleSave").addEventListener("click", async () => {
  const key = $("#ruleFile").value, text = $("#ruleText").value;
  const saved = await store.get("files", {});
  const next = { ...DEFAULT_FILES, ...saved, [key]: text };
  try {
    R.loadBank(next.rules, next.sentences_en); R.loadBank(next.rules, next.sentences_es);
  } catch (e) {
    const where = e.line ? ` (line ${e.line}, column ${e.column})` : "";
    setRuleMsg(`Not saved: ${e.message.split("\n")[0]}${where}`, "err"); return;
  }
  await store.set("files", { ...saved, [key]: text });
  setRuleMsg("Saved. Applies to the next report.", "ok");
});
$("#ruleReset").addEventListener("click", async () => {
  if (!confirm("Reset this file to the built-in default?")) return;
  const saved = await store.get("files", {});
  delete saved[$("#ruleFile").value];
  await store.set("files", saved); await loadRuleText(); setRuleMsg("Reset to default.", "ok");
});
$("#ruleDownload").addEventListener("click", () => download(`${$("#ruleFile").value}.toml`, $("#ruleText").value));

// ================================================================== init
(async function init() {
  await loadFetchForm();
  const prefs = await store.get("pdfPrefs", { page: "carta", font: "Arial" });
  $("#page").value = prefs.page; $("#font").value = prefs.font;
  $("#f_status").value = "Completed";
  await loadRuleText();
  runs = (await dbAll("runs")).sort((a, b) => b.createdAt - a.createdAt);
  await rebuildSources();
  if (runs.length) showResults(runs[0]);
  refreshCacheInfo();
  checkSession();
})();
