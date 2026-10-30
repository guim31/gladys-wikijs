// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. Wiki.js menus are named as in its English interface
// ("Administration → API Access"). German says "du", Spanish "usted"
// (test/i18n.test.js).
// -----------------------------------------------------------------------------

// Feature names (frozen by Gladys at creation).
export const NAMES = {
  en: {
    pages: 'Pages',
    today: 'Pages changed today',
    latest: 'Latest changed page',
  },
  fr: {
    pages: 'Pages',
    today: "Pages modifiées aujourd'hui",
    latest: 'Dernière page modifiée',
  },
  de: {
    pages: 'Seiten',
    today: 'Heute geänderte Seiten',
    latest: 'Zuletzt geänderte Seite',
  },
  es: {
    pages: 'Páginas',
    today: 'Páginas modificadas hoy',
    latest: 'Última página modificada',
  },
};

/** The "Latest changed page" text of an empty wiki. */
export const NONE = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' };

export const STATUS_TEXT = {
  en: {
    none: 'Enter the address of Wiki.js and an API key in the configuration.',
    invalid: 'The Wiki.js address is not valid: enter an address like 192.168.1.50:3000.',
    key: 'Enter an API key (Wiki.js → Administration → API Access).',
    unauthorized:
      'Wiki.js did not accept the API key: check it, its expiry, and that the API is enabled.',
    unreachable: 'Wiki.js does not answer: check its address and that it is running.',
    error: 'Wiki.js answered with an error: see the logs of the integration.',
    invalid_answer: 'This address does not answer like Wiki.js: check the address and the port.',
  },
  fr: {
    none: "Saisissez l'adresse de Wiki.js et une clé d'API dans la configuration.",
    invalid:
      "L'adresse de Wiki.js n'est pas valide : saisissez une adresse comme 192.168.1.50:3000.",
    key: "Saisissez une clé d'API (Wiki.js → Administration → API Access).",
    unauthorized:
      "Wiki.js n'a pas accepté la clé d'API : vérifiez-la, sa date d'expiration et que l'API est activée.",
    unreachable: "Wiki.js ne répond pas : vérifiez son adresse et qu'il est démarré.",
    error: "Wiki.js a répondu par une erreur : consultez les journaux de l'intégration.",
    invalid_answer: "Cette adresse ne répond pas comme Wiki.js : vérifiez l'adresse et le port.",
  },
  de: {
    none: 'Gib in der Konfiguration die Adresse von Wiki.js und einen API-Schlüssel ein.',
    invalid: 'Die Wiki.js-Adresse ist ungültig: Gib eine Adresse wie 192.168.1.50:3000 ein.',
    key: 'Gib einen API-Schlüssel ein (Wiki.js → Administration → API Access).',
    unauthorized:
      'Wiki.js hat den API-Schlüssel nicht akzeptiert: Prüfe ihn, sein Ablaufdatum und ob die API aktiviert ist.',
    unreachable: 'Wiki.js antwortet nicht: Prüfe die Adresse und ob es läuft.',
    error: 'Wiki.js hat mit einem Fehler geantwortet: Sieh dir die Logs der Integration an.',
    invalid_answer: 'Diese Adresse antwortet nicht wie Wiki.js: Prüfe Adresse und Port.',
  },
  es: {
    none: 'Introduzca la dirección de Wiki.js y una clave de API en la configuración.',
    invalid:
      'La dirección de Wiki.js no es válida: introduzca una dirección como 192.168.1.50:3000.',
    key: 'Introduzca una clave de API (Wiki.js → Administration → API Access).',
    unauthorized:
      'Wiki.js no aceptó la clave de API: compruébela, su caducidad y que la API esté activada.',
    unreachable: 'Wiki.js no responde: compruebe su dirección y que esté en marcha.',
    error: 'Wiki.js respondió con un error: consulte los registros de la integración.',
    invalid_answer: 'Esta dirección no responde como Wiki.js: compruebe la dirección y el puerto.',
  },
};

/** "Test the connection" once Wiki.js answered. */
export const TEST_TEXT = {
  en: (pages) => `Connected to Wiki.js: ${pages} page(s).`,
  fr: (pages) => `Connecté à Wiki.js : ${pages} page(s).`,
  de: (pages) => `Mit Wiki.js verbunden: ${pages} Seite(n).`,
  es: (pages) => `Conectado a Wiki.js: ${pages} página(s).`,
};

export const INIT_FAILED = {
  en: 'The integration could not start: see its logs.',
  fr: "L'intégration n'a pas pu démarrer : consultez ses journaux.",
  de: 'Die Integration konnte nicht starten: Sieh dir ihre Logs an.',
  es: 'La integración no pudo iniciarse: consulte sus registros.',
};

// Errors of the scene actions. `{path}` is a page path, `{detail}` the
// reason Wiki.js gave.
export const COMMAND_ERRORS = {
  en: {
    timeout: 'Wiki.js answered too late: the page may have been written anyway.',
    http: 'Wiki.js could not write the page: {detail}',
    unreachable: 'Wiki.js does not answer: nothing was done.',
    unauthorized: 'Wiki.js did not accept the API key: nothing was done.',
    forbidden: 'The API key may not write this page: nothing was done.',
    exists: 'A page already exists at "{path}": nothing was done.',
    path: 'Enter the path of the page.',
    title: 'Enter the title of the page.',
    line: 'Enter the line to add.',
    rejected: 'Wiki.js refused the page: {detail}',
  },
  fr: {
    timeout: 'Wiki.js a répondu trop tard : la page a peut-être été écrite quand même.',
    http: "Wiki.js n'a pas pu écrire la page : {detail}",
    unreachable: "Wiki.js ne répond pas : rien n'a été fait.",
    unauthorized: "Wiki.js n'a pas accepté la clé d'API : rien n'a été fait.",
    forbidden: "La clé d'API ne peut pas écrire cette page : rien n'a été fait.",
    exists: "Une page existe déjà à « {path} » : rien n'a été fait.",
    path: 'Saisissez le chemin de la page.',
    title: 'Saisissez le titre de la page.',
    line: 'Saisissez la ligne à ajouter.',
    rejected: 'Wiki.js a refusé la page : {detail}',
  },
  de: {
    timeout: 'Wiki.js hat zu spät geantwortet: Die Seite wurde vielleicht trotzdem geschrieben.',
    http: 'Wiki.js konnte die Seite nicht schreiben: {detail}',
    unreachable: 'Wiki.js antwortet nicht: Es wurde nichts getan.',
    unauthorized: 'Wiki.js hat den API-Schlüssel nicht akzeptiert: Es wurde nichts getan.',
    forbidden: 'Der API-Schlüssel darf diese Seite nicht schreiben: Es wurde nichts getan.',
    exists: 'Unter „{path}“ gibt es schon eine Seite: Es wurde nichts getan.',
    path: 'Gib den Pfad der Seite ein.',
    title: 'Gib den Titel der Seite ein.',
    line: 'Gib die hinzuzufügende Zeile ein.',
    rejected: 'Wiki.js hat die Seite abgelehnt: {detail}',
  },
  es: {
    timeout:
      'Wiki.js respondió demasiado tarde: puede que la página se haya escrito de todos modos.',
    http: 'Wiki.js no pudo escribir la página: {detail}',
    unreachable: 'Wiki.js no responde: no se ha hecho nada.',
    unauthorized: 'Wiki.js no aceptó la clave de API: no se ha hecho nada.',
    forbidden: 'La clave de API no puede escribir esta página: no se ha hecho nada.',
    exists: 'Ya existe una página en «{path}»: no se ha hecho nada.',
    path: 'Introduzca la ruta de la página.',
    title: 'Introduzca el título de la página.',
    line: 'Introduzca la línea que desea añadir.',
    rejected: 'Wiki.js rechazó la página: {detail}',
  },
};

/** A coded message in every language, details filled in. */
export function commandMessage(code, values = {}) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      (table[code] ?? table.unreachable)
        .replace('{path}', () => values.path ?? '')
        .replace('{detail}', () => values.detail ?? '')
        .slice(0, 200),
    ]),
  );
}

export const pick = (table, language) => table[language] ?? table.en;
