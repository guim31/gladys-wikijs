// What reaches `docker logs` at the default level (info): the lifecycle only.
// A normal cycle (reads, published states, events, polls) writes nothing at
// info, an outage logs one line, and its recovery one more.
//
// The SDK logger writes through console.log (debug, info) and console.error
// (warn, error), re-reading LOG_LEVEL on every call: the tests capture both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, HOST, createWikiJs } from './helpers/fakeWikiJs.js';
import { createAll, createWorld } from './helpers/world.js';

function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const captured = [];
  const record = (...args) => captured.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    all: () => [...captured],
    lines: () => captured.filter((line) => !line.includes('[DEBUG]') && line.includes('[wikijs-')),
    reset: () => captured.splice(0),
  };
}

test('a normal cycle writes nothing at info: reads, states, events, polls', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world.fake);
  const start = logs.lines();
  assert.deepEqual(start.length, 1, start.join('\n'));
  assert.match(start[0], /Connected to Wiki\.js 2\.5\.317 \(3 pages\)/);
  logs.reset();
  for (let i = 0; i < 5; i += 1) {
    world.server.addPage({ path: `notes/p${i}`, title: `Page ${i}`, tags: ['note'] });
    await world.hub.refresh();
  }
  await world.fake.poll(world.fake.discoveredDevices[0]);
  await world.fake.widgetGet('pages', { settings: {} });
  assert.equal(world.fake.sceneEvents.length, 10, 'events were fired');
  assert.deepEqual(logs.lines(), [], 'nothing at info or above');
});

test('one line per page written by a scene, without its content', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.reset();
  await world.fake.sceneAction('append_line', {
    path: 'maison/chaudiere',
    line: 'secret-plans',
  });
  const lines = logs.lines();
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /\[INFO\].*Line added to a page/);
  assert.ok(!lines[0].includes('secret-plans'), 'the line is not logged');
});

test('Wiki.js down: one warning, nothing per attempt, one line when it is back', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.reset();
  world.server.goDown();
  for (let i = 0; i < 4; i += 1) {
    await world.hub.refresh();
  }
  const down = logs.lines();
  assert.equal(down.length, 1, down.join('\n'));
  assert.match(down[0], /\[WARN\].*Wiki\.js unreachable \(ECONNREFUSED\)/);
  logs.reset();
  world.server.goUp();
  await world.hub.refresh();
  const back = logs.lines();
  assert.equal(back.length, 1, back.join('\n'));
  assert.match(back[0], /\[INFO\].*Wiki\.js answers again \(3 pages\)/);
});

test('the API key never reaches the logs', async (t) => {
  const logs = captureLogs(t);
  for (const secret of ['s3cr3t-wrong', API_KEY]) {
    const world = await createWorld({
      server: createWikiJs(),
      config: { url: HOST, api_key: secret },
    });
    await world.hub.refresh();
    await world.fake.sceneAction('create_page', { path: 'x', title: 'X' });
    await world.app.stop();
  }
  const all = logs.all().join('\n');
  for (const secret of ['s3cr3t-wrong', API_KEY]) {
    assert.ok(!all.includes(secret), secret);
  }
});
