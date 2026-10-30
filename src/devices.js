// -----------------------------------------------------------------------------
// Wiki.js -> Gladys device: one "Wiki.js" device (`wikijs:wiki`) with the
// number of pages, the pages changed today and the latest changed page.
// The integration links one wiki: its device keeps its id when the address
// of the wiki changes (a new IP, a reverse proxy), history and scenes stay.
// Everything is read only: pages are written through the scene actions.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { NAMES, NONE, pick } from './texts.js';

export const WIKIJS_TYPE = 'wikijs';
export const WIKI_ID = 'wiki';
export const COUNTERS = ['pages', 'today'];

const MAX_COUNT = 10_000_000;

export const wikiIds = (gladys) => gladys.externalIds(WIKIJS_TYPE, WIKI_ID);

const counter = (name, externalId) => ({
  name,
  external_id: externalId,
  category: CAT.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  min: 0,
  max: MAX_COUNT,
  keep_history: true,
});

/**
 * @param {object} gladys
 * @param {string} language
 * @param {string} url Wiki.js base URL (a device param, shown in Gladys)
 * @param {string} version
 */
export function buildWikiDevice(gladys, language, url, version) {
  const names = pick(NAMES, language);
  const ids = wikiIds(gladys);
  return {
    name: 'Wiki.js',
    external_id: ids.device,
    model: 'Wiki.js',
    should_poll: false,
    features: [
      ...COUNTERS.map((key) => counter(names[key], ids.feature(key))),
      {
        name: names.latest,
        external_id: ids.feature('latest'),
        category: CAT.TEXT,
        type: TYPE.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        min: 0,
        max: 0,
        keep_history: false,
      },
    ],
    params: [
      { name: 'WIKIJS_URL', value: url },
      { name: 'WIKIJS_VERSION', value: version || '?' },
    ],
  };
}

/**
 * @param {object} gladys
 * @param {{ pages: number, today: number }} counters
 * @param {{ title: string } | undefined} latest the page changed last
 * @param {string} language
 */
export function buildWikiStates(gladys, counters, latest, language) {
  const ids = wikiIds(gladys);
  return [
    ...COUNTERS.map((key) => ({
      device_feature_external_id: ids.feature(key),
      state: counters[key],
    })),
    {
      device_feature_external_id: ids.feature('latest'),
      text: (latest?.title || pick(NONE, language)).slice(0, 200),
    },
  ];
}

/** Whether a device external id is the Wiki.js device. */
export const isWikiDevice = (gladys, externalId) => externalId === wikiIds(gladys).device;
