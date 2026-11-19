// csv.js — RFC-4180 writer/reader compatible with Python's csv module (QUOTE_MINIMAL, CRLF)
function cell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(fields, rows) {
  const out = [fields.map(cell).join(",")];
  for (const r of rows) out.push(fields.map((f) => cell(r[f])).join(","));
  return out.join("\r\n") + "\r\n";
}
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
    i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const fields = rows.shift() || [];
  return { fields, rows: rows.map((r) => Object.fromEntries(fields.map((f, j) => [f, r[j] ?? ""]))) };
}
