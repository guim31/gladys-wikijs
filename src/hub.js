// -----------------------------------------------------------------------------
// The hub: the link to one Wiki.js and everything Gladys sees of it — the
// device, its states, the connection status, the scene events, and the pages
// written from scenes.
//
// Wiki.js pushes nothing: the container reads it every `refresh_minutes` (15
// by default) on its own timer (should_poll: false), and just after midnight
// so that "pages changed today" falls back to 0. A read is one GraphQL
// request (the list of every page, with its dates and tags), plus the version
// once, and one page read per change announced (its author).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { buildWikiDevice, buildWikiStates, isWikiDevice, wikiIds } from './devices.js';
import { WikiJsClient, WikiJsError } from './wikijs/client.js';
import {
  appendLine,
  isUnder,
  mainLocale,
  normalizePath,
  parseTags,
  stamp,
  summarizePage,
  titleFromPath,
} from './wikijs/model.js';
import { MemoryStore } from './store.js';
import { STATUS_TEXT, TEST_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'wikijs-hub' });

export const WIDGET_KEY = 'pages';
export const TRIGGERS = { changed: 'page_changed', tagged: 'tagged_page_changed' };

export const DEFAULT_TIMINGS = {
  // requestWidgetRefresh is dropped by the core beyond one call per 10 s.
  widgetGap: 10_500,
  // An unchanged value is sent again before Gladys calls it stale (48 h).
  heartbeat: 6 * 3_600_000,
  requestTimeout: 15_000,
  // The read after midnight waits a little for the clock to be past it.
  midnightDelay: 5_000,
};

// Past that many changes between two reads (an import, a folder moved), it
// is a burst: the ten oldest are announced and the rest is recorded as seen.
export const BURST = 50;
// Each announced change costs one more request (its author): bounded per
// read. Below a burst, the changes past ten wait for the next read.
export const MAX_EVENTS_PER_READ = 10;
// The pages written by the integration itself are never announced (a scene
// bound to "Page changed" that writes a page would loop).
const MAX_OWN = 200;
// Reads after which a change whose event Gladys keeps refusing is given up.
export const MAX_TRIES = 3;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language, values) {
    const messages = commandMessage(code, values);
    super(messages[language] ?? messages.en);
    this.code = code;
    this.messages = messages;
  }
}

const linkOf = (config) => JSON.stringify([config.url, config.apiKey]);
const timeOf = (iso) => Date.parse(iso);
const ownKey = (page) => `${page.id}@${timeOf(page.updated)}`;
const ownTime = (key) => Number(key.split('@')[1]);

/** Local midnight (the TZ of Gladys, injected by its supervisor) of a time. */
export function startOfDay(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The newest change seen: its time and the pages changed at that very millisecond. */
function advance(mark, page) {
  const at = timeOf(page.updated);
  if (!Number.isFinite(at)) {
    return mark;
  }
  if (!mark || at > mark.at) {
    return { at, ids: [page.id] };
  }
  if (at === mark.at && !mark.ids.includes(page.id)) {
    return { at, ids: [...mark.ids, page.id] };
  }
  return mark;
}

const seenBy = (mark, page) => {
  const at = timeOf(page.updated);
  return !Number.isFinite(at) || at < mark.at || (at === mark.at && mark.ids.includes(page.id));
};

const byNewest = (a, b) => timeOf(b.updated) - timeOf(a.updated) || b.id - a.id;

export class Hub {
  constructor({ gladys, fetch, timings, now = Date.now, store }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.store = store ?? new MemoryStore();
    this.config = { url: null, urlInvalid: false, apiKey: '', refreshMinutes: 15, language: 'fr' };
    this.client = null;
    this.version = '';
    /** every page, summarized, the newest change first; null before the first read */
    this.pages = null;
    /** { pages, today } */
    this.counters = null;
    /** null (fine), or the kind of the last failure */
    this.failure = null;
    this.announced = false;
    this.lastStatus = '';
    this.saved = '';
    /** what the triggers already saw: { instance, at, ids, since } */
    this.seen = null;
    /** `<page id>@<time>` of the changes written by the integration */
    this.own = new Set();
    /** ids announced "created" since `seen.since`: never "created" twice */
    this.createdIds = new Set();
    /** `<page id>@<time>` -> { tries, sent }: events Gladys refused, events it took */
    this.retries = new Map();
    this.eventFailing = false;
    this.devicesFailing = false;
    this.publishFailing = false;
    this.configuring = Promise.resolve();
    this.writing = Promise.resolve();
    this.refreshTimer = null;
    this.midnightTimer = null;
    this.refreshing = null;
    this.refreshAgain = false;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  get loaded() {
    return this.counters !== null;
  }

  async start(config) {
    const saved = await this.store.load();
    // A damaged file is a new baseline, not a crash on every read.
    this.seen =
      typeof saved.instance === 'string' &&
      Number.isFinite(saved.at) &&
      Array.isArray(saved.ids) &&
      saved.ids.every(Number.isInteger)
        ? {
            instance: saved.instance,
            at: saved.at,
            ids: saved.ids,
            since: Number.isFinite(saved.since) ? saved.since : saved.at,
          }
        : null;
    // The pages written from Gladys but not read back yet: never announced,
    // even after a restart.
    if (Array.isArray(saved.own)) {
      this.own = new Set(saved.own.filter((k) => typeof k === 'string').slice(-MAX_OWN));
    }
    if (this.seen && Array.isArray(saved.created)) {
      this.createdIds = new Set(saved.created.filter(Number.isInteger));
    }
    this.#scheduleMidnight();
    await this.reconfigure(config);
  }

  /** One configuration change at a time: a second one waits for the first. */
  reconfigure(config) {
    const run = this.configuring.then(() => this.#reconfigure(config));
    this.configuring = run.catch(() => {});
    return run;
  }

  async #reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const linkChanged = linkOf(previous) !== linkOf(config) || !this.client;
    if (linkChanged || previous.refreshMinutes !== config.refreshMinutes) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (linkChanged) {
      this.client = null;
      this.version = '';
      this.pages = null;
      this.counters = null;
      this.failure = null;
      this.announced = false;
      if (config.url && config.apiKey) {
        this.client = new WikiJsClient({
          url: config.url,
          apiKey: config.apiKey,
          fetch: this.fetch,
          timeout: this.timings.requestTimeout,
        });
      }
    }
    if (this.client && !this.refreshTimer) {
      this.refreshTimer = setInterval(
        () => this.refresh().catch((err) => logger.error('Read failed', err)),
        config.refreshMinutes * 60_000,
      );
      this.refreshTimer.unref?.();
    }
    if (linkChanged) {
      await this.refresh();
    } else {
      // Language or interval only: same data, new names and texts.
      this.gladys.forgetPublishedStates?.();
      await this.#update();
    }
    await this.updateConnectionStatus();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.lastStatus = '';
    await this.reconfigure(config);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.midnightTimer);
    clearTimeout(this.widgetTimer);
    this.refreshTimer = null;
    await this.store.flush();
  }

  /** A read just after local midnight: the count of the day starts again. */
  #scheduleMidnight() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const tomorrow = new Date(startOfDay(now));
    tomorrow.setDate(tomorrow.getDate() + 1);
    const wait = tomorrow.getTime() - now + this.timings.midnightDelay;
    this.midnightTimer = setTimeout(() => {
      this.#scheduleMidnight();
      if (this.client) {
        this.refresh().catch((err) => logger.error('Read failed', err));
      }
    }, wait);
    this.midnightTimer.unref?.();
  }

  // --- Reading Wiki.js ------------------------------------------------------

  /** Read Wiki.js (one read at a time; a request during it runs once after). */
  refresh() {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          await this.#refreshOnce();
        } catch (err) {
          // Never ends the loop: a read queued meanwhile (new address) still runs.
          logger.error('Read failed', err);
        }
      } while (this.refreshAgain && !this.stopped);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The key of the wiki for the triggers: a new address is a new baseline. */
  get #instance() {
    return this.config.url ?? '';
  }

  #known() {
    return this.seen?.instance === this.#instance ? this.seen : null;
  }

  async #refreshOnce() {
    const client = this.client;
    if (this.stopped) {
      return;
    }
    if (!client) {
      await this.publishDevices();
      return;
    }
    let list;
    let version = this.version;
    try {
      list = await client.pages();
      if (!this.announced) {
        version = await client.version();
      }
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.#fail(err);
      await this.updateConnectionStatus();
      return;
    }
    if (client !== this.client || this.stopped) {
      return;
    }
    this.version = version;
    this.pages = list.map((p) => summarizePage(p, this.config.url)).sort(byNewest);
    const midnight = startOfDay(this.now());
    this.counters = {
      pages: this.pages.length,
      today: this.pages.filter((p) => timeOf(p.updated) >= midnight).length,
    };
    this.#recover();
    await this.#update();
    if (client !== this.client || this.stopped) {
      return; // the configuration changed meanwhile
    }
    // A scene write in progress: its page must be known as ours first.
    await this.writing;
    await this.#announce(client, this.pages);
    await this.updateConnectionStatus();
  }

  /** Device, states and widget from the last read. */
  async #update() {
    await this.publishDevices();
    await this.publishStates();
    this.refreshWidget();
  }

  #fail(err) {
    const kind = err instanceof WikiJsError ? err.kind : 'unreachable';
    if (this.failure === null) {
      logger.warn(`Wiki.js: ${err.message}`);
    } else {
      logger.debug(`Wiki.js still failing: ${err.message}`);
    }
    if (this.failure === null) {
      this.refreshWidget(); // the widget shows that Wiki.js does not answer
    }
    this.failure = kind;
  }

  #recover() {
    const count = this.counters.pages;
    if (this.failure !== null) {
      logger.info(`Wiki.js answers again (${count} pages)`);
    } else if (!this.announced) {
      const version = this.version ? ` ${this.version}` : '';
      logger.info(`Connected to Wiki.js${version} (${count} pages)`);
    }
    this.announced = true;
    this.failure = null;
  }

  // --- Scene events ---------------------------------------------------------

  /**
   * Fire the pages created or changed since the last read, the oldest first.
   * The first read of a wiki is a silent baseline: installing the
   * integration announces nothing already there.
   * @param {WikiJsClient} client
   * @param {object[]} pages every page, the newest change first
   */
  async #announce(client, pages) {
    const known = this.#known();
    let mark = known ? { at: known.at, ids: known.ids } : null;
    // The end of the last read that went through its whole list: a page
    // created after it is "created", even when its event waited a read.
    let since = known?.since ?? 0;
    if (!known) {
      // Baseline: the newest change of the wiki (an empty wiki: any page to come).
      for (const page of pages) {
        mark = advance(mark, page);
      }
      mark ??= { at: 0, ids: [] };
      since = mark.at;
    } else {
      const changes = pages.filter((p) => !seenBy(known, p)).reverse();
      const fresh = changes.filter((p) => !this.#isOwn(p));
      const pending = fresh.slice(0, MAX_EVENTS_PER_READ);
      const burst = fresh.length > BURST;
      if (burst) {
        logger.info(`${fresh.length} pages changed at once: ${pending.length} announced`);
      }
      // The oldest first; the mark follows each page Gladys took.
      let stopped = false;
      let deferred = false;
      for (const page of changes) {
        if (this.#isOwn(page)) {
          mark = advance(mark, page);
          continue;
        }
        if (!pending.includes(page)) {
          deferred = true;
          break; // past ten: the next read
        }
        if ((await this.#fire(client, page, since)) === 'retry') {
          stopped = true;
          break;
        }
        mark = advance(mark, page);
      }
      if (burst && !stopped) {
        // The rest of a burst is seen: the mark jumps to the newest change.
        for (const page of changes) {
          mark = advance(mark, page);
        }
      }
      if (!stopped && (burst || !deferred)) {
        since = mark.at;
      }
    }
    for (const key of this.own) {
      if (ownTime(key) <= mark.at) {
        this.own.delete(key);
      }
    }
    for (const key of this.retries.keys()) {
      if (ownTime(key) <= mark.at) {
        this.retries.delete(key); // seen meanwhile (changed again, a burst)
      }
    }
    if (since !== known?.since) {
      this.createdIds.clear();
    }
    this.seen = { instance: this.#instance, at: mark.at, ids: mark.ids, since };
    await this.#save();
  }

  /** The mark and the own changes on disk, when they changed. */
  async #save() {
    const data = { ...this.seen, own: [...this.own], created: [...this.createdIds] };
    const text = JSON.stringify(data);
    if (text !== this.saved) {
      this.saved = text;
      await this.store.save(data);
    }
  }

  /**
   * Fire the events of one changed page: one "Page changed", and one "Tagged
   * page changed" per tag (so a scene set on a tag runs once).
   * @returns {Promise<'done' | 'retry'>}
   */
  async #fire(client, page, since) {
    const key = ownKey(page);
    const attempt = this.retries.get(key) ?? { tries: 0, sent: 0 };
    // Who changed it: one more request, best effort (the event goes anyway).
    let author = '';
    try {
      author = String((await client.page(page.id)).authorName ?? '');
    } catch (err) {
      logger.debug(`Page ${page.id} not read: ${err.message}`);
    }
    // Created after the last complete read, and not announced as such yet (a
    // page created, announced, then saved again while events wait). Decided
    // once per change: a retry sends the same events.
    attempt.created ??= timeOf(page.created) > since && !this.createdIds.has(page.id);
    const data = this.#eventData(page, author, attempt.created);
    const events = [
      [TRIGGERS.changed, data],
      ...page.tags.map((tag) => [TRIGGERS.tagged, { ...data, tag: tag.slice(0, 1000) }]),
    ];
    // The events Gladys already took for this change are not sent again.
    for (const [index, [trigger, eventData]] of events.entries()) {
      if (index < attempt.sent) {
        continue;
      }
      logger.debug(`${trigger}: ${page.id}`);
      try {
        await this.gladys.publishSceneEvent(trigger, eventData);
        if (this.eventFailing) {
          logger.info('Scene events accepted again');
        }
        this.eventFailing = false;
        attempt.sent = index + 1;
      } catch (err) {
        if (this.eventFailing) {
          logger.debug(`Cannot fire ${trigger}: ${err.message}`);
        } else {
          logger.warn(`Cannot fire ${trigger}: ${err.message}`);
        }
        this.eventFailing = true;
        // A refusal for good (4xx but 429) is not retried: it would be
        // refused at every read. Otherwise (Gladys restarting), this change
        // and the next ones are fired again at the next read.
        const status = err?.status;
        const final = Number.isInteger(status) && status >= 400 && status < 500 && status !== 429;
        if (final) {
          attempt.sent = index + 1;
          continue;
        }
        const tries = attempt.tries + 1;
        if (tries < MAX_TRIES) {
          this.retries.set(key, { ...attempt, tries });
          return 'retry';
        }
        // A change Gladys keeps refusing would hold back every later one.
        logger.warn(`Page ${page.id} not announced: Gladys refused it ${tries} times`);
        this.retries.delete(key);
        return 'done';
      }
    }
    this.retries.delete(key);
    if (attempt.created) {
      this.createdIds.add(page.id);
    }
    return 'done';
  }

  /**
   * A change written by the integration: Wiki.js may list a page between its
   * write and its render with an earlier time than the one it answered.
   */
  #isOwn(page) {
    const at = timeOf(page.updated);
    for (const key of this.own) {
      if (key.startsWith(`${page.id}@`) && at <= ownTime(key)) {
        return true;
      }
    }
    return false;
  }

  #eventData(page, author, created) {
    return {
      folder: page.folder.slice(0, 1000),
      path: page.path.slice(0, 1000),
      change: created ? 'created' : 'updated',
      title: page.title.slice(0, 1000),
      url: page.url.slice(0, 1000),
      updated_by: author.slice(0, 1000),
      tags: page.tags.join(', ').slice(0, 1000),
      page_id: page.id,
    };
  }

  // --- Device and states ----------------------------------------------------

  #isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  buildDevices() {
    if (!this.loaded) {
      return [];
    }
    return [buildWikiDevice(this.gladys, this.language, this.config.url ?? '', this.version)];
  }

  async publishDevices() {
    if (this.stopped) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      if (this.devicesFailing) {
        logger.debug(`Cannot publish the devices: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the devices: ${err.message}`);
      }
      this.devicesFailing = true;
      return;
    }
    this.devicesFailing = false;
  }

  /**
   * The states of the device, once the user added it (Gladys drops the others).
   * @param {string} [justCreated] the external id of a device just added
   */
  async publishStates(justCreated) {
    if (!this.loaded || this.stopped) {
      return;
    }
    const device = wikiIds(this.gladys).device;
    if (device !== justCreated && !this.#isCreated(device)) {
      return;
    }
    const states = buildWikiStates(this.gladys, this.counters, this.pages[0], this.language);
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeat });
    } catch (err) {
      if (this.publishFailing) {
        logger.debug(`Cannot publish the states: ${err.message}`);
      } else {
        logger.warn(`Cannot publish the states: ${err.message}`);
      }
      this.publishFailing = true;
      return;
    }
    if (this.publishFailing) {
      logger.info('States published again');
    }
    this.publishFailing = false;
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (!isWikiDevice(this.gladys, device?.external_id)) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.publishStates(device.external_id);
    this.refreshWidget();
  }

  /** The user renamed or deleted the device: the widget follows. */
  onDeviceChanged(device) {
    if (isWikiDevice(this.gladys, device?.external_id)) {
      this.refreshWidget();
    }
  }

  /** onPoll (the device is not polled: the container reads on its timer). */
  async poll(device) {
    if (isWikiDevice(this.gladys, device?.external_id)) {
      await this.publishStates(device.external_id);
    }
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + this.timings.widgetGap - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  /**
   * The pages of a folder and/or carrying a tag, the newest change first.
   * @param {{ folder?: string, tag?: string }} filter
   */
  filterPages({ folder = '', tag = '' } = {}) {
    const wantedTag = tag.trim().toLowerCase();
    return (this.pages ?? []).filter(
      (p) => isUnder(p.path, folder) && (wantedTag === '' || p.tags.includes(wantedTag)),
    );
  }

  // --- Connection status ----------------------------------------------------

  statusKey() {
    if (this.config.urlInvalid) {
      return 'invalid';
    }
    if (!this.config.url) {
      return 'none';
    }
    if (!this.config.apiKey) {
      return 'key';
    }
    if (this.failure) {
      return (
        {
          unauthorized: 'unauthorized',
          invalid: 'invalid_answer',
          http: 'error',
          forbidden: 'error',
          not_found: 'error',
          rejected: 'error',
        }[this.failure] ?? 'unreachable'
      );
    }
    return null;
  }

  statusMessage() {
    const key = this.statusKey();
    return key ? this.#statusOf(key) : null;
  }

  #statusOf(key) {
    return Object.fromEntries(
      Object.entries(STATUS_TEXT).map(([language, table]) => [language, table[key]]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    // Nothing to say before the first answer or failure.
    if (this.client && !this.loaded && this.failure === null) {
      return;
    }
    const message = this.statusMessage();
    const connected = Boolean(this.client) && this.loaded && this.failure === null;
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
      // Recorded once Gladys took it: a failed call is sent again next time.
      this.lastStatus = fingerprint;
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Actions --------------------------------------------------------------

  /** "Test the connection": a fresh read, then its outcome. */
  async testReport() {
    if (!this.client) {
      return this.statusMessage();
    }
    await this.refresh();
    const message = this.statusMessage();
    if (message) {
      return message;
    }
    if (!this.loaded) {
      // The configuration changed during the test: nothing read yet.
      return this.#statusOf('unreachable');
    }
    return Object.fromEntries(
      Object.entries(TEST_TEXT).map(([language, render]) => [
        language,
        render(this.counters.pages),
      ]),
    );
  }

  #clientOrFail() {
    if (!this.client) {
      throw new CommandError('unreachable', this.language);
    }
    return this.client;
  }

  /** Writes one at a time: two lines added at once both land in the page. */
  #serialize(fn) {
    const run = this.writing.then(fn);
    this.writing = run.catch(() => {});
    return run;
  }

  /** The pages to look a path up in: the last read, else a fresh one. */
  async #knownPages(client) {
    if (this.pages && client === this.client) {
      return this.pages;
    }
    return (await client.pages()).map((p) => summarizePage(p, this.config.url));
  }

  #path(raw) {
    const path = normalizePath(raw);
    if (!path) {
      throw new CommandError('path', this.language);
    }
    return path;
  }

  /**
   * Create a Markdown page. A path already taken is an error, never overwritten.
   * @param {{ path: unknown, title: unknown, content?: unknown, tags?: unknown }} request
   */
  createPage({ path: rawPath, title: rawTitle, content, tags }) {
    return this.#serialize(async () => {
      const language = this.language;
      const path = this.#path(rawPath);
      const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 255) : '';
      if (!title) {
        throw new CommandError('title', language);
      }
      const client = this.#clientOrFail();
      const text = typeof content === 'string' ? content.trim() : '';
      let page;
      let locale;
      try {
        locale = mainLocale(await this.#knownPages(client));
        page = await client.createPage({
          path,
          title,
          // Wiki.js refuses an empty page.
          content: text || `# ${title}`,
          tags: parseTags(tags),
          locale,
        });
      } catch (err) {
        throw this.#commandError(err, path);
      }
      this.#remember(page);
      logger.info('Page created');
      this.refresh().catch(() => {});
      return this.#written(page, locale);
    });
  }

  /**
   * Add a line at the end of a page (a journal), created if missing.
   * @param {{ path: unknown, line: unknown, addTime?: unknown, title?: unknown }} request
   */
  appendToPage({ path: rawPath, line, addTime, title: rawTitle }) {
    return this.#serialize(async () => {
      const language = this.language;
      const path = this.#path(rawPath);
      const typed = typeof line === 'string' ? line.trim().slice(0, 5000) : '';
      if (!typed) {
        throw new CommandError('line', language);
      }
      const text =
        addTime === false || addTime === 'false' ? typed : `${stamp(this.now())} — ${typed}`;
      const client = this.#clientOrFail();
      let written;
      let locale;
      let created = false;
      try {
        const known = await this.#knownPages(client);
        const main = mainLocale(known);
        // The locale of a page already at that path, the main one first.
        const match =
          known.find((p) => p.path === path && p.locale === main) ??
          known.find((p) => p.path === path);
        locale = match?.locale ?? main;
        const existing = await client.pageByPath(path, locale);
        if (existing) {
          written = await client.updatePage(existing, appendLine(existing, text));
        } else {
          const title =
            (typeof rawTitle === 'string' ? rawTitle.trim().slice(0, 255) : '') ||
            titleFromPath(path);
          written = await client.createPage({ path, title, content: text, tags: [], locale });
          created = true;
        }
      } catch (err) {
        throw this.#commandError(err, path);
      }
      this.#remember(written);
      logger.info(created ? 'Journal page created' : 'Line added to a page');
      this.refresh().catch(() => {});
      return { ...this.#written(written, locale), created };
    });
  }

  #written(page, locale) {
    const summary = summarizePage({ ...page, locale }, this.config.url);
    return { page_id: page.id, path: summary.path, url: summary.url };
  }

  #remember(page) {
    if (!page?.updatedAt) {
      return;
    }
    this.own.add(ownKey({ id: page.id, updated: page.updatedAt }));
    if (this.own.size > MAX_OWN) {
      this.own.delete(this.own.values().next().value);
    }
    // Kept on disk: a restart before the next read must not announce it.
    if (this.seen) {
      this.#save().catch(() => {});
    }
  }

  #commandError(err, path) {
    if (err instanceof CommandError) {
      return err;
    }
    const kind = err instanceof WikiJsError ? err.kind : 'unreachable';
    const detail = err.message;
    if (kind === 'unauthorized') {
      return new CommandError('unauthorized', this.language);
    }
    if (kind === 'forbidden') {
      return new CommandError('forbidden', this.language);
    }
    if (kind === 'exists') {
      return new CommandError('exists', this.language, { path: path.slice(0, 100) });
    }
    if (kind === 'rejected') {
      return new CommandError('rejected', this.language, { detail });
    }
    if (kind === 'timeout') {
      // The request may have reached Wiki.js: the page may be written.
      return new CommandError('timeout', this.language);
    }
    if (kind === 'unreachable') {
      return new CommandError('unreachable', this.language);
    }
    return new CommandError('http', this.language, { detail });
  }
}
