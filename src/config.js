// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const REFRESH_MINUTES = ['5', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  refresh_minutes: '15',
  language: 'fr',
};

/**
 * Turn what the user typed into the base URL of Wiki.js, without `/graphql`:
 * - `192.0.2.10:3000` or `wiki.local`: http, that address;
 * - `https://example.org/wiki/`: exactly that address (reverse proxy).
 * A pasted `/graphql`, or the address of an admin, edit, history, source or
 * tag page (`/a/...`, `/e/...`, `/h/...`, `/s/...`, `/t/...`), is dropped
 * down to the base. Returns null when it is not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  const path = url.pathname
    .replace(/\/(graphql|login|logout|register|[aehst])(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = text(source.url);
  const url = normalizeUrl(typed);
  const refresh = String(source.refresh_minutes ?? '');
  return {
    url,
    urlInvalid: typed !== '' && url === null,
    // "Bearer ..." pasted whole works as well.
    apiKey: text(source.api_key).replace(/^bearer\s+/i, ''),
    refreshMinutes: Number(
      REFRESH_MINUTES.includes(refresh) ? refresh : DEFAULT_CONFIG.refresh_minutes,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
