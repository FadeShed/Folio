# Audit de Folio — 23 octobre 2026

## Objet et portée

Cet audit a été réalisé avant le premier envoi du code de Folio dans ce dépôt. Il porte sur l’application autonome, le code source qui la génère, les bibliothèques embarquées, les imports et exports, le stockage local, le suivi des fichiers et les tests. Les défauts reproduits ont été corrigés avant la livraison ; les scénarios de régression accompagnent les sources.

La revue couvre les fichiers propres à Folio dans `src/`, le script d’assemblage et le lanceur de tests. Pour Marked, DOMPurify et KaTeX, elle vérifie les versions, les avis de sécurité, les paramètres utilisés par Folio, la provenance et l’intégrité des distributions. Elle ne prétend pas constituer une revue ligne par ligne de tout le code interne de ces trois projets.

Les modifications d’interface demandées pendant l’audit suppriment le bandeau inférieur du lecteur, qui répétait le nom du fichier et la mention de lecture locale, et déplacent les métadonnées de lecture avec les commandes du document dans la colonne de droite, au-dessus du sommaire. La zone de lecture commence directement sous les onglets. Sur petit écran, un bouton compact dans la rangée des onglets donne accès aux outils. La marque reste dans la colonne de collection ; aucun bandeau supérieur redondant n’est réintroduit.

## Résultat de la validation

**72/72 scénarios réussis sur le HTML final.** La vérification `python3 scripts/build.py --check` confirme que le fichier distribué correspond exactement aux sources.

| Suite | Résultat |
| --- | ---: |
| Lecteur, sécurité et exports | 15/15 |
| Stockage local | 11/11 |
| Module de suivi | 10/10 |
| Interface du suivi | 7/7 |
| Régressions de rendu et sécurité | 15/15 |
| Régressions de stockage | 5/5 |
| Régressions fonctionnelles et accessibilité | 9/9 |

`Folio.html` : **903 846 octets**. Empreinte SHA-256 :

```text
bf2b5706026b947113dd56dd34198d9faa00268603a65143469e2e37ddafdaa4
```

Le [relevé de validation](docs/audit-results.json) conserve les noms et résultats des scénarios, l’empreinte du livrable et les contrôles d’intégrité des bibliothèques.

Les tests de référence passaient déjà avant cet audit : 43 scénarios. Ils ne couvraient pas les défauts supplémentaires décrits ci-dessous. Les nouvelles suites ciblent les reproductions de ces défauts, avec des fichiers synthétiques ; aucun document personnel n’est nécessaire pour les exécuter.

Les essais sont exécutés avec Node.js 24.19.0, jsdom 30.1.3 et fake-indexeddb 6.2.6. Une installation propre des 37 paquets de développement a été reproduite à partir de `package-lock.json`, sans script d’installation et à partir du cache npm. La construction du fichier autonome ne télécharge rien et utilise seulement Python 3.

## Défauts trouvés et corrections

Les priorités décrivent l’impact observé dans Folio : P1 pour une atteinte importante à une action de confidentialité, P2 pour une erreur fonctionnelle ou de robustesse, P3 pour une amélioration de compatibilité ou d’usage. Elles ne sont pas des scores CVSS.

| Référence | Priorité | Défaut reproduit | Correction |
| --- | --- | --- | --- |
| FOL-01 | P1 | Une désactivation de la mémorisation pouvait rester bloquée derrière un enregistrement puis un import. La case était décochée, mais la copie restait présente et l’état « Effacement… » ne se terminait pas. Le même problème existait pour une nouvelle tentative d’effacement pendant un import. | La fin d’un import relance toujours la file de persistance, indépendamment de l’activation des sauvegardes. Les tests retiennent puis libèrent les opérations pour exercer les deux ordres d’exécution. |
| FOL-02 | P2 | Une extension `constructor` accédait à une propriété héritée de la table des types d’images. Un fichier non pris en charge pouvait devenir une fausse image persistée, puis faire échouer la restauration de la collection. | La reconnaissance des images exige une propriété propre avec `Object.hasOwn`. Une régression vérifie l’import puis la réouverture. |
| FOL-03 | P2 | La version embarquée de DOMPurify était visée par trois avis récents. Les configurations décrites dans ces avis ne correspondent pas aux options activées par Folio. | Mise à jour de 3.4.16 vers 3.4.17, vérification des octets de la distribution officielle et nouvelle exécution des tests de nettoyage et d’export. Voir les références ci-dessous. |
| FOL-04 | P2 | Des délimiteurs mathématiques non fermés et certains passages répétés dans la recherche d’un prochain délimiteur provoquaient des rescans coûteux. Des ancres HTML identiques provoquaient aussi des recherches de suffixes quadratiques. | Mémorisation des recherches par flux de lexage, arrêt des recherches déjà infructueuses, compteurs d’identifiants, budgets de travail et régressions ciblées. |
| FOL-05 | P2 | De petites définitions de macros mathématiques imbriquées pouvaient produire beaucoup de travail dans KaTeX avant les vérifications du HTML final. | Les définitions de macros utilisateur et les commandes internes contenant `@` restent affichées littéralement avec un avertissement. Le plafond d’expansion KaTeX est réduit à 256. Les formules usuelles, matrices, intégrales et numérotations standard restent couvertes. |
| FOL-06 | P2 | Les limites de taille des fichiers ne bornaient pas suffisamment le volume de DOM ou l’export. Une image locale de 1 Mio référencée 16 fois produisait un HTML de 22 372 327 octets. | Budgets de lexage, de formules, de profondeur, de DOM et de HTML. Le volume d’export est estimé avant de cloner et de sérialiser les documents, en comptant chaque occurrence d’une image incorporée. Un dépassement produit un message lisible. |
| FOL-07 | P2 | La limite du parcours de dossiers était locale à chaque sous-arbre. Deux racines pouvaient dépasser ensemble la limite et de nombreuses entrées étaient lues avant le refus. | Budget global partagé entre les racines, contrôle avant descente, limite de profondeur, limites d’images et de chemins, interface occupée pendant l’énumération, récupération après erreur. |
| FOL-08 | P2 | Une enveloppe IndexedDB sans révision valide proposait un rechargement qui ne pouvait pas la réparer. Une enveloppe désactivée contenant encore un snapshot annonçait à tort qu’aucune copie n’était mémorisée. | Diagnostic distinct de corruption, sans fausse confirmation de suppression ni réinitialisation arbitraire de la révision. La marche à suivre pour effacer les données du site est affichée. Un snapshot invalide dont l’enveloppe possède une révision valide reste effaçable par l’interface. |
| FOL-09 | P2 | `note.md` et `note.markdown` produisaient tous deux `note.html`, avec des liens individuels ne pouvant pas désigner correctement les deux fichiers. | Attribution déterministe de chemins d’export uniques, communs à la génération des liens et au nom du téléchargement. Les exports individuels restent à ranger selon l’arborescence indiquée dans le README. |
| FOL-10 | P2 | Un libellé de langage de bloc de code artificiellement long était recopié intégralement dans la barre du bloc, sous-estimant la taille de l’export. | Affichage du libellé borné à 80 caractères, avec ellipse. Le contenu du bloc de code est conservé. |
| FOL-11 | P3 | Le focus pouvait rester dans un menu d’export ou une colonne mobile masqués, ou être perdu lors d’un lien entre documents. Le bouton de téléchargement perdait aussi son nom accessible quand son texte était masqué sur petit écran. | Retours explicites du focus vers le bouton, l’onglet, le titre cible ou l’article selon l’action ; nom accessible permanent du téléchargement. Les mises à jour automatiques ne prennent pas ce focus de navigation. |
| FOL-12 | P3 | Les petits textes secondaires du thème clair avaient un contraste de 3,60:1 à 4,12:1 sur les surfaces courantes. L’opacité des extensions de fichiers le diminuait encore. | Couleur secondaire remplacée par `#606f63` ; opacité du libellé d’extension supprimée. Le minimum calculé sur les surfaces vérifiées est désormais 4,609:1 en clair et 4,628:1 en sombre. Cela ne constitue pas une certification WCAG globale. |
| FOL-13 | P3 | Un nom de fichier contenant un accent décomposé ne répondait pas à un lien utilisant la forme Unicode composée équivalente. | Repli sur la normalisation NFC uniquement si la correspondance est unique, après les chemins exacts. Deux fichiers réellement distincts ne sont pas fusionnés. |
| FOL-14 | P3 | Une formule pouvait être interprétée dans un élément HTML `<code>` au lieu de rester du code littéral. | Les contenus de code sont exclus du traitement des formules, avec vérification des blocs Markdown, des fragments de code et du HTML de code. |

Les contrôles de limites sont effectués avant de remplacer une version valide importée ou suivie. Une erreur de lecture, d’encodage ou de rendu ne doit pas écraser silencieusement le document déjà affiché.

## Sécurité et confidentialité vérifiées

### Conversion et exports

Le HTML fourni dans un Markdown est d’abord construit dans un gabarit inerte. Les attributs actifs et les ressources sont retirés, puis DOMPurify applique une liste d’éléments et d’attributs autorisés. Les identifiants sont reconstruits avec des préfixes propres au lecteur afin de ne pas masquer les contrôles de l’application. Les URL de scripts, les SVG importés, les formulaires, les cadres, les objets et les styles provenant des documents ne sont pas autorisés.

Les images distantes restent des emplacements descriptifs. Les images incorporées proviennent des fichiers locaux importés ou d’URL `data:` limitées aux types raster pris en charge. Le code applicatif ne contient pas de chemin de téléversement, de service de conversion, d’analyse d’audience ou de chargement de bibliothèque distante. Les styles KaTeX ne comportent ni URL de police distante ni `@import`.

Seul le HTML produit par KaTeX passe après le nettoyage, avec `trust:false`, des bornes de taille et d’expansion et les garde-fous supplémentaires décrits plus haut. Les tests comprennent des charges HTML/URL/mathématiques malveillantes et une nouvelle analyse des exports sérialisés. Ils n’ont observé ni exécution de la charge injectée ni requête réseau applicative dans l’environnement simulé. L’inspection des sources et des attributs actifs complète ce résultat ; jsdom ne reproduit pas tous les chargements natifs d’un navigateur.

L’application et les exports contiennent une politique CSP restrictive. Les exports individuels interdisent les scripts ; une collection exportée contient uniquement le script de navigation entre ses onglets. Les exports ne conservent ni stockage applicatif, ni surveillance, ni référence autorisée à un original.

### Conservation et suivi

La mémorisation exige l’option correspondante. L’indication de réussite attend la fin de la transaction IndexedDB, pas seulement le succès de la requête `put`. Les tests couvrent refus, quota, transaction annulée, suppression, restauration, clone de référence non pris en charge et conflits entre pages. Les révisions et les marqueurs de suppression empêchent une page obsolète de rétablir une copie retirée par une autre page.

Le suivi utilise un accès en lecture et n’écrit pas dans les originaux. Les demandes d’autorisation supplémentaires restent liées à une action de l’utilisateur. Les opérations devenues obsolètes après retrait, désactivation ou réimport sont invalidées. Les scénarios couvrent aussi les changements d’un document inactif, la conservation du mode Source, la reprise après changement de visibilité et une disparition temporaire du fichier.

Folio ne chiffre pas les copies locales. Le navigateur isole les données par origine, pas par simple chemin de page : la clé de chemin utilisée par Folio organise les collections, mais n’est pas une frontière de sécurité entre scripts du même site. La confiance dans l’origine d’hébergement et dans le HTML réellement servi reste nécessaire. Ces limites sont expliquées dans l’aide et le README ; elles ne sont pas présentées comme une garantie cryptographique.

## Dépendances et intégrité

| Composant | Version livrée | Vérifications |
| --- | --- | --- |
| Marked | 18.1.1 | Archive npm et intégrité SHA-512 ; code du bundle identique après retrait du commentaire de source map ; licence conservée. |
| DOMPurify | 3.4.17 | Mise à jour des trois avis ; mêmes vérifications d’archive, de code et de licence. |
| KaTeX | 0.19.0 | Archive npm, SHA-512, code identique ; 20 polices WOFF2 identiques ; CSS identique après incorporation des polices et retrait des formats de repli externes. |

Les URL d’archives et empreintes SHA-256/SHA-512 sont dans [vendor/manifest.json](vendor/manifest.json). Les textes de licence correspondent aux distributions officielles. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) décrit leur intégration.

À la date de l’audit, l’API d’avis npm ne signale aucune vulnérabilité pour ces trois versions après mise à jour. `npm audit` ne signale aucune vulnérabilité dans les 37 paquets de développement. Ces deux contrôles sont distincts : les bibliothèques embarquées ne figurent pas dans les dépendances de test et ne seraient pas couvertes par le seul `npm audit` du dépôt. Ces constats sont datés et devront être revérifiés lors des mises à jour.

Références consultées :

- [DOMPurify 3.4.17](https://github.com/cure53/DOMPurify/releases/tag/3.4.17).
- [Avis DOMPurify : mode XHTML et SMIL](https://github.com/cure53/DOMPurify/security/advisories/GHSA-c6gr-qvv4-5v3f), [suppression par hooks en mode IN_PLACE](https://github.com/cure53/DOMPurify/security/advisories/GHSA-mrv2-3pqr-j5jr), [SAFE_FOR_TEMPLATES et shadow roots](https://github.com/cure53/DOMPurify/security/advisories/GHSA-cg2g-xh64-v4q7). Folio n’active pas ces configurations.
- [Avis Marked sur la récursion, corrigé en 18.0.2](https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7).
- [Avis KaTeX sur la pollution préexistante de prototypes, corrigé en 0.18.2](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7).
- [W3C : contraste minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- [MDN : politique de même origine](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).
- [Chrome : accès autorisé au système de fichiers](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

## Reproduire la validation

```sh
python3 scripts/build.py --check
npm ci --ignore-scripts
npm test
npm audit
```

Les tests lisent le `Folio.html` distribué et les modules concernés. Les chemins sont relatifs au dépôt. Le lanceur efface chaque ancien rapport avant de lancer sa suite et échoue si le rapport est absent, si une suite échoue ou si un scénario n’a pas réussi. Les rapports détaillés sont générés dans `tests/output/`, qui ne fait pas partie des fichiers suivis par Git.

L’assemblage est déterministe et vérifie qu’il ne reste pas de marqueur de gabarit. Les dépendances nécessaires à l’utilisation sont toutes locales ; npm est réservé au développement et aux tests.

## Limites et essais natifs restant à effectuer

**Aucun navigateur réel n’a été utilisé pour certifier cette version.** La revue des sources et les tests automatisés sont effectués ; une validation native complémentaire reste nécessaire. L’infrastructure de prévisualisation disponible pour cette session ne permettait pas de réaliser ces essais.

| Essai natif | Ce que les tests actuels vérifient | Ce qui reste à vérifier |
| --- | --- | --- |
| Affichage sur ordinateur et mobile | Structure DOM, état des panneaux, styles et calculs de contraste | Géométrie, zoom, débordements, tailles tactiles, rendu des polices et impression. |
| Accessibilité | Noms et états des contrôles, déplacements explicites du focus, navigation par touches | Parcours avec lecteur d’écran et ordre de lecture natif. |
| IndexedDB | Transactions et erreurs simulées, restauration, purge, conflits | Quotas réels, navigation privée, éviction, comportement d’une URL locale. |
| Suivi d’originaux | Références simulées, permissions injectées, interruptions et mises à jour concurrentes | Sélecteur natif, persistance d’un véritable FileSystemFileHandle, permissions entre sessions et sauvegarde par remplacement dans un éditeur réel. |
| Confidentialité et CSP | Code, configuration CSP, attributs actifs, interception des requêtes simulées | Application native de la CSP et contrôle du réseau dans les outils du navigateur. |
| Images locales | Types autorisés, chemins, taille des fichiers et incorporation aux exports | Décodage des formats par le navigateur et mémoire des images de très grandes dimensions ; la limite de 15 Mio porte sur le fichier compressé. |
| Export et presse-papiers | Contenu du Blob, noms, liens et boutons | Téléchargement réel, emplacement choisi, permissions de copie et ouverture du fichier exporté. |

Les plafonds de complexité limitent les cas d’amplification reproduits ; ils ne garantissent pas un temps de réponse identique sur tous les appareils. La conversion reste synchrone sur le fil de l’interface, et un document proche des limites peut ralentir une machine peu puissante. L’estimation d’export est volontairement conservatrice et peut refuser une collection avant que sa taille exacte atteigne 80 Mio.

Un enregistrement corrompu n’est pas supprimé automatiquement : l’utilisateur doit pouvoir décider de l’effacement. Les copies de navigateur restent soumises à ses politiques et ne remplacent pas les originaux.

L’audit est une revue de code et une validation reproductible, pas une garantie d’absence de toute vulnérabilité ni une certification d’accessibilité ou de compatibilité universelle.
