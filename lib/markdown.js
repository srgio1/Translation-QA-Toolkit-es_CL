// markdown.js — tiny Markdown subset -> HTML, mirroring qa_pdf.py / qa_preview.py:
// # headings, tables, "- [ ]" check items, bullets, paragraphs; **bold** _italic_ `code` ==highlight==
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const W = "\\p{L}\\p{N}_";

export function inline(text) {
  text = text.replace(/\\\|/g, "|");
  return text.split(/(`[^`]*`)/).map((part) => {
    if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) return `<code>${esc(part.slice(1, -1))}</code>`;
    let s = esc(part);
    s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    s = s.replace(/==(.+?)==/g, "<mark>$1</mark>");
    s = s.replace(new RegExp(`(?<![${W}*])_(.+?)_(?![${W}])`, "gu"), "<i>$1</i>");
    s = s.replace(new RegExp(`(?<![${W}*])\\*(?!\\*)(.+?)(?<!\\*)\\*(?![${W}*])`, "gu"), "<i>$1</i>");
    return s;
  }).join("");
}

function splitRow(line) {
  let cells = line.trim().split(/(?<!\\)\|/);
  if (cells.length && cells[0].trim() === "") cells = cells.slice(1);
  if (cells.length && cells[cells.length - 1].trim() === "") cells = cells.slice(0, -1);
  return cells.map((c) => c.trim());
}

function table(lines) {
  let rows = lines.map(splitRow).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  if (!rows.length) return "";
  const ncol = Math.max(...rows.map((r) => r.length));
  rows = rows.map((r) => r.concat(Array(ncol - r.length).fill("")));
  const body = rows.length > 1 ? rows.slice(1) : rows;
  const weights = Array.from({ length: ncol }, (_, j) =>
    Math.min(Math.max(body.reduce((a, r) => a + r[j].length, 0) / body.length, 14), 70));
  const total = weights.reduce((a, b) => a + b, 0);
  const cols = weights.map((w) => `<col style="width:${((100 * w) / total).toFixed(1)}%">`).join("");
  const tr = (r, tag) => `<tr>${r.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`;
  return `<table><colgroup>${cols}</colgroup><thead>${tr(rows[0], "th")}</thead><tbody>${rows.slice(1).map((r) => tr(r, "td")).join("")}</tbody></table>`;
}

export function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0, m;
  const list = (cls, re) => {                 // consecutive list items -> one <ul>
    const items = [];
    while (i < lines.length && (m = re.exec(lines[i]))) { items.push(`<li>${inline(m[1])}</li>`); i++; }
    out.push(`<ul class="${cls}">${items.join("")}</ul>`);
  };
  const CK = /^\s*[-*] \[[ xX]\] (.*)/, BU = /^\s*[-*] (.*)/;
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) i++;
    else if (ln.startsWith("### ")) { out.push(`<h3>${inline(ln.slice(4))}</h3>`); i++; }
    else if (ln.startsWith("## ")) { out.push(`<h2>${inline(ln.slice(3))}</h2>`); i++; }
    else if (ln.startsWith("# ")) { out.push(`<h1>${inline(ln.slice(2))}</h1>`); i++; }
    else if (ln.trimStart().startsWith("|")) {
      const block = [];
      while (i < lines.length && lines[i].trimStart().startsWith("|")) block.push(lines[i++]);
      out.push(table(block));
    } else if (CK.test(ln)) list("checks", CK);
    else if (BU.test(ln)) list("bullets", BU);
    else {
      const para = [ln.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !/^\s*([#|]|[-*] )/.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
