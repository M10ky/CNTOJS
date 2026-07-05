'use strict';

// ═══════════════════════════════════════════════════════════════
//   CONSTANTS.JS — Source unique de vérité pour tous les statuts
//   Charger ce fichier EN PREMIER dans index.html, avant utils.js
// ═══════════════════════════════════════════════════════════════

const STATUS_PRET = Object.freeze({
  EN_COURS:  'En cours',
  EN_RETARD: 'En retard',
  RETOURNE:  'Retourné',
  PERDU:     'Perdu',
});

const STATUS_ACTIF = Object.freeze({
  EN_SERVICE:   'En service',
  EN_PRET:      'En prêt',
  HORS_SERVICE: 'Hors service',
  REFORME:      'Réformé',
  SORTI:        'Sorti',
});

const STATUS_DEMANDE = Object.freeze({
  EN_ATTENTE: 'En attente',
  VALIDE:     'Validé',
  REFUSE:     'Refusé',
});

const STATUS_MVT = Object.freeze({
  ENTREE: 'Entrée',
  SORTIE: 'Sortie',
});

const STATUS_STOCK = Object.freeze({
  DISPONIBLE: 'Disponible',
  CRITIQUE:   'Critique',
  RUPTURE:    'Rupture',
});

// ─── Machines d'états : transitions autorisées ────────────────
// Garantit qu'aucune transition invalide n'atteint PostgreSQL.

const TRANSITIONS_PRET = Object.freeze({
  [STATUS_PRET.EN_COURS]:  [STATUS_PRET.RETOURNE, STATUS_PRET.PERDU],
  [STATUS_PRET.EN_RETARD]: [STATUS_PRET.RETOURNE, STATUS_PRET.PERDU],
  [STATUS_PRET.RETOURNE]:  [],   // terminal
  [STATUS_PRET.PERDU]:     [],   // terminal
});

const TRANSITIONS_ACTIF = Object.freeze({
  [STATUS_ACTIF.EN_SERVICE]:   [STATUS_ACTIF.EN_PRET, STATUS_ACTIF.HORS_SERVICE, STATUS_ACTIF.REFORME, STATUS_ACTIF.SORTI],
  [STATUS_ACTIF.EN_PRET]:      [STATUS_ACTIF.EN_SERVICE, STATUS_ACTIF.REFORME],
  [STATUS_ACTIF.HORS_SERVICE]: [STATUS_ACTIF.EN_SERVICE, STATUS_ACTIF.REFORME, STATUS_ACTIF.SORTI],
  [STATUS_ACTIF.REFORME]:      [],  // terminal
  [STATUS_ACTIF.SORTI]:        [STATUS_ACTIF.EN_SERVICE],  // ← réversible : réintégration possible (rpc_reintegrer_actif)
});

const TRANSITIONS_DEMANDE = Object.freeze({
  [STATUS_DEMANDE.EN_ATTENTE]: [STATUS_DEMANDE.VALIDE, STATUS_DEMANDE.REFUSE],
  [STATUS_DEMANDE.VALIDE]:     [],  // terminal
  [STATUS_DEMANDE.REFUSE]:     [],  // terminal
});

/**
 * Vérifie si une transition de statut est valide.
 * @param {Readonly<Object>} map - L'objet TRANSITIONS_xxx
 * @param {string} from - Statut actuel
 * @param {string} to   - Statut cible
 * @returns {boolean}
 */
function isValidTransition(map, from, to) {
  return Array.isArray(map[from]) && map[from].includes(to);
}

/**
 * Valide qu'un statut appartient bien à un ensemble connu.
 * Lance une erreur lisible si ce n'est pas le cas.
 * @param {Readonly<Object>} statusObj - Ex: STATUS_PRET
 * @param {string}           value     - Valeur à tester
 * @param {string}           label     - Nom du champ (pour le message d'erreur)
 */
function assertValidStatus(statusObj, value, label = 'statut') {
  const allowed = Object.values(statusObj);
  if (!allowed.includes(value)) {
    throw new Error(`Valeur de ${label} invalide : "${value}". Autorisées : ${allowed.join(', ')}.`);
  }
}
