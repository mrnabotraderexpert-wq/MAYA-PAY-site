# MAYA-PAY

**MAYA-PAY n'est pas un agrégateur de paiement.** C'est un simple raccourci de lien qui facilite les paiements mobiles (Orange Money, Moov Money). MAYA-PAY ne détient ni ne stocke aucun argent et ne garantit pas les produits ou services du vendeur. **Faites toujours un premier test avec un petit montant.**

Application web (PWA) **réservée au téléphone**. Le vendeur crée un lien et l'envoie à son client par WhatsApp ou SMS. Le client paie de compte à compte.

## Parcours

- **Vendeur** : nom commercial, numéro Orange Money et/ou Moov Money (au moins un), montant, description, durée de validité. Il obtient un lien (copie, WhatsApp, SMS, partage) et un bouton **Suivre le paiement**. Les liens récents restent sur son téléphone.
- **Client** : un bouton **Payer avec …** par opérateur,  parmi les opérateurs pour lesquels le vendeur a saisi un numéro (**Orange Money** et/ou **Moov Money**), puis le composeur du téléphone s'ouvre avec le code prêt. L'opérateur demande ensuite le code PIN.
- **Session de 2 minutes** : un compte à rebours s'affiche. À zéro, le code est effacé et la session se ferme (la page tente de se fermer ; sinon elle affiche « Session fermée »). Si l'opération n'est pas terminée, le client la rouvre.
- **Confirmation** : le client colle le SMS de confirmation Orange/Moov. Le serveur le lit, vérifie le montant et le bénéficiaire, répond au client (Confirmé, Transmis au vendeur, Non confirmé) et le message apparaît dans le **suivi du vendeur** (rafraîchi toutes les 10 secondes).
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

## Confirmation par SMS : ce que ça prouve

- `Confirmé` : le message annonce un transfert, le montant demandé et le numéro du vendeur y figurent, et ce même message n'a jamais servi pour un autre paiement.
- `À vérifier` : le montant est bon mais le bénéficiaire n'est pas lisible (numéro masqué). Le vendeur vérifie lui-même.
- `Non confirmé` : échec, message de réception d'argent, mauvais montant, message déjà utilisé, texte sans rapport.
- **Un client peut inventer un faux SMS.** Le vendeur doit toujours contrôler le SMS et le solde de son propre compte avant de livrer. Le lecteur de SMS se règle dans la fonction `mayapay_confirm` (mots-clés, formats) ; il est écrit pour des textes courants et doit être ajusté sur de vrais SMS Orange et Moov.

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
sw.js, manifest.webmanifest, icon*   PWA (icônes tirées du logo)
```

## Licence

MIT.
