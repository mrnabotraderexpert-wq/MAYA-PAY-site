// Configuration unique de MAYA-PAY. Modifiez ce fichier, pas le reste du code.
export const CONFIG = {
  appName: 'MAYA-PAY',
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

  // Serveur (Supabase) : le numéro du vendeur et les formules USSD n'existent QUE dans la base
  // (voir maya-pay.sql). Ce site ne les contient jamais. La clé « publishable » est faite pour
  // être publique ; les tables sont fermées par RLS et seules des fonctions RPC sont accessibles.
  supabase: {
    url: 'https://zxmgwyrnfshrspplfxpf.supabase.co',
    key: 'sb_publishable_5I-c13DK_gRqIep_YwEBtg_g76CXbXG',
  },

  // Opérateurs proposés au client (les formules sont dans la base, table mayapay.operators).
  operators: [
    { id: 'orange', label: 'Orange Money' },
    { id: 'moov', label: 'Moov Money' },
  ],

  // Rafraîchissement automatique de la page de suivi du vendeur (secondes).
  trackRefreshSeconds: 10,
};
