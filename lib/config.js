// config.js — port of config.py (locale is now a setting instead of hardcoded es-cl)
export const BASE_URL = "https://translate.wordpress.org";
export const SUBPROJECTS = ["stable", "stable-readme", "dev", "dev-readme"];

export const FETCH_DEFAULTS = {
  locale: "es-cl",
  delayMin: 1.0,     // seconds, random delay before every network request
  delayMax: 10.5,
  maxRetries: 5,
  timeoutSec: 20,
};

// Reason-tag strings exactly as they appear in the GlotPress tooltip
export const REASON_GLOSSARY = "Glossary";
export const REASON_STYLE_GUIDE = "Style Guide";
export const REASON_BAD_QUALITY = "Bad Quality (AI?)";

const root = (p, s, l) => `${BASE_URL}/projects/wp-plugins/${p}/${s}/${l}`;

export function listingUrl({ project, subproject, locale, page }) {
  return `${root(project, subproject, locale)}/default/?filters%5Bchangesrequested%5D=yes` +
    `&filters%5Bstatus%5D=changesrequested&page=${page}`;
}

export function discussionUrl({ project, subproject, locale, originalId }) {
  return `${BASE_URL}/projects/wp-plugins/${project}/${subproject}/${originalId}/${locale}/default/`;
}

export function userStatusUrl({ project, subproject, locale, status, username }) {
  const u = encodeURIComponent(username).replace(/%20/g, "+");   // quote_plus
  return `${root(project, subproject, locale)}/default/?filters%5Bstatus%5D=${status}` +
    `&filters%5Buser_login%5D=${u}&sort%5Bby%5D=translation_date_modified&sort%5Bhow%5D=desc`;
}
