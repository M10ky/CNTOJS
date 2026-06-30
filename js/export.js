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
      'Valeur cumulée entrées (MGA)',  // ← Étape D+
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
        getValeurTotaleProduit(p.id),  // ← Étape D+
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
    'ID', 'Date & Heure', 'Type', 'Produit', 'Quantité',
    'Prix unitaire (MGA)', 'Valeur totale (MGA)', 'Emplacement', 'Destination',  // ← Étape D+
    'Fournisseur', 'Réf. Document', 'Agent', 'Observation'
  ];
  const rows = mvt.map(m => [
    m.id,
    fmtDT(m.created_at || m.date),
    m.type,
    m.produit_nom,
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
window.exportRapportsCSV = () => {
  const headers = [
    'Département', 'Catégorie', 'Nb produits',
    'Stock total', 'Valeur totale (MGA)',
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
      const valeur     = prods.reduce((s, p) => s + p.stock * (p.prix || 0), 0);
      const critiques  = prods.filter(p => getStatus(p) !== 'Disponible').length;
      rows.push([dept, cat, prods.length, stockTotal, valeur, critiques]);
    });
  });

  exportToCSV(rows, headers, `rapport_stock_${todayFileDate()}.csv`);
};

// ─── Amortissement — registre complet ───
window.exportAmortissementCSV = () => {
  if (!canSeeHist()) { showToast("Accès restreint à l'administrateur", 'err'); return; }

  const prods = ST.produits.filter(p =>
    p.valeur_achat > 0 && p.date_achat && p.duree_amortissement &&
    ((canSeeIT() && p.dept === 'IT') || (canSeeFin() && p.dept === 'Finance'))
  ).sort((a, b) => (b.valeur_achat || 0) - (a.valeur_achat || 0));

  const headers = [
    'Département', 'Produit', 'Catégorie', 'Emplacement',
    'Valeur achat (MGA)', 'Date achat',
    'Durée (mois)', 'Taux (%/an)', 'Dotation annuelle (MGA)',
    'VNC (MGA)', '% Amorti', 'Statut amortissement',
  ];

  const rows = prods.map(p => {
    const vnc  = calcVNC(p);
    const pct  = amortPct(p);
    const taux = tauxLineaire(p.duree_amortissement);
    const ann  = annuiteLineaire(p);
    return [
      p.dept,
      p.nom,
      p.categorie,
      p.emplacement        || '',
      p.valeur_achat       || 0,
      p.date_achat         || '',
      p.duree_amortissement|| '',
      taux                 ?? '',
      ann                  ?? '',
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