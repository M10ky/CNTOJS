'use strict';

// ═══════════════════════════════════════════════════════════════
//   ACTIFS INDIVIDUELS — MODULE COMPLET
//   Dépendances : utils.js, stock.js, export.js
// ═══════════════════════════════════════════════════════════════

// ─── Chargement depuis Supabase ───────────────────────────────
async function loadActifs() {
  const { data, error } = await db
    .from('actifs_individuels')
    .select('*')
    .order('date_entree', { ascending: false }); // ← FIX : 'created_at' n'existe pas sur cette table, on trie sur 'date_entree'
  if (error) { console.error('[loadActifs]', error); return; }
  ST.actifs = data || [];
}

// ─── Nomenclature CNTO-{DEPT}-{CAT3}-{YEAR}-{SEQ4} ──────────
function getCatAbbr(categorie) {
  if (!categorie) return 'GEN';
  const norm = categorie
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // supprime les diacritiques
    .replace(/[^a-zA-Z\s]/g, '')
    .trim()
    .toUpperCase();
  const first = (norm.split(/\s+/)[0] || 'GEN');
  return first.padEnd(3, 'X').slice(0, 3);
}

// ─── Numéro de série ─────────────────────────────────────
// Format : CNTO-{PRODUIT_ID_COMPLET}-{YY}-{SEQ4}
// Exemple : CNTO-IT-MQMETGM4-26-0001
function generateNomenclature(produitId, year, seq) {
  const yy = String(year).slice(-2);   // 2026 → 26

  // Nettoyage du produit_id
  let cleanId = String(produitId || 'GEN')
    .trim()
    .replace(/[^A-Z0-9-]/gi, '')      // Garde seulement lettres, chiffres et -
    .replace(/-+/g, '-');             // Évite les doubles tirets

  return `CNTO-${cleanId}-${yy}-${String(seq).padStart(4, '0')}`;
}
window.getHistoriqueActif = (actifId) => {
  const actif = (ST.actifs || []).find(a => a.id === actifId);

  // Mouvements individuels (sortie directe, attribution de demande) + le
  // mouvement d'entrée d'origine, partagé entre tous les actifs créés dans
  // la même réception et retrouvé via mouvement_entree_id (jamais dupliqué,
  // aucune écriture supplémentaire nécessaire côté submitMvt/createActifUnits).
  const mvts = (ST.mouvements || [])
    .filter(m => m.actif_id === actifId || (actif && actif.mouvement_entree_id && m.id === actif.mouvement_entree_id))
    .map(m => ({
      created_at: m.created_at || m.date,
      kind:       'mouvement',
      label:      m.type,
      qty:        m.qty,
      valeur:     m.valeur,
      lieu:       m.destination || m.emplacement || '—',
      user:       m.user_name || '—',
      detail:     m.demande_id ? `Demande ${m.demande_id}${m.observation ? ' — ' + m.observation : ''}` : (m.observation || ''),
    }));

  // Prêts liés à cet actif (numéro CNTO) : un événement « Prêt » à l'emprunt,
  // puis « Retour » ou « Perdu » selon l'issue — reconstruit depuis ST.prets
  // (déjà chargé par loadPrets), sans nouvelle table ni requête additionnelle.
  const prets = [];
  (ST.prets || []).filter(p => getActifNumero(p) === actifId).forEach(p => {
    prets.push({
      created_at: p.created_at || p.date_debut,
      kind: 'pret', label: 'Prêt', qty: 1, valeur: null,
      lieu: p.emprunteur || '—', user: p.valideur || '—',
      detail: p.motif || '',
    });
    if (p.statut === STATUS_PRET.RETOURNE && p.date_retour_reelle) {
      prets.push({
        created_at: p.date_retour_reelle,
        kind: 'pret', label: 'Retour', qty: 1, valeur: null,
        lieu: p.emprunteur || '—', user: '—',
        detail: 'Retour de prêt',
      });
    } else if (p.statut === STATUS_PRET.PERDU) {
      prets.push({
        created_at: p.updated_at || p.date_retour_prevue || p.created_at,
        kind: 'pret', label: 'Perdu', qty: 1, valeur: null,
        lieu: p.emprunteur || '—', user: '—',
        detail: 'Déclaré perdu — réformé',
      });
    }
  });

  return [...mvts, ...prets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};
// ─── Création automatique d'actifs à l'entrée de stock ────────
// FIX : la fonction renvoie { ok, message, first, last } pour que l'appelant
// (submitMvt) sache si la création a réellement réussi ET puisse afficher
// le message d'erreur Supabase réel dans un seul toast — au lieu d'un toast
// de succès factice, ou de deux toasts qui s'écrasaient l'un l'autre.
// prixUnit : prix unitaire de l'ENTRÉE EN COURS.
// FIX (corrections finales — pt.3) : ce paramètre existait déjà dans la signature
// mais n'était JAMAIS transmis par submitMvt() (stock.js) → il valait donc toujours
// `null` ici, et le repli silencieux sur prod.valeur_achat (champ catalogue souvent
// jamais configuré, donc à 0) produisait des actifs avec un prix unitaire vide.
// submitMvt() transmet désormais bien prixUnit (cf. stock.js → submitMvt), et ce
// prix est utilisé ci-dessous SANS repli sur le catalogue.
window.createActifUnits = async (prod, qty, mvtId, emplacement, manualSerials = [], prixUnit = null) => {
  try {
    // Préfixe de nomenclature pour ce produit (dept + catégorie) — réutilisé
    // pour la colonne 'prefix' de serial_sequences ET pour générer chaque ID.
    const deptCode = prod.dept === 'IT' ? 'IT' : 'FIN';
    const catAbbr  = getCatAbbr(prod.categorie);
    const nomPrefix = `CNTO-${deptCode}-${catAbbr}`;

    // Lire le dernier numéro de séquence pour ce produit
    // FIX : la colonne réelle s'appelle 'current_seq', pas 'last_seq'
    // (confirmé via information_schema.columns sur serial_sequences).
    let lastSeq = 0;
    const { data: seqRow, error: seqRErr } = await db
      .from('serial_sequences')
      .select('current_seq')
      .eq('produit_id', prod.id)
      .maybeSingle();
    if (seqRErr) throw seqRErr;
    if (seqRow) lastSeq = seqRow.current_seq || 0;

    const year = new Date().getFullYear();
    const now  = nowISO();
    const actifs = [];

    for (let i = 0; i < qty; i++) {
      const seq = lastSeq + i + 1;
      // ← Étape D+ : numéro manuel s'il est fourni, sinon génération automatique
      const actifId = (manualSerials[i] && manualSerials[i].trim())
        ? manualSerials[i].trim()
        : generateNomenclature(prod.id, year, seq);
      actifs.push({
        id:                  actifId,
        produit_id:          prod.id,
        produit_nom:         prod.nom,
        categorie:           prod.categorie            || '',
        dept:                prod.dept,
        emplacement:         emplacement || prod.emplacement || '',
        date_entree:         now,
        // FIX (corrections finales — pt.3) : valeur_achat = TOUJOURS le prix unitaire
        // de cette entrée précise (prixUnit), jamais celui du produit catalogue. Un
        // même produit peut être réceptionné à des prix différents au fil du temps ;
        // chaque actif individuel doit conserver SON propre prix d'acquisition. Le
        // repli sur prod.valeur_achat est supprimé (c'était la source du bug : ce
        // champ catalogue est rarement configuré et valait souvent 0). submitMvt()
        // bloque désormais toute entrée sans prix pour un produit amortissable, donc
        // ce cas ne devrait plus survenir en usage normal ; 0 reste un repli défensif.
        valeur_achat:        (prixUnit !== null && prixUnit > 0) ? prixUnit : 0,
        // FIX (corrections finales — pt.3) : date_achat = date réelle de CETTE entrée
        // (même valeur que date_entree, tronquée à la date), et non plus la date_achat
        // générique du produit catalogue. Chaque actif amortit donc à partir de sa
        // propre date d'acquisition réelle.
        date_achat:          now.slice(0, 10),
        duree_amortissement: prod.duree_amortissement  || 36,
        statut:              'En service',
        mouvement_entree_id: mvtId,
        observation:         '',
        // FIX : 'created_at' / 'updated_at' supprimés — ces colonnes n'existent
        // pas dans le schéma réel de actifs_individuels (cf. liste de colonnes
        // confirmée). Leur présence ici faisait échouer systématiquement
        // l'INSERT (erreur PostgREST « colonne inconnue »), erreur qui était
        // ensuite avalée par le catch ci-dessous sans jamais remonter à l'appelant.
      });
    }

    const { error: insErr } = await db.from('actifs_individuels').insert(actifs);
    if (insErr) throw insErr;

    // Mettre à jour (ou créer) le compteur de séquence
    // FIX : 'last_seq' → 'current_seq' (vrai nom de colonne), et ajout de
    // 'prefix' qui existe sur la table et n'était jusqu'ici jamais alimenté.
    const { error: seqWErr } = await db.from('serial_sequences').upsert(
      { produit_id: prod.id, current_seq: lastSeq + qty, prefix: nomPrefix, updated_at: now },
      { onConflict: 'produit_id' }
    );
    if (seqWErr) throw seqWErr;

    const first = actifs[0].id;
    const last  = actifs[actifs.length - 1].id;
    return { ok: true, first, last }; // ← FIX : succès explicite — c'est submitMvt() qui affiche le toast
  } catch (err) {
    // FIX : plus de showToast() ici. Un seul toast (affiché par submitMvt)
    // avec le VRAI message Supabase, au lieu de deux toasts qui s'écrasaient
    // l'un l'autre (l'utilisateur ne voyait jamais le détail de l'erreur).
    console.error('[createActifUnits]', err);
    return { ok: false, message: err?.message || err?.error_description || String(err) };
  }
};

// ─── Mise à jour du flag is_amortissable ─────────────────────
window.updateAmortissable = async (prodId, val) => {
  try {
    const { error } = await db
      .from('produits')
      .update({ is_amortissable: val, updated_at: nowISO() })
      .eq('id', prodId);
    if (error) throw error;
    await loadProduits();
    showToast(val ? 'Suivi individuel activé pour ce produit' : 'Suivi individuel désactivé');
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

// ─── Notes d'audit sur changement de statut ────────────────────
// Aucune nouvelle table : on réutilise la colonne 'observation' déjà
// présente sur actifs_individuels pour tenir un journal horodaté, cumulatif
// et lisible de chaque action de cycle de vie (HS / réactivation / réforme /
// transfert). Consommé directement par openActifHistorique() ci-dessus.
function buildActifNote(actif, action) {
  const line = `${fmtDT(nowISO())} — ${action} (${ST.profile?.name || 'Système'})`;
  return actif?.observation ? `${line}\n${actif.observation}` : line;
}

// ─── Synchronisation Inventaire ↔ Actifs individuels ───────────
// Recalcule produits.stock strictement à partir du nombre d'actifs
// actuellement au statut STATUS_ACTIF.EN_SERVICE pour ce produit — seul
// statut compté comme "disponible" (En prêt / Hors service / Sorti /
// Réformé ne comptent jamais, cf. règles métier). Appelée après CHAQUE
// changement de statut d'actif pouvant faire varier la disponibilité :
// c'est la cause racine du bug — certaines actions (retour de prêt,
// remise en service, actif retrouvé) ne mettaient jamais à jour
// produits.stock, en comptant sur des RPC qui n'incrémentaient pas
// systématiquement la bonne colonne, ou sur aucun mécanisme du tout.
window.syncStockDepuisActifs = async (produitId) => {
  if (!produitId) return;
  try {
    await loadActifs(); // s'assurer que ST.actifs reflète le tout dernier changement
    const prod = ST.produits.find(p => p.id === produitId);
    if (!prod || !prod.is_amortissable) return; // ← ne touche jamais les produits non amortissables

    const nbDisponible = ST.actifs.filter(
      a => a.produit_id === produitId && a.statut === STATUS_ACTIF.EN_SERVICE
    ).length;

    if (nbDisponible === prod.stock) return; // déjà synchronisé — pas d'écriture inutile

    const { error } = await db.from('produits')
      .update({ stock: nbDisponible, updated_at: nowISO() })
      .eq('id', produitId);
    if (error) throw error;

    await loadProduits();
  } catch (err) {
    console.error('[syncStockDepuisActifs]', err);
  }
};

// ─── Actions sur les actifs ────────────────────────────────────
window.horsServiceActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  try {
    const note = buildActifNote(a, 'Mis hors service');
    const { error } = await db
      .from('actifs_individuels')
      .update({ statut: STATUS_ACTIF.HORS_SERVICE, observation: note }) // ← FIX : 'updated_at' retiré (colonne inexistante sur actifs_individuels)
      .eq('id', id);
    if (error) throw error;
    showToast(`"${id}" mis hors service`);
    await syncStockDepuisActifs(a.produit_id); // ← FIX : recalcule le stock (actif sorti du pool "disponible")
    render();
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

window.reactiverActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;

  // ← FIX : réactiver un actif "En prêt" est synonyme d'un RETOUR DE PRÊT — pas
  // d'une simple remise en service. Auparavant, cette fonction faisait un update
  // brut du statut sans jamais toucher la table `prets` : l'actif redevenait
  // "En service" alors que son prêt restait affiché "En cours"/"En retard" avec
  // son emprunteur — deux vérités contradictoires pour le même actif. On route
  // donc systématiquement vers retournerPret() (déjà responsable de clôturer le
  // prêt ET de resynchroniser le stock via syncStockDepuisActifs), au lieu de
  // dupliquer cette logique ici.
  if (a.statut === STATUS_ACTIF.EN_PRET) {
    const pretActif = (ST.prets || []).find(p =>
      getActifNumero(p) === id &&
      (p.statut === STATUS_PRET.EN_COURS || p.statut === STATUS_PRET.EN_RETARD)
    );
    if (pretActif) {
      await retournerPret(pretActif.id); // ← réutilise le workflow existant (clôture prêt + historique + stock)
      return;
    }
    // Sécurité : actif marqué "En prêt" mais aucun prêt "En cours" retrouvé
    // (incohérence de données) — on continue sur le chemin normal ci-dessous
    // plutôt que de bloquer l'utilisateur.
  }

  try {
    const note = buildActifNote(a, 'Remise en service');
    const { error } = await db
      .from('actifs_individuels')
      .update({ statut: STATUS_ACTIF.EN_SERVICE, observation: note }) // ← FIX : 'updated_at' retiré (colonne inexistante sur actifs_individuels)
      .eq('id', id);
    if (error) throw error;
    showToast(`"${id}" réactivé en service`);
    await syncStockDepuisActifs(a.produit_id); // ← FIX : l'actif redevient disponible, stock recalculé
    render();
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

// ─── Réintégration d'un actif Sorti (réversibilité — v3) ───────
// Contrairement à reactiverActif() (Hors service → En service, qui ne touche
// jamais le stock car une mise Hors service ne l'avait pas décrémenté),
// la réintégration d'un actif Sorti DOIT réincrémenter le stock du produit
// (la sortie l'avait décrémenté). D'où le passage par un RPC atomique dédié
// plutôt qu'un simple update de statut.
window.reintegrerActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  if (a.dept === 'IT' && !canManIT() || a.dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }
  showConfirm(
    `Réintégrer "${id}" en service ?`,
    `L'actif "${a.produit_nom}" redeviendra <strong>disponible</strong> (statut En service)
     et le stock du produit sera réincrémenté de 1.`,
    async () => {
      try {
        const { error } = await db.rpc('rpc_reintegrer_actif', {
          p_actif_id:  id,
          p_user_name: ST.profile?.name || 'Système',
          p_user_id:   ST.user?.id || null,
          p_obs:       '',
        });
        if (error) throw error;
        showToast(`"${id}" réintégré — remis en service`);
        await Promise.all([loadMouvements(), loadMouvementsEntrees()]);
        // ← FIX : recalcul explicite du stock depuis les actifs réels, au lieu de
        // faire confiance uniquement à l'incrémentation faite côté RPC (garde-fou
        // qui corrige toute dérive silencieuse entre inventaire et actifs).
        await syncStockDepuisActifs(a.produit_id);
        render();
      } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
    },
    '#10b981'
  );
};

window.reformerActif = async (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  showConfirm(
    `Réformer "${id}" ?`,
    `L'actif "${a.produit_nom}" sera définitivement réformé. Cette action est irréversible.`,
    async () => {
      try {
        const note = buildActifNote(a, 'Réformé');
        const { error } = await db
          .from('actifs_individuels')
          .update({ statut: STATUS_ACTIF.REFORME, observation: note }) // ← FIX : 'updated_at' retiré (colonne inexistante sur actifs_individuels)
          .eq('id', id);
        if (error) throw error;
        showToast(`"${id}" réformé`);
        await syncStockDepuisActifs(a.produit_id); // ← FIX : réforme = sortie définitive du pool disponible
        render();
      } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
    },
    '#ef4444'
  );
};

// ─── Transfert / changement d'emplacement ──────────────────────
// N'est pas un changement de statut (n'entre pas dans TRANSITIONS_ACTIF) :
// ne touche que 'emplacement' + note d'audit. Bloqué sur les statuts
// terminaux (Réformé / Sorti) uniquement.
window.changerEmplacementActif = (id) => {
  const a = ST.actifs.find(x => x.id === id);
  if (!a) return;
  if (a.dept === 'IT' && !canManIT() || a.dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }
  const emplOpts = (ST.params.emplacements.length ? ST.params.emplacements : ['Stock Principal'])
    .map(e => `<option value="${e}" ${e === (a.emplacement || '') ? 'selected' : ''}>${e}</option>`).join('');
  showConfirm(
    `Changer l'emplacement de "${id}" ?`,
    `<div style="margin-bottom:10px">Emplacement actuel : <strong>${a.emplacement || '—'}</strong></div>
     <select id="transfer-empl-select" style="width:100%">${emplOpts}</select>`,
    async () => {
      const nouvel = document.getElementById('transfer-empl-select')?.value;
      if (!nouvel || nouvel === a.emplacement) return;
      try {
        const note = buildActifNote(a, `Transfert : ${a.emplacement || '—'} → ${nouvel}`);
        const { error } = await db
          .from('actifs_individuels')
          .update({ emplacement: nouvel, observation: note })
          .eq('id', id);
        if (error) throw error;
        showToast(`"${id}" transféré vers ${nouvel}`);
        await loadActifs(); render();
      } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
    },
    '#0ea5e9'
  );
};

// ─── Badge statut actif ────────────────────────────────────────
function actifStatutBadge(statut) {
  if (statut === 'En service')   return `<span class="tag actif-sv">● En service</span>`;
  if (statut === 'En prêt')      return `<span class="tag actif-pr">⇄ En prêt</span>`;
  if (statut === 'Hors service') return `<span class="tag actif-hs">⚠ Hors service</span>`;
  if (statut === 'Réformé')      return `<span class="tag actif-rf">✕ Réformé</span>`;
  if (statut === 'Sorti')        return `<span class="tag actif-sorti">↗ Sorti</span>`;
  return `<span class="tag">${statut || '—'}</span>`;
}

// ─── Page Actifs Individuels ───────────────────────────────────
function renderActifs(dept) {
  const color = dept === 'IT' ? '#4f46e5' : '#10b981';
  const il    = ST.search.inline;
  const q     = (il.query || '').trim();
  const canM  = dept === 'IT' ? canManIT() : canManFin();

  const all = ST.actifs.filter(a => a.dept === dept);

  // Filtrage texte libre
  const filtered = all.filter(a => {
    if (!q) return true;
    return matchesQuery(
      [a.id, a.produit_nom, a.categorie, a.emplacement, a.statut, a.mouvement_entree_id],
      q
    );
  });

  // KPIs
  const nbSv = all.filter(a => a.statut === 'En service').length;
  const nbPr = all.filter(a => a.statut === 'En prêt').length;
  const nbHs = all.filter(a => a.statut === 'Hors service').length;
  const nbSo = all.filter(a => a.statut === 'Sorti').length;      // ← NOUVEAU
  const nbRf = all.filter(a => a.statut === 'Réformé').length;
  const vncTotale = all
    .filter(a => a.statut === 'En service' || a.statut === 'En prêt')
    .reduce((s, a) => s + (calcVNC(a) || 0), 0);
  const valTotale = all
    .filter(a => a.statut === 'En service' || a.statut === 'En prêt')
    .reduce((s, a) => s + (a.valeur_achat || 0), 0);

  const kpis = [
    { lbl: 'En service',    val: nbSv, s: 'actifs opérationnels', c: '#10b981' },
    { lbl: 'En prêt',       val: nbPr, s: 'actifs sortis',        c: '#3b82f6' },
    { lbl: 'Hors service',  val: nbHs, s: 'à vérifier/réparer',   c: '#f59e0b' },
    { lbl: 'Sortis',        val: nbSo, s: 'sortis du stock',      c: '#dc2626' }, // ← NOUVEAU
    { lbl: 'Réformés',      val: nbRf, s: 'fin de vie',           c: '#94a3b8' },
  ];
  if (canSeePrix() && all.length) {
    kpis.push({
      lbl: 'VNC Totale (actifs actifs)',
      val: fmt(vncTotale) + ' MGA',
      s: `sur ${fmt(valTotale)} MGA d'achat`,
      c: '#4f46e5',
    });
  }

  // Écran vide
  if (!all.length) {
    return `<p class="page-title">Actifs Individuels ${dept}</p>
      <p class="page-sub">Aucun actif enregistré pour le département ${dept}</p>
      <div class="info-banner">
        <i class="ti ti-info-circle"></i>
        <div>
          Les actifs individuels sont créés <strong>automatiquement</strong> lors d'une entrée de stock
          sur un produit coché <strong>« Suivi individuel amortissable »</strong>.<br>
          Activez ce suivi dans le formulaire de modification du produit, puis enregistrez une entrée.
        </div>
      </div>
      <div class="card"><div class="empty-state">
        <div class="empty-ico">📦</div>
        <div style="font-size:14px;font-weight:700;color:var(--text)">Aucun actif individuel</div>
        <div style="font-size:12px;margin-top:6px;color:var(--text3)">
          Activez le suivi amortissable sur un produit, puis enregistrez une entrée de stock.
        </div>
      </div></div>`;
  }

  // Barre de recherche (texte libre uniquement — filtres par statut à l'Étape E)
  const searchBar = buildContentSearchBar({
    placeholder: `Rechercher dans les actifs ${dept} (numéro de série, produit, emplacement, statut…)`,
    count: all.length,
    filteredCount: filtered.length,
  });

  // FIX (corrections finales — pt.2) : "Produit" est désormais affiché avant
  // "Numéro de série" (ordre de lecture plus naturel : on identifie d'abord le
  // type de matériel, puis son numéro de série précis). Même ordre appliqué aux
  // deux départements puisque renderActifs() est une fonction partagée IT/Finance.
  const hdrs = ['Produit', 'Numéro de série', 'Catégorie', 'Emplacement', 'Date entrée'];
  if (canSeePrix()) hdrs.push('Valeur achat');
  hdrs.push('Durée');
  if (canSeePrix()) hdrs.push('VNC · Avanc.');
  hdrs.push('Statut');
  if (canM) hdrs.push('Actions');

  const rows = filtered.map(a => {
    const vnc = calcVNC(a);
    const pct = amortPct(a);
    const vncCell = vnc !== null
      ? `<div style="font-weight:700;font-size:12px">${fmt(vnc)} MGA</div>
         <div class="amort-bar"><div class="amort-fill" style="width:${pct}%;background:${amortColor(pct)}"></div></div>
         <div style="font-size:9px;color:${amortColor(pct)};margin-top:1px">${pct}% amorti</div>`
      : '<span style="color:var(--text3);font-size:11px">—</span>';

    const actions = canM
      ? `<div style="display:flex;gap:4px;flex-wrap:wrap">
          ${a.statut === STATUS_ACTIF.SORTI ? btn('↩ Réintégrer', '#10b981', true, `reintegrerActif('${a.id}')`) : ''}
          ${isValidTransition(TRANSITIONS_ACTIF, a.statut, STATUS_ACTIF.HORS_SERVICE) ? btn('⚠ HS',      '#f59e0b', true, `horsServiceActif('${a.id}')`) : ''}
          ${a.statut !== STATUS_ACTIF.SORTI && isValidTransition(TRANSITIONS_ACTIF, a.statut, STATUS_ACTIF.EN_SERVICE)
            ? btn('↩ Activer', '#10b981', true, `reactiverActif('${a.id}')`)
            : ''}
          ${isValidTransition(TRANSITIONS_ACTIF, a.statut, STATUS_ACTIF.REFORME)
            ? btn('✕ Réformer','#ef4444',true, `reformerActif('${a.id}')`)
            : (a.statut === 'Réformé'
                ? `<span class="tag actif-rf" style="font-size:9.5px">${a.statut}</span>`
                : '')}
          ${(a.statut !== STATUS_ACTIF.REFORME && a.statut !== STATUS_ACTIF.SORTI) ? btn('📍', '#0ea5e9', true, `changerEmplacementActif('${a.id}')`, '') : ''}
          ${btn('✏', '#64748b', true, `openEditActif('${a.id}')`, '')}
          ${btn('🕘', '#6366f1', true, `openActifHistorique('${a.id}')`, '')}
        </div>`
      : `${btn('🕘 Historique', '#6366f1', true, `openActifHistorique('${a.id}')`)}`;

    // FIX (corrections finales — pt.2) : cellule "Produit" déplacée avant la
    // cellule "Numéro de série", conformément au nouvel ordre des en-têtes ci-dessus.
    return `<tr${a.statut === 'Réformé' ? ' class="row-inactif"' : ''}>
      <td style="font-weight:600;font-size:12.5px">${highlight(a.produit_nom, q)}</td>
      <td><code class="actif-id">${highlight(a.id, q)}</code></td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${highlight(a.categorie, q)}</span></td>
      <td>${a.emplacement
        ? `<span class="tag" style="color:#1e40af;background:#dbeafe;font-size:9.5px">${highlight(a.emplacement, q)}</span>`
        : '<span style="color:var(--text3)">—</span>'
      }</td>
      <td>${fmtDate(a.date_entree)}</td>
      ${canSeePrix() ? `<td style="font-family:var(--mono);font-size:12px">${fmt(a.valeur_achat)} MGA</td>` : ''}
      <td style="font-size:11px;color:var(--text3)">${a.duree_amortissement ? (a.duree_amortissement / 12).toFixed(1) + ' a' : '—'}</td>
      ${canSeePrix() ? `<td>${vncCell}</td>` : ''}
      <td>${actifStatutBadge(a.statut)}</td>
      ${canM ? `<td>${actions}</td>` : ''}
    </tr>`;
  }).join('');

  const emptyRow = !filtered.length
    ? `<tr class="no-result-row"><td colspan="${hdrs.length}">
        <div class="nri">🔍</div>
        <div class="nrt">Aucun actif ne correspond à "${q}"</div>
        <div style="font-size:11px;margin-top:4px">
          <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a>
        </div>
      </td></tr>`
    : '';

  return `<p class="page-title">Actifs Individuels ${dept}</p>
    <p class="page-sub">${all.length} actif${all.length > 1 ? 's' : ''} enregistré${all.length > 1 ? 's' : ''} · ${nbSv} en service · ${nbPr} en prêt · ${nbHs + nbRf} hors service / réformés</p>
    <div class="kpi-grid">${kpis.map(k =>
      `<div class="kpi" style="border-left-color:${k.c}">
        <div class="kpi-lbl">${k.lbl}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-s">${k.s}</div>
      </div>`
    ).join('')}</div>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV', '#10b981', true, `exportActifsCSV('${dept}')`, 'ti-download')}
    </div>
    ${searchBar}
    <div class="card">
      <div class="card-hd">
        <span class="card-ttl">
          <i class="ti ti-devices" style="color:${color}"></i>
          Registre des actifs ${dept}
        </span>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows || emptyRow}</tbody>
      </table></div>
    </div>`;
}

// ─── Export CSV actifs ─────────────────────────────────────────
window.exportActifsCSV = (dept) => {
  const all   = ST.actifs.filter(a => a.dept === dept);
  const showP = canSeePrix();

  // FIX (corrections finales — pt.2) : ordre des colonnes aligné sur le tableau
  // à l'écran (Produit avant Numéro de série).
  const headers = [
    'Produit', 'Numéro de série', 'Catégorie', 'Emplacement',
    'Statut', 'Date entrée', 'Mouvement entrée',
  ];
  if (showP) headers.push('Valeur achat (MGA)', 'Date achat', 'Durée amort. (mois)', 'VNC (MGA)', '% Amorti');

  const rows = all.map(a => {
    const vnc = calcVNC(a);
    const pct = amortPct(a);
    const row = [
      a.produit_nom, a.id, a.categorie, a.emplacement || '',
      a.statut, fmtDT(a.date_entree), a.mouvement_entree_id || '',
    ];
    if (showP) row.push(
      a.valeur_achat            || 0,
      a.date_achat              || '',
      a.duree_amortissement     || '',
      vnc !== null ? vnc        : '',
      pct !== null ? pct + '%'  : ''
    );
    return row;
  });

  exportToCSV(rows, headers, `actifs_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};
// ─── Édition individuelle d'un actif (point 4) ─────────────────
// Mono-table (update actifs_individuels uniquement) : pas de risque
// d'incohérence multi-table, donc pas de RPC nécessaire ici. Modifier un
// actif n'affecte jamais les autres actifs du même produit — chaque ligne
// est totalement indépendante (valeur_achat, fournisseur, etc. déjà stockés
// par actif depuis la création via createActifUnits).
window.openEditActif = (actifId) => {
  const a = (ST.actifs || []).find(x => x.id === actifId);
  if (!a) return;
  if (a.dept === 'IT' && !canManIT() || a.dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }
  ST.modal = { type: 'editActif', actifId };
  renderModalEditActif();
};

function renderModalEditActif() {
  document.getElementById('modal-el')?.remove();
  if (!ST.modal || ST.modal.type !== 'editActif') return;

  const a = (ST.actifs || []).find(x => x.id === ST.modal.actifId);
  if (!a) { closeModal(); return; }
  const color = a.dept === 'IT' ? '#4f46e5' : '#10b981';

  const body = `
    <div class="form-row"><label class="form-lbl">Actif</label>
      <input value="${a.produit_nom} — ${a.id}" disabled class="field-readonly" style="font-weight:700"></div>
    <div class="form-2col">
      <div class="form-row"><label class="form-lbl">Valeur d'achat (MGA)</label>
        <input id="f-actif-valach" type="number" min="0" value="${a.valeur_achat || 0}"></div>
      <div class="form-row"><label class="form-lbl">Date d'achat</label>
        <input id="f-actif-dtach" type="date" value="${a.date_achat || ''}"></div>
    </div>
    <div class="form-2col">
      <div class="form-row"><label class="form-lbl">Fournisseur</label>
        <select id="f-actif-fourn">
          <option value="">— Non renseigné —</option>
          ${(ST.params.fournisseurs || []).map(f =>
            `<option value="${escQ(f)}" ${a.fournisseur === f ? 'selected' : ''}>${f}</option>`
          ).join('')}
        </select></div>
      <div class="form-row"><label class="form-lbl">Durée d'amortissement</label>
        <select id="f-actif-duree">${[12,24,36,48,60,84].map(m =>
          `<option value="${m}" ${(a.duree_amortissement||36)===m?'selected':''}>${m} mois — ${tauxLineaire(m)}%/an</option>`
        ).join('')}</select></div>
    </div>
    <div class="form-row"><label class="form-lbl">Valeur résiduelle (MGA)</label>
      <input id="f-actif-residuelle" type="number" min="0" value="${a.valeur_residuelle || 0}">
      <div style="font-size:10.5px;color:var(--text3);margin-top:3px">
        Valeur plancher — la VNC de cet actif ne descendra jamais sous ce montant, même totalement amorti.
      </div>
    </div>
    <div class="info-banner" style="margin-top:10px;font-size:11.5px">
      <i class="ti ti-info-circle"></i>
      <div>Ces valeurs sont propres à <strong>cet actif uniquement</strong> — les autres unités du même
      produit (achetées à des dates ou prix différents) ne sont pas affectées.</div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      ${btn('Annuler', '#94a3b8', true, 'closeModal()')}
      ${btn('✓ Enregistrer', color, false, `submitEditActif('${a.id}')`)}
    </div>`;

  const ov = document.createElement('div');
  ov.id = 'modal-el'; ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
    <div class="modal-h"><span class="modal-ttl">✏️ Modifier l'actif — <code class="actif-id">${a.id}</code></span>
      <button class="close-btn" onclick="closeModal()">✕</button></div>
    ${body}</div>`;
  ov.addEventListener('click', closeModal);
  document.body.appendChild(ov);
}

window.submitEditActif = async (actifId) => {
  const a = (ST.actifs || []).find(x => x.id === actifId);
  if (!a) return;
  const valAch     = parseFloat(document.getElementById('f-actif-valach')?.value) || 0;
  const dtAch      = document.getElementById('f-actif-dtach')?.value || null;
  const fournisseur= document.getElementById('f-actif-fourn')?.value || null;
  const duree      = parseInt(document.getElementById('f-actif-duree')?.value) || 36;
  const residuelle = parseFloat(document.getElementById('f-actif-residuelle')?.value) || 0;

  if (residuelle > valAch) {
    showToast('La valeur résiduelle ne peut pas dépasser la valeur d\'achat', 'err'); return;
  }

  try {
    const { error } = await db.from('actifs_individuels').update({
      valeur_achat:        valAch,
      date_achat:          dtAch,
      fournisseur,
      duree_amortissement: duree,
      valeur_residuelle:   residuelle,
    }).eq('id', actifId);
    if (error) throw error;
    closeModal();
    showToast(`Actif "${actifId}" mis à jour`);
    await loadActifs(); render();
  } catch (err) { showToast('Erreur : ' + err.message, 'err'); }
};

// ─── Historique d'un actif individuel (modal read-only) ────────
window.openActifHistorique = (actifId) => {
  document.getElementById('modal-el')?.remove();
  const a = (ST.actifs || []).find(x => x.id === actifId);
  const hist = getHistoriqueActif(actifId);

  const badgeFor = (h) => {
    if (h.kind === 'pret') {
      if (h.label === 'Prêt')   return `<span class="tag pret-encours">⇄ Prêt</span>`;
      if (h.label === 'Retour') return `<span class="tag pret-retourne">✓ Retour</span>`;
      if (h.label === 'Perdu')  return `<span class="tag pret-perdu">✕ Perdu</span>`;
    }
    return typeBadge(h.label);
  };

  const rows = hist.length
    ? hist.map(h => `<tr>
        <td>${fmtDTSplit(h.created_at)}</td>
        <td>${badgeFor(h)}</td>
        <td style="font-weight:600">${h.qty ?? '—'}</td>
        <td style="font-weight:700">${h.valeur!=null ? fmt(h.valeur)+' MGA' : '—'}</td>
        <td style="font-size:11px;color:var(--text2)">${h.lieu || '—'}</td>
        <td style="font-size:11px;color:var(--text3)">${h.user || '—'}</td>
        <td style="font-size:11px;color:var(--text3);max-width:140px">${h.detail || ''}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text3)">Aucun historique enregistré pour cet actif</td></tr>`;

  const ov = document.createElement('div');
  ov.id = 'modal-el';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal modal-wide" onclick="event.stopPropagation()">
    <div class="modal-h">
      <span class="modal-ttl">🕘 Historique — <code class="actif-id">${actifId}</code></span>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
      ${a?.produit_nom || '—'} · Statut actuel : ${actifStatutBadge(a?.statut || '—')}
      ${a?.observation ? `<div style="margin-top:8px;padding:8px 10px;background:#f8fafc;border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--text2);white-space:pre-line">${a.observation}</div>` : ''}
    </div>
    <div style="overflow-x:auto"><table>
      <thead><tr>${['Date & Heure','Action','Qté','Valeur','Empl./Dest.','Agent','Détail'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px">
      ${btn('Fermer','#94a3b8',true,'closeModal()')}
    </div>
  </div>`;
  ov.addEventListener('click', closeModal);
  document.body.appendChild(ov);
};