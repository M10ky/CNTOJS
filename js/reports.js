'use strict';

// ═══════════════════════════════════════════════════════════════
//   HELPERS — RAPPORTS (Point 3)
// ═══════════════════════════════════════════════════════════════

function getProduitsNonAmort() {
  return ST.produits.filter(p => !p.is_amortissable);
}
function getProduitsVisibles() {
  return ST.produits.filter(p => (canSeeIT() && p.dept === 'IT') || (canSeeFin() && p.dept === 'Finance'));
}

/** Validé / (Validé + Refusé) — "En attente" exclu du calcul, conformément à la confirmation. */
function tauxValidationGlobal(dem) {
  const valide = dem.filter(d => d.statut === 'Validé').length;
  const refuse = dem.filter(d => d.statut === 'Refusé').length;
  const total  = valide + refuse;
  return total ? Math.round(valide / total * 100) : 0;
}

/** Top N produits par quantité + valeur sortie — basé sur les mouvements de la PÉRIODE sélectionnée. */
function topProduitsDistribues(mvtSortie, n = 10) {
  const map = {};
  mvtSortie.forEach(m => {
    if (!map[m.produit_id]) map[m.produit_id] = { id: m.produit_id, nom: m.produit_nom, qty: 0, valeur: 0 };
    map[m.produit_id].qty    += (m.qty || 0);
    map[m.produit_id].valeur += (m.valeur || 0);
  });
  return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, n);
}

/** Top N produits les plus coûteux : CUMP×stock pour non-amortissables,
 *  somme des valeur_achat des actifs actifs (En service/En prêt) pour amortissables. */
function topProduitsCouteux(n = 10) {
  return getProduitsVisibles().map(p => {
    const valeur = p.is_amortissable
      ? (ST.actifs || []).filter(a => a.produit_id === p.id && (a.statut === 'En service' || a.statut === 'En prêt'))
          .reduce((s, a) => s + (a.valeur_achat || 0), 0)
      : getValeurStockActuel(p.id);
    return { nom: p.nom, dept: p.dept, valeur, amort: !!p.is_amortissable };
  }).filter(x => x.valeur > 0).sort((a, b) => b.valeur - a.valeur).slice(0, n);
}

function repartitionActifsStatut() {
  const statuts = ['En service', 'En prêt', 'Hors service', 'Sorti', 'Réformé'];
  const visibles = (ST.actifs || []).filter(a => (canManIT() && a.dept === 'IT') || (canManFin() && a.dept === 'Finance'));
  return statuts.map(s => ({ statut: s, n: visibles.filter(a => a.statut === s).length }));
}

/** Évolution de la valeur du stock (non-amortissables uniquement) sur N mois,
 *  reconstituée depuis l'historique des mouvements (Entrée:+valeur, Sortie:-valeur). */
function evolutionValeurStock(nbMois = 6) {
  const nonAmortIds = new Set(getProduitsNonAmort().filter(p => (canSeeIT() && p.dept === 'IT') || (canSeeFin() && p.dept === 'Finance')).map(p => p.id));
  const mvt = (ST.mouvements || []).filter(m => nonAmortIds.has(m.produit_id))
    .sort((a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date));
  const today = new Date();
  const months = [];
  for (let i = nbMois - 1; i >= 0; i--) months.push(new Date(today.getFullYear(), today.getMonth() - i, 1));
  return months.map(mDate => {
    const nextMonth = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 1);
    const val = mvt.filter(m => new Date(m.created_at || m.date) < nextMonth)
      .reduce((s, m) => s + (m.type === 'Entrée' ? (m.valeur || 0) : -(m.valeur || 0)), 0);
    return { label: mDate.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }), val: Math.max(0, val) };
  });
}

function produitsSansMouvement90j() {
  const seuil = new Date(); seuil.setDate(seuil.getDate() - 90);
  return getProduitsVisibles().filter(p => {
    const mvts = (ST.mouvements || []).filter(m => m.produit_id === p.id);
    if (!mvts.length) return true;
    const derniere = mvts.reduce((max, m) => { const d = new Date(m.created_at || m.date); return d > max ? d : max; }, new Date(0));
    return derniere < seuil;
  });
}

function coutMoyenSorties(mvtSortie) {
  const totalQty = mvtSortie.reduce((s, m) => s + (m.qty || 0), 0);
  const totalVal = mvtSortie.reduce((s, m) => s + (m.valeur || 0), 0);
  return totalQty ? totalVal / totalQty : 0;
}

function valeurMoyenneParCategorie() {
  const cats = {};
  getProduitsNonAmort().filter(p => (canSeeIT() && p.dept === 'IT') || (canSeeFin() && p.dept === 'Finance')).forEach(p => {
    const cat = p.categorie || '—';
    if (!cats[cat]) cats[cat] = { total: 0, n: 0 };
    cats[cat].total += getValeurStockActuel(p.id);
    cats[cat].n += 1;
  });
  return Object.entries(cats).map(([cat, { total, n }]) => ({ cat, total, n, moyenne: n ? total / n : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ═══════════════════════════════════════════════════════════════
//   HELPERS — DASHBOARD LECTEUR (vue de pilotage stratégique)
// ═══════════════════════════════════════════════════════════════

/** VNC globale + valeur brute de tous les actifs individuels "vivants"
 *  (En service + En prêt), tous départements visibles confondus. */
function getVNCGlobaleActifs() {
  const visibles = (ST.actifs || []).filter(a =>
    (a.statut === STATUS_ACTIF.EN_SERVICE || a.statut === STATUS_ACTIF.EN_PRET) &&
    ((canSeeIT() && a.dept === 'IT') || (canSeeFin() && a.dept === 'Finance'))
  );
  const brute = visibles.reduce((s, a) => s + (a.valeur_achat || 0), 0);
  const vnc   = visibles.reduce((s, a) => s + (calcVNC(a) || 0), 0);
  return { brute, vnc, amorti: brute - vnc, nb: visibles.length };
}

/** Prêts en cours / en retard valorisés via la valeur d'achat de l'actif prêté. */
function getPretsValorises() {
  const visibles = (ST.prets || []).filter(p =>
    ((canManIT() || isLecteur()) && p.dept === 'IT') ||
    ((canManFin() || isLecteur()) && p.dept === 'Finance')
  );
  const enCours  = visibles.filter(p => p.statut === STATUS_PRET.EN_COURS);
  const enRetard = visibles.filter(p => p.statut === STATUS_PRET.EN_RETARD);
  const valoriser = liste => liste.reduce((s, p) => {
    const a = (ST.actifs || []).find(x => x.id === getActifNumero(p));
    return s + (a?.valeur_achat || 0);
  }, 0);
  const retard30 = enRetard.filter(p => {
    if (!p.date_retour_prevue) return false;
    const jours = Math.ceil((new Date() - new Date(p.date_retour_prevue)) / 86400000);
    return jours > 30;
  });
  return {
    enCours: enCours.length, enRetard: enRetard.length,
    valeurEnCours: valoriser(enCours), valeurEnRetard: valoriser(enRetard),
    retard30: retard30.length,
  };
}

/** Taux de rotation approximatif : valeur des sorties (période) / valeur du stock actuel
 *  (non-amortissables uniquement — même périmètre que getValeurStockActuel). */
function getTauxRotationStock() {
  const nonAmortIds = new Set(
    getProduitsNonAmort()
      .filter(p => (canSeeIT() && p.dept === 'IT') || (canSeeFin() && p.dept === 'Finance'))
      .map(p => p.id)
  );
  const sortiesVal = [...fMvtIT(), ...fMvtFin()]
    .filter(m => m.type === 'Sortie' && nonAmortIds.has(m.produit_id))
    .reduce((s, m) => s + (m.valeur || 0), 0);
  const stockVal = getProduitsVisibles().filter(p => !p.is_amortissable)
    .reduce((s, p) => s + getValeurStockActuel(p.id), 0);
  return stockVal > 0 ? Math.round((sortiesVal / stockVal) * 100) / 100 : 0;
}

/** Top N catégories les plus valorisées — stock CUMP (non-amort.) + VNC (amortissables). */
function getTopCategoriesValorisees(n = 5) {
  const map = {};
  getProduitsVisibles().filter(p => !p.is_amortissable).forEach(p => {
    const cat = p.categorie || '—';
    map[cat] = (map[cat] || 0) + getValeurStockActuel(p.id);
  });
  (ST.actifs || [])
    .filter(a => (a.statut === 'En service' || a.statut === 'En prêt') &&
      ((canSeeIT() && a.dept === 'IT') || (canSeeFin() && a.dept === 'Finance')))
    .forEach(a => {
      const cat = a.categorie || '—';
      map[cat] = (map[cat] || 0) + (calcVNC(a) || 0);
    });
  return Object.entries(map).map(([cat, val]) => ({ cat, val }))
    .sort((a, b) => b.val - a.val).slice(0, n);
}

/** Répartition des actifs individuels par état, départements visibles confondus. */
function getRepartitionActifsEtat() {
  const visibles = (ST.actifs || []).filter(a => (canSeeIT() && a.dept === 'IT') || (canSeeFin() && a.dept === 'Finance'));
  return {
    enService:   visibles.filter(a => a.statut === 'En service').length,
    enPret:      visibles.filter(a => a.statut === 'En prêt').length,
    horsService: visibles.filter(a => a.statut === 'Hors service').length,
    reforme:     visibles.filter(a => a.statut === 'Réformé').length,
    sorti:       visibles.filter(a => a.statut === 'Sorti').length,
  };
}

/** Alertes majeures consolidées pour le pilotage. */
function getAlertesMajeures() {
  const ruptures = [...alertsIT(), ...alertsFin()].filter(p => p.stock === 0);
  const { retard30 } = getPretsValorises();
  return { ruptures: ruptures.length, retard30 };
}

/** Actifs amortissables "exploitables" (données complètes), visibles pour l'utilisateur courant. */
function getActifsAmortissablesVisibles() {
  return (ST.actifs || []).filter(a =>
    a.valeur_achat > 0 && a.date_achat && a.duree_amortissement &&
    ((canSeeIT() && a.dept === 'IT') || (canSeeFin() && a.dept === 'Finance'))
  );
}

// ─── Filtres dédiés à la page Amortissement ────────────────────
window.setAmortDeptFilter  = (val) => { ST.search.inline.amortDept  = val; render(); };
window.setAmortAnneeFilter = (val) => { ST.search.inline.amortAnnee = val; render(); };

// ═══ DASHBOARD ═══
function renderDashboard() {
  // Point 1 : valeur du stock global = stock actuel × CUMP, produits non
  // amortissables uniquement (les amortissables sont valorisés via leur VNC
  // dans le module Actifs — jamais mélangés ici).
  const vIT=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+getValeurStockActuel(p.id),0);
  const vFin=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+getValeurStockActuel(p.id),0);
  const alIT=alertsIT().length, alFin=alertsFin().length;
  const showP=canSeePrix();
  const kpis=[];
  if (canSeeIT())  kpis.push(showP?{lbl:'Valeur Stock IT',val:fmt(vIT)+' MGA',s:`${ST.produits.filter(p=>p.dept==='IT').length} réf.`,c:'#4f46e5'}:{lbl:'Produits IT',val:ST.produits.filter(p=>p.dept==='IT').length,s:'références',c:'#4f46e5'});
  if (canSeeFin()) kpis.push(showP?{lbl:'Valeur Stock Finance',val:fmt(vFin)+' MGA',s:`${ST.produits.filter(p=>p.dept==='Finance').length} réf.`,c:'#10b981'}:{lbl:'Produits Finance',val:ST.produits.filter(p=>p.dept==='Finance').length,s:'références',c:'#10b981'});
  if (canManIT())  kpis.push({lbl:'Alertes IT',val:alIT,s:alIT>0?'⚠ à traiter':'✓ Niveaux OK',c:alIT>0?'#ef4444':'#22c55e'});
  if (canManFin()) kpis.push({lbl:'Alertes Finance',val:alFin,s:alFin>0?'⚠ à traiter':'✓ Niveaux OK',c:alFin>0?'#ef4444':'#22c55e'});
  if (canManIT())  kpis.push({lbl:'Demandes IT en attente',val:attenteIT(),s:'à traiter',c:'#f59e0b'});
  if (canManFin()) kpis.push({lbl:'Demandes Finance en attente',val:attenteFin(),s:'à traiter',c:'#f59e0b'});
  const allMvt=[...fMvtIT(),...fMvtFin()].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);
  const mvtRows=allMvt.map(m=>`<tr>
    <td>${fmtDTSplit(m.created_at||m.date)}</td>
    <td>${deptTag(m.dept)}</td>
    <td>${typeBadge(m.type)}</td>
    <td style="font-weight:500;font-size:12.5px">${m.produit_nom}${m.actif_id ? `<br><code class="actif-id" style="margin-top:2px;display:inline-block">${m.actif_id}</code>` : ''}</td>
    <td style="font-weight:700">${m.qty}</td>
    <td style="font-size:11px;color:var(--text2)">${m.emplacement||'—'}</td>
    <td style="font-size:11px;color:var(--text2)">${m.destination||'—'}</td>
    <td style="font-size:11px;color:var(--text3)">${m.user_name}</td>
  </tr>`).join('');
    const infoBanner=(!showP||!canSeeHist())?`<div class="info-banner"><i class="ti ti-info-circle"></i><div>Vous consultez en <strong>mode lecture</strong>. Pour demander du matériel, utilisez la section <strong>Demandes</strong>.</div></div>`:'';

  // ═══════════════════════════════════════════════════════════════
  //   BLOC STRATÉGIQUE — RÔLE LECTEUR (PDG / Direction Finance)
  //   Consolidation IT + Finance, lecture seule, orienté pilotage.
  // ═══════════════════════════════════════════════════════════════
  let lecteurBlock = '';
  if (isLecteur()) {
    const { brute: vncBrute, vnc: vncGlobale, nb: nbActifsAmort } = getVNCGlobaleActifs();
    const pretsInfo  = getPretsValorises();
    const rotation   = getTauxRotationStock();
    const etatActifs = getRepartitionActifsEtat();
    const topCats    = getTopCategoriesValorisees(5);
    const alertesMaj = getAlertesMajeures();
    const valeurStockTotal = vIT + vFin;

    const lecteurKpis = [
      { lbl:'Valeur Totale Stock (IT+Fin)',        val:fmt(valeurStockTotal)+' MGA', s:'stock non-amortissable (CUMP)',                 c:'#0ea5e9' },
      { lbl:'VNC Globale Actifs Amortissables',     val:fmt(vncGlobale)+' MGA',       s:`sur ${fmt(vncBrute)} MGA d'acquisition · ${nbActifsAmort} actif(s)`, c:'#4f46e5' },
      { lbl:'Taux de rotation du stock',            val:rotation,                     s:'sorties valorisées / stock (période)',           c:'#f59e0b' },
      { lbl:'Actifs En service',                    val:etatActifs.enService,         s:`${etatActifs.enPret} actuellement en prêt`,      c:'#10b981' },
      { lbl:'Actifs HS / Réformés',                 val:etatActifs.horsService+etatActifs.reforme, s:`${etatActifs.horsService} HS · ${etatActifs.reforme} réformé(s)`, c:'#94a3b8' },
      { lbl:'Prêts en cours',                       val:pretsInfo.enCours,            s:`${fmt(pretsInfo.valeurEnCours)} MGA valorisés`,  c:'#3b82f6' },
      { lbl:'Prêts en retard',                      val:pretsInfo.enRetard,           s:`${fmt(pretsInfo.valeurEnRetard)} MGA valorisés`, c:pretsInfo.enRetard>0?'#ef4444':'#22c55e' },
    ];

    const alertBanner = (alertesMaj.ruptures>0 || alertesMaj.retard30>0)
      ? `<div class="info-banner" style="background:#fef2f2;border-color:#fecaca;color:#dc2626;margin-bottom:14px">
          <i class="ti ti-alert-triangle" style="color:#dc2626"></i>
          <div>
            ${alertesMaj.ruptures>0?`<strong>${alertesMaj.ruptures}</strong> produit(s) en rupture critique. `:''}
            ${alertesMaj.retard30>0?`<strong>${alertesMaj.retard30}</strong> prêt(s) en retard de plus de 30 jours.`:''}
          </div>
        </div>` : '';

    const topCatRows = topCats.map((c,i)=>`<tr>
      <td style="font-weight:700;color:var(--text3)">#${i+1}</td>
      <td style="font-weight:600">${c.cat}</td>
      <td style="font-weight:800;color:#4f46e5">${fmt(c.val)} MGA</td>
    </tr>`).join('') || `<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:14px">Aucune donnée</td></tr>`;

    lecteurBlock = `
      <div class="info-banner" style="background:linear-gradient(135deg,#eef2ff,#f0fdf9);border-color:#c7d2fe;color:#3730a3;margin-bottom:14px">
        <i class="ti ti-chart-infographic" style="color:#4f46e5"></i>
        <div><strong>Vue de pilotage stratégique.</strong> Synthèse consolidée IT + Finance — lecture seule.</div>
      </div>
      ${alertBanner}
      <div class="kpi-grid">${lecteurKpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s||''}</div></div>`).join('')}</div>
      <div class="charts-grid">
        <div class="chart-card"><div class="chart-ttl">Évolution de la valeur du stock (12 mois)</div><div class="bar-chart-wrap"><canvas id="chart-lecteur-evol"></canvas></div></div>
        <div class="chart-card"><div class="chart-ttl">Répartition IT vs Finance (valeur totale, M MGA)</div><div class="bar-chart-wrap"><canvas id="chart-lecteur-repart"></canvas></div></div>
      </div>
      <div class="charts-grid">
        <div class="chart-card"><div class="chart-ttl">Actifs individuels par état</div><div class="bar-chart-wrap"><canvas id="chart-lecteur-etat-actifs"></canvas></div></div>
        <div class="card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:0">
          <div class="card-hd"><span class="card-ttl"><i class="ti ti-trophy" style="color:#f59e0b"></i>Top 5 catégories les plus valorisées</span></div>
          <div style="overflow-x:auto"><table>
            <thead><tr><th>Rang</th><th>Catégorie</th><th>Valeur</th></tr></thead>
            <tbody>${topCatRows}</tbody>
          </table></div>
        </div>
      </div>`;
  }

  return `<p class="page-title">Tableau de Bord</p>
    <p class="page-sub">${new Date().toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
    ${infoBanner}
    ${lecteurBlock}
    <div class="kpi-grid">${kpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s||''}</div></div>`).join('')}</div>
    ${canSeeHist()?`
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Mouvements par jour (période)</div><div class="bar-chart-wrap"><canvas id="chart-mvt"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Répartition valeur stock (M MGA)</div><div class="bar-chart-wrap"><canvas id="chart-pie"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-activity" style="color:var(--teal)"></i>Activités récentes (10 derniers mouvements)</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['Date & Heure','Dépt','Type','Produit','Qté','Emplacement','Destination','Agent'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${mvtRows||'<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">Aucun mouvement sur la période</td></tr>'}</tbody>
      </table></div></div>`:''}`;
}

// ── RAPPORTS — TABLEAU DE BORD DÉCISIONNEL (Point 3) ──
function renderRapports() {
  const prodsVisibles = getProduitsVisibles();
  const vIT  = ST.produits.filter(p => p.dept === 'IT').reduce((s, p) => s + getValeurStockActuel(p.id), 0);
  const vFin = ST.produits.filter(p => p.dept === 'Finance').reduce((s, p) => s + getValeurStockActuel(p.id), 0);

  const mvtPeriode  = [...fMvtIT(), ...fMvtFin()];
  const entreesP    = mvtPeriode.filter(m => m.type === 'Entrée');
  const sortiesP    = mvtPeriode.filter(m => m.type === 'Sortie');
  const valEntreesP = entreesP.reduce((s, m) => s + (m.valeur || 0), 0);
  const valSortiesP = sortiesP.reduce((s, m) => s + (m.valeur || 0), 0);

  const demVisibles  = [...fDemIT(), ...fDemFin()];
  const tauxValid    = tauxValidationGlobal(demVisibles);
  const nbAttente    = demVisibles.filter(d => d.statut === 'En attente').length;

  const nbProduits   = prodsVisibles.length;
  const nbUnites     = prodsVisibles.reduce((s, p) => s + (p.stock || 0), 0);
  const nbCritiques  = alertsIT().length + alertsFin().length;
  const nbAmort      = prodsVisibles.filter(p => p.is_amortissable).length;

  // ── KPIs ──────────────────────────────────────────────────
  const kpis = [
    { lbl: 'Valeur Stock IT',            val: fmt(vIT) + ' MGA',        s: 'Non-amortissables (CUMP)', c: '#4f46e5' },
    { lbl: 'Valeur Stock Finance',       val: fmt(vFin) + ' MGA',       s: 'Non-amortissables (CUMP)', c: '#10b981' },
    { lbl: 'Produits (total)',           val: nbProduits,               s: `${nbAmort} amortissable(s)`, c: '#64748b' },
    { lbl: 'Unités en stock',            val: fmt(nbUnites),            s: 'toutes références',        c: '#0ea5e9' },
    { lbl: 'Mouvements (période)',       val: mvtPeriode.length,        s: `${entreesP.length} entrée(s) · ${sortiesP.length} sortie(s)`, c: '#6366f1' },
    { lbl: 'Valeur Entrées (période)',   val: fmt(valEntreesP) + ' MGA',s: 'coût d\'acquisition',      c: '#16a34a' },
    { lbl: 'Valeur Sorties (période)',   val: fmt(valSortiesP) + ' MGA',s: 'valorisées au CUMP',       c: '#dc2626' },
    { lbl: 'Produits critiques',         val: nbCritiques,              s: 'sous seuil ou rupture',    c: '#ef4444' },
    { lbl: 'Produits amortissables',     val: nbAmort,                  s: 'suivi individuel actif',   c: '#7c3aed' },
    { lbl: 'Demandes en attente',        val: nbAttente,                s: 'à traiter',                c: '#f59e0b' },
    { lbl: 'Taux de validation',         val: tauxValid + '%',          s: 'Validé / (Validé+Refusé)', c: '#f59e0b' },
  ];

  // ── Analyse détaillée ───────────────────────────────────────
  const valMoyCat   = valeurMoyenneParCategorie();
  const coutMoySortie= coutMoyenSorties(sortiesP);
  const sansMvt      = produitsSansMouvement90j();
  const dernieres    = [...mvtPeriode].sort((a,b)=>new Date(b.created_at||b.date)-new Date(a.created_at||a.date)).slice(0,8);
  const nbActifsProd = prodsVisibles.filter(p=>isActif(p)).length;
  const nbInactifsProd = nbProduits - nbActifsProd;

  const catMoyRows = valMoyCat.slice(0,8).map(c => `<tr>
    <td style="font-weight:600">${c.cat}</td>
    <td style="color:var(--text3)">${c.n}</td>
    <td style="font-weight:700">${fmt(c.total)} MGA</td>
    <td>${fmt(Math.round(c.moyenne))} MGA</td>
  </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">Aucune donnée</td></tr>`;

  const sansMvtRows = sansMvt.slice(0,10).map(p => `<tr>
    <td>${deptTag(p.dept)}</td>
    <td style="font-weight:600">${p.nom}</td>
    <td><span class="tag" style="color:#475569;background:#f1f5f9">${p.categorie}</span></td>
    <td style="color:var(--text3)">${p.stock}</td>
  </tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">Aucun produit dormant</td></tr>`;

  const dernieresRows = dernieres.map(m => `<tr>
    <td>${fmtDTSplit(m.created_at||m.date)}</td>
    <td>${deptTag(m.dept)}</td>
    <td>${typeBadge(m.type)}</td>
    <td style="font-weight:500">${m.produit_nom}</td>
    <td style="font-weight:700">${m.qty}</td>
    <td style="font-weight:700">${fmt(m.valeur)} MGA</td>
  </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">Aucun mouvement sur la période</td></tr>`;

  return `<p class="page-title">Rapports & Statistiques</p>
    <p class="page-sub">Tableau de bord décisionnel — période sélectionnée</p>

    <div class="kpi-grid">${kpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s||''}</div></div>`).join('')}</div>

    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Valeur du stock par catégorie (non-amortissables)</div><div class="bar-chart-wrap"><canvas id="chart-rap-cat-valeur"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Entrées vs Sorties — 6 derniers mois</div><div class="bar-chart-wrap"><canvas id="chart-rap-evol-mensuel"></canvas></div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Top 10 produits les plus distribués (période)</div><div class="bar-chart-wrap"><canvas id="chart-rap-top-distrib"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Top 10 produits les plus coûteux</div><div class="bar-chart-wrap"><canvas id="chart-rap-top-couteux"></canvas></div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">Actifs amortissables par statut</div><div class="bar-chart-wrap"><canvas id="chart-rap-actifs-statut"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Évolution de la valeur du stock (6 mois)</div><div class="bar-chart-wrap"><canvas id="chart-rap-evol-valeur"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-chart-bar" style="color:var(--teal)"></i>Analyse détaillée</span></div>
      <div style="padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;border-bottom:1px solid var(--border)">
        <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700">Coût moyen des sorties</div><div style="font-size:18px;font-weight:800;margin-top:4px">${fmt(Math.round(coutMoySortie))} MGA</div></div>
        <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700">Produits actifs / inactifs</div><div style="font-size:18px;font-weight:800;margin-top:4px">${nbActifsProd} / ${nbInactifsProd}</div></div>
        <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:700">Produits sans mouvement &gt;90j</div><div style="font-size:18px;font-weight:800;margin-top:4px;color:${sansMvt.length?'#f59e0b':'#16a34a'}">${sansMvt.length}</div></div>
      </div>
      <div style="padding:16px;border-bottom:1px solid var(--border)">
        <div class="chart-ttl" style="margin-bottom:8px">Valeur moyenne par catégorie</div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Catégorie</th><th>Nb produits</th><th>Valeur totale</th><th>Valeur moyenne</th></tr></thead>
          <tbody>${catMoyRows}</tbody>
        </table></div>
      </div>
      <div style="padding:16px;border-bottom:1px solid var(--border)">
        <div class="chart-ttl" style="margin-bottom:8px">Produits sans mouvement depuis plus de 90 jours</div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Dépt</th><th>Produit</th><th>Catégorie</th><th>Stock</th></tr></thead>
          <tbody>${sansMvtRows}</tbody>
        </table></div>
      </div>
      <div style="padding:16px">
        <div class="chart-ttl" style="margin-bottom:8px">Dernières entrées / sorties (période)</div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Date & Heure</th><th>Dépt</th><th>Type</th><th>Produit</th><th>Qté</th><th>Valeur</th></tr></thead>
          <tbody>${dernieresRows}</tbody>
        </table></div>
      </div>
    </div>`;
}

// ── AMORTISSEMENT ──
// FIX (bug "0 0 0 0") : cette page se basait sur ST.produits (champs catalogue
// valeur_achat/date_achat/duree_amortissement), quasi toujours vides depuis
// l'introduction des actifs individuels — chaque unité a désormais SON PROPRE
// prix/date/durée dans ST.actifs. La page est reconstruite sur ST.actifs,
// seule source de vérité réelle pour l'amortissement, + filtres dept/année,
// totaux en pied de tableau, et lecture seule pour le rôle Lecteur.
function renderAmortissement() {
  const il     = ST.search.inline;
  const deptF  = il.amortDept  || '';
  const anneeF = il.amortAnnee || '';

  const allActifs = getActifsAmortissablesVisibles();
  const annees = [...new Set(allActifs.map(a => (a.date_achat || '').slice(0, 4)).filter(Boolean))].sort((a, b) => b - a);

  const filtered = allActifs.filter(a => {
    if (deptF  && a.dept !== deptF) return false;
    if (anneeF && (a.date_achat || '').slice(0, 4) !== anneeF) return false;
    return true;
  });

  const sansAmort = (ST.actifs || [])
    .filter(a => (canSeeIT() && a.dept === 'IT') || (canSeeFin() && a.dept === 'Finance'))
    .filter(a => !a.valeur_achat || !a.date_achat || !a.duree_amortissement);

  const totalAchat = filtered.reduce((s, a) => s + (a.valeur_achat || 0), 0);
  const totalVNC   = filtered.reduce((s, a) => s + (calcVNC(a) || 0), 0);
  const totalAmort = totalAchat - totalVNC;
  const nbExpires  = filtered.filter(a => calcVNC(a) === 0).length;

  const kpis = [
    { lbl:'Valeur Acquisition Totale',  val:fmt(totalAchat)+' MGA', s:`${filtered.length} actif(s)`, c:'#4f46e5' },
    { lbl:'VNC Actuelle Totale',        val:fmt(totalVNC)+' MGA',   s:'Valeur nette comptable',      c:'#10b981' },
    { lbl:'Amortissement Cumulé',       val:fmt(totalAmort)+' MGA', s:filtered.length?`${Math.round(totalAmort/totalAchat*100)}% de la valeur initiale`:'—', c:'#f59e0b' },
    { lbl:'Actifs Totalement Amortis',  val:nbExpires,              s:'VNC nulle',                   c:'#ef4444' },
  ];

  const filterBar = `
    <div class="content-search-bar" style="margin-bottom:12px">
      <div class="csb-row csb-row-filters" style="padding:10px 14px">
        <div class="csb-chip-group">
          <span class="csb-filter-label">Dépt</span>
          <span class="csb-pill${deptF==='IT'?' on-it on':''}" onclick="setAmortDeptFilter('${deptF==='IT'?'':'IT'}')">IT</span>
          <span class="csb-pill${deptF==='Finance'?' on-fin on':''}" onclick="setAmortDeptFilter('${deptF==='Finance'?'':'Finance'}')">Finance</span>
        </div>
        <div class="csb-chip-group">
          <label class="csb-filter-label" for="amort-annee-sel">Année d'acquisition</label>
          <select id="amort-annee-sel" class="csb-cat-select" onchange="setAmortAnneeFilter(this.value)">
            <option value="" ${!anneeF?'selected':''}>Toutes années</option>
            ${annees.map(y=>`<option value="${y}" ${anneeF===y?'selected':''}>${y}</option>`).join('')}
          </select>
        </div>
        ${(deptF||anneeF) ? `<button class="csb-reset" onclick="setAmortDeptFilter('');setAmortAnneeFilter('')"><i class="ti ti-refresh" style="font-size:11px"></i> Réinitialiser</button>` : ''}
      </div>
    </div>`;

  const rows = filtered.sort((a, b) => (b.valeur_achat || 0) - (a.valeur_achat || 0)).map(a => {
    const vnc = calcVNC(a); const pct = amortPct(a) || 0; const c = amortColor(pct);
    const taux = tauxLineaire(a.duree_amortissement);
    const annuite = (a.valeur_achat && a.duree_amortissement) ? Math.round(a.valeur_achat / (a.duree_amortissement / 12)) : null;
    return `<tr>
      <td>${deptTag(a.dept)}</td>
      <td><div style="font-weight:600">${a.produit_nom || '—'}</div><code class="actif-id" style="margin-top:2px;display:inline-block">${a.id}</code></td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${a.categorie || '—'}</span></td>
      <td><span class="tag" style="color:#1e40af;background:#dbeafe">${a.emplacement || '—'}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(a.valeur_achat)} MGA</td>
      <td style="font-size:11px;color:var(--text3)">${fmtDate(a.date_achat)}</td>
      <td style="font-size:11px;color:var(--text3)">${(a.duree_amortissement/12).toFixed(1)}a · <strong>${taux}%/an</strong></td>
      <td style="font-size:11px;color:var(--text3)">${annuite?fmt(annuite)+' MGA/an':'—'}</td>
      <td>
        <div style="font-weight:700;color:${c}">${vnc===0?'<span class="tag" style="color:#dc2626;background:#fef2f2">Totalement amorti</span>':fmt(vnc)+' MGA'}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
          <div class="amort-bar" style="width:90px"><div class="amort-fill" style="width:${pct}%;background:${c}"></div></div>
          <span style="font-size:10px;color:${c};font-weight:700">${pct}%</span>
        </div>
      </td>
      <td>${isLecteur() ? btn('🕘', '#6366f1', true, `openActifHistorique('${a.id}')`) : btn('✏', '#64748b', true, `openEditActif('${a.id}')`)}</td>
    </tr>`;
  }).join('');

  const totalsFooterRow = filtered.length ? `<tr style="background:#f8fafc;font-weight:800">
    <td colspan="4" style="text-align:right">TOTAUX</td>
    <td style="font-family:var(--mono)">${fmt(totalAchat)} MGA</td>
    <td></td><td></td>
    <td style="font-size:11px">${fmt(totalAmort)} MGA amorti</td>
    <td>${fmt(totalVNC)} MGA</td>
    <td></td>
  </tr>` : '';

  const noAmortRows = sansAmort.slice(0, 5).map(a => `<tr>
    <td>${deptTag(a.dept)}</td>
    <td style="font-weight:500">${a.produit_nom || '—'} <code class="actif-id">${a.id}</code></td>
    <td><span class="tag" style="color:#475569;background:#f1f5f9">${a.categorie || '—'}</span></td>
    <td>${isLecteur() ? '<span style="color:var(--text3);font-size:11px">—</span>' : btn('Configurer', '#4f46e5', true, `openEditActif('${a.id}')`)}</td>
  </tr>`).join('');

  return `<p class="page-title">Amortissement Linéaire des Actifs</p>
    <p class="page-sub">Valeur nette comptable (VNC) — Méthode linéaire, calculée actif par actif</p>
    <div class="info-banner" style="background:#fffbeb;border-color:#fcd34d;color:#92400e">
      <i class="ti ti-info-circle" style="color:#f59e0b"></i>
      <div><strong>Méthode linéaire :</strong> L'actif perd une valeur égale chaque année. Taux annuel = 100% / Durée en années.</div>
    </div>
    <div class="kpi-grid">${kpis.map(k=>`<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s}</div></div>`).join('')}</div>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV Amortissement', '#10b981', true, 'exportAmortissementCSV()', 'ti-download')}
    </div>
    ${filterBar}
    ${filtered.length ? `
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-ttl">VNC vs Valeur initiale — Top 8 actifs</div><div class="bar-chart-wrap"><canvas id="chart-amort"></canvas></div></div>
      <div class="chart-card"><div class="chart-ttl">Répartition par statut d'amortissement</div><div class="bar-chart-wrap"><canvas id="chart-amort-pie"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-chart-line" style="color:var(--teal)"></i>Registre des amortissements (${filtered.length} actif(s))</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['Dépt','Actif','Catégorie','Emplacement','Valeur Acquisition','Date Acquisition','Durée · Taux','Dotation/an','VNC · Avanc.','Action'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows}${totalsFooterRow}</tbody>
      </table></div>
    </div>` : `<div class="card"><div class="empty-state"><div class="empty-ico">📉</div><div style="font-size:14px;font-weight:700;color:var(--text)">Aucun actif amortissable ne correspond aux filtres</div></div></div>`}
    ${sansAmort.length ? `
    <div class="card" style="border-left:3px solid #f59e0b">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-alert-triangle" style="color:#f59e0b"></i>${sansAmort.length} actif(s) sans données d'amortissement complètes</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Dépt</th><th>Actif</th><th>Catégorie</th><th>Action</th></tr></thead>
        <tbody>${noAmortRows}${sansAmort.length>5?`<tr><td colspan="4" style="text-align:center;color:var(--text3);font-size:11px">… et ${sansAmort.length-5} autres</td></tr>`:''}</tbody>
      </table></div>
    </div>` : ''}`;
}

// ═══ GRAPHIQUES ═══
function drawCharts() {
  Object.values(Chart.instances||{}).forEach(c=>c.destroy());
  const gc='#e2e8f0', tc='#94a3b8';
  const baseOpts={ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} };
  if (document.getElementById('chart-mvt')) {
    const mvtAll=[...fMvtIT(),...fMvtFin()];
    const dates=[...new Set(mvtAll.map(m=>(m.created_at||m.date).slice(0,10)))].sort().slice(-8);
    new Chart(document.getElementById('chart-mvt'),{type:'bar',data:{labels:dates.map(d=>new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})),datasets:[{label:'Entrées',data:dates.map(d=>mvtAll.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Entrée').reduce((s,m)=>s+m.qty,0)),backgroundColor:'#10b981',borderRadius:4},{label:'Sorties',data:dates.map(d=>mvtAll.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Sortie').reduce((s,m)=>s+m.qty,0)),backgroundColor:'#ef4444',borderRadius:4}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-pie')) {
    const vIT=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+getValeurStockActuel(p.id),0);
    const vFin=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+getValeurStockActuel(p.id),0);
    const data=[],labels=[],colors=[];
    if (canSeeIT())  { data.push(Math.round(vIT/1e6));  labels.push('IT');      colors.push('#4f46e5'); }
    if (canSeeFin()) { data.push(Math.round(vFin/1e6)); labels.push('Finance'); colors.push('#10b981'); }
    new Chart(document.getElementById('chart-pie'),{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:9}},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.raw}M MGA`}}}}});
  }
  if (document.getElementById('chart-cat-it')) {
    const cats={};ST.produits.filter(p=>p.dept==='IT').forEach(p=>{cats[p.categorie]=(cats[p.categorie]||0)+p.stock;});
    const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,8);
    new Chart(document.getElementById('chart-cat-it'),{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>v),backgroundColor:'#4f46e5',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-cat-fin')) {
    const cats={};ST.produits.filter(p=>p.dept==='Finance').forEach(p=>{cats[p.categorie]=(cats[p.categorie]||0)+p.stock;});
    const sorted=Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,8);
    new Chart(document.getElementById('chart-cat-fin'),{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>v),backgroundColor:'#10b981',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-empl')) {
    const byEmpl={};ST.produits.forEach(p=>{const e=p.emplacement||'Non défini';byEmpl[e]=(byEmpl[e]||0)+getValeurTotaleProduit(p.id);});
    const sorted=Object.entries(byEmpl).sort((a,b)=>b[1]-a[1]).slice(0,5);
    new Chart(document.getElementById('chart-empl'),{type:'bar',data:{labels:sorted.map(([k])=>k),datasets:[{data:sorted.map(([,v])=>Math.round(v/1e6*100)/100),backgroundColor:'#6366f1',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9},callback:v=>v+'M'},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-mvt-30')) {
    const today=new Date();const days=[];
    for(let i=29;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);days.push(d.toISOString().split('T')[0]);}
    const all=[...ST.mouvements];
    new Chart(document.getElementById('chart-mvt-30'),{type:'line',data:{labels:days.map(d=>{const x=new Date(d);return `${x.getDate()}/${x.getMonth()+1}`;}),datasets:[{label:'Entrées',data:days.map(d=>all.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Entrée').reduce((s,m)=>s+m.qty,0)),borderColor:'#10b981',tension:.35,fill:false,pointRadius:2},{label:'Sorties',data:days.map(d=>all.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Sortie').reduce((s,m)=>s+m.qty,0)),borderColor:'#ef4444',tension:.35,fill:false,pointRadius:2}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:8},maxTicksLimit:10},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{color:gc}}}}});
  }
  // FIX : ces deux graphiques utilisent désormais ST.actifs (source réelle des
  // données d'amortissement) au lieu de ST.produits — cohérent avec le fix de
  // renderAmortissement() ci-dessus. Respectent les mêmes filtres dept/année.
  if (document.getElementById('chart-amort')) {
    const ilA = ST.search.inline;
    const deptF = ilA.amortDept || '', anneeF = ilA.amortAnnee || '';
    const actifsA = getActifsAmortissablesVisibles().filter(a => {
      if (deptF && a.dept !== deptF) return false;
      if (anneeF && (a.date_achat||'').slice(0,4) !== anneeF) return false;
      return true;
    }).sort((a,b)=>(b.valeur_achat||0)-(a.valeur_achat||0)).slice(0,8);
    new Chart(document.getElementById('chart-amort'),{type:'bar',data:{labels:actifsA.map(a=>(a.produit_nom||a.id).slice(0,14)),datasets:[{label:'Valeur acquisition',data:actifsA.map(a=>Math.round((a.valeur_achat||0)/1e6*100)/100),backgroundColor:'#e0e7ff',borderRadius:3},{label:'VNC',data:actifsA.map(a=>Math.round((calcVNC(a)||0)/1e6*100)/100),backgroundColor:'#4f46e5',borderRadius:3}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:8}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9},callback:v=>v+'M'},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-amort-pie')) {
    const ilA = ST.search.inline;
    const deptF = ilA.amortDept || '', anneeF = ilA.amortAnnee || '';
    const w = getActifsAmortissablesVisibles().filter(a => {
      if (deptF && a.dept !== deptF) return false;
      if (anneeF && (a.date_achat||'').slice(0,4) !== anneeF) return false;
      return true;
    });
    const fully=w.filter(a=>calcVNC(a)===0).length;
    const partial=w.filter(a=>{const pct=amortPct(a);return pct!==null&&pct>50&&pct<100;}).length;
    const low=w.filter(a=>{const pct=amortPct(a);return pct!==null&&pct<=50;}).length;
    new Chart(document.getElementById('chart-amort-pie'),{type:'doughnut',data:{labels:['Faible <50%','Partiel 50–99%','Totalement amorti'],datasets:[{data:[low,partial,fully],backgroundColor:['#10b981','#f59e0b','#ef4444'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:9}}}}});
  }

  // ═══ NOUVEAUX GRAPHIQUES — DASHBOARD LECTEUR ═══
  if (document.getElementById('chart-lecteur-evol')) {
    const serie = evolutionValeurStock(12);
    new Chart(document.getElementById('chart-lecteur-evol'),{type:'line',data:{labels:serie.map(s=>s.label),datasets:[{label:'Valeur stock (MGA)',data:serie.map(s=>Math.round(s.val/1e3)),borderColor:'#4f46e5',backgroundColor:'rgba(79,70,229,.1)',tension:.35,fill:true,pointRadius:3}]},options:{...baseOpts,plugins:{legend:{display:false}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9},callback:v=>v+'K'},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-lecteur-repart')) {
    const vITTot  = ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+getValeurStockActuel(p.id),0)
      + (ST.actifs||[]).filter(a=>a.dept==='IT'&&(a.statut==='En service'||a.statut==='En prêt')).reduce((s,a)=>s+(calcVNC(a)||0),0);
    const vFinTot = ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+getValeurStockActuel(p.id),0)
      + (ST.actifs||[]).filter(a=>a.dept==='Finance'&&(a.statut==='En service'||a.statut==='En prêt')).reduce((s,a)=>s+(calcVNC(a)||0),0);
    new Chart(document.getElementById('chart-lecteur-repart'),{type:'bar',data:{labels:['IT','Finance'],datasets:[{data:[Math.round(vITTot/1e6*100)/100,Math.round(vFinTot/1e6*100)/100],backgroundColor:['#4f46e5','#10b981'],borderRadius:4}]},options:{...baseOpts,scales:{x:{ticks:{color:tc,font:{size:10}},grid:{display:false}},y:{ticks:{color:tc,font:{size:9},callback:v=>v+'M'},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-lecteur-etat-actifs')) {
    const etat = getRepartitionActifsEtat();
    new Chart(document.getElementById('chart-lecteur-etat-actifs'),{type:'doughnut',data:{labels:['En service','En prêt','Hors service','Réformé','Sorti'],datasets:[{data:[etat.enService,etat.enPret,etat.horsService,etat.reforme,etat.sorti],backgroundColor:['#16a34a','#1d4ed8','#f59e0b','#94a3b8','#dc2626'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},boxWidth:8}}}}});
  }

  // ═══ NOUVEAUX GRAPHIQUES — RAPPORTS (Point 3) ═══
  if (document.getElementById('chart-rap-cat-valeur')) {
    const data = valeurMoyenneParCategorie().slice(0,8);
    new Chart(document.getElementById('chart-rap-cat-valeur'),{type:'bar',data:{labels:data.map(c=>c.cat),datasets:[{data:data.map(c=>Math.round(c.total/1e3)),backgroundColor:'#4f46e5',borderRadius:4}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9},callback:v=>v+'K'},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-rap-evol-mensuel')) {
    const today=new Date(); const months=[];
    for(let i=5;i>=0;i--) months.push(new Date(today.getFullYear(), today.getMonth()-i, 1));
    const all=[...ST.mouvements];
    const labels=months.map(d=>d.toLocaleDateString('fr-FR',{month:'short',year:'2-digit'}));
    const entrees=months.map(mDate=>{
      const next=new Date(mDate.getFullYear(),mDate.getMonth()+1,1);
      return all.filter(m=>m.type==='Entrée'&&new Date(m.created_at||m.date)>=mDate&&new Date(m.created_at||m.date)<next).reduce((s,m)=>s+m.qty,0);
    });
    const sorties=months.map(mDate=>{
      const next=new Date(mDate.getFullYear(),mDate.getMonth()+1,1);
      return all.filter(m=>m.type==='Sortie'&&new Date(m.created_at||m.date)>=mDate&&new Date(m.created_at||m.date)<next).reduce((s,m)=>s+m.qty,0);
    });
    new Chart(document.getElementById('chart-rap-evol-mensuel'),{type:'bar',data:{labels,datasets:[{label:'Entrées',data:entrees,backgroundColor:'#10b981',borderRadius:3},{label:'Sorties',data:sorties,backgroundColor:'#ef4444',borderRadius:3}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-rap-top-distrib')) {
    const mvtPeriode=[...fMvtIT(),...fMvtFin()].filter(m=>m.type==='Sortie');
    const top=topProduitsDistribues(mvtPeriode,10);
    new Chart(document.getElementById('chart-rap-top-distrib'),{type:'bar',data:{labels:top.map(p=>p.nom.slice(0,16)),datasets:[{data:top.map(p=>p.qty),backgroundColor:'#f59e0b',borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-rap-top-couteux')) {
    const top=topProduitsCouteux(10);
    new Chart(document.getElementById('chart-rap-top-couteux'),{type:'bar',data:{labels:top.map(p=>p.nom.slice(0,16)),datasets:[{data:top.map(p=>Math.round(p.valeur/1e3)),backgroundColor:top.map(p=>p.amort?'#7c3aed':'#4f46e5'),borderRadius:3}]},options:{...baseOpts,indexAxis:'y',scales:{x:{ticks:{color:tc,font:{size:9},callback:v=>v+'K'},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{display:false}}}}});
  }
  if (document.getElementById('chart-rap-actifs-statut')) {
    const rep=repartitionActifsStatut();
    new Chart(document.getElementById('chart-rap-actifs-statut'),{type:'doughnut',data:{labels:rep.map(r=>r.statut),datasets:[{data:rep.map(r=>r.n),backgroundColor:['#16a34a','#1d4ed8','#f59e0b','#dc2626','#94a3b8'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:9},boxWidth:8}}}}});
  }
  if (document.getElementById('chart-rap-evol-valeur')) {
    const serie=evolutionValeurStock(6);
    new Chart(document.getElementById('chart-rap-evol-valeur'),{type:'line',data:{labels:serie.map(s=>s.label),datasets:[{label:'Valeur stock (MGA)',data:serie.map(s=>Math.round(s.val/1e3)),borderColor:'#0ea5e9',backgroundColor:'rgba(14,165,233,.1)',tension:.35,fill:true,pointRadius:3}]},options:{...baseOpts,plugins:{legend:{display:false}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9},callback:v=>v+'K'},grid:{color:gc}}}}});
  }
}
