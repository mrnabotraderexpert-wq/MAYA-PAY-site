// Assistant MAYA-PAY : moteur de réponses 100 % local (aucune API externe, aucune donnée envoyée).
// Il normalise la question (accents, ponctuation, fautes de frappe, pluriels, synonymes), la compare à une
// base de thèmes pondérés et répond avec le texte correspondant. Hors de sa base, il passe la main à l'équipe.

const STOP = new Set(('le la les un une des du de d l je j tu il elle on nous vous ils elles me m te t se s ce c cet cette ces ' +
  'mon ma mes ton ta tes son sa ses notre votre vos leur leurs et ou mais donc or ni car que qu qui quoi dont a au aux en dans par ' +
  'pour sur sous avec sans est es suis sont ai as avons avez ont etre avoir fait faire peut peux puis pas ne n plus tres si y ca ' +
  'cela ceci comment pourquoi quand quel quelle quels quelles veux veut voudrais aimerais svp stp please').split(' '));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`]/g, ' ').replace(/[^a-z0-9# ]/g, ' ').replace(/\s+/g, ' ').trim();

function canon(w) {
  if (/^(pay|pai)/.test(w) && w.length >= 4) return 'paie'; // payer, payé, paiement, paie…
  if (/^(regl)/.test(w)) return 'paie';
  if (w === 'telephone' || w === 'tel' || w === 'portable' || w === 'mobile') return 'telephone';
  if (w === 'appli' || w === 'app' || w === 'application') return 'application';
  if (w === 'arnaque' || w === 'arnaquer' || w === 'escroc' || w === 'escroquerie') return 'arnaque';
  return w;
}
function stem(w) {
  if (w.length <= 3) return w;
  for (const suf of ['ements', 'ement', 'ations', 'ation', 'ment', 'ions', 'ion', 'ees', 'ee', 'es', 'er', 'ez', 'e', 's', 'x', 't']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) return w.slice(0, -suf.length);
  }
  return w;
}
const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w)).map(canon).map(stem);

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function same(q, k) {
  if (q === k) return true;
  const L = Math.min(q.length, k.length);
  if (L < 5) return false;
  if (L >= 6 && q.slice(0, 6) === k.slice(0, 6)) return true; // même début : faute de fin de mot
  return lev(q, k) <= (L >= 8 ? 2 : 1);
}

// ——— Base de connaissances ———
// kw : expressions qui déclenchent le thème (toutes leurs mots doivent apparaître, fautes tolérées).
// a : réponse. next : suggestions de suite. links : liens utiles. human : propose l'équipe.
export const KB = [
  { id: 'quoi', title: 'C’est quoi MAYA-PAY ?',
    kw: ['maya pay', 'c est quoi', 'presentation', 'principe', 'service', 'a quoi sert', 'agregateur', 'fonctionne', 'argent passe', 'detient', 'stocke'],
    a: 'MAYA-PAY est un simple raccourci de lien pour les paiements Orange Money et Moov Money.\n\nLe vendeur crée un lien et l’envoie à son client. Le client paie de son compte vers celui du vendeur : MAYA-PAY prépare seulement le code, et c’est le client qui le valide avec son code PIN.\n\nMAYA-PAY n’est pas un agrégateur de paiement : l’argent ne passe jamais par MAYA-PAY, qui ne le détient ni ne le stocke.',
    next: ['creer', 'payer', 'securite'] },

  { id: 'creer', title: 'Créer un lien de paiement',
    kw: ['creer lien', 'faire lien', 'generer lien', 'nouveau lien', 'lien paiement', 'vendeur', 'vendre', 'encaisser', 'recevoir argent', 'demander paiement', 'envoyer lien'],
    a: 'Pour créer un lien :\n1. Saisissez votre nom commercial (une photo ou un logo est facultatif).\n2. Indiquez votre numéro Orange Money et/ou Moov Money (au moins un).\n3. Entrez le montant et une courte description.\n4. Choisissez la durée de validité (1 heure, 24 heures, 7 jours ou 30 jours).\n\nVous obtenez un lien à copier ou à envoyer par WhatsApp ou SMS, et un bouton « Suivre le paiement ».',
    next: ['suivre', 'expire', 'abonnement'] },

  { id: 'payer', title: 'Comment payer avec un lien',
    kw: ['comment payer', 'payer lien', 'je veux payer', 'faire paiement', 'effectuer paiement', 'bouton payer', 'client', 'etapes paiement', 'utiliser lien'],
    a: 'Pour payer :\n1. Ouvrez le lien reçu et vérifiez le nom du vendeur et le montant.\n2. Choisissez votre opérateur (Orange Money ou Moov Money).\n3. Saisissez votre numéro Mobile Money (celui qui envoie l’argent).\n4. Cochez la case, puis appuyez sur « Payer ».\n5. Validez avec votre code PIN chez votre opérateur.\n\nLa confirmation est ensuite automatique. Pour un premier paiement, testez avec un petit montant.',
    next: ['numero', 'confirmation', 'session'] },

  { id: 'numero', title: 'Pourquoi mon numéro est demandé',
    kw: ['pourquoi numero', 'mon numero', 'numero client', 'numero expediteur', 'saisir numero', 'numero obligatoire', 'numero different', 'autre numero'],
    a: 'Votre numéro sert à vérifier le paiement : MAYA-PAY le compare au numéro de l’expéditeur du SMS de confirmation de l’opérateur. S’ils ne correspondent pas, le paiement n’est pas validé.\n\nSaisissez donc le numéro de la SIM avec laquelle vous envoyez réellement l’argent.',
    next: ['confirmation', 'averifier'] },

  { id: 'securite', title: 'Mon code PIN est-il en sécurité ?',
    kw: ['pin', 'code secret', 'mot de passe', 'securite', 'securise', 'confiance', 'sur', 'arnaque', 'voler', 'vol', 'danger', 'risque', 'pirat'],
    a: 'MAYA-PAY ne connaît jamais votre code PIN et ne vous le demande jamais : vous le saisissez uniquement chez votre opérateur (Orange Money ou Moov Money).\n\nVérifiez toujours que le bénéficiaire affiché est bien le vendeur attendu, et faites un premier test avec un petit montant. Si quelqu’un vous demande votre PIN, ne le donnez pas.',
    next: ['quoi', 'vieprivee'] },

  { id: 'session', title: 'La session de 2 minutes',
    kw: ['session', '2 minutes', 'deux minutes', 'compte a rebours', 'temps', 'session fermee', 'code efface', 'rouvrir', 'rouvrir operation', 'relancer', 'minuteur', 'timer'],
    a: 'Après « Payer », une session de 2 minutes s’ouvre avec un compte à rebours. À zéro, le code est effacé et la session se ferme : c’est une protection.\n\nSi l’opération n’est pas terminée, appuyez sur « Rouvrir une opération » (ou « Relancer le paiement ») pour recommencer. Un lien peut être ouvert 20 fois par heure au maximum.',
    next: ['payer', 'confirmation'] },

  { id: 'confirmation', title: 'La confirmation automatique',
    kw: ['confirmation', 'confirme', 'confirmer', 'automatique', 'sms', 'lire sms', 'verification', 'verifier paiement', 'statut', 'en attente', 'attendre sms', 'pas confirme'],
    a: 'Dans l’application Android, MAYA-PAY lit le SMS de confirmation de votre opérateur pendant 10 minutes après le paiement, puis le serveur le vérifie : montant, bénéficiaire, opérateur, date, numéro expéditeur, et transaction jamais utilisée.\n\n• Confirmé : tout correspond.\n• À vérifier : tout est correct mais l’expéditeur n’a pas pu être établi ; le vendeur contrôle son compte.\n• Non validé : mauvais montant, bénéficiaire, opérateur ou numéro.\n\nGardez le téléphone allumé et la permission SMS activée.',
    next: ['averifier', 'smsperm', 'argentdebite'] },

  { id: 'averifier', title: 'Que veut dire « À vérifier » ?',
    kw: ['a verifier', 'verifier', 'format non valide', 'expediteur non verifie', 'sender', 'verifiera'],
    a: '« À vérifier » signifie que le montant, le bénéficiaire et la transaction sont corrects, mais que le numéro de l’expéditeur n’a pas pu être confirmé (le SMS ne le mentionne pas et la SIM ne le communique pas toujours).\n\nCe n’est jamais confirmé automatiquement : le vendeur doit contrôler la réception sur son compte Orange Money ou Moov Money avant de livrer.',
    next: ['confirmation', 'argentdebite'] },

  { id: 'argentdebite', title: 'J’ai payé mais le vendeur n’a rien reçu',
    kw: ['paye mais', 'debite', 'argent parti', 'pas recu', 'rien recu', 'non recu', 'perdu argent', 'erreur transfert', 'mauvais numero', 'rembourser', 'remboursement', 'litige', 'probleme paiement', 'paiement echoue', 'echec', 'echoue', 'transaction'],
    a: 'MAYA-PAY ne détient jamais l’argent : le transfert se fait de compte à compte, chez Orange Money ou Moov Money.\n\n1. Gardez le SMS de l’opérateur (il contient l’identifiant de transaction).\n2. Vérifiez votre solde et l’historique de votre compte.\n3. Si l’argent est débité, le vendeur doit contrôler son propre compte.\n4. En cas d’erreur de transfert, contactez votre opérateur : seul lui peut annuler ou rembourser.\n\nSi besoin, l’équipe MAYA-PAY peut regarder avec vous.',
    human: true, next: ['averifier', 'confirmation'] },

  { id: 'android', title: 'Installer l’application Android',
    kw: ['android', 'application', 'telecharger', 'installer', 'apk', 'play store', 'installation', 'telechargement', 'sources inconnues', 'ouvrir fichier'],
    a: 'Sur Android, le paiement se fait depuis l’application MAYA-PAY : elle lance le paiement directement sur votre SIM, sans afficher le numéro du vendeur, et confirme automatiquement.\n\nAppuyez sur « Télécharger l’application », puis ouvrez le fichier. Si le téléphone le demande, autorisez l’installation depuis cette source. Si l’application est déjà installée, utilisez « J’ai déjà l’application : ouvrir ce paiement ».',
    next: ['smsperm', 'iphone'] },

  { id: 'smsperm', title: 'L’autorisation SMS',
    kw: ['autorisation sms', 'permission', 'permission sms', 'autoriser', 'sms manquant', 'lire sms', 'acces sms', 'parametres'],
    a: 'L’application a besoin de lire le SMS de votre opérateur pour confirmer le paiement. Elle ne s’en sert que pendant 10 minutes après un paiement lancé depuis MAYA-PAY, et ne regarde que les SMS Orange Money ou Moov Money.\n\nPour l’activer : Paramètres du téléphone > Applications > MAYA-PAY > Autorisations > SMS. Relancez ensuite le paiement.',
    links: [{ label: 'Politique de confidentialité', href: 'privacy.html#sms' }], next: ['vieprivee', 'confirmation'] },

  { id: 'iphone', title: 'iPhone, ordinateur et autres appareils',
    kw: ['iphone', 'ios', 'apple', 'ordinateur', 'pc', 'mac', 'tablette', 'windows', 'navigateur', 'chrome', 'safari'],
    a: 'MAYA-PAY est conçu pour le téléphone. Sur un ordinateur, l’écran vous demande d’ouvrir le lien sur un téléphone.\n\nSur iPhone, le paiement passe par le composeur du téléphone ; la confirmation automatique par SMS n’est disponible que dans l’application Android, donc le vendeur vérifie la réception sur son compte.',
    next: ['android', 'confirmation'] },

  { id: 'deuxsim', title: 'Téléphone à deux SIM',
    kw: ['deux sim', 'double sim', 'dual sim', 'quelle sim', 'choisir sim', 'sim', 'composeur', 'composer'],
    a: 'Un site web ne peut ni lancer l’appel lui-même ni choisir la SIM : sur un téléphone à deux SIM, le téléphone vous demande laquelle utiliser. Choisissez la SIM de l’opérateur que vous avez sélectionné (Orange Money ou Moov Money), et saisissez le numéro de cette SIM dans MAYA-PAY.\n\nDans l’application Android, l’appel est lancé directement sur la SIM de l’opérateur choisi.',
    next: ['numero', 'android'] },

  { id: 'suivre', title: 'Suivre un paiement (vendeur)',
    kw: ['suivre', 'suivi', 'suivre paiement', 'voir paiement', 'paiement recu', 'savoir paye', 'client a paye', 'historique', 'liens recents', 'mes liens'],
    a: 'Après la création du lien, appuyez sur « Suivre le paiement » : la page se met à jour toutes les 10 secondes et affiche le statut (confirmé, à vérifier…), le numéro déclaré par le client et le motif des vérifications. Vos liens récents restent dans « Mes liens récents ».\n\nLa clé de suivi est dans votre lien de suivi : ne le partagez pas, car quiconque l’a peut voir les messages reçus. Pour un montant important, contrôlez aussi votre solde avant de livrer.',
    next: ['averifier', 'creer'] },

  { id: 'expire', title: 'Lien expiré ou durée de validité',
    kw: ['expire', 'expiration', 'lien expire', 'valide', 'validite', 'duree', 'invalide', 'lien invalide', 'lien ne marche pas', 'lien ne fonctionne pas', 'introuvable', 'plus valable'],
    a: 'Un lien est valable 1 heure, 24 heures, 7 jours ou 30 jours selon ce que le vendeur a choisi. Passé ce délai, il affiche « lien expiré ».\n\nClient : demandez au vendeur de vous envoyer un nouveau lien. Vendeur : recréez un lien avec une durée plus longue.',
    next: ['creer', 'payer'] },

  { id: 'abonnement', title: 'L’abonnement vendeur',
    kw: ['abonnement', 'abonner', 'licence', 'renouveler', 'expire abonnement', 'prix', 'tarif', 'combien', 'cout', 'cher', 'payant', 'gratuit', 'souscrire'],
    a: 'Selon la configuration, la création de nouveaux liens peut demander un abonnement. Le prix, la durée, l’état et la date d’expiration s’affichent dans la carte « Mon abonnement » de l’espace vendeur, d’après le numéro Orange ou Moov saisi.\n\nAppuyez sur « S’abonner » ou « Renouveler mon abonnement » : le paiement suit le parcours habituel, et la licence est activée automatiquement quand le SMS est confirmé. Si le statut est « à vérifier », l’équipe valide le paiement. Un abonnement expiré bloque seulement la création de nouveaux liens : vos liens existants et paiements en cours ne sont pas touchés.',
    next: ['creer', 'frais'] },

  { id: 'frais', title: 'Frais et commissions',
    kw: ['frais', 'commission', 'pourcentage', 'taxe', 'prelevement', 'retenue', 'coute combien', 'gratuit'],
    a: 'MAYA-PAY ne prélève aucune commission sur les paiements entre un client et un vendeur, puisque l’argent ne passe pas par MAYA-PAY. Les frais éventuels de transfert sont ceux de votre opérateur (Orange Money ou Moov Money) et apparaissent dans son SMS.\n\nL’abonnement vendeur, s’il est activé, est séparé des paiements.',
    next: ['abonnement', 'quoi'] },

  { id: 'montant', title: 'Montants minimum et maximum',
    kw: ['montant', 'maximum', 'minimum', 'limite', 'plafond', 'combien maximum', 'gros montant', 'petit montant', 'test', 'tester'],
    a: 'Un lien accepte un montant de 1 à 5 000 000 FCFA. Les plafonds de votre compte Orange Money ou Moov Money, eux, dépendent de votre opérateur.\n\nPour un premier paiement, testez toujours avec un petit montant. Pour un montant important, le vendeur doit aussi contrôler son solde avant de livrer.',
    next: ['payer', 'creer'] },

  { id: 'sarali', title: 'Activation Sarali (numéro marchand)',
    kw: ['sarali', 'marchand', 'numero marchand', 'petit commercant', '143', '#143#', 'code marchand', 'activation', 'activer', 'enregistrer numero', 'orange marchand'],
    a: 'Avant de fournir votre numéro Orange, enregistrez-le comme numéro marchand (Sarali) :\n1. Composez #143# sur votre puce Orange.\n2. Sélectionnez l’option de souscription Sarali / petit commerçant.\n3. Confirmez l’inscription en suivant les instructions.\n\nLa suite de la procédure est détaillée sur la page « Créer un lien de paiement », dans le bandeau « Activation Sarali ».',
    next: ['creer', 'suivre'] },

  { id: 'visible', title: 'Le numéro du vendeur est-il caché ?',
    kw: ['numero vendeur', 'numero cache', 'masque', 'visible', 'voir numero', 'afficher numero', 'cacher numero', 'confidentiel numero'],
    a: 'Le site ne contient ni numéro de vendeur ni formule USSD : ils sont stockés côté serveur, et le numéro n’est remis qu’à l’ouverture d’une session de 2 minutes.\n\nLimite à connaître : sur un téléphone sans l’application, le composeur affiche le code composé, donc le numéro. Dans l’application Android, l’appel est lancé directement sur la SIM, sans passer par le composeur.',
    next: ['securite', 'android'] },

  { id: 'vieprivee', title: 'Mes données et ma vie privée',
    kw: ['donnees', 'vie privee', 'confidentialite', 'politique', 'rgpd', 'supprimer', 'effacer', 'oublier', 'conservation', 'photo', 'cookies', 'personnelles', 'privacy'],
    a: 'MAYA-PAY collecte le minimum nécessaire : les informations du lien (nom, numéros, montant, photo facultative), votre numéro de payeur, et le résultat de vérification du SMS (sans son texte complet, et avec le solde masqué). Rien n’est vendu, il n’y a pas de publicité ni de cookies.\n\nLe bouton « Effacer » de l’espace vendeur supprime nom, photo et numéros de cet appareil. Pour accéder à vos données ou les faire supprimer, écrivez à l’équipe.',
    links: [{ label: 'Lire la politique de confidentialité', href: 'privacy.html' }], next: ['smsperm', 'securite'] },

  { id: 'consent', title: 'La case à cocher avant de payer',
    kw: ['case', 'cocher', 'coche', 'consentement', 'accepte', 'accord', 'decocher', 'retirer accord'],
    a: 'La case confirme que c’est vous qui lancez le paiement depuis votre compte, que vous acceptez la politique de confidentialité et la lecture du SMS de confirmation. Votre accord est mémorisé sur ce téléphone : vous n’avez pas à recocher à chaque paiement.\n\nPour le retirer, décochez la case : elle vous sera redemandée au prochain paiement.',
    next: ['vieprivee', 'payer'] },

  { id: 'legal', title: 'Est-ce légal ? Quel est le statut de MAYA-PAY ?',
    kw: ['legal', 'legalite', 'agrement', 'bceao', 'licence legale', 'autorise', 'reglemente', 'officiel', 'statut', 'orange affilie', 'moov affilie'],
    a: 'MAYA-PAY se présente comme un outil technique de lien de paiement : le client initie lui-même le paiement avec son PIN, l’argent va de compte à compte et MAYA-PAY ne le détient jamais. Ce n’est pas un agrégateur de paiement.\n\nMAYA-PAY n’est pas affilié à Orange ni à Moov ; les paiements sont exécutés uniquement par l’opérateur, selon ses propres conditions.',
    links: [{ label: 'Conditions et confidentialité', href: 'privacy.html#conditions' }], next: ['quoi', 'securite'] },

  { id: 'contact', title: 'Parler à l’équipe',
    kw: ['equipe', 'humain', 'agent', 'conseiller', 'contacter', 'contact', 'parler', 'appeler', 'telephone support', 'aide', 'support', 'assistance', 'reclamation', 'plainte', 'probleme'],
    a: 'Bien sûr : je peux vous mettre en relation avec l’équipe MAYA-PAY. Appuyez sur « Écrire à l’équipe » ; elle répond dès que possible, dans cette même bulle.',
    human: true, next: [] },
];

const SMALLTALK = [
  { re: /^(bonjour|bonsoir|salut|salam|coucou|hello|hey|bjr|bsr|slt|assalam)\b/, a: 'Bonjour ! Je suis l’assistant MAYA-PAY. Posez-moi votre question ou choisissez un sujet ci-dessous.' },
  { re: /^(merci|mici|barka|ok merci|d accord|ok|super|parfait|top)\b/, a: 'Avec plaisir ! Une autre question ?' },
  { re: /^(au revoir|bye|a bientot|bonne journee|bonne soiree)\b/, a: 'À bientôt ! Faites toujours un premier test avec un petit montant.' },
];

const TITLE = Object.fromEntries(KB.map((e) => [e.id, e.title]));
const byId = Object.fromEntries(KB.map((e) => [e.id, e]));
const KBT = KB.map((e) => ({ e, kws: e.kw.map((k) => tokens(k)).filter((t) => t.length), title: tokens(e.title) }));

function score(qt) {
  const res = KBT.map(({ e, kws, title }) => {
    let s = 0;
    for (const kt of kws) {
      const hit = kt.filter((t) => qt.some((q) => same(q, t))).length;
      if (hit === kt.length) s += kt.length > 1 ? 3 * kt.length : 2;
      else if (kt.length > 1 && hit >= Math.ceil(kt.length * 0.6)) s += 1.2 * hit;
    }
    for (const t of title) if (qt.some((q) => same(q, t))) s += 0.5;
    return { e, s };
  }).filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
  return res;
}

/**
 * Répond à une question. Retourne { text, chips: [{label, ask}], links, human, topic }.
 * `ctx.last` : dernier thème traité (pour « et ensuite ? »).
 */
export function answer(question, ctx = {}) {
  const raw = norm(question);
  if (!raw) return { text: 'Écrivez votre question, par exemple « comment payer ? ».', chips: starters(ctx) };
  for (const t of SMALLTALK) if (t.re.test(raw) && raw.split(' ').length <= 4) return { text: t.a, chips: starters(ctx) };

  const qt = tokens(question);
  if (/^(et apres|ensuite|la suite|et puis|continuer|suite)$/.test(raw) && ctx.last && byId[ctx.last]) {
    const nx = byId[ctx.last].next || [];
    if (nx.length) return { text: 'Voici la suite logique :', chips: nx.map(chip) };
  }
  const res = qt.length ? score(qt) : [];
  const best = res[0];
  if (!best || best.s < 2) return fallback(ctx);
  const second = res[1];
  // Deux thèmes presque à égalité et peu de signal : on demande de préciser.
  if (second && second.s >= best.s * 0.85 && best.s < 6) {
    return { text: 'Je veux être sûr de bien vous répondre. Vous parlez de quoi ?', chips: [best, second, res[2]].filter(Boolean).map((r) => chip(r.e.id)), human: true };
  }
  const e = best.e;
  return { text: e.a, chips: (e.next || []).map(chip), links: e.links, human: Boolean(e.human), topic: e.id };
}

export const reply = (id) => { const e = byId[id]; return e ? { text: e.a, chips: (e.next || []).map(chip), links: e.links, human: Boolean(e.human), topic: e.id } : fallback({}); };
const chip = (id) => ({ label: TITLE[id], ask: id });
function fallback(ctx) {
  return { text: 'Je n’ai pas trouvé de réponse précise à cette question. Essayez avec d’autres mots, choisissez un sujet ci-dessous, ou écrivez à l’équipe qui vous répondra.', chips: starters(ctx), human: true };
}
export function starters(ctx = {}) {
  const ids = ctx.client ? ['payer', 'confirmation', 'numero', 'securite'] : ['creer', 'suivre', 'abonnement', 'sarali'];
  return ids.map(chip);
}
