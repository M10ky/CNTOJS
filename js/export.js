'use strict';

// ═══════════════════════════════════════════
//   EXPORT CSV — MODULE GÉNÉRIQUE RÉUTILISABLE
// ═══════════════════════════════════════════

/** Retourne la date du jour au format YYYY-MM-DD pour les noms de fichiers */
function todayFileDate() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Fonction générique d'export CSV — réutilisable sur tout le site.
 * @param {Array<Array>} rows    - Tableau de tableaux (une ligne = un enregistrement)
 * @param {Array<string>} headers - En-têtes de colonnes
 * @param {string}        filename - Nom du fichier téléchargé (.csv)
 */
function exportToCSV(rows, headers, filename) {
  const BOM = '\uFEFF'; // UTF-8 BOM — indispensable pour Excel (accents corrects)

  const escapeCell = (val) => {
    if (val === null || val === undefined) return '';
    // Supprimer les balises HTML éventuelles et décoder les entités
    let s = String(val)
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .trim();
    // Encapsuler entre guillemets si la valeur contient un séparateur, saut de ligne ou guillemet
    if (/[";,\n\r]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [
    headers.map(escapeCell).join(';'),
    ...rows.map(row => row.map(escapeCell).join(';'))
  ];

  const blob = new Blob([BOM + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(`Export "${filename}" téléchargé`);
}

// ═══════════════════════════════════════════
//   EXPORTS SPÉCIFIQUES PAR MODULE
// ═══════════════════════════════════════════

// ─── Inventaire / Produits ───
window.exportProduitsCSV = (dept) => {
  const baseProd = ST.produits.filter(p => !dept || p.dept === dept);
  const prods    = applyInlineFilters(baseProd, 'produit');
  const showP    = canSeePrix();

  // FIX (corrections finales — pt.1) : 'VNC (MGA)' et '% Amorti' retirés de l'export
  // Inventaire — cohérent avec la suppression de la colonne VNC dans prodTable
  // (stock.js). 'Valeur achat (MGA)' / 'Date achat' / 'Durée amort. (mois)' restent :
  // ce sont des données de configuration catalogue toujours éditables depuis la
  // fiche produit (✏), simplement plus utilisées ici pour calculer une VNC produit.
  const headers = [
    'ID', 'Produit', 'Catégorie', 'Département', 'Emplacement',
    'Stock', 'Seuil critique', 'Statut'
  ];
  if (showP) {
    headers.push(
      'Valeur Stock CUMP (MGA)',   // ← Point 1 : aligné sur la colonne écran
      'Valeur achat (MGA)', 'Date achat',
      'Durée amort. (mois)'
    );
  }

  const rows = prods.map(p => {
    const row = [
      p.id, p.nom, p.categorie, p.dept,
      p.emplacement || '', p.stock, p.seuil, getStatus(p)
    ];
    if (showP) {
      row.push(
        p.is_amortissable ? '' : getValeurStockActuel(p.id),  // ← Point 1
        p.valeur_achat || 0,
        p.date_achat   || '',
        p.duree_amortissement || ''
      );
    }
    return row;
  });

  const suffix = dept
    ? dept.toLowerCase()
    : 'complet';
  exportToCSV(rows, headers, `inventaire_${suffix}_${todayFileDate()}.csv`);
};

// ─── Mouvements de stock ───
window.exportMouvementsCSV = (dept) => {
  const allMvt = dept === 'IT' ? fMvtIT() : fMvtFin();
  const mvt    = applyInlineFilters(allMvt, 'mouvement');

  const headers = [
    'ID', 'Date & Heure', 'Type', 'Produit', 'N° Actif (CNTO)', 'Quantité',
    'Prix unitaire (MGA)', 'Valeur totale (MGA)', 'Emplacement', 'Destination',  // ← Étape D+
    'Fournisseur', 'Réf. Document', 'Agent', 'Observation'
  ];
  const rows = mvt.map(m => [
    m.id,
    fmtDT(m.created_at || m.date),
    m.type,
    m.produit_nom,
    m.actif_id || '',                                     // ← traçabilité individuelle
    m.qty,
    m.qty > 0 ? Math.round((m.valeur || 0) / m.qty) : 0,  // ← Prix unitaire calculé
    m.valeur  || 0,
    m.emplacement || '',
    m.destination || '',
    m.fournisseur || '',
    m.ref_document || '',
    m.user_name,
    m.observation  || ''
  ]);

  exportToCSV(rows, headers, `mouvements_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};

// ─── Demandes ───
window.exportDemandesCSV = (dept) => {
  const allDem = dept === 'IT' ? fDemIT() : fDemFin();
  const dem    = applyInlineFilters(allDem, 'demande');

  const headers = [
    'ID', 'Date & Heure', 'Demandeur', 'Produit', 'Quantité',
    'Urgence', 'Destination', 'Motif', 'Statut',
    'Mis à jour', 'Validé par'
  ];
  const rows = dem.map(d => [
    d.id,
    fmtDT(d.created_at || d.date),
    d.demandeur,
    d.produit,
    d.qty,
    d.urgence || 'Normale',
    d.dest    || '',
    d.motif   || '',
    d.statut,
    fmtDT(d.updated_at),
    d.valideur || ''
  ]);

  exportToCSV(rows, headers, `demandes_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};

// ─── Historique complet ───
window.exportHistoriqueCSV = () => {
  // Reconstituer la même liste filtrée que renderHistorique()
  const allItems = [
    ...fMvtIT().map(m => ({
      ...m, src: 'Mouvement', label: m.type,
      actor: m.user_name, detail: m.observation,
      produit: m.produit_nom, dest: m.destination, dept: 'IT'
    })),
    ...fMvtFin().map(m => ({
      ...m, src: 'Mouvement', label: m.type,
      actor: m.user_name, detail: m.observation,
      produit: m.produit_nom, dest: m.destination, dept: 'Finance'
    })),
    ...fDemIT().map(d => ({
      ...d, src: 'Demande', label: d.statut,
      actor: d.demandeur, detail: d.motif,
      dest: d.dest, dept: 'IT'
    })),
    ...fDemFin().map(d => ({
      ...d, src: 'Demande', label: d.statut,
      actor: d.demandeur, detail: d.motif,
      dest: d.dest, dept: 'Finance'
    })),
  ]
    .filter(h => canSeeIT()  || h.dept !== 'IT')
    .filter(h => canSeeFin() || h.dept !== 'Finance')
    .sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date));

  const il = ST.search.inline;
  const q  = (il.query || '').toLowerCase().trim();
  const filtered = allItems.filter(h => {
    if (!q) return true;
    return matchesQuery([h.produit, h.produit_nom, h.actor, h.detail, h.dest, h.id], q);
  });

  const headers = [
    'Date & Heure', 'Département', 'Catégorie', 'Type / Statut',
    'Produit', 'Quantité', 'Emplacement / Destination', 'Acteur', 'Détail'
  ];
  const rows = filtered.map(h => [
    fmtDT(h.created_at || h.date),
    h.dept,
    h.src,
    h.label,
    h.produit || h.produit_nom || '',
    h.qty  || '',
    h.emplacement || h.dest || '',
    h.actor,
    h.detail || ''
  ]);

  exportToCSV(rows, headers, `historique_${todayFileDate()}.csv`);
};

// ─── Alertes (stock critique / rupture) ───
window.exportAlertesCSV = (dept) => {
  const al = (dept === 'IT' ? alertsIT() : alertsFin())
    .sort((a, b) => a.stock - b.stock);

  const headers = [
    'Produit', 'Catégorie', 'Emplacement',
    'Stock actuel', 'Seuil', 'Statut', 'Dernière MAJ'
  ];
  const rows = al.map(p => [
    p.nom, p.categorie, p.emplacement || '',
    p.stock, p.seuil, getStatus(p), fmtDate(p.updated_at)
  ]);

  exportToCSV(rows, headers, `alertes_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};

// ─── Utilisateurs ───
window.exportUtilisateursCSV = () => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur", 'err'); return; }

  const headers = ['Nom', 'Email', 'Rôle', 'Département', 'Statut', 'Créé le'];
  const rows = ST.allProfiles.map(u => [
    u.name,
    u.email || '',
    u.role,
    u.dept === 'both' ? 'IT + Finance' : u.dept,
    u.is_active ? 'Actif' : 'Inactif',
    fmtDT(u.created_at)
  ]);

  exportToCSV(rows, headers, `utilisateurs_${todayFileDate()}.csv`);
};

// ─── Rapports — synthèse stock par catégorie ───
// APRÈS
window.exportRapportsCSV = () => {
  const headers = [
    'Département', 'Catégorie', 'Nb produits',
    'Stock total', 'Valeur totale (MGA) — CUMP, non-amort.',
    'Produits critiques ou en rupture'
  ];
  const rows = [];

  ['IT', 'Finance'].forEach(dept => {
    const cats = [
      ...new Set(ST.produits.filter(p => p.dept === dept).map(p => p.categorie))
    ].sort();
    cats.forEach(cat => {
      const prods      = ST.produits.filter(p => p.dept === dept && p.categorie === cat);
      const stockTotal = prods.reduce((s, p) => s + p.stock, 0);
      // FIX (cohérence des prix) : ancien calcul basé sur `p.prix` (champ
      // catalogue manuel, quasi toujours à 0, jamais mis à jour par les
      // mouvements réels) — remplacé par getValeurStockActuel(), déjà utilisée
      // partout ailleurs (Dashboard, Rapports, Inventaire), basée sur le CUMP
      // réel des entrées. Renvoie 0 pour les amortissables (valorisés via les
      // actifs individuels, jamais mélangés ici).
      const valeur     = prods.reduce((s, p) => s + getValeurStockActuel(p.id), 0);
      const critiques  = prods.filter(p => getStatus(p) !== 'Disponible').length;
      rows.push([dept, cat, prods.length, stockTotal, valeur, critiques]);
    });
  });

  exportToCSV(rows, headers, `rapport_stock_${todayFileDate()}.csv`);
};

// ─── Amortissement — registre complet ───
// FIX : source basculée de ST.produits vers ST.actifs (cohérent avec le fix de
// renderAmortissement() dans reports.js) + respect des filtres dept/année de
// la page. Accessible au Lecteur (canSeeHist() l'inclut déjà).
window.exportAmortissementCSV = () => {
  if (!canSeeHist()) { showToast("Accès restreint", 'err'); return; }

  const il    = ST.search.inline;
  const deptF = il.amortDept  || '';
  const anneeF= il.amortAnnee || '';

  const actifs = getActifsAmortissablesVisibles()
    .filter(a => {
      if (deptF  && a.dept !== deptF) return false;
      if (anneeF && (a.date_achat || '').slice(0, 4) !== anneeF) return false;
      return true;
    })
    .sort((a, b) => (b.valeur_achat || 0) - (a.valeur_achat || 0));

  const headers = [
    'Département', 'Produit', 'N° CNTO', 'Catégorie', 'Emplacement',
    'Valeur acquisition (MGA)', 'Date acquisition',
    'Durée (mois)', 'Taux (%/an)', 'Dotation annuelle (MGA)',
    'VNC (MGA)', '% Amorti', 'Statut amortissement',
  ];

  const rows = actifs.map(a => {
    const vnc  = calcVNC(a);
    const pct  = amortPct(a);
    const taux = tauxLineaire(a.duree_amortissement);
    const ann  = (a.valeur_achat && a.duree_amortissement) ? Math.round(a.valeur_achat / (a.duree_amortissement / 12)) : null;
    return [
      a.dept,
      a.produit_nom || '',
      a.id,
      a.categorie           || '',
      a.emplacement         || '',
      a.valeur_achat        || 0,
      a.date_achat          || '',
      a.duree_amortissement || '',
      taux  ?? '',
      ann   ?? '',
      vnc !== null ? vnc   : '',
      pct !== null ? pct + '%' : '',
      pct === 100 ? 'Totalement amorti'
        : pct !== null && pct > 50 ? 'Partiel (>50%)'
        : pct !== null ? 'Faible (<50%)'
        : 'Non configuré',
    ];
  });

  exportToCSV(rows, headers, `amortissement_${todayFileDate()}.csv`);
};

// ─── Rapport hebdomadaire — flux de transactions (lundi → dimanche) ───
// Règle métier : date transaction = created_at || date
window.exportRapportHebdoCSV = (dept) => {
  if (!canSeeHist()) { showToast('Accès restreint', 'err'); return; }
  if (dept === 'IT'      && !canSeeIT())  { showToast('Accès restreint', 'err'); return; }
  if (dept === 'Finance' && !canSeeFin()) { showToast('Accès restreint', 'err'); return; }

  const weekStart = startOfWeekMonday(ST.weekRef || new Date());
  const weekEnd   = endOfWeekSunday(weekStart);
  const key       = weekDayKey(weekStart);
  const entry     = ST.weekFlux && ST.weekFlux[key];
  if (!entry || entry.loading || !entry.data) {
    showToast('Rapport hebdomadaire en cours de chargement — réessayez dans un instant', 'err');
    return;
  }

  const stats = computeWeekDeptStats(dept, entry, weekStart, weekEnd);
  const showP = canSeePrix();
  const showAssets = dept === 'IT' ? (canManIT() || isLecteur()) : (canManFin() || isLecteur());

  const headers = ['Section', 'ID / Réf.', 'Date', 'Type / Statut', 'Produit / Actif', 'Qté'];
  if (showP) headers.push('Valeur (MGA)');
  headers.push('Destinataire / Emprunteur', 'Fournisseur / Agent', 'Détail');

  const rows = [];
  const row = (section, id, date, type, produit, qty, valeur, dest, agent, detail) => {
    const r = [section, id || '', date || '', type || '', produit || '', qty == null ? '' : qty];
    if (showP) r.push(valeur == null ? '' : valeur);
    r.push(dest || '', agent || '', detail || '');
    return r;
  };

  rows.push([`EN-TÊTE — ${dept} — ${labelSemaine(weekStart, weekEnd)}`]);
  rows.push(['RÈGLE', 'Semaine lundi → dimanche', 'Date transaction = created_at || date']);
  rows.push([]);

  rows.push(['MOUVEMENTS']);
  [...stats.mvts]
    .sort((a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date))
    .forEach(m => rows.push(row(
      'Mouvement', m.id, fmtDT(m.created_at || m.date), m.type, m.produit_nom || '', m.qty,
      m.valeur || 0, m.destination || '', [m.fournisseur, m.user_name].filter(Boolean).join(' · '),
      [m.actif_id, m.ref_document, m.observation].filter(Boolean).join(' · ')
    )));

  rows.push([]);
  rows.push(['DEMANDES']);
  [...stats.dms]
    .sort((a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date))
    .forEach(d => rows.push(row(
      'Demande', d.id, fmtDT(d.created_at || d.date), d.statut, d.produit || '', d.qty,
      null, d.dest || '', d.demandeur || '', d.motif || ''
    )));

  if (showAssets) {
    rows.push([]);
    rows.push(['ACTIFS CRÉÉS']);
    stats.actifsCrees.forEach(a => rows.push(row(
      'Actif créé', a.id, fmtDT(a.date_entree), a.statut, a.produit_nom || '', 1,
      a.valeur_achat || 0, a.emplacement || '', '', a.categorie || ''
    )));

    rows.push([]);
    rows.push(['ACTIFS SORTIS']);
    stats.actifsSortis.forEach(a => rows.push(row(
      'Actif sorti', a.id, fmtDT(a.sortie.created_at || a.sortie.date), a.statut || 'Sorti', a.produit_nom || '', 1,
      a.sortie.valeur || a.valeur_achat || 0, '', a.sortie.user_name || '', a.categorie || ''
    )));

    const actifById = new Map((ST.actifs || []).map(a => [a.id, a]));
    const valeurPret = p => (actifById.get(getActifNumero(p)) || {}).valeur_achat || 0;

    rows.push([]);
    rows.push(['PRÊTS DÉMARRÉS']);
    stats.pretsDemarres.forEach(p => rows.push(row(
      'Prêt démarré', p.id, fmtDT(p.date_debut || p.created_at), p.statut, getActifNumero(p) || '',
      1, valeurPret(p), p.emprunteur || '', p.valideur || '', p.motif || ''
    )));

    rows.push([]);
    rows.push(['PRÊTS RENDUS']);
    stats.pretsRendus.forEach(p => rows.push(row(
      'Prêt rendu', p.id, fmtDT(p.date_retour_reelle), p.statut, getActifNumero(p) || '',
      1, valeurPret(p), p.emprunteur || '', '', p.motif || ''
    )));
  }

  // Activité par agent
  rows.push([]);
  rows.push(['ACTIVITÉ PAR AGENT']);
  if (showP) {
    rows.push(['Agent', 'Dept', 'Total', 'Entrées', 'Sorties', 'Qty entrées', 'Qty sorties', 'Valeur entrées', 'Valeur sorties']);
  } else {
    rows.push(['Agent', 'Dept', 'Total', 'Entrées', 'Sorties', 'Qty entrées', 'Qty sorties']);
  }
  const agentMap = {};
  (stats.mvts || []).forEach(m => {
    const key = (m.user_id != null && m.user_id !== '') ? `id:${m.user_id}` : `name:${m.user_name || m.agent || '—'}`;
    if (!agentMap[key]) {
      agentMap[key] = {
        agent: m.user_name || m.agent || '—',
        dept: m.dept || dept,
        total: 0, entrees: 0, sorties: 0,
        qtyEntree: 0, qtySortie: 0,
        valEntree: 0, valSortie: 0
      };
    }
    agentMap[key].total += 1;
    if (m.type === 'Entrée' || m.type === STATUS_MVT?.ENTREE) {
      agentMap[key].entrees += 1;
      agentMap[key].qtyEntree += (m.qty || 0);
      agentMap[key].valEntree += (m.valeur || 0);
    } else if (m.type === 'Sortie' || m.type === STATUS_MVT?.SORTIE) {
      agentMap[key].sorties += 1;
      agentMap[key].qtySortie += (m.qty || 0);
      agentMap[key].valSortie += (m.valeur || 0);
    }
  });
  const agentRowsArr = Object.values(agentMap).filter(x => x.total > 0).sort((a, b) => b.total - a.total);
  if (agentRowsArr.length === 0) {
    rows.push(['Aucune transaction cette semaine', '', '', '', '', '', '']);
  } else {
    agentRowsArr.forEach(a => {
      if (showP) {
        rows.push([a.agent, a.dept, a.total, a.entrees, a.sorties, a.qtyEntree, a.qtySortie, a.valEntree, a.valSortie]);
      } else {
        rows.push([a.agent, a.dept, a.total, a.entrees, a.sorties, a.qtyEntree, a.qtySortie]);
      }
    });
  }

  const fname = `rapport_hebdo_${dept.toLowerCase()}_${weekDayKey(weekStart).replace(/-/g, '')}_${weekDayKey(weekEnd).replace(/-/g, '')}.csv`;
  exportToCSV(rows, headers, fname);
};
