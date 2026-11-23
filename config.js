// Configuration unique d'OM Direct. Modifiez ce fichier, pas le reste du code.
export const CONFIG = {
  appName: 'OM Direct',
  currency: 'FCFA',

  // Indicatif pays retiré automatiquement si l'utilisateur le saisit (223 = Mali).
  countryCode: '223',
  // Nombre de chiffres du numéro national, indicatif exclu.
  numberDigits: { min: 8, max: 10 },
  amount: { min: 1, max: 5000000 },
  limits: { name: 40, description: 120 },

  // Durées de validité proposées au vendeur à la création du lien (en heures, 720 maximum).
  validity: {
    default: 168,
    options: [
      { hours: 1, label: '1 heure' },
      { hours: 24, label: '24 heures' },
      { hours: 168, label: '7 jours' },
      { hours: 720, label: '30 jours' },
    ],
  },

  // Mode serveur : le numéro du vendeur reste dans Supabase et n'est jamais dans le lien.
  // La clé « publishable » est faite pour être publique ; la table est fermée par RLS
  // et seules trois fonctions RPC sont accessibles. Laissez url vide pour revenir au mode
  // sans serveur (numéro encodé dans le lien).
  supabase: {
    url: 'https://zxmgwyrnfshrspplfxpf.supabase.co',
    key: 'sb_publishable_5I-c13DK_gRqIep_YwEBtg_g76CXbXG',
  },

  ussd: {
    // IMPORTANT : ces codes viennent du cahier des charges et n'ont PAS pu être testés
    // sur un vrai compte Orange Money. Passez `verified` à true uniquement après un test
    // réel (petit montant), ce qui masque l'avertissement affiché côté vendeur.
    verified: false,

    // Code pour obtenir le CAUU (code d'accès à usage unique).
    cauuRequest: '#144#77#',

    // Gabarit du transfert. Variables : {NUMERO} {MONTANT} {CAUU}.
    // Si {CAUU} est absent du gabarit, le champ CAUU n'est pas demandé au client.
    transferTemplate: '#144#11*{NUMERO}*{MONTANT}*1*{CAUU}*{NUMERO}#',

    // Format accepté pour le CAUU saisi par le client (à ajuster après vérification).
    cauuPattern: /^\d{4,10}$/,

    // Durée de vie du CAUU et du code préparé en mémoire, en millisecondes.
    cauuTtlMs: 120000,
  },
};
