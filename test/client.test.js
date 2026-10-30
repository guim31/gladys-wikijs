// -----------------------------------------------------------------------------
// The Wiki.js client, the model and the configuration, on the answers
// recorded on a real Wiki.js 2.5.317: the key header, the guest a wrong key
// reads as, errors by kind, the update that sends the page back whole.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WikiJsClient } from '../src/wikijs/client.js';
import {
  appendLine,
  folderOf,
  isUnder,
  mainLocale,
  normalizePath,
  pageUrl,
  parseTags,
  titleFromPath,
} from '../src/wikijs/model.js';
import { normalizeConfig, normalizeUrl } from '../src/config.js';
import { HOST, fixture } from './helpers/fakeWikiJs.js';

/** A client answered by recorded bodies, one per call. */
function replay(...names) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const recorded = fixture(names[calls.length - 1]);
    return new Response(JSON.stringify(recorded.body), { status: recorded.status });
  };
  return { calls, client: new WikiJsClient({ url: HOST, apiKey: 'k3y', fetch }) };
}

test('pages: one POST to /graphql with the key, every page the newest first', async () => {
  const { calls, client } = replay('list');
  const pages = await client.pages();
  assert.equal(calls[0].url, `${HOST}/graphql`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k3y');
  assert.deepEqual(
    pages.map((p) => [p.path, p.tags]),
    [
      ['recettes/tarte-aux-pommes', ['cuisine']],
      ['maison/chaudiere', ['entretien', 'chauffage']],
      ['home', []],
    ],
  );
});

test('a key Wiki.js does not know reads as the guest: refused, not an empty wiki', async () => {
  const { client } = replay('guest-list');
  await assert.rejects(client.pages(), (err) => err.kind === 'unauthorized');
  assert.equal(
    await replay('list-empty')
      .client.pages()
      .then((p) => p.length),
    0,
  );
});

test('the version is best effort', async () => {
  assert.equal(await replay('version').client.version(), '2.5.317');
  assert.equal(await replay('readonly-version').client.version(), '');
});

test('errors by kind, with the reason Wiki.js gave and never the key', async () => {
  const cases = [
    ['create-exists', 'exists', /already exists/],
    ['create-invalid-path', 'rejected', /illegal characters/],
    ['readonly-create', 'forbidden', /Forbidden/],
  ];
  for (const [name, kind, message] of cases) {
    const { client } = replay(name);
    await assert.rejects(
      client.createPage({ path: 'p', title: 'T', content: 'c', tags: [], locale: 'en' }),
      (err) => {
        assert.equal(err.kind, kind, name);
        assert.match(err.message, message);
        assert.ok(!err.message.includes('k3y'));
        return true;
      },
    );
  }
  const page = fixture('single').body.data.pages.single;
  await assert.rejects(replay('update-missing').client.updatePage(page, 'x'), (err) => {
    return err.kind === 'not_found';
  });
  await assert.rejects(replay('readonly-update').client.updatePage(page, 'x'), (err) => {
    return err.kind === 'forbidden';
  });
  await assert.rejects(replay('single-missing').client.page(9), (err) => err.kind === 'not_found');
  assert.equal(await replay('by-path-missing').client.pageByPath('journal/absent', 'en'), null);
});

test('update sends the page back whole, as read', async () => {
  const { calls, client } = replay('update');
  const page = fixture('single').body.data.pages.single;
  const written = await client.updatePage(page, 'new');
  assert.equal(written.updatedAt, '2026-10-30T17:22:20.008Z');
  const sent = calls[0].body.variables;
  assert.deepEqual(sent, {
    id: 2,
    content: 'new',
    title: 'Chaudière',
    description: '',
    isPublished: true,
    isPrivate: false,
    publishStartDate: '',
    publishEndDate: '',
    scriptCss: '',
    scriptJs: '',
    tags: ['entretien', 'chauffage'],
  });
});

test('create: a published Markdown page, its id and dates', async () => {
  const { calls, client } = replay('create');
  const page = await client.createPage({
    path: 'maison/chaudiere',
    title: 'Chaudière',
    content: 'x',
    tags: ['entretien'],
    locale: 'en',
  });
  assert.equal(page.id, 2);
  assert.match(calls[0].body.query, /editor: "markdown", isPublished: true/);
  assert.doesNotMatch(calls[0].body.query, /page \{[^}]*locale/, 'create cannot return the locale');
});

test('not Wiki.js: an HTML page, a server down, too late', async () => {
  const html = async () => new Response('<html>Login</html>', { status: 200 });
  const client = new WikiJsClient({ url: HOST, apiKey: 'a', fetch: html });
  await assert.rejects(client.pages(), (err) => err.kind === 'invalid');
  const down = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  await assert.rejects(
    new WikiJsClient({ url: HOST, apiKey: 'a', fetch: down }).pages(),
    (err) => err.kind === 'unreachable' && /ECONNREFUSED/.test(err.message),
  );
  const slow = (url, init) =>
    new Promise((resolve, reject) => {
      // A pending timer keeps the event loop alive (the abort timer does not).
      const late = setTimeout(resolve, 5000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(late);
        reject(init.signal.reason);
      });
    });
  await assert.rejects(
    new WikiJsClient({ url: HOST, apiKey: 'a', fetch: slow, timeout: 20 }).pages(),
    (err) => err.kind === 'timeout',
  );
});

test('addresses typed by users', () => {
  assert.equal(normalizeUrl('192.0.2.10:3000'), 'http://192.0.2.10:3000');
  assert.equal(normalizeUrl('https://example.org/wiki/'), 'https://example.org/wiki');
  assert.equal(normalizeUrl('http://192.0.2.10:3000/graphql'), 'http://192.0.2.10:3000');
  assert.equal(normalizeUrl('http://192.0.2.10:3000/a/api'), 'http://192.0.2.10:3000');
  assert.equal(normalizeUrl('https://example.org/wiki/e/en/home'), 'https://example.org/wiki');
  assert.equal(normalizeUrl('http://user:pass@192.0.2.10'), null);
  assert.equal(normalizeUrl('ftp://192.0.2.10'), null);
  const config = normalizeConfig({ url: ' wiki.local ', api_key: ' Bearer abc ' });
  assert.equal(config.url, 'http://wiki.local');
  assert.equal(config.apiKey, 'abc');
  assert.equal(config.refreshMinutes, 15);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ url: 'ftp://x' }).urlInvalid, true);
});

test('paths, folders, tags, locales, lines added to a page', () => {
  assert.equal(normalizePath(' /maison// chaudiere /'), 'maison/chaudiere');
  assert.equal(normalizePath(undefined), '');
  assert.equal(folderOf('maison/chauffage/chaudiere'), 'maison');
  assert.equal(folderOf('home'), '');
  assert.ok(isUnder('maison/chaudiere', 'maison'));
  assert.ok(!isUnder('maisonnette/x', 'maison'));
  assert.deepEqual(parseTags('Rapport, énergie;rapport\n'), ['rapport', 'énergie']);
  assert.equal(mainLocale([{ locale: 'fr' }, { locale: 'fr' }, { locale: 'en' }]), 'fr');
  assert.equal(mainLocale([]), 'en');
  assert.equal(titleFromPath('journal/chaudiere-gaz'), 'Chaudiere gaz');
  assert.equal(
    pageUrl(HOST, { locale: 'fr', path: 'maison/pièce 1' }),
    `${HOST}/fr/maison/pi%C3%A8ce%201`,
  );
  assert.equal(appendLine({ editor: 'markdown', content: '# J\n\n' }, 'L'), '# J\n\nL');
  assert.equal(appendLine({ editor: 'markdown', content: '' }, 'L'), 'L');
  assert.equal(
    appendLine({ editor: 'code', content: '<p>a</p>' }, '<b>'),
    '<p>a</p>\n<p>&lt;b&gt;</p>',
  );
});
