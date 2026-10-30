# Wiki.js

Reliez Gladys à [Wiki.js](https://js.wiki), le wiki auto-hébergé : suivez ses
compteurs, réagissez quand une page est créée ou modifiée, écrivez des pages
depuis vos scènes, et tenez un journal (la chaudière, l'alarme, le jardin…) que
Gladys remplit ligne après ligne. Tout reste sur votre réseau local : Gladys
parle directement à votre Wiki.js.

Testée sur un vrai Wiki.js 2.5.317 (l'image Docker officielle). Vos retours sont
les bienvenus sur le forum de Gladys.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Wiki.js 2.x joignable depuis la machine de Gladys. Wiki.js 3 n'est pas pris
  en charge.
- Une clé d'API : dans Wiki.js, ouvrez **Administration → API Access**, cliquez
  sur **Enable API** si elle est désactivée, puis sur **New API Key**. Une clé
  **Full Access** convient. Une clé limitée à un groupe voit ce que voit ce
  groupe : elle doit pouvoir lire les pages, et les écrire pour les actions de
  scène. Copiez la clé : elle n'est affichée qu'une fois.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Dans **Adresse de Wiki.js**, saisissez l'adresse à laquelle vous ouvrez
   Wiki.js, par exemple `192.168.1.50:3000` ou `https://wiki.example.org`.
3. Collez la **Clé d'API**.
4. **Lire Wiki.js toutes les** : 5, 15 (par défaut), 30 ou 60 minutes. Les pages
   modifiées sont annoncées à la lecture suivante.
5. **Langue des noms et messages** fixe le nom des fonctionnalités (figé à
   l'ajout d'un appareil) et les textes de l'intégration. Français par défaut.
6. Enregistrez, puis utilisez **Tester la connexion** : elle affiche le nombre de
   pages.
7. Dans l'onglet **Découverte**, ajoutez l'appareil **Wiki.js**.

## Appareils

**Wiki.js** (un appareil) :

| Fonctionnalité              | Valeur                                                  |
| --------------------------- | ------------------------------------------------------- |
| Pages                       | nombre de pages                                         |
| Pages modifiées aujourd'hui | pages créées ou enregistrées depuis minuit              |
| Dernière page modifiée      | titre de la page créée ou enregistrée le plus récemment |

Les compteurs gardent leur historique. L'appareil garde son identité quand
l'adresse de Wiki.js change.

## Widget du tableau de bord

**Wiki.js** : deux tuiles (pages, pages modifiées aujourd'hui) et les huit
dernières pages modifiées, avec leur chemin et l'heure de la modification. Dans
les réglages du widget, **Dossier** garde les pages sous un chemin (ex.
`maison`) et **Étiquette** les pages qui la portent ; la tuile les compte alors.
**Masquer les compteurs** ne garde que la liste. Quand Wiki.js est joint en
https, chaque page s'ouvre dans Wiki.js.

## Déclencheurs de scène

- **Page Wiki.js créée ou modifiée** : une page est créée ou enregistrée dans
  Wiki.js. Filtres : **Dossier** (la première partie du chemin, ex. `maison`
  pour `maison/chaudiere`), **Chemin de la page** (une seule page, ex.
  `maison/chaudiere`) et **Changement** (créée, modifiée, ou vide : les deux).
  Les filtres vides laissent passer toutes les pages.
- **Page Wiki.js étiquetée modifiée** : la même chose, pour les pages qui portent
  une étiquette : **Étiquette** (obligatoire, en minuscules comme Wiki.js
  l'enregistre, ex. `journal`), **Dossier** et **Changement**. Une page à
  plusieurs étiquettes déclenche une fois par étiquette : une scène réglée sur
  une étiquette ne s'exécute qu'une fois.

Les chemins s'écrivent comme dans l'adresse de la page, sans la langue (`/fr/`)
ni les barres obliques aux deux bouts.

Variables : **Titre de la page**, **Chemin de la page**, **Dossier**,
**Changement** (`created` ou `updated`), **Adresse de la page**, **Modifiée
par**, **Étiquettes** (séparées par des virgules), **Identifiant de la page**,
et **Étiquette** pour le second déclencheur.

La première lecture après l'installation est silencieuse : les pages déjà là ne
sont pas annoncées. Les pages écrites par cette intégration ne sont jamais
annoncées. Dix pages au plus sont annoncées par lecture, les plus anciennes
d'abord ; les suivantes attendent la lecture suivante. Au-delà de 50
modifications entre deux lectures (un import), dix sont annoncées et le reste
est compté comme vu.

## Actions de scène

- **Créer une page Wiki.js** : **Chemin de la page** (ex. `rapports/2026-10`),
  **Titre**, et si vous le souhaitez **Contenu** (Markdown) et **Étiquettes**
  (séparées par des virgules). La page est publiée, dans la langue de la plupart
  des pages du wiki. Une page déjà présente à ce chemin est une erreur : elle
  n'est jamais écrasée.
- **Ajouter une ligne à une page Wiki.js** : **Chemin de la page** et **Ligne**.
  La ligne est ajoutée à la fin de la page, en nouveau paragraphe, précédée de
  la date et de l'heure sauf si **Commencer par la date et l'heure** est
  désactivé. La page est créée à sa première ligne, avec pour titre la fin de
  son chemin, sauf si **Titre si la page est créée** est rempli. Les pages
  Markdown reçoivent la ligne en Markdown, celles de l'éditeur visuel en texte
  brut. Tout le reste de la page (titre, étiquettes, publication, scripts) est
  conservé.

Les deux renvoient **Identifiant de la page**, **Chemin de la page** et
**Adresse de la page** ; la seconde aussi **Page créée**.

## Exemples de scènes

- **Journal de la chaudière** : quand la pression de la chaudière passe sous
  1 bar → **Ajouter une ligne à une page Wiki.js**, chemin
  `journal/chaudiere`, ligne « Pression sous 1 bar ».
- **Savoir ce qui a changé** : déclencheur **Page Wiki.js créée ou modifiée**,
  dossier `procedures` → envoyer un message « {{triggerEvent.data.updated_by}}
  a modifié {{triggerEvent.data.title}} ».
- **Liste de courses sur le wiki** : déclencheur **Page Wiki.js créée ou
  modifiée**, chemin `maison/courses` → envoyer l'adresse de la page à la
  famille.
- **Rapport de vacances** : quand l'alarme est désactivée au retour de vacances
  → **Créer une page Wiki.js** à `rapports/vacances-2026`, étiquetée `rapport`.

## Dépannage

- **« Wiki.js n'a pas accepté la clé d'API »** : la clé a été révoquée, a expiré
  ou a été mal recopiée, ou l'API est désactivée. Wiki.js répond alors comme à
  un visiteur non connecté : vérifiez **Administration → API Access**.
- **« La clé d'API ne peut pas écrire cette page »** : le groupe de la clé n'a
  pas le droit d'écriture sur ce chemin. Utilisez une clé Full Access, ou
  élargissez le groupe.
- **« Wiki.js ne répond pas »** : vérifiez l'adresse et le port depuis la machine
  de Gladys. Le conteneur est sur un réseau en pont : `localhost` désigne le
  conteneur lui-même, saisissez plutôt l'adresse IP du serveur.
- **« Cette adresse ne répond pas comme Wiki.js »** : une page de connexion d'un
  proxy répond à la place de Wiki.js, ou l'adresse contient le chemin d'une
  page. Saisissez l'adresse de l'accueil du wiki.
- La version affiche `?` sur l'appareil : la clé ne peut pas lire les
  informations du système (seule une clé Full Access le peut). Rien d'autre
  n'est touché.
- Pour plus de détails dans les journaux de l'intégration, réglez
  `LOG_LEVEL=debug`.

## Limites

- Un seul Wiki.js, vu avec les droits de sa clé d'API.
- Les déclencheurs partent à la lecture suivante (15 minutes par défaut), pas
  instantanément : Wiki.js ne pousse rien. Les pages supprimées, déplacées ou
  seulement commentées ne sont pas annoncées ; une page enregistrée plusieurs
  fois entre deux lectures est annoncée une fois.
- Une lecture est une requête qui liste toutes les pages (quelques centaines de
  Ko pour des milliers de pages), plus une par page annoncée. Wiki.js n'impose
  aucun quota de requêtes.
- L'intégration ne supprime ni ne déplace jamais rien dans Wiki.js.
- Sans lien avec Wiki.js ni Requarks.
