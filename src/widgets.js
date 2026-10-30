// -----------------------------------------------------------------------------
// The "Wiki.js" dashboard widget: counters (pages, pages changed today — or
// the pages of the folder or tag set in the widget) and the pages changed
// last, each one opening in Wiki.js.
// -----------------------------------------------------------------------------

import { WIDGET_KEY } from './hub.js';
import { normalizePath } from './wikijs/model.js';
import { NAMES, pick } from './texts.js';

// The core shows 8 items at most in a `list` card-list.
export const MAX_ITEMS = 8;

export const TEXT = {
  today: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  open: {
    en: 'Open in Wiki.js',
    fr: 'Ouvrir dans Wiki.js',
    de: 'In Wiki.js öffnen',
    es: 'Abrir en Wiki.js',
  },
  empty: {
    en: 'No page to show yet.',
    fr: 'Aucune page à afficher pour le moment.',
    de: 'Noch keine Seite anzuzeigen.',
    es: 'Todavía no hay ninguna página que mostrar.',
  },
  unavailable: {
    en: 'Wiki.js does not answer right now.',
    fr: 'Wiki.js ne répond pas pour le moment.',
    de: 'Wiki.js antwortet gerade nicht.',
    es: 'Wiki.js no responde en este momento.',
  },
  waiting: {
    en: 'Waiting for Wiki.js: check the configuration of the integration.',
    fr: "En attente de Wiki.js : vérifiez la configuration de l'intégration.",
    de: 'Warte auf Wiki.js: Prüfe die Konfiguration der Integration.',
    es: 'Esperando a Wiki.js: compruebe la configuración de la integración.',
  },
};

const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const https = (url) => typeof url === 'string' && /^https:\/\//i.test(url);

function shortDate(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(
    { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-GB',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
  );
}

/** One row of the list: the title, then the path and the date of the change. */
export function pageItem(page, language) {
  const item = {
    title: cut(page.title, 60),
    subtitle: cut([page.path, shortDate(page.updated, language)].filter(Boolean).join(' · '), 60),
  };
  // The links of a card must be https: a Wiki.js on plain http is left out.
  if (https(page.url)) {
    item.links = [{ url: page.url.slice(0, 2000), label: pick(TEXT.open, language) }];
  }
  return item;
}

const truthy = (value) => value === true || value === 'true';
const text = (value) => (typeof value === 'string' ? value.trim() : '');

export async function buildContent(hub, { language = 'en', settings = {} } = {}) {
  if (!hub.loaded) {
    return {
      ttl_seconds: 60,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: pick(hub.failure ? TEXT.unavailable : TEXT.waiting, language),
        },
      ],
    };
  }
  const folder = normalizePath(settings?.folder);
  const tag = text(settings?.tag).toLowerCase();
  const filtered = folder !== '' || tag !== '';
  const pages = hub.filterPages({ folder, tag });
  const names = pick(NAMES, language);
  const components = [];
  if (!truthy(settings?.hide_counters)) {
    if (filtered) {
      const label = [folder, tag ? `#${tag}` : ''].filter(Boolean).join(' ');
      components.push({
        type: 'value',
        label: cut(label, 24),
        value: pages.length,
        icon: 'folder',
      });
    } else {
      components.push(
        { type: 'value', label: names.pages, value: hub.counters.pages, icon: 'file-text' },
        {
          type: 'value',
          label: pick(TEXT.today, language),
          value: hub.counters.today,
          icon: 'edit-3',
        },
      );
    }
  }
  if (hub.failure !== null) {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.unavailable, language) });
  }
  if (pages.length === 0) {
    components.push({ type: 'text', variant: 'caption', text: pick(TEXT.empty, language) });
  } else {
    components.push({
      type: 'card-list',
      display: 'list',
      items: pages.slice(0, MAX_ITEMS).map((p) => pageItem(p, language)),
    });
  }
  // The hub nudges the widget after every read and every write.
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get: (hub, request) => buildContent(hub, request),
  },
};
