# Translation QA Toolkit

A Firefox extension for locale teams on [translate.wordpress.org](https://translate.wordpress.org). It does two jobs in one place:

1. **Fetch feedback:** collects the "changes requested" strings of a plugin, with the reviewers' comments and reason tags, and counts approved vs. flagged strings per translator. 
2. **Generate a report:** turns that data into a short, structured Markdown (or PDF) quality-review report for each translator, in English or Spanish.

It is a port of two Python tools (a feedback scraper and a report generator) into a single extension. Nothing is uploaded anywhere: all data stays in your browser.

> Not affiliated with WordPress.org or the WordPress Polyglots team.

## Tailored to es_CL

This toolkit was built for the **Spanish (Chile) [es_CL]** locale team, and its defaults reflect that team's feedback style:

- The detection rules (`rules.toml`) match the wording of es_CL reviewer comments (for example "comillas", "mayúscula", "ustedeo") and check es_CL conventions: informal "tú" instead of "usted", sentence-case capitalization, and no guillemets « ».
- The built-in report wording (`sentences_es.toml` / `sentences_en.toml`) mentions es_CL and its style guide.
- Fetching itself works for any locale (the locale is a field), but the **reports will only make sense for other locales after you adapt the rules and wording**.

If your team uses a different locale or feedback style, the intended path is to **fork this repository** and edit `rules.toml` and the `sentences_*.toml` files. See [Adapting it to another team or language](#adapting-it-to-another-team-or-language). No code changes are needed for most adaptations.

## Features

- Uses your **logged-in Firefox session**, so your GlotPress "strings per page" setting applies and fewer requests are needed.
- Follows the whole workflow: listing pages → each string's discussion page → one "is being discussed here" hop → categorization → per-translator approved/changes-requested counts.
- Polite by design: random delay before every request (configurable), retries with backoff, a local page cache, and a Stop button.
- Reports are built from **editable rule and wording files** (TOML), so the detected issues and the report text can be adapted to another team's feedback style or language without touching code.
- Report preview (Markdown or rendered), copy to clipboard, save `.md`, and export PDF (Carta or Oficio, with a font of your choice).
- Interoperable with the original Python tools: import their CSV pairs, or download runs as CSV files with the same names.

## Install

**Get the code**

- **As a ZIP (no Git needed):** on the repository's GitHub page click the green **Code** button → **Download ZIP**, then unzip it somewhere you will keep it (Firefox loads the add-on from that folder).
- **With Git:** `git clone <repository-url>`

**Temporary install (for trying it out)**

1. Unzip or clone the repository as described above.
2. In Firefox open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**
3. Select `manifest.json` inside the unzipped folder (GitHub ZIPs add one extra top-level folder named after the repository).
4. Click the toolbar button. The toolkit opens in its own tab (a popup would close and interrupt a long fetch).

Temporary add-ons are removed when Firefox restarts. For a permanent install the add-on must be signed: submit the zipped folder as an **unlisted** add-on on [addons.mozilla.org](https://addons.mozilla.org/developers/).

Requires Firefox 115 or newer.

## Usage

### 1. Fetch feedback

1. Log in to translate.wordpress.org in the same Firefox profile. The header shows whether the session was detected.
2. Enter the **plugin slug** (for example `wpematico`), the **subproject** (`stable`, `stable-readme`, `dev`, `dev-readme`) and the **locale** as it appears in the URL (`es-cl`, `pt-br`, …).
3. Click **Start**. Progress and a log are shown; **Stop** keeps what was collected so far.
4. When it finishes, a table lists each translator with flagged strings by category (glossary, style guide, AI, other) and approved vs. changes-requested counts.

Other buttons: **Refresh translator stats only** (re-reads the counts without re-scraping feedback), **Download CSVs**, **Clear cache**.

Request settings (delay, retries, timeout) are under "Request settings". The defaults are a random 1–10.5 s delay between requests. Please keep delays polite on large plugins.

### 2. Report

1. Pick the stored run (or **Import CSV files…**) and a translator.
2. Check the pre-filled fields (reviewer, project, language pair, status, counts, date). Empty fields are filled automatically.
3. **Generate report.** Click again for different wording.
4. Edit the Markdown if you like, then copy it, save it, or **Export PDF…**.

The report language is detected from the language of the reviewer comments, or you can force English or Spanish.

### 3. Rules & wording

Edit the three TOML files directly in the extension; changes apply to the next report. Invalid TOML is rejected with a line number, and each file can be reset to its default.

## Adapting it to another team or language

Almost everything is data, not code:

| File | Controls |
| --- | --- |
| `rules.toml` | **What is detected.** Regex patterns matched against reviewer comments (`comment_patterns`) and GlotPress reason tags (`tag_patterns`), issue order, thresholds, quality tiers, and the Spanish usted→tú fallback list. |
| `sentences_en.toml`, `sentences_es.toml` | **What the report says.** Headings, labels, sentences (lists are interchangeable variants picked at random), table columns, checklist items, month names. |

Tips:

- If the generator shows **"Comments not matched by any rule"**, add a pattern to the relevant issue in `rules.toml`.
- Every `key` in `rules.toml` needs a matching `[[issues]]` block in each wording file.
- A new issue type only needs an `[[issues]]` block in `rules.toml` and in each wording file.
- Three issues have extra logic in `lib/report.js`, keyed by name: `formal_address` (usted→tú suggestions), `capitalization` (mid-sentence capitals) and `glossary` (the term table). Other languages will usually define their own issues instead.
- **Adding a language** means a new `sentences_xx.toml`, an entry in `lib/defaults.js`, and an option in `app.html` (language dropdown and Rules tab). Automatic language detection only tells Spanish from English; other languages are chosen manually.
- The reason-tag strings (`Glossary`, `Style Guide`, `Bad Quality (AI?)`) are in `lib/config.js`.

## Data and privacy

- The extension only makes requests to `https://translate.wordpress.org/*`, using your existing login cookies. It never reads or stores your password.
- Fetched pages (cache) and runs are stored in the extension's own IndexedDB; your rule edits and form values in `browser.storage.local`. Nothing is sent to any other server.
- The cache keeps logged-in and public versions of a page separate. Use **Force re-fetch** or **Clear cache** if you want fresh data.

## Project layout

```
manifest.json        Manifest V2 (see note below)
background.js        toolbar button -> opens app.html in a tab
app.html / .css / .js   the UI (Fetch, Report, Rules tabs)
lib/
  config.js          URL templates, defaults, reason-tag strings
  fetcher.js         cached fetch with delay, retries, abort, session detection
  parsers.js         listing / discussion / user-stats HTML parsers (DOMParser)
  categorize.js      reason tags -> categories, translator summaries
  pipeline.js        the 4-stage run + CSV export
  report.js          report generator (detection + wording)
  markdown.js        small Markdown -> HTML renderer for preview and PDF
  csv.js             CSV reader/writer compatible with Python's csv module
  db.js              IndexedDB helpers
  defaults.js        built-in copies of rules.toml and sentences_*.toml
  toml.js            bundled TOML parser (smol-toml)
```

**Why Manifest V2?** In Firefox, Manifest V3 host permissions are not granted automatically to temporarily loaded add-ons, which makes the fetches fail silently. V2 is still fully supported by Firefox.

## Development

No build step is needed to run the extension. The only generated files:

- `lib/toml.js` is [smol-toml](https://github.com/squirrelchat/smol-toml) (MIT) bundled with esbuild:
  ```bash
  npm install smol-toml esbuild
  echo 'export { parse } from "smol-toml";' > toml-entry.js
  npx esbuild toml-entry.js --bundle --format=esm --minify --outfile=lib/toml.js
  ```
- `lib/defaults.js` is `rules.toml` and the two `sentences_*.toml` files embedded as strings (`export const DEFAULT_FILES = { rules, sentences_en, sentences_es }`). Regenerate it if you change the defaults.

The report generator, parsers and categorizer were ported function by function from the original Python code. On test data the generated reports are identical to the Python output.

## Limitations

- **PDF export** uses Firefox's print dialog (choose *Save to PDF*) with page size, margins and file name preset. Page numbers come from Firefox's own header/footer setting.
- The parsers depend on GlotPress's current HTML structure. If translate.wordpress.org changes its markup, selectors in `lib/parsers.js` may need updating.
- Fetching is sequential and deliberately slow; a plugin with hundreds of flagged strings can take a while.

## License
MIT. `lib/toml.js` bundles smol-toml, which is MIT-licensed.

## Screenshots

<img width="1992" height="1462" alt="Screenshot Translation QA Toolkit with blurred translator name" src="https://github.com/user-attachments/assets/bd2e4c86-2aeb-43b9-8f82-5877e93845d3" /><img width="2044" height="1754" alt="Screenshot 2026-11-19 at 18-33-11 Translation QA Toolkit" src="https://github.com/user-attachments/assets/c7d996b5-89d1-4889-b7dd-467970d15de1" />

