# MAYA-PAY

**MAYA-PAY n'est pas un agrégateur de paiement.** C'est un simple raccourci de lien qui facilite les paiements mobiles (Orange Money, Moov Money). MAYA-PAY ne détient ni ne stocke aucun argent et ne garantit pas les produits ou services du vendeur. **Faites toujours un premier test avec un petit montant.**

Application web (PWA) **réservée au téléphone**. Le vendeur crée un lien et l'envoie à son client par WhatsApp ou SMS. Le client paie de compte à compte.

## Parcours

- **Vendeur** : nom commercial, numéro Orange Money et/ou Moov Money (au moins un), montant, description, durée de validité. Il obtient un lien (copie, WhatsApp, SMS, partage) et un bouton **Suivre le paiement**. Les liens récents restent sur son téléphone.
- **Client** : un bouton **Payer avec …** par opérateur,  parmi les opérateurs pour lesquels le vendeur a saisi un numéro (**Orange Money** et/ou **Moov Money**), puis le composeur du téléphone s'ouvre avec le code prêt. L'opérateur demande ensuite le code PIN.
- **Session de 2 minutes** : un compte à rebours s'affiche. À zéro, le code est effacé et la session se ferme (la page tente de se fermer ; sinon elle affiche « Session fermée »). Si l'opération n'est pas terminée, le client l'ouvre.
- **Confirmation 100 % automatique** : le client choisit son opérateur, saisit le numéro avec lequel il envoie l'argent, paie ; l'application Android lit le SMS de l'opérateur et le serveur décide. Il n'y a plus de saisie de SMS ni de capture d'écran.
- **Android hors application** : le client voit « Télécharger l’application » (et « ouvrir ce paiement » s’il l’a déjà) au lieu des boutons Payer. Déposez l’APK à la racine du dépôt sous le nom `MAYA-PAY.apk` (ou changez `app.apkUrl` dans `config.js`).
- **Ordinateur** : un écran demande d'ouvrir MAYA-PAY sur un téléphone.

## Masquage du numéro et des formules

Le site (GitHub Pages) ne contient **ni numéro de vendeur, ni formule USSD**. Tout vit dans Supabase (schéma privé `mayapay`, fermé par RLS) :

- le lien ne contient qu'un identifiant aléatoire de 12 caractères ;
- le numéro n'est jamais renvoyé au navigateur, **sauf à l'ouverture d'une session** : le serveur remet alors le code complet, valable 2 minutes, limité à 20 ouvertures par heure et par lien ;
- les formules sont dans la table `mayapay.operators` (modifiables dans Supabase sans toucher au site) ;
- le code n'est jamais écrit dans la page, l'URL, le stockage ni le presse-papiers : il est passé au composeur puis effacé.

**Limite à connaître** : le composeur du téléphone affiche le code composé, donc le numéro. Aucun système USSD ne peut l'éviter. Un site web ne peut pas non plus lancer l'appel lui-même ni choisir la SIM : le client appuie sur appeler, et un téléphone à deux SIM demande laquelle utiliser.

## Mise en place

1. **Base** : le serveur (schéma `mayapay`) est déjà installé dans Supabase. Le fichier SQL contient les formules : **ne le mettez jamais sur GitHub**.
2. **Site** : envoyez tous les fichiers (aucun sous-dossier) à la racine du dépôt GitHub, branche `main`. Dans Settings > Pages : Deploy from a branch, `main`, `/ (root)`.
3. Dans `config.js`, `supabase.url` et `supabase.key` (clé publishable) doivent être ceux du projet où vous avez exécuté le SQL.
4. Testez avec un petit montant sur de vrais comptes Orange Money et Moov Money.

## Confirmation automatique par SMS

Flux : l'application (récepteur natif `SmsReceiver`) détecte le SMS Orange Money / Moov Money pendant les 10 minutes qui suivent le paiement, l'envoie au serveur (`mayapay_sms_v2`) avec sa date de réception et le numéro de la SIM, puis la page affiche le résultat (`mayapay_sms_result`).

Le serveur (`mayapay.parse_sms`) reconnaît : Orange « Votre transfert de X FCFA vers le N a reussi … ID:… », Moov « Transfert d'argent réussi vers N … ID: … », et des formulations génériques (« vous avez transféré / envoyé / payé … »), ces dernières jamais confirmées seules. Il extrait montant, frais, expéditeur, destinataire, ID et date.

Statuts :
- `Confirmé` : format reconnu, bon opérateur, bon montant, bon destinataire, SMS reçu après le début du paiement, transaction jamais utilisée, **numéro expéditeur = numéro déclaré par le client**.
- `À vérifier` : tout est correct mais l'expéditeur n'a pu être établi (le SMS Orange ne le cite pas ; la SIM ne communique pas toujours son numéro) ou le format n'est pas validé. Jamais confirmé automatiquement.
- Rejeté (non affiché au vendeur) : échec, mauvais montant ou destinataire, autre opérateur, SMS ancien, transaction déjà utilisée, **numéro expéditeur différent**.
- Journal : chaque tentative est écrite dans `mayapay.sms_log` (statut, motif, champs extraits, sans le texte du SMS). Le solde du client est masqué dans les SMS conservés.
- **Limite** : le SMS est relayé par le téléphone du client ; un téléphone modifié pourrait en fabriquer un. Pour un montant important, contrôlez aussi votre solde.

## Autres limites

- N'importe qui peut créer des liens (pas de compte vendeur) ; il n'y a pas de limitation de débit à la création.
- La clé de suivi du vendeur est dans son lien de suivi et dans son navigateur : qui l'a peut voir les messages reçus.
- Pour supprimer les anciens liens : `delete from mayapay.links where expires_at < now() - interval '30 days';`
- Pour changer une formule : `update mayapay.operators set template = '...' where id = 'orange';`.
- Les liens se créent avec `mayapay_create_v2` (un numéro par opérateur) ; l'ancienne `mayapay_create` (numéro unique) reste active pour les anciens liens. Les anciennes fonctions `omdirect_*` (version précédente) restent dans la base ; vous pouvez les supprimer si vous n'avez plus d'anciens liens.

## Fichiers

```
index.html              page unique (vendeur, suivi, client, erreur)
style.css               design
banner.jpg              bannière de la page d'accueil
config.js               nom, devise, limites, opérateurs affichés, Supabase
app.js                  parcours
api.js                  appels Supabase (RPC)
link.js                 validation des saisies
ussd.js                 ouverture du composeur (tel:)
admin.html, admin.js, admin.css   page d'administration des abonnements (/admin.html)
sw.js, manifest.webmanifest, icon*   PWA (icônes tirées du logo)
```

## Licence

MIT.

## v1.10
- **Orange Money automatique** : même lecture de SMS que Moov dans l'application ; filtre et règles dans Supabase (`operators.sms_filter`, `mayapay_confirm`). Modèle exact du SMS Orange à fournir pour affiner.
- **Numéro du client** obligatoire avant « Payer » (`mayapay_start_v2`) ; rapproché du SMS et visible dans le suivi vendeur.
- **Lien personnalisé** : photo/logo (optionnelle) + nom du vendeur affichés sur la page de paiement (`mayapay_create_v3`, colonne `links.photo`).

## v1.11 – Abonnements vendeurs

**Administration** : ouvrez `https://votre-site/admin.html` (ordinateur ou téléphone, protégée par mot de passe, non référencée). Vous y réglez :
- l'**accès gratuit** (interrupteur global, appliqué immédiatement à tous les vendeurs) ;
- le **prix** et la **durée** de la licence (30 jours, 3 mois, 6 mois, 1 an ou durée libre) ;
- les **numéros marchands** Orange Money / Moov Money qui reçoivent les abonnements (le lien de paiement est créé automatiquement pour chaque vendeur) ;
- les **licences** : recherche par numéro, prolonger, suspendre, réactiver, ajouter un numéro à la main ;
- les **paiements à valider** et l'historique des paiements d'abonnement ; le **mot de passe** administrateur.

**Espace vendeur** : une carte « Mon abonnement » affiche le prix, la durée, l'état et la date d'expiration (d'après le numéro Orange/Moov saisi), avec le bouton « S'abonner » ou « Renouveler mon abonnement ». Le paiement suit le parcours habituel (lien, SMS lu par l'application, vérification par le serveur).

**Activation automatique** : quand le SMS est confirmé par le serveur (bon montant, bon bénéficiaire, numéro expéditeur identique, transaction jamais utilisée), la licence du vendeur est créée ou prolongée et la date d'expiration est enregistrée. Une même transaction ne peut activer qu'une seule licence (`mayapay.sub_payments.tx_hash` unique). Si le SMS ne permet pas d'établir l'expéditeur (« à vérifier »), le paiement attend votre validation dans l'administration : il n'est jamais confirmé automatiquement.

**Protection** : quand l'accès gratuit est désactivé et que la licence est absente, expirée ou suspendue, seule la **création de nouveaux liens** est refusée (`license_required`). Les liens existants, les paiements déjà lancés, les transactions et les historiques ne sont jamais touchés. Toutes les opérations d'administration passent par des fonctions serveur qui revérifient le mot de passe à chaque appel (blocage 15 minutes après 8 échecs) ; les tables restent fermées par RLS.

Tables : `mayapay.settings`, `licenses`, `sub_payments`, `license_log` (journal des activations et actions admin), `admin_secret`. Pour consulter le journal : `select * from mayapay.license_log order by at desc;`.

Fichiers à envoyer sur GitHub : tous ceux du zip (nouveaux : `admin.html`, `admin.js`, `admin.css` ; modifiés : `app.js`, `api.js`, `index.html`, `style.css`, `sw.js`, `README.md`).

## v1.14 – Politique de confidentialité
- Nouvelle page `privacy.html` (politique de confidentialité + conditions d'utilisation), liée depuis le pied de page. URL à fournir au Play Store : `https://votre-site/privacy.html`.
- À personnaliser avant publication : l'adresse e-mail de contact (section 13). Vérifiez aussi que la durée de conservation annoncée (liens supprimés 30 jours après expiration) correspond à votre pratique.
- Fichier à envoyer sur GitHub : `privacy.html` (nouveau) ; modifiés : `index.html`, `sw.js`, `README.md`.

## v1.15 – Case de consentement avant « Payer »
- Le client doit cocher une case (« Je lance moi-même ce paiement… », lien vers `privacy.html`) avant que « Payer » n'ouvre la session. Case décochée à chaque nouveau paiement ; sans elle, un message d'erreur s'affiche et rien n'est envoyé au serveur.
- Fichiers modifiés : `index.html`, `app.js`, `style.css`, `sw.js`, `README.md`.
- **Preuve côté serveur** : `mayapay_start_v3` refuse la session sans consentement (`consent_required`) et enregistre `starts.consent_at` + `starts.consent_version` (migration `mayapay_consent_start_v3`). `mayapay_start_v2` reste en place pour les anciens clients ; vous pouvez la retirer quand tout le monde a la v1.15+ : `revoke execute on function public.mayapay_start_v2(text,text,text) from anon, authenticated, public;`
- **Message « le client initie »** ajouté : écran vendeur (sous l'intro), page de paiement du client, pied de page, `privacy.html`. Fichiers : `index.html`, `privacy.html`, `style.css`, `sw.js`.
- **Consentement mémorisé** : après un premier paiement, la case reste cochée sur ce téléphone (version + date dans `mayapay.vendor`), avec la mention « Déjà accepté le … ». Décocher retire l'accord ; une nouvelle `CONSENT_VERSION` (api.js) le redemande. Le serveur enregistre quand même le consentement à chaque session (`starts.consent_at`).

## v1.16 – Assistant intelligent local
- La bulle « Assistance » a maintenant deux onglets : **Assistant** (réponses immédiates) et **Équipe** (messagerie existante).
- L'assistant (`assistant.js`) tourne **entièrement dans le téléphone, sans API externe** : normalisation du français (accents, pluriels, fautes), synonymes, score par thème, suggestions cliquables, puis passage à l'équipe (la question est pré-remplie) quand il ne sait pas. Rien n'est envoyé ni enregistré.
- Pour l'enrichir : ajoutez un thème dans le tableau `KB` d'`assistant.js` (`id`, `title`, `kw`, `a`, `next`). Testez avec `node` : `import { answer } from './assistant.js'`.
- La bulle devient ronde (icône seule) sur la page de paiement pour ne plus recouvrir « Payer ».
- Fichiers : `assistant.js` (nouveau) ; modifiés : `support.js`, `sw.js`, `privacy.html`, `README.md`.
