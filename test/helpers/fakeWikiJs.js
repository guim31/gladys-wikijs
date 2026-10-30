// -----------------------------------------------------------------------------
// A fake Wiki.js behind a `fetch` function: it starts from the bodies
// recorded on a real Wiki.js 2.5.317 (test/fixtures/wikijs/2.5.317/), keeps
// its pages in memory, tells the GraphQL documents of the client apart by
// their root fields, and answers the errors the real server answers (HTTP
// 200 with `errors`, the guest for a wrong key, an HTML 404 elsewhere).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const HOST = 'http://192.0.2.50:3000';
export const API_KEY = 'eyJhbGciOiJSUzI1NiJ9.test-key.signature';
// 18:00 UTC on the day the fixtures were recorded (17:22 UTC): their pages
// count as changed today in any time zone from UTC-12 to UTC+5.
export const NOW = Date.parse('2026-10-30T18:00:00.000Z');

export const fixture = (name) =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/wikijs/2.5.317/${name}.json`, import.meta.url), 'utf8'),
  );

export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const FULL_DEFAULTS = {
  description: '',
  editor: 'markdown',
  contentType: 'markdown',
  publishStartDate: '',
  publishEndDate: '',
  scriptCss: '',
  scriptJs: '',
};

export function createWikiJs() {
  const recorded = fixture('list').body.data.pages.list;
  const contents = { 2: fixture('single').body.data.pages.single.content };
  const state = {
    pages: recorded.map((page) => ({
      ...structuredClone(page),
      ...FULL_DEFAULTS,
      content: contents[page.id] ?? `# ${page.title}`,
      authorName: 'Administrator',
    })),
    readOnly: false,
    noSystem: false,
    down: false,
    html: false,
    requests: [],
    clock: Date.parse('2026-10-30T17:23:00.000Z'),
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  const tick = () => {
    state.clock += 60_000;
    return new Date(state.clock).toISOString();
  };
  const nextId = () => Math.max(0, ...state.pages.map((p) => p.id)) + 1;
  const listItem = (p) => ({
    id: p.id,
    path: p.path,
    locale: p.locale,
    title: p.title,
    isPublished: p.isPublished,
    isPrivate: p.isPrivate,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    tags: [...p.tags],
  });
  const full = (p) => ({ ...structuredClone(p), tags: p.tags.map((tag) => ({ tag })) });
  const written = (p) => ({
    id: p.id,
    path: p.path,
    title: p.title,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  });
  const forbidden = (field) => ({
    errors: [{ message: 'Forbidden', path: ['pages', field], extensions: {} }],
    data: { pages: { [field]: null } },
  });

  /** A page created by a user in Wiki.js. */
  function addPage({ path, title = 'New page', tags = [], by = 'Camille', locale = 'en' } = {}) {
    const at = tick();
    const page = {
      id: nextId(),
      path: path ?? `notes/page-${nextId()}`,
      locale,
      title,
      isPublished: true,
      isPrivate: false,
      createdAt: at,
      updatedAt: at,
      tags: tags.map((t) => t.toLowerCase()),
      ...FULL_DEFAULTS,
      content: `# ${title}`,
      authorName: by,
    };
    state.pages.push(page);
    return page;
  }

  function editPage(id, { by = 'Camille', content } = {}) {
    const page = state.pages.find((p) => p.id === id);
    page.updatedAt = tick();
    page.authorName = by;
    if (content !== undefined) {
      page.content = content;
    }
    return page;
  }

  async function fetch(url, init = {}) {
    const { pathname } = new URL(url);
    if (state.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (state.html || pathname !== '/graphql' || init.method !== 'POST') {
      return new Response('<!DOCTYPE html><html><body>Not Found</body></html>', {
        status: state.html ? 200 : 404,
        headers: { 'content-type': 'text/html' },
      });
    }
    const { query, variables = {} } = JSON.parse(init.body);
    const root = query.match(/(list|currentVersion|singleByPath|single|create|update)\(?/)[1];
    state.requests.push(root);
    // A key Wiki.js does not know reads as the guest.
    const guest = init.headers?.Authorization !== `Bearer ${API_KEY}`;
    if (root === 'list') {
      const pages = [...state.pages]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map(listItem);
      return json(
        guest
          ? {
              ...fixture('guest-list').body,
              data: { users: { profile: null }, pages: { list: [] } },
            }
          : { data: { users: { profile: { id: 1 } }, pages: { list: pages } } },
      );
    }
    if (root === 'currentVersion') {
      return json(fixture(guest || state.noSystem ? 'guest-version' : 'version').body);
    }
    if (root === 'single' || root === 'singleByPath') {
      const page = state.pages.find((p) =>
        root === 'single'
          ? p.id === variables.id
          : p.path === variables.path && p.locale === variables.locale,
      );
      if (!page) {
        return json(fixture(root === 'single' ? 'single-missing' : 'by-path-missing').body);
      }
      return json({ data: { pages: { [root]: full(page) } } });
    }
    if (guest || state.readOnly) {
      return json(forbidden(root));
    }
    const result = (page) => ({
      data: {
        pages: {
          [root]: {
            responseResult: { succeeded: true, errorCode: 0, slug: 'ok', message: 'ok' },
            page: written(page),
          },
        },
      },
    });
    if (root === 'create') {
      if (state.pages.some((p) => p.path === variables.path && p.locale === variables.locale)) {
        return json(fixture('create-exists').body);
      }
      if (/[.%]/.test(variables.path)) {
        return json(fixture('create-invalid-path').body);
      }
      const page = addPage({
        path: variables.path,
        title: variables.title,
        tags: variables.tags,
        by: 'API',
        locale: variables.locale,
      });
      page.content = variables.content;
      state.lastWrite = variables;
      return json(result(page));
    }
    // update: every field is written, as Wiki.js does.
    const page = state.pages.find((p) => p.id === variables.id);
    if (!page) {
      return json(fixture('update-missing').body);
    }
    if (!Array.isArray(variables.tags)) {
      return json({
        data: {
          pages: {
            update: {
              responseResult: { succeeded: false, errorCode: 1, slug: 'TypeError', message: 'x' },
              page: null,
            },
          },
        },
      });
    }
    state.lastWrite = variables;
    editPage(page.id, { by: 'API', content: variables.content });
    page.title = variables.title;
    page.isPublished = variables.isPublished === true;
    page.tags = [...variables.tags];
    return json(result(page));
  }

  return {
    state,
    fetch,
    addPage,
    editPage,
    goDown() {
      state.down = true;
    },
    goUp() {
      state.down = false;
    },
  };
}
