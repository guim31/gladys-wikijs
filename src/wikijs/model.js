// -----------------------------------------------------------------------------
// Wiki.js answers -> plain values, and what users type in scenes (a path,
// tags, a line for a journal page) -> what the API wants.
// -----------------------------------------------------------------------------

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The address of a page. The locale segment is always understood by Wiki.js
 * (`/en/home` opens `home`, namespacing or not), and the only one right when
 * the wiki is namespaced.
 */
export const pageUrl = (baseUrl, page) =>
  `${baseUrl}/${encodeURIComponent(page.locale || 'en')}/${String(page.path)
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

/** The first part of a path: `maison/chauffage/chaudiere` -> `maison`. */
export const folderOf = (path) => {
  const text = clean(path);
  const cut = text.indexOf('/');
  return cut < 0 ? '' : text.slice(0, cut);
};

/** The tags of a list item (strings) or of a full page (`{ tag }`). */
export function tagsOf(tags) {
  const seen = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const name = clean(typeof tag === 'string' ? tag : tag?.tag);
    if (name) {
      seen.add(name);
    }
  }
  return [...seen];
}

/** A page of the list (or a full page) as the integration keeps it. */
export function summarizePage(page, baseUrl) {
  return {
    id: page.id,
    path: String(page.path),
    locale: clean(page.locale) || 'en',
    title: clean(page.title) || String(page.path),
    folder: folderOf(page.path),
    tags: tagsOf(page.tags),
    created: page.createdAt,
    updated: page.updatedAt,
    url: pageUrl(baseUrl, page),
  };
}

/**
 * A path typed by the user, as Wiki.js stores it: no slash at either end, no
 * empty part, no space around a part. `''` when nothing is left.
 * @param {unknown} raw
 */
export function normalizePath(raw) {
  return clean(typeof raw === 'number' ? String(raw) : raw)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .slice(0, 255);
}

/** Whether a page path is a folder path or below it (`maison` holds `maison/x`). */
export const isUnder = (path, folder) =>
  folder === '' || path === folder || path.startsWith(`${folder}/`);

/**
 * `journal, Chauffage` -> `['journal', 'chauffage']` (Wiki.js stores tags in
 * lower case).
 * @param {unknown} text
 */
export function parseTags(text) {
  const tags = new Set();
  for (const part of clean(text).split(/[,;\n]/)) {
    const tag = clean(part).toLowerCase().slice(0, 255);
    if (tag) {
      tags.add(tag);
    }
  }
  return [...tags].slice(0, 20);
}

/** The locale most pages use: new pages go there (`en` for an empty wiki). */
export function mainLocale(pages) {
  const counts = new Map();
  for (const page of pages) {
    counts.set(page.locale, (counts.get(page.locale) ?? 0) + 1);
  }
  let best = 'en';
  let most = 0;
  for (const [locale, count] of counts) {
    if (locale && count > most) {
      best = locale;
      most = count;
    }
  }
  return best;
}

/** The title of a journal page created by its first line: the end of its path. */
export const titleFromPath = (path) => {
  const last = path.slice(path.lastIndexOf('/') + 1).replace(/[-_]+/g, ' ');
  return last.charAt(0).toLocaleUpperCase() + last.slice(1);
};

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** `2026-10-30 08:15`, in the time zone of Gladys (TZ, set by its supervisor). */
export function stamp(time) {
  const date = new Date(time);
  const two = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}:${two(date.getMinutes())}`
  );
}

/**
 * The content of a page once a line is added at its end, in the editor the
 * page uses: an HTML paragraph for the visual editor (`ckeditor`) and the raw
 * HTML one (`code`), the line escaped; a paragraph of text otherwise
 * (Markdown, AsciiDoc: the line may hold their syntax).
 * @param {{ editor?: string, content?: string }} page
 * @param {string} line
 */
export function appendLine(page, line) {
  const before = String(page.content ?? '').replace(/\s+$/, '');
  if (page.editor === 'ckeditor' || page.editor === 'code') {
    const html = `<p>${escapeHtml(line)}</p>`;
    return before ? `${before}\n${html}` : html;
  }
  return before ? `${before}\n\n${line}` : line;
}
