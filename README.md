# OM Direct

Liens de paiement Orange Money directs. Le vendeur génère un lien et l'envoie à son client par WhatsApp ou SMS. Le client paie depuis son compte Orange Money vers celui du vendeur. **OM Direct ne reçoit jamais l'argent.**

Application statique en HTML, CSS et JavaScript natif, sans dépendance à installer, ni compte, ni portefeuille. Seul le numéro du vendeur est conservé côté Supabase (voir plus bas). PWA installable sur Android.

## Lancer en local

```bash
python3 -m http.server 8080      # ou : npm start
# ouvrir http://localhost:8080
npm test                          # tests (Node 20 ou plus récent)
```

Le service worker et l'installation PWA exigent HTTPS ou `localhost`.

## Déployer sur GitHub Pages

1. Créez un dépôt GitHub et envoyez-y tout le contenu de ce dossier (branche `main`).
2. Dans **Settings > Pages**, choisissez **Source : GitHub Actions**.
3. Le workflow `.github/workflows/pages.yml` lance les tests puis publie le site. L'adresse est de la forme `https://<utilisateur>.github.io/<depot>/`.

Aucun autre réglage n'est nécessaire : tous les chemins sont relatifs, donc le site fonctionne dans un sous-dossier.

## Fonctionnement

- **Vendeur** : nom commercial, numéro Orange Money, montant, description. L'application produit un lien (copie, WhatsApp, SMS, partage natif) et permet d'enchaîner un nouveau lien en changeant seulement le montant. Le nom et le numéro sont mémorisés dans le navigateur de l'appareil (bouton pour les effacer).
- **Client** : page avec le nom du vendeur, le montant et la description, puis un parcours en trois temps : avertissement et case de vérification, saisie du CAUU, ouverture du composeur avec le code préparé. Si le composeur ne s'ouvre pas (ordinateur, navigateur limité), un écran de secours affiche le code à copier.

## Limites à connaître

### Où se trouve le numéro du vendeur
Par défaut (`supabase.url` renseigné dans `js/config.js`), le numéro est stocké dans Supabase et **n'est pas dans le lien**, qui ne contient qu'un identifiant aléatoire de 12 caractères (`#/pay?i=...`). Le numéro n'est renvoyé au navigateur du client qu'au clic sur « Confirmer et continuer », car le code USSD en a besoin : le client peut donc toujours le voir en copiant le code, ce qu'aucune solution ne peut empêcher. La page client et l'écran de secours l'affichent masqué.

Mise en place (déjà appliquée au projet Supabase BOUTIKI) :

- schéma privé `omdirect`, table `links` fermée par RLS, sans aucun accès direct pour `anon` ou `authenticated` ;
- trois fonctions RPC dans `public` : `omdirect_create_link` (retourne l'identifiant), `omdirect_get_link` (nom, montant, description, jamais le numéro) et `omdirect_get_number` ;
- le vendeur choisit la durée de validité à la création (1 heure, 24 heures, 7 jours ou 30 jours, réglable dans `js/config.js`, 720 heures maximum côté base) ; un lien expiré affiche « Lien de paiement invalide » ;
- la clé publishable de `js/config.js` est faite pour être publique.

Limites : n'importe qui peut créer des liens (pas de compte vendeur, par choix du projet), il n'y a pas de limitation de débit, et un identifiant ne se devine pas mais se partage. Pour supprimer les liens expirés : `delete from omdirect.links where expires_at < now();`.

Mode sans serveur : videz `supabase.url`. L'expiration est alors inscrite dans le lien et vérifiée par le navigateur du client (elle ne peut donc pas être imposée). Le numéro est alors encodé en base64url dans le lien (fragment `#/pay?d=...`, jamais envoyé à un serveur) ; **toute personne qui a le lien peut le décoder**.

### Le montant et le bénéficiaire peuvent être modifiés dans le lien
N'importe qui peut fabriquer un lien. C'est pourquoi la page client demande au client de vérifier le montant et le nom du bénéficiaire affiché par Orange Money avant de valider.

### Les codes USSD ne sont pas vérifiés
Les codes suivants viennent du cahier des charges et **n'ont pas pu être testés sur un compte Orange Money réel** :

- obtention du CAUU : `#144#77#`
- transfert : `#144#11*NUMERO*MONTANT*1*CAUU*NUMERO#`

Rien n'est affirmé comme fonctionnel. Avant toute mise en service : vérifiez les codes auprès d'Orange Money, testez avec un petit montant sur de vrais comptes, puis modifiez `js/config.js` (`cauuRequest`, `transferTemplate`, `cauuPattern`) si nécessaire et passez `ussd.verified` à `true`. Tant que ce champ vaut `false`, un avertissement s'affiche côté vendeur.

L'ouverture automatique repose sur un lien `tel:` avec `#` encodé en `%23`. Son comportement dépend du téléphone et du navigateur, d'où l'écran de secours.

## Sécurité

- Le **code PIN n'est jamais demandé**, ni stocké, ni transmis.
- Le **CAUU** est saisi dans un champ masqué, gardé en mémoire uniquement (jamais dans l'URL, `localStorage` ou un cookie), effacé après usage, au retour en arrière, au changement de page et après 2 minutes (`cauuTtlMs`). L'écran de secours affiche le code avec le numéro du vendeur et le CAUU masqués ; la copie du code complet place le numéro et le CAUU dans le presse-papiers de l'appareil jusqu'à son remplacement.
- Toutes les données lues dans un lien sont revalidées (longueur, format, numéro, montant) puis affichées avec `textContent` : une description du type `<script>` s'affiche comme du texte. Un lien altéré affiche « Lien de paiement invalide ».
- Chaque valeur injectée dans le code USSD est strictement numérique ; le code final n'accepte que `0-9`, `*` et `#`.

## Structure

```
index.html              page unique (vues vendeur, client, erreur)
manifest.webmanifest    configuration PWA
sw.js                   service worker (fonctionne hors ligne)
css/style.css           design
js/config.js            configuration : devise, limites, codes USSD
js/link.js              validation, encodage et décodage des liens
js/ussd.js              préparation du code USSD
js/api.js               appels Supabase (RPC)
js/app.js               interface et parcours
icons/                  icônes PWA (SVG, PNG 192 et 512, maskable)
tests/                  tests Node
.github/workflows/      déploiement GitHub Pages
```

## Personnalisation

Tout se règle dans `js/config.js` : indicatif pays (`223` par défaut), longueur des numéros, montant maximal, longueurs de texte, codes USSD. Pour changer la couleur, modifiez les variables en haut de `css/style.css`.

## Licence

MIT.
