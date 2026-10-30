// -----------------------------------------------------------------------------
// The GraphQL API of Wiki.js 2 (`<base>/graphql`), the few calls the
// integration needs, authenticated by an API key (`Authorization: Bearer`).
//
// Facts checked on a real server, Wiki.js 2.5.317 (ghcr.io/requarks/wiki:2),
// see test/fixtures/wikijs/2.5.317/:
// - every answer is HTTP 200, errors included: `{ errors: [{ message,
//   extensions: { exception: { code } } }], data }`, `data` holding what
//   could be read; an unknown route is an HTML 404;
// - a wrong, revoked or expired key, or a disabled API, is not refused: the
//   request runs as the guest, who may read the public pages. `users.profile`
//   tells the two apart (error 1019 "You must be authenticated" as a guest);
// - a key lacking a permission gets the error "Forbidden" on that field
//   (`system.info` needs `manage:system`: the version is best effort);
// - mutations answer `responseResult { succeeded, errorCode, slug, message }`
//   (6002 the path is taken, 6005 an illegal path), `pages.create` returns
//   the page but not its `locale` (asking for it fails the whole page);
// - `pages.update` writes every field it is given and resets the ones it is
//   not: without `isPublished` the page is unpublished, without `tags` the
//   call fails, without `scriptCss`/`scriptJs` they are emptied. The page is
//   read in full first and sent back whole.
// -----------------------------------------------------------------------------

export const DEFAULT_TIMEOUT = 15_000;

const LIST_ITEM = 'id path locale title isPublished isPrivate createdAt updatedAt tags';
const FULL =
  'id path locale title description content editor contentType isPublished isPrivate ' +
  'publishStartDate publishEndDate scriptCss scriptJs createdAt updatedAt authorName tags { tag }';
const RESULT =
  'responseResult { succeeded errorCode slug message } page { id path title createdAt updatedAt }';

const QUERIES = {
  read: `{ users { profile { id } } pages { list(orderBy: UPDATED, orderByDirection: DESC) { ${LIST_ITEM} } } }`,
  version: '{ system { info { currentVersion } } }',
  single: `query ($id: Int!) { pages { single(id: $id) { ${FULL} } } }`,
  byPath: `query ($path: String!, $locale: String!) { pages { singleByPath(path: $path, locale: $locale) { ${FULL} } } }`,
  create:
    'mutation ($path: String!, $title: String!, $content: String!, $tags: [String]!, $locale: String!) ' +
    '{ pages { create(path: $path, title: $title, content: $content, tags: $tags, locale: $locale, ' +
    `description: "", editor: "markdown", isPublished: true, isPrivate: false) { ${RESULT} } } }`,
  update:
    'mutation ($id: Int!, $content: String!, $title: String!, $description: String!, ' +
    '$isPublished: Boolean!, $isPrivate: Boolean!, $publishStartDate: Date, $publishEndDate: Date, ' +
    '$scriptCss: String, $scriptJs: String, $tags: [String]!) { pages { update(id: $id, ' +
    'content: $content, title: $title, description: $description, isPublished: $isPublished, ' +
    'isPrivate: $isPrivate, publishStartDate: $publishStartDate, publishEndDate: $publishEndDate, ' +
    `scriptCss: $scriptCss, scriptJs: $scriptJs, tags: $tags) { ${RESULT} } } }`,
};

export class WikiJsError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'forbidden' | 'not_found' | 'exists' | 'timeout' | 'http' | 'invalid' | 'rejected'} kind
   * @param {string} message never carries a credential
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'WikiJsError';
    this.kind = kind;
    this.status = status;
  }
}

const codeOf = (error) => error?.extensions?.exception?.code;

/** The error of a GraphQL `errors` entry. */
function fromGraphQl(error) {
  const message = String(error?.message ?? 'error')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  const code = codeOf(error);
  if (code === 1019) {
    return new WikiJsError('unauthorized', message);
  }
  if (message === 'Forbidden') {
    return new WikiJsError('forbidden', message);
  }
  if (code === 6003) {
    return new WikiJsError('not_found', message);
  }
  return new WikiJsError('http', message);
}

/** The error of a mutation `responseResult` that did not succeed. */
function fromResult(result) {
  const message = String(result?.message ?? 'error')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  if (result?.errorCode === 6002) {
    return new WikiJsError('exists', message);
  }
  if (/^Invalid Page Id$/i.test(message) || result?.errorCode === 6003) {
    return new WikiJsError('not_found', message);
  }
  if (/forbidden/i.test(result?.slug ?? '')) {
    return new WikiJsError('forbidden', message);
  }
  return new WikiJsError('rejected', message);
}

export class WikiJsClient {
  /**
   * @param {object} options
   * @param {string} options.url normalized base URL (see normalizeUrl)
   * @param {string} options.apiKey
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeout]
   */
  constructor({ url, apiKey, fetch: fetchImpl, timeout }) {
    this.url = url;
    this.authorization = `Bearer ${apiKey}`;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeout = timeout ?? DEFAULT_TIMEOUT;
  }

  /** One GraphQL request: the whole answer, `{ data, errors }`. */
  async #send(query, variables = {}) {
    let response;
    let raw;
    try {
      response = await this.fetch(`${this.url}/graphql`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.authorization,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'follow',
      });
      raw = await response.text();
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new WikiJsError('timeout', `No answer from Wiki.js within ${this.timeout} ms`);
      }
      const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? 'error';
      throw new WikiJsError('unreachable', `Wiki.js unreachable (${cause})`);
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      // An HTML 404 (not Wiki.js, or a wrong path), a proxy login page...
      throw new WikiJsError(
        'invalid',
        `HTTP ${response.status}: the answer is not JSON (is this Wiki.js?)`,
        response.status,
      );
    }
    if (!response.ok && !body?.data) {
      const detail = body?.errors?.[0]?.message ?? `HTTP ${response.status}`;
      throw new WikiJsError(
        response.status === 401 ? 'unauthorized' : 'http',
        String(detail).slice(0, 120),
        response.status,
      );
    }
    if (!body || typeof body !== 'object' || (!body.data && !Array.isArray(body.errors))) {
      throw new WikiJsError('invalid', 'The answer is not GraphQL (is this Wiki.js?)');
    }
    return body;
  }

  /** The value at `path` in `data`, or the error GraphQL gave for it. */
  static #pick(body, path) {
    const error = (body.errors ?? []).find((e) =>
      path.every((part, index) => e?.path?.[index] === undefined || e.path[index] === part),
    );
    let value = body.data;
    for (const part of path) {
      value = value?.[part];
    }
    if ((value === null || value === undefined) && error) {
      throw fromGraphQl(error);
    }
    if (value === undefined) {
      throw new WikiJsError('invalid', `Wiki.js did not answer ${path.join('.')}`);
    }
    return value;
  }

  /**
   * Every page the key may read, the newest change first. Refuses a key
   * Wiki.js does not know (it would read as the guest).
   * @returns {Promise<object[]>}
   */
  async pages() {
    const body = await this.#send(QUERIES.read);
    WikiJsClient.#pick(body, ['users', 'profile']);
    const list = WikiJsClient.#pick(body, ['pages', 'list']);
    if (!Array.isArray(list)) {
      throw new WikiJsError('invalid', 'Wiki.js did not answer its pages');
    }
    return list.filter((p) => Number.isInteger(p?.id) && typeof p.path === 'string');
  }

  /** The version of Wiki.js, or '' when the key may not read it. */
  async version() {
    try {
      const body = await this.#send(QUERIES.version);
      const version = body.data?.system?.info?.currentVersion;
      return typeof version === 'string' ? version : '';
    } catch {
      return '';
    }
  }

  /** One page, whole (content, tags, author). */
  async page(id) {
    const page = WikiJsClient.#pick(await this.#send(QUERIES.single, { id }), ['pages', 'single']);
    if (!Number.isInteger(page?.id)) {
      throw new WikiJsError('invalid', 'Wiki.js did not answer the page');
    }
    return page;
  }

  /** One page by its path, whole; null when there is none. */
  async pageByPath(path, locale) {
    try {
      const page = WikiJsClient.#pick(await this.#send(QUERIES.byPath, { path, locale }), [
        'pages',
        'singleByPath',
      ]);
      return Number.isInteger(page?.id) ? page : null;
    } catch (err) {
      if (err instanceof WikiJsError && err.kind === 'not_found') {
        return null;
      }
      throw err;
    }
  }

  static #written(body, operation) {
    const answer = WikiJsClient.#pick(body, ['pages', operation]);
    if (answer?.responseResult?.succeeded !== true) {
      throw fromResult(answer?.responseResult);
    }
    if (!Number.isInteger(answer.page?.id)) {
      throw new WikiJsError('invalid', 'Wiki.js did not answer the page');
    }
    return answer.page;
  }

  /**
   * A new Markdown page, published.
   * @param {{ path: string, title: string, content: string, tags: string[], locale: string }} page
   * @returns {Promise<{ id: number, path: string, title: string, createdAt: string, updatedAt: string }>}
   */
  async createPage({ path, title, content, tags, locale }) {
    return WikiJsClient.#written(
      await this.#send(QUERIES.create, { path, title, content, tags, locale }),
      'create',
    );
  }

  /**
   * A page with a new content, everything else sent back as it was.
   * @param {object} page the page as read by `page` or `pageByPath`
   * @param {string} content
   */
  async updatePage(page, content) {
    return WikiJsClient.#written(
      await this.#send(QUERIES.update, {
        id: page.id,
        content,
        title: page.title,
        description: page.description ?? '',
        isPublished: page.isPublished !== false,
        isPrivate: page.isPrivate === true,
        publishStartDate: page.publishStartDate || '',
        publishEndDate: page.publishEndDate || '',
        scriptCss: page.scriptCss ?? '',
        scriptJs: page.scriptJs ?? '',
        tags: (page.tags ?? []).map((t) => t?.tag).filter((t) => typeof t === 'string'),
      }),
      'update',
    );
  }
}
