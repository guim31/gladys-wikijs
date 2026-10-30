// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Wiki.js built from real
// answers: device and states, the timer, the triggers, the scene actions,
// the widget and the connection status.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MAX_TRIES, startOfDay } from '../src/hub.js';
import { MemoryStore } from '../src/store.js';
import { API_KEY, HOST, createWikiJs, settle } from './helpers/fakeWikiJs.js';
import { CONFIG, createAll, createWorld, mainDevice, mainFeature } from './helpers/world.js';

const changed = (fake) => fake.sceneEvents.filter((e) => e.key === 'page_changed');
const tagged = (fake) => fake.sceneEvents.filter((e) => e.key === 'tagged_page_changed');

/** Run a scene action as Gladys would: its outputs, or the error it answered. */
async function run(world, key, fields) {
  const ack = await world.fake.sceneAction(key, fields);
  assert.equal(ack.success, true, ack.error);
  return ack.data.outputs;
}
async function failure(world, key, fields) {
  const ack = await world.fake.sceneAction(key, fields);
  assert.equal(ack.success, false, key);
  return ack.error;
}

test('one Wiki.js device, its states once added', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [['Wiki.js', mainDevice]],
  );
  assert.equal(world.fake.states.length, 0, 'no state before the device is added');
  await createAll(world.fake);
  assert.equal(world.fake.lastState(mainFeature('pages')), 3);
  assert.equal(world.fake.lastState(mainFeature('today')), 3);
  assert.equal(world.fake.lastState(mainFeature('latest')), 'Tarte aux pommes');
  assert.equal(devices[0].params.find((p) => p.name === 'WIKIJS_VERSION').value, '2.5.317');
  assert.equal(devices[0].params.find((p) => p.name === 'WIKIJS_URL').value, HOST);
});

test('the container reads Wiki.js on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const world = await createWorld({ config: { ...CONFIG, refresh_minutes: '5' } });
  t.after(() => world.app.stop());
  await createAll(world.fake);
  world.server.addPage({ path: 'notes/lisez-moi', title: 'Lisez-moi' });
  t.mock.timers.tick(5 * 60_000);
  await settle(20);
  assert.equal(world.fake.lastState(mainFeature('pages')), 4);
  assert.equal(world.fake.lastState(mainFeature('latest')), 'Lisez-moi');
  assert.ok(!world.fake.requests.some((r) => r.path?.includes('poll')));
});

test('pages changed today fall back to 0 after midnight', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world.fake);
  assert.equal(world.fake.lastState(mainFeature('today')), 3);
  world.clock.now = startOfDay(world.clock.now) + 24 * 3_600_000 + 60_000;
  world.server.state.clock = world.clock.now;
  await world.hub.refresh();
  assert.equal(world.fake.lastState(mainFeature('today')), 0);
  world.server.editPage(3);
  await world.hub.refresh();
  assert.equal(world.fake.lastState(mainFeature('today')), 1);
  assert.equal(world.fake.lastState(mainFeature('pages')), 3);
});

test('page changed: silent baseline, created then updated, folder, tags, author', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.sceneEvents.length, 0, 'the first read announces nothing');
  const page = world.server.addPage({
    path: 'maison/panne-chaudiere',
    title: 'Chaudière : panne',
    tags: ['Incident', 'chauffage'],
    by: 'Camille',
  });
  await world.hub.refresh();
  world.server.editPage(page.id, { by: 'Dominique' });
  world.server.editPage(1);
  await world.hub.refresh();
  await world.hub.refresh();
  const base = {
    folder: 'maison',
    path: 'maison/panne-chaudiere',
    title: 'Chaudière : panne',
    url: `${HOST}/en/maison/panne-chaudiere`,
    tags: 'incident, chauffage',
    page_id: page.id,
  };
  assert.deepEqual(
    changed(world.fake).map((e) => e.data),
    [
      { ...base, change: 'created', updated_by: 'Camille' },
      { ...base, change: 'updated', updated_by: 'Dominique' },
      {
        folder: '',
        path: 'home',
        title: 'Accueil',
        url: `${HOST}/en/home`,
        tags: '',
        page_id: 1,
        change: 'updated',
        updated_by: 'Camille',
      },
    ],
  );
  // One tagged event per tag: a scene set on "incident" runs once.
  assert.deepEqual(
    tagged(world.fake).map((e) => [e.data.tag, e.data.change]),
    [
      ['incident', 'created'],
      ['chauffage', 'created'],
      ['incident', 'updated'],
      ['chauffage', 'updated'],
    ],
  );
});

test('more than ten changes: ten now, the rest at the next read, oldest first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 15; i += 1) {
    world.server.addPage({ path: `notes/n${i}`, title: `Note ${i}` });
  }
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    Array.from({ length: 10 }, (_, i) => `Note ${i}`),
  );
  await world.hub.refresh();
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    Array.from({ length: 15 }, (_, i) => `Note ${i}`),
  );
});

test('a page created then edited, announced a read later, is still "created"', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const late = world.server.addPage({ path: 'late', title: 'Late' });
  for (let i = 0; i < 10; i += 1) {
    world.server.addPage({ path: `notes/n${i}`, title: `Note ${i}` });
  }
  world.server.editPage(late.id);
  await world.hub.refresh();
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake)
      .filter((e) => e.data.title === 'Late')
      .map((e) => e.data.change),
    ['created'],
  );
});

test('a burst (an import): ten announced, the rest seen', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (let i = 0; i < 60; i += 1) {
    world.server.addPage({ path: `import/p${i}`, title: `Import ${i}` });
  }
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 10);
  world.server.addPage({ path: 'after', title: 'After' });
  await world.hub.refresh();
  assert.equal(changed(world.fake).at(-1).data.title, 'After');
  assert.equal(changed(world.fake).length, 11, 'never twice');
});

test('an event Gladys took is not sent again when a later one fails', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let fail = 1;
  world.gladys.publishSceneEvent = async (key, data) => {
    if (key === 'tagged_page_changed' && fail > 0) {
      fail -= 1;
      throw Object.assign(new Error('busy'), { status: 503 });
    }
    return publish(key, data);
  };
  world.server.addPage({ path: 'tagged', title: 'Tagged', tags: ['incident'] });
  await world.hub.refresh();
  await world.hub.refresh();
  assert.equal(changed(world.fake).length, 1);
  assert.equal(tagged(world.fake).length, 1);
});

test('an event Gladys did not take is fired again at the next read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let down = true;
  world.gladys.publishSceneEvent = async (...args) => {
    if (down) {
      throw Object.assign(new Error('Gladys restarting'), { status: 503 });
    }
    return publish(...args);
  };
  world.server.addPage({ path: 'first', title: 'First' });
  await world.hub.refresh();
  down = false;
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    ['First'],
  );
});

test('a change Gladys keeps refusing is given up, the next ones go through', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  world.gladys.publishSceneEvent = async (key, data) => {
    if (data.title === 'Broken') {
      throw Object.assign(new Error('busy'), { status: 503 });
    }
    return publish(key, data);
  };
  world.server.addPage({ path: 'broken', title: 'Broken' });
  world.server.addPage({ path: 'fine', title: 'Fine' });
  for (let i = 0; i < MAX_TRIES; i += 1) {
    await world.hub.refresh();
  }
  assert.deepEqual(
    changed(world.fake).map((e) => e.data.title),
    ['Fine'],
  );
});

test('the author is best effort: a page Wiki.js cannot read is announced anyway', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const page = world.server.addPage({ path: 'secret', title: 'Secret' });
  const fetch = world.server.fetch;
  world.hub.client.fetch = async (url, init) =>
    init.body.includes('single(')
      ? new Response('{"errors":[{"message":"Forbidden"}]}')
      : fetch(url, init);
  await world.hub.refresh();
  assert.deepEqual(
    changed(world.fake).map((e) => [e.data.page_id, e.data.updated_by]),
    [[page.id, '']],
  );
});

test('the last change seen survives a restart', async (t) => {
  const store = new MemoryStore();
  const server = createWikiJs();
  const first = await createWorld({ server, store });
  server.addPage({ path: 'before', title: 'Before' });
  await first.hub.refresh();
  await first.app.stop();
  server.addPage({ path: 'while-off', title: 'While off' });
  const second = await createWorld({ server, store });
  t.after(() => second.app.stop());
  assert.deepEqual(
    changed(second.fake).map((e) => e.data.title),
    ['While off'],
  );
});

test('a new address is a new baseline: nothing announced', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.server.addPage({ path: 'x', title: 'X' });
  await world.fake.configUpdated({ ...CONFIG, url: 'http://192.0.2.51:3000' });
  await settle(20);
  assert.equal(world.fake.sceneEvents.length, 0);
  assert.equal(world.fake.discoveredDevices[0].external_id, mainDevice, 'same device');
});

test('append_line: a journal page created then extended, never announced', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.now = new Date(2026, 9, 30, 8, 15).getTime();
  const first = await run(world, 'append_line', {
    path: '/journal/chaudiere/',
    line: 'Révision faite',
  });
  assert.equal(first.created, true);
  assert.equal(first.path, 'journal/chaudiere');
  assert.equal(first.url, `${HOST}/en/journal/chaudiere`);
  const page = world.server.state.pages.find((p) => p.id === first.page_id);
  assert.equal(page.title, 'Chaudiere');
  assert.equal(page.content, '2026-10-30 08:15 — Révision faite');
  const second = await run(world, 'append_line', {
    path: 'journal/chaudiere',
    line: 'Pression **1,5 bar**',
    add_time: false,
  });
  assert.deepEqual(second, { ...first, created: false });
  assert.equal(page.content, '2026-10-30 08:15 — Révision faite\n\nPression **1,5 bar**');
  await world.hub.refresh();
  await world.hub.refresh();
  assert.equal(world.fake.sceneEvents.length, 0, 'the integration does not announce itself');
});

test('append_line sends the page back whole: published, title, tags, scripts kept', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const page = world.server.state.pages.find((p) => p.id === 2);
  page.scriptCss = '.x{color:red}';
  await run(world, 'append_line', { path: 'maison/chaudiere', line: 'Purge' });
  const sent = world.server.state.lastWrite;
  assert.equal(sent.isPublished, true);
  assert.equal(sent.title, 'Chaudière');
  assert.deepEqual(sent.tags, ['entretien', 'chauffage']);
  assert.equal(sent.scriptCss, '.x{color:red}');
  assert.equal(sent.description, '');
  assert.match(sent.content, /octobre\.\n\n\d{4}-\d\d-\d\d \d\d:\d\d — Purge$/);
});

test('append_line: a page of the visual editor gets an escaped paragraph', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const page = world.server.state.pages.find((p) => p.id === 1);
  page.editor = 'ckeditor';
  page.content = '<p>Bienvenue</p>';
  await run(world, 'append_line', { path: 'home', line: 'a < b', add_time: false });
  assert.equal(page.content, '<p>Bienvenue</p>\n<p>a &lt; b</p>');
});

test('two lines at once both land in the page', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await Promise.all([
    run(world, 'append_line', { path: 'journal/j', line: 'A', add_time: false }),
    run(world, 'append_line', { path: 'journal/j', line: 'B', add_time: false }),
  ]);
  const page = world.server.state.pages.find((p) => p.path === 'journal/j');
  assert.equal(page.content, 'A\n\nB');
});

test('create_page: content and tags, in the locale of the wiki', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const page of world.server.state.pages) {
    page.locale = 'fr';
  }
  await world.hub.refresh();
  const out = await run(world, 'create_page', {
    path: 'rapports/octobre',
    title: 'Rapport d’octobre',
    content: '# Bilan\n\n12 kWh',
    tags: 'Rapport, énergie, rapport',
  });
  assert.deepEqual(Object.keys(out).sort(), ['page_id', 'path', 'url']);
  assert.equal(out.url, `${HOST}/fr/rapports/octobre`);
  const sent = world.server.state.lastWrite;
  assert.equal(sent.locale, 'fr');
  assert.deepEqual(sent.tags, ['rapport', 'énergie']);
  assert.equal(sent.content, '# Bilan\n\n12 kWh');
  const bare = await run(world, 'create_page', { path: 'vide', title: 'Vide' });
  assert.equal(world.server.state.pages.find((p) => p.id === bare.page_id).content, '# Vide');
});

test('scene actions: errors in clear words, an existing page never overwritten', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const action = (key, fields) => failure(world, key, fields);
  assert.match(await action('create_page', { path: 'home', title: 'X' }), /« home »/);
  assert.equal(world.server.state.pages.find((p) => p.id === 1).title, 'Accueil');
  assert.match(await action('create_page', { path: 'a/b.c', title: 'X' }), /refusé la page/);
  assert.match(await action('create_page', { path: ' / ', title: 'X' }), /chemin/);
  assert.match(await action('create_page', { path: 'x' }), /titre/);
  assert.match(await action('append_line', { path: 'x', line: ' ' }), /ligne/);
  world.server.state.readOnly = true;
  assert.match(await action('append_line', { path: 'x', line: 'y' }), /ne peut pas écrire/);
  world.server.goDown();
  assert.match(await action('create_page', { path: 'y', title: 'Y' }), /ne répond pas/);
});

test('widget: counters, the pages changed last, a folder or a tag, counters hidden', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const get = async (settings, language = 'fr') => {
    const content = (await world.fake.widgetGet('pages', { settings, language })).data.content;
    validateWidgetContent(content);
    return content;
  };
  const all = await get({});
  assert.deepEqual(
    all.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [
      ['Pages', 3],
      ["Aujourd'hui", 3],
    ],
  );
  const list = all.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    list.items.map((i) => i.title),
    ['Tarte aux pommes', 'Chaudière', 'Accueil'],
  );
  assert.match(list.items[0].subtitle, /^recettes\/tarte-aux-pommes · /);
  assert.equal(list.items[0].links, undefined, 'no link to a Wiki.js on http');
  for (let i = 0; i < 12; i += 1) {
    world.server.addPage({ path: `maison/p${i}`, title: `P${i}` });
  }
  await world.hub.refresh();
  assert.equal((await get({})).components.find((c) => c.type === 'card-list').items.length, 8);
  const folder = await get({ folder: '/maison/' });
  assert.deepEqual(
    folder.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [['maison', 13]],
  );
  const tag = await get({ tag: 'Cuisine' });
  assert.deepEqual(
    tag.components.find((c) => c.type === 'card-list').items.map((i) => i.title),
    ['Tarte aux pommes'],
  );
  const none = await get({ folder: 'garage', hide_counters: true }, 'de');
  assert.deepEqual(
    none.components.map((c) => c.text ?? c.type),
    ['Noch keine Seite anzuzeigen.'],
  );
});

test('widget links to Wiki.js over https; waiting before the first read', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, url: 'https://wiki.example.org' } });
  t.after(() => world.app.stop());
  const content = (await world.fake.widgetGet('pages', { settings: {}, language: 'en' })).data
    .content;
  const item = content.components.find((c) => c.type === 'card-list').items[0];
  assert.deepEqual(item.links, [
    { url: 'https://wiki.example.org/en/recettes/tarte-aux-pommes', label: 'Open in Wiki.js' },
  ]);
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  const waiting = (await empty.fake.widgetGet('pages', { settings: {}, language: 'en' })).data
    .content;
  assert.match(waiting.components[0].text, /Waiting for Wiki\.js/);
});

test('connection status: missing settings, a key Wiki.js refuses, down and back, not Wiki.js', async (t) => {
  const statusOf = (world) => world.fake.connectionStatus;
  const none = await createWorld({ config: {} });
  t.after(() => none.app.stop());
  assert.equal(statusOf(none).connected, false);
  assert.match(statusOf(none).message.fr, /Saisissez l'adresse/);
  const noKey = await createWorld({ config: { url: HOST } });
  t.after(() => noKey.app.stop());
  assert.match(statusOf(noKey).message.en, /Enter an API key/);
  const invalid = await createWorld({ config: { url: 'ftp://x', api_key: API_KEY } });
  t.after(() => invalid.app.stop());
  assert.match(statusOf(invalid).message.en, /not valid/);
  const guest = await createWorld({ config: { url: HOST, api_key: 'revoked' } });
  t.after(() => guest.app.stop());
  assert.equal(statusOf(guest).connected, false);
  assert.match(statusOf(guest).message.en, /did not accept the API key/);
  assert.equal(guest.fake.discoveredDevices.length, 0);
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(statusOf(world).connected, true);
  world.server.goDown();
  await world.hub.refresh();
  assert.equal(statusOf(world).connected, false);
  assert.match(statusOf(world).message.de, /antwortet nicht/);
  world.server.goUp();
  world.server.state.html = true;
  await world.hub.refresh();
  assert.match(statusOf(world).message.es, /no responde como Wiki\.js/);
  world.server.state.html = false;
  await world.hub.refresh();
  assert.equal(statusOf(world).connected, true);
});

test('test_connection: how many pages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection');
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Connecté à Wiki.js : 3 page(s).');
});

test('a key without manage:system: no version, everything else works', async (t) => {
  const server = createWikiJs();
  server.state.noSystem = true;
  const world = await createWorld({ server });
  t.after(() => world.app.stop());
  const device = world.fake.discoveredDevices[0];
  assert.equal(device.params.find((p) => p.name === 'WIKIJS_VERSION').value, '?');
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the language changes the names, not the device', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices[0].features[1].name, "Pages modifiées aujourd'hui");
  await world.fake.configUpdated({ ...CONFIG, language: 'es' });
  await settle(20);
  const device = world.fake.discoveredDevices[0];
  assert.equal(device.external_id, mainDevice);
  assert.equal(device.features[1].name, 'Páginas modificadas hoy');
});
