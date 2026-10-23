# Composants tiers de Folio

Cette notice décrit les composants intégrés à `Folio.html` et leur provenance. Les licences ci-dessous s’appliquent à ces composants ; elles ne définissent pas de licence globale pour le code propre à Folio, qui reste à choisir par le propriétaire du dépôt.

Le fichier [vendor/manifest.json](vendor/manifest.json) conserve les URL des archives npm, leurs empreintes SHA-256 et leurs valeurs d’intégrité SHA-512. Il permet de retrouver précisément les distributions utilisées.

## Composants embarqués

| Composant | Version | Utilisation | Licence distribuée |
| --- | --- | --- | --- |
| Marked | 18.1.1 | Conversion du Markdown | MIT ; notices supplémentaires du projet conservées |
| DOMPurify | 3.4.17 | Nettoyage du HTML issu des documents | Apache License 2.0 |
| KaTeX | 0.19.0 | Rendu des formules et styles mathématiques | MIT |
| Polices KaTeX | Distribution de KaTeX 0.19.0 | 20 fichiers WOFF2 intégrés aux styles | SIL Open Font License 1.1 |

### Marked 18.1.1

- Sources : <https://github.com/markedjs/marked/tree/v18.1.1>
- Version publiée : <https://github.com/markedjs/marked/releases/tag/v18.1.1>
- Distribution utilisée : paquet npm `marked@18.1.1`, fichier `package/lib/marked.umd.js`.
- Fichier intégré : `vendor/vendor.js`.
- Licence complète et notices d’origine : [licenses/Marked-MIT.txt](licenses/Marked-MIT.txt).

Copyright © 2018+, MarkedJS ; copyright © 2011–2018, Christopher Jeffrey. Le fichier de licence d’origine comprend également les notices relatives à Markdown, copyright © 2004, John Gruber, qui sont conservées dans la distribution. Les dispositions propres au projet Marked, dont sa section sur les contributions, ne constituent pas une licence ou une politique de contribution pour Folio.

### DOMPurify 3.4.17

- Sources : <https://github.com/cure53/DOMPurify/tree/3.4.17>
- Version publiée : <https://github.com/cure53/DOMPurify/releases/tag/3.4.17>
- Distribution utilisée : paquet npm `dompurify@3.4.17`, fichier `package/dist/purify.min.js`.
- Fichier intégré : `vendor/vendor.js`.
- Licence complète : [licenses/DOMPurify-Apache-2.0.txt](licenses/DOMPurify-Apache-2.0.txt).

DOMPurify est proposé par son projet d’origine sous Apache-2.0 **ou** MPL-2.0. Cette distribution utilise l’option **Apache-2.0**. La notice d’origine du fichier JavaScript et le texte complet de la licence Apache sont conservés dans le bundle.

### KaTeX 0.19.0

- Site officiel : <https://katex.org/>
- Version publiée et sources : <https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0>
- Index des versions : <https://katex.org/versions>
- Archive de distribution : <https://registry.npmjs.org/katex/-/katex-0.19.0.tgz>
- Fichiers intégrés : `vendor/math-vendor.js` et `vendor/math.css`.
- Licence du JavaScript et des styles : [licenses/KaTeX-MIT.txt](licenses/KaTeX-MIT.txt).

Copyright © 2013–2020, Khan Academy and other contributors. L’intégrité SHA-512 de l’archive a été vérifiée contre les métadonnées npm lors de l’intégration.

### Polices KaTeX

Les 20 polices WOFF2 de la distribution KaTeX sont encodées en URL `data:` dans `vendor/math.css`. Aucun chargement de police distante n’est nécessaire. Elles sont distribuées sous la [SIL Open Font License 1.1](licenses/KaTeX-Fonts-OFL-1.1.txt), dont le texte intégral et les notices de copyright sont également intégrés au CSS.

Copyright © 2009–2010, Design Science, Inc. ; copyright © 2014–2018, Khan Academy.

Noms réservés déclarés dans la licence des polices : `KaTeX_AMS`, `KaTeX_Caligraphic`, `KaTeX_Fraktur`, `KaTeX_Main`, `KaTeX_Math`, `KaTeX_SansSerif`, `KaTeX_Script`, `KaTeX_Size1`, `KaTeX_Size2`, `KaTeX_Size3`, `KaTeX_Size4` et `KaTeX_Typewriter`.

## Adaptations et redistribution

Le code exécutable de Marked et de DOMPurify provient des distributions npm fixées aux versions indiquées. Les commentaires de référencement des source maps ont été retirés de `vendor/vendor.js` pour éviter des chargements annexes par les outils de développement ; le code exécutable de ces bibliothèques n’a pas été modifié. Leurs licences complètes et notices d’origine sont présentes dans le bundle.

Les styles KaTeX sont distribués avec les polices embarquées en URL `data:`. Folio assemble ces ressources directement dans le HTML ; il ne les récupère pas sur un CDN à l’exécution. Les exports de documents conservent les styles mathématiques et leurs notices, ainsi que les polices nécessaires aux formules déjà rendues.

Conservez les notices de copyright et les textes de licence applicables lorsque vous redistribuez ces composants ou les fichiers qui les contiennent. Les textes du dossier `licenses/` sont les références complètes ; cette notice les accompagne sans les remplacer.

## Dépendances de développement

Les tests utilisent `jsdom` et `fake-indexeddb`, aux versions fixées dans `package.json` et `package-lock.json`, ainsi que leurs dépendances transitives. Ces paquets sont installés par `npm ci` pour les tests ; ils ne sont pas inclus dans `Folio.html`. Leurs notices et licences sont fournies dans leurs distributions npm respectives.
