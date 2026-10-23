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
| Mermaid | 12.2.0 | Rendu des diagrammes en images SVG intégrées | MIT ; licences des dépendances incluses conservées |

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

### Mermaid 12.2.0

- Site officiel : <https://mermaid.js.org/>
- Sources et version publiée : <https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.2.0>.
- Archive de distribution : <https://registry.npmjs.org/mermaid/-/mermaid-12.2.0.tgz>.
- Distribution utilisée : `package/dist/mermaid.min.js`, bundle IIFE complet officiel ; les moteurs de diagrammes et de disposition sont intégrés dans ce fichier.
- Fichier intégré : `vendor/mermaid-vendor.js`.
- Licence de Mermaid : [licenses/Mermaid-MIT.txt](licenses/Mermaid-MIT.txt).
- Licences et provenance des dépendances du bundle : [licenses/Mermaid-THIRD-PARTY.txt](licenses/Mermaid-THIRD-PARTY.txt).

Copyright © 2014–2022, Knut Sveidqvist. L’archive npm a été vérifiée contre son intégrité SHA-512 publiée. Le manifeste conserve aussi les SHA-256 de l’archive, du JavaScript officiel, de sa source map utilisée pour identifier les dépendances et du bundle Folio final.

Les 66 paquets npm identifiés dans cette source map conservent leurs textes de licence et leurs notices, repris de leurs archives aux versions exactes. Ils comprennent notamment des composants MIT, ISC, BSD-3-Clause, Apache-2.0 et ELK sous EPL-2.0. Le bundle contient ses propres versions internes de DOMPurify et de KaTeX ; elles sont recensées séparément dans les notices de Mermaid et ne remplacent pas les distributions utilisées directement par Folio. FastDom fournit sa licence MIT dans son README. Les commentaires de licence présents dans la distribution JavaScript sont également conservés.

Les sources correspondantes et les instructions de construction d’ELK sont disponibles auprès des projets [elkjs 0.9.3](https://github.com/kieler/elkjs/tree/a8304cf79fde75bc2ab1a89d28320f53f8637436) et [Eclipse ELK](https://github.com/eclipse/elk). Folio ne modifie pas ce composant. Les adaptations de FastDom et de Rough.js signalées dans la source map appartiennent à la distribution officielle de Mermaid.

Folio utilise le bundle local et une police système pour les diagrammes. Aucun CDN, module externe, fichier de police distant ou source map n’est nécessaire pendant le rendu. Les exports de documents contiennent les images SVG déjà générées et ne chargent pas le moteur Mermaid.

Pour reproduire le bundle après avoir téléchargé l’archive indiquée dans le manifeste :

```sh
python3 scripts/vendor_mermaid.py /chemin/mermaid-12.2.0.tgz
python3 scripts/vendor_mermaid.py /chemin/mermaid-12.2.0.tgz --check
```

Ce script vérifie les empreintes et la licence amont, puis assemble la distribution avec les notices déjà présentes dans le dépôt. Il ne télécharge rien. L’assemblage ordinaire de `Folio.html` utilise directement le bundle versionné.

## Adaptations et redistribution

Le code exécutable de Marked et de DOMPurify provient des distributions npm fixées aux versions indiquées. Les commentaires de référencement des source maps ont été retirés de `vendor/vendor.js` pour éviter des chargements annexes par les outils de développement ; le code exécutable de ces bibliothèques n’a pas été modifié. Leurs licences complètes et notices d’origine sont présentes dans le bundle.

Les styles KaTeX sont distribués avec les polices embarquées en URL `data:`. Folio assemble ces ressources directement dans le HTML ; il ne les récupère pas sur un CDN à l’exécution. Les exports de documents conservent les styles mathématiques et leurs notices, ainsi que les polices nécessaires aux formules déjà rendues.

Le JavaScript exécutable de Mermaid est conservé à l’identique. Un commentaire contenant sa licence complète et celles de ses dépendances est ajouté au début de `vendor/mermaid-vendor.js`, afin que les notices accompagnent aussi le fichier HTML autonome.

Conservez les notices de copyright et les textes de licence applicables lorsque vous redistribuez ces composants ou les fichiers qui les contiennent. Les textes du dossier `licenses/` sont les références complètes ; cette notice les accompagne sans les remplacer.

## Dépendances de développement

Les tests utilisent `jsdom` et `fake-indexeddb`, aux versions fixées dans `package.json` et `package-lock.json`, ainsi que leurs dépendances transitives. Ces paquets sont installés par `npm ci` pour les tests ; ils ne sont pas inclus dans `Folio.html`. Leurs notices et licences sont fournies dans leurs distributions npm respectives.
