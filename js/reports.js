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
  // Point 1 : valeur du stock (non-amortissable) = stock actuel × CUMP.
  // Conservé tel quel — réutilisé plus bas par le bloc Lecteur avec le
  // libellé explicite "stock non-amortissable (CUMP)".
  const vIT=ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+getValeurStockActuel(p.id),0);
  const vFin=ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+getValeurStockActuel(p.id),0);

  // FIX (KPI Dashboard non pertinentes) : "Valeur Stock IT/Finance" n'incluait
  // que les produits non-amortissables (comme vIT/vFin ci-dessus), sous-évaluant
  // silencieusement la valeur réelle par département. On ajoute la VNC des
  // actifs individuels "vivants" (En service/En prêt) pour une vision
  // patrimoine complète — cohérente avec le camembert chart-pie déjà corrigé.
  const vncIT  = (ST.actifs||[]).filter(a=>a.dept==='IT'      && (a.statut==='En service'||a.statut==='En prêt')).reduce((s,a)=>s+(calcVNC(a)||0),0);
  const vncFin = (ST.actifs||[]).filter(a=>a.dept==='Finance' && (a.statut==='En service'||a.statut==='En prêt')).reduce((s,a)=>s+(calcVNC(a)||0),0);
  const totIT  = vIT  + vncIT;
  const totFin = vFin + vncFin;
  const nbActifsIT  = (ST.actifs||[]).filter(a=>a.dept==='IT'      && (a.statut==='En service'||a.statut==='En prêt')).length;
  const nbActifsFin = (ST.actifs||[]).filter(a=>a.dept==='Finance' && (a.statut==='En service'||a.statut==='En prêt')).length;

  const alIT=alertsIT().length, alFin=alertsFin().length;
  const showP=canSeePrix();
  const kpis=[];
  if (canSeeIT())  kpis.push(showP?{lbl:'Valeur Totale IT',val:fmt(totIT)+' MGA',s:`${ST.produits.filter(p=>p.dept==='IT').length} réf. stock${nbActifsIT?` · ${nbActifsIT} actif(s) amort.`:''}`,c:'#4f46e5'}:{lbl:'Produits IT',val:ST.produits.filter(p=>p.dept==='IT').length,s:'références',c:'#4f46e5'});
  if (canSeeFin()) kpis.push(showP?{lbl:'Valeur Totale Finance',val:fmt(totFin)+' MGA',s:`${ST.produits.filter(p=>p.dept==='Finance').length} réf. stock${nbActifsFin?` · ${nbActifsFin} actif(s) amort.`:''}`,c:'#10b981'}:{lbl:'Produits Finance',val:ST.produits.filter(p=>p.dept==='Finance').length,s:'références',c:'#10b981'});
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
      ? `<div class="info-banner" style="background:var(--err-bg);border-color:var(--err-bd);color:var(--err-fg);margin-bottom:14px">
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
      <div class="info-banner" style="background:linear-gradient(135deg,var(--indigo-bg),var(--green-bg));border-color:var(--indigo-bd);color:var(--indigo-fg);margin-bottom:14px">
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
      <div class="chart-card"><div class="chart-ttl">Répartition valeur totale — Stock + Actifs (M MGA)</div><div class="bar-chart-wrap"><canvas id="chart-pie"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-activity" style="color:var(--teal)"></i>Activités récentes (10 derniers mouvements)</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['Date & Heure','Dépt','Type','Produit','Qté','Emplacement','Destination','Agent'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${mvtRows||'<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">Aucun mouvement sur la période</td></tr>'}</tbody>
      </table></div></div>`:''}`;
}

// ═══════════════════════════════════════════════════════════════
//   RAPPORT HEBDOMADAIRE — FLUX DE TRANSACTIONS (lundi → dimanche)
//   Règle métier : date transaction = created_at || date
// ═══════════════════════════════════════════════════════════════

const WEEK_CACHE_TTL = 30000; // ms — rafraîchissement léger du cache hebdo

/** Filtre Supabase : (created_at dans la plage) OU (created_at absent ET date dans la plage).
 *  La plage "date" est volontairement élargie d'un jour de chaque côté (fuseaux),
 *  le filtrage final exact étant refait côté client par inWeek(). */
function weekQueryFilter(start, end) {
  const sIso = start.toISOString(), eIso = end.toISOString();
  const sDay = weekDayKey(new Date(start.getTime() - 86400000));
  const eDay = weekDayKey(new Date(end.getTime()   + 86400000));
  return `and(created_at.gte.${sIso},created_at.lte.${eIso}),and(created_at.is.null,date.gte.${sDay},date.lte.${eDay})`;
}

/** Lecture paginée (PostgREST plafonne à 1000 lignes par requête) pour une semaine. */
async function fetchWeekRows(table, start, end, depts) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select('*')
      .or(weekQueryFilter(start, end))
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (depts.length) q = q.in('dept', depts);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** Charge de façon ciblée les mouvements (S et S−1) + les demandes de la semaine.
 *  Les prêts et actifs sont déjà chargés intégralement (ST.prets / ST.actifs). */
async function loadWeekFluxData(weekStart, weekEnd) {
  const prevStart = new Date(weekStart); prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd   = new Date(weekEnd);   prevEnd.setDate(prevEnd.getDate() - 7);

  const depts = [];
  if (canSeeIT())  depts.push('IT');
  if (canSeeFin()) depts.push('Finance');

  const [mvts, dms] = await Promise.all([
    fetchWeekRows('mouvements', prevStart, weekEnd, depts),
    fetchWeekRows('demandes',   weekStart, weekEnd, depts),
  ]);

  return {
    current: {
      mouvements: mvts.filter(m => inWeek(m.created_at || m.date, weekStart, weekEnd)),
      demandes:   dms.filter(d => inWeek(d.created_at || d.date, weekStart, weekEnd)),
    },
    previous: {
      mouvements: mvts.filter(m => inWeek(m.created_at || m.date, prevStart, prevEnd)),
    },
  };
}

/** Cache + déclenchement du chargement asynchrone (re-render quand prêt). */
function ensureWeekFluxData(weekStart, weekEnd) {
  const key = weekDayKey(weekStart);
  ST.weekFlux = ST.weekFlux || {};
  const existing = ST.weekFlux[key];
  if (existing && (existing.loading || Date.now() - (existing.ts || 0) < WEEK_CACHE_TTL)) return existing;

  const entry = existing || {};
  entry.loading = true;
  entry.error = null;
  ST.weekFlux[key] = entry;

  loadWeekFluxData(weekStart, weekEnd)
    .then(data => {
      entry.data = data;
      entry.loading = false;
      entry.ts = Date.now();
      if (ST.tab === 'rapports') render();
    })
    .catch(err => {
      console.error('[rapport hebdo]', err);
      entry.loading = false;
      entry.error = err?.message || 'Erreur de chargement';
      entry.ts = Date.now();
      if (ST.tab === 'rapports') render();
    });

  return entry;
}

window.weekPrev = () => {
  const s = startOfWeekMonday(ST.weekRef || new Date());
  s.setDate(s.getDate() - 7);
  ST.weekRef = s;
  render();
};
window.weekToday = () => {
  ST.weekRef = new Date();
  if (ST.weekFlux) delete ST.weekFlux[weekDayKey(startOfWeekMonday(ST.weekRef))];
  render();
};
window.weekNext = () => {
  const s = startOfWeekMonday(ST.weekRef || new Date());
  s.setDate(s.getDate() + 7);
  if (s.getTime() > startOfWeekMonday(new Date()).getTime()) return;
  ST.weekRef = s;
  render();
};
window.weekRetry = () => {
  const key = weekDayKey(startOfWeekMonday(ST.weekRef || new Date()));
  if (ST.weekFlux) delete ST.weekFlux[key];
  render();
};

/** Top N produits d'un sens de flux (entrées ou sorties). */
function topProduitsFlux(mouvements, type, n = 5) {
  const map = {};
  mouvements.filter(m => m.type === type).forEach(m => {
    const key = m.produit_id || m.produit_nom || '—';
    if (!map[key]) map[key] = { nom: m.produit_nom || m.produit_id || '—', qty: 0, valeur: 0 };
    map[key].qty    += (m.qty || 0);
    map[key].valeur += (m.valeur || 0);
  });
  return Object.values(map).sort((a, b) => b.qty - a.qty || b.valeur - a.valeur).slice(0, n);
}

function variationLabel(current, previous, money = false) {
  const delta = (current || 0) - (previous || 0);
  const arrow = delta > 0 ? '↗' : delta < 0 ? '↘' : '→';
  const deltaTxt = `${delta > 0 ? '+' : ''}${fmt(delta)}${money ? ' MGA' : ''}`;
  const pct = previous === 0
    ? (current === 0 ? '0 %' : 'n/a')
    : `${delta > 0 ? '+' : ''}${Math.round((delta / Math.abs(previous)) * 1000) / 10} %`;
  return `${arrow} ${deltaTxt} · ${pct} vs S−1`;
}

/** Agrégats purs d'un département pour la semaine + comparaison S−1. */
function computeWeekDeptStats(dept, entry, weekStart, weekEnd) {
  const current  = entry?.data?.current  || { mouvements: [], demandes: [] };
  const previous = entry?.data?.previous || { mouvements: [] };

  const mvts     = (current.mouvements || []).filter(m => m.dept === dept);
  const prevMvts = (previous.mouvements || []).filter(m => m.dept === dept);
  const dms      = (current.demandes || []).filter(d => d.dept === dept);

  const entrees = mvts.filter(m => m.type === STATUS_MVT.ENTREE);
  const sorties = mvts.filter(m => m.type === STATUS_MVT.SORTIE);
  const prevEntrees = prevMvts.filter(m => m.type === STATUS_MVT.ENTREE);
  const prevSorties = prevMvts.filter(m => m.type === STATUS_MVT.SORTIE);

  const sumQty = list => list.reduce((s, m) => s + (m.qty || 0), 0);
  const sumVal = list => list.reduce((s, m) => s + (m.valeur || 0), 0);

  const prets  = (ST.prets  || []).filter(p => p.dept === dept);
  const actifs = (ST.actifs || []).filter(a => a.dept === dept);

  const pretsDemarres = prets.filter(p => inWeek(p.date_debut || p.created_at, weekStart, weekEnd));
  const pretsRendus   = prets.filter(p => p.date_retour_reelle && inWeek(p.date_retour_reelle, weekStart, weekEnd));
  const pretsRetard   = prets.filter(p => p.statut === STATUS_PRET.EN_RETARD);

  const actifsCrees = actifs.filter(a => inWeek(a.date_entree, weekStart, weekEnd));

  const sortieParActif = {};
  sorties.filter(m => m.actif_id).forEach(m => {
    if (!sortieParActif[m.actif_id]) sortieParActif[m.actif_id] = m;
  });
  const actifsSortis = Object.keys(sortieParActif).map(id => {
    const a = actifs.find(x => x.id === id);
    return { ...(a || { id, produit_nom: '—', dept }), sortie: sortieParActif[id] };
  });

  const demandes = {
    total:    dms.length,
    validees: dms.filter(d => d.statut === STATUS_DEMANDE.VALIDE).length,
    refusees: dms.filter(d => d.statut === STATUS_DEMANDE.REFUSE).length,
    attente:  dms.filter(d => d.statut === STATUS_DEMANDE.EN_ATTENTE).length,
  };

  const daily = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart); day.setDate(day.getDate() + i);
    const dStart = new Date(day); dStart.setHours(0, 0, 0, 0);
    const dEnd   = new Date(day); dEnd.setHours(23, 59, 59, 999);
    const dayMvts = mvts.filter(m => inWeek(m.created_at || m.date, dStart, dEnd));
    const dIn  = dayMvts.filter(m => m.type === STATUS_MVT.ENTREE);
    const dOut = dayMvts.filter(m => m.type === STATUS_MVT.SORTIE);
    const vIn  = sumVal(dIn), vOut = sumVal(dOut);
    daily.push({
      date: day,
      label: day.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
      qtyIn: sumQty(dIn), qtyOut: sumQty(dOut),
      valIn: vIn, valOut: vOut, net: vIn - vOut,
    });
  }

  return {
    dept, mvts, prevMvts, dms, entrees, sorties, prevEntrees, prevSorties,
    qtyIn: sumQty(entrees), qtyOut: sumQty(sorties),
    valIn: sumVal(entrees), valOut: sumVal(sorties),
    net: sumVal(entrees) - sumVal(sorties),
    nbMvt: mvts.length, nbMvtPrev: prevMvts.length,
    produitsTouches: new Set(mvts.map(m => m.produit_id || m.produit_nom).filter(Boolean)).size,
    topEntrees: topProduitsFlux(mvts, STATUS_MVT.ENTREE, 5),
    topSorties: topProduitsFlux(mvts, STATUS_MVT.SORTIE, 5),
    daily, demandes, prets, pretsDemarres, pretsRendus, pretsRetard,
    actifs, actifsCrees, actifsSortis,
    hasData: mvts.length || dms.length || actifsCrees.length || actifsSortis.length || pretsDemarres.length || pretsRendus.length,
  };
}

function weekEmptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;color:var(--text3);padding:14px">${msg}</td></tr>`;
}

function renderWeekDeptBlock(dept, stats, weekStart, weekEnd, showP) {
  const isIT = dept === 'IT';
  const color = isIT ? '#4f46e5' : '#10b981';
  const canSeeAssets = isIT ? (canManIT() || isLecteur()) : (canManFin() || isLecteur());
  const deptLbl = isIT ? 'IT' : 'Finance';

  const kpis = [
    { lbl: 'Mouvements',    val: stats.nbMvt,       s: variationLabel(stats.nbMvt, stats.nbMvtPrev), c: '#6366f1' },
    { lbl: 'Entrées (qté)', val: fmt(stats.qtyIn),  s: `${stats.entrees.length} mouvement(s)`,       c: '#16a34a' },
    { lbl: 'Sorties (qté)', val: fmt(stats.qtyOut), s: `${stats.sorties.length} mouvement(s)`,       c: '#dc2626' },
  ];
  if (showP) {
    kpis.push({ lbl: 'Valeur entrées', val: fmt(stats.valIn) + ' MGA', s: variationLabel(stats.valIn, stats.prevEntrees.reduce((s, m) => s + (m.valeur || 0), 0), true), c: '#16a34a' });
    kpis.push({ lbl: 'Valeur sorties', val: fmt(stats.valOut) + ' MGA', s: variationLabel(stats.valOut, stats.prevSorties.reduce((s, m) => s + (m.valeur || 0), 0), true), c: '#dc2626' });
    kpis.push({ lbl: 'Solde net',      val: fmt(stats.net) + ' MGA',    s: 'entrées − sorties', c: stats.net >= 0 ? '#16a34a' : '#dc2626' });
  }
  kpis.push({ lbl: 'Produits touchés', val: stats.produitsTouches, s: 'références distinctes', c: '#0ea5e9' });
  kpis.push({ lbl: 'Demandes créées',  val: stats.demandes.total,  s: `${stats.demandes.validees} validée(s) · ${stats.demandes.refusees} refusée(s) · ${stats.demandes.attente} en attente`, c: '#f59e0b' });
  if (canSeeAssets) {
    kpis.push({ lbl: 'Actifs créés',     val: stats.actifsCrees.length, s: 'entrées amortissables', c: '#7c3aed' });
    kpis.push({ lbl: 'Actifs sortis',    val: stats.actifsSortis.length, s: 'sorties individuelles', c: '#dc2626' });
    kpis.push({ lbl: 'Prêts démarrés',   val: stats.pretsDemarres.length, s: 'sur la semaine', c: '#3b82f6' });
    kpis.push({ lbl: 'Prêts rendus',     val: stats.pretsRendus.length,   s: 'sur la semaine', c: '#10b981' });
    kpis.push({ lbl: 'Prêts en retard',  val: stats.pretsRetard.length,   s: 'stock actuel', c: stats.pretsRetard.length ? '#ef4444' : '#22c55e' });
  }

  const dayCols = showP ? 6 : 3;
  const dayRows = stats.daily.map(d => {
    if (showP) {
      return `<tr>
        <td style="font-weight:600;text-transform:capitalize">${d.label}</td>
        <td style="font-weight:700;color:#16a34a">${fmt(d.qtyIn)}</td>
        <td style="font-weight:700;color:#dc2626">${fmt(d.qtyOut)}</td>
        <td>${fmt(d.valIn)} MGA</td>
        <td>${fmt(d.valOut)} MGA</td>
        <td style="font-weight:700;color:${d.net >= 0 ? '#16a34a' : '#dc2626'}">${fmt(d.net)} MGA</td>
      </tr>`;
    }
    return `<tr>
      <td style="font-weight:600;text-transform:capitalize">${d.label}</td>
      <td style="font-weight:700;color:#16a34a">${fmt(d.qtyIn)}</td>
      <td style="font-weight:700;color:#dc2626">${fmt(d.qtyOut)}</td>
    </tr>`;
  }).join('');

  const topRows = (list, empty) => list.map((p, i) => `<tr>
    <td style="font-weight:700;color:var(--text3)">#${i + 1}</td>
    <td style="font-weight:600">${p.nom}</td>
    <td style="font-weight:700">${fmt(p.qty)}</td>
    ${showP ? `<td style="font-family:var(--mono);font-size:12px">${fmt(p.valeur)} MGA</td>` : ''}
  </tr>`).join('') || weekEmptyRow(showP ? 4 : 3, empty);

  const demRows = [...stats.dms]
    .sort((a, b) => new Date(b.created_at || b.date) - new Date(a.created_at || a.date))
    .slice(0, 10)
    .map(d => `<tr>
      <td>${fmtDTSplit(d.created_at || d.date)}</td>
      <td style="font-weight:500">${d.demandeur || '—'}</td>
      <td>${d.produit || '—'}</td>
      <td style="font-weight:700">${d.qty || 0}</td>
      <td>${statBadge(d.statut)}</td>
    </tr>`).join('') || weekEmptyRow(5, 'Aucune demande créée cette semaine');

  const actifCreesRows = stats.actifsCrees.map(a => `<tr>
    <td>${fmtDTSplit(a.date_entree)}</td>
    <td><code class="actif-id">${a.id}</code></td>
    <td style="font-weight:500">${a.produit_nom || '—'}</td>
    <td>${a.statut || '—'}</td>
  </tr>`).join('') || weekEmptyRow(4, 'Aucun actif créé cette semaine');

  const actifSortisRows = stats.actifsSortis.map(a => `<tr>
    <td>${fmtDTSplit(a.sortie.created_at || a.sortie.date)}</td>
    <td><code class="actif-id">${a.id}</code></td>
    <td style="font-weight:500">${a.produit_nom || '—'}</td>
    <td>${a.statut || '—'}</td>
  </tr>`).join('') || weekEmptyRow(4, 'Aucun actif sorti cette semaine');

  const pretLigne = p => `<tr>
    <td>${fmtDTSplit(p._date)}</td>
    <td><code class="actif-id">${getActifNumero(p) || '—'}</code></td>
    <td style="font-weight:500">${p.produit_nom || '—'}</td>
    <td>${p.emprunteur || '—'}</td>
    <td>${pretStatutBadge(p.statut)}</td>
  </tr>`;
  const pretsDemarresRows = stats.pretsDemarres.map(p => pretLigne({ ...p, _date: p.date_debut || p.created_at })).join('')
    || weekEmptyRow(5, 'Aucun prêt démarré cette semaine');
  const pretsRendusRows = stats.pretsRendus.map(p => pretLigne({ ...p, _date: p.date_retour_reelle })).join('')
    || weekEmptyRow(5, 'Aucun prêt rendu cette semaine');

  const emptyBanner = stats.hasData ? '' : `<div class="info-banner" style="background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn-fg)">
      <i class="ti ti-calendar-off" style="color:#f59e0b"></i>
      <div>Aucune transaction enregistrée pour <strong>${deptLbl}</strong> sur cette semaine.</div>
    </div>`;

  return `
    <div class="card" style="border-left:3px solid ${color};margin-bottom:14px">
      <div class="card-hd">
        <span class="card-ttl"><i class="ti ti-${isIT ? 'device-laptop' : 'cash'}" style="color:${color}"></i>${deptLbl} — flux de la semaine</span>
        <div class="btn-row">
          ${btn('↓ Export CSV semaine', color, true, `exportRapportHebdoCSV('${dept}')`, 'ti-download')}
        </div>
      </div>
      <div style="padding:14px 16px">
        ${emptyBanner}
        <div class="kpi-grid">${kpis.map(k => `<div class="kpi" style="border-left-color:${k.c}"><div class="kpi-lbl">${k.lbl}</div><div class="kpi-val">${k.val}</div><div class="kpi-s">${k.s || ''}</div></div>`).join('')}</div>
        <div class="chart-ttl" style="margin:4px 0 8px"><i class="ti ti-calendar-stats" style="color:${color}"></i>Flux jour par jour (lun → dim)</div>
        <div style="overflow-x:auto"><table>
          <thead><tr>
            <th>Jour</th><th>Entrées (qté)</th><th>Sorties (qté)</th>
            ${showP ? '<th>Valeur entrées</th><th>Valeur sorties</th><th>Net</th>' : ''}
          </tr></thead>
          <tbody>${dayRows || weekEmptyRow(dayCols, 'Aucune donnée')}</tbody>
        </table></div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:0">
        <div class="card-hd"><span class="card-ttl"><i class="ti ti-trending-up" style="color:#dc2626"></i>Top 5 produits sortis</span></div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>#</th><th>Produit</th><th>Qté</th>${showP ? '<th>Valeur</th>' : ''}</tr></thead>
          <tbody>${topRows(stats.topSorties, 'Aucune sortie cette semaine')}</tbody>
        </table></div>
      </div>
      <div class="card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:0">
        <div class="card-hd"><span class="card-ttl"><i class="ti ti-trending-down" style="color:#16a34a"></i>Top 5 produits entrés</span></div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>#</th><th>Produit</th><th>Qté</th>${showP ? '<th>Valeur</th>' : ''}</tr></thead>
          <tbody>${topRows(stats.topEntrees, 'Aucune entrée cette semaine')}</tbody>
        </table></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-hd"><span class="card-ttl"><i class="ti ti-clipboard-list" style="color:#f59e0b"></i>Demandes de la semaine (${stats.demandes.total})</span></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Date</th><th>Demandeur</th><th>Produit</th><th>Qté</th><th>Statut</th></tr></thead>
        <tbody>${demRows}</tbody>
      </table></div>
      ${stats.dms.length > 10 ? `<div style="padding:8px 16px;font-size:11px;color:var(--text3);border-top:1px solid var(--border)">… et ${stats.dms.length - 10} autre(s) demande(s) — voir l'export CSV.</div>` : ''}
    </div>

    ${canSeeAssets ? `
    <div class="charts-grid">
      <div class="card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:0">
        <div class="card-hd"><span class="card-ttl"><i class="ti ti-devices" style="color:#7c3aed"></i>Actifs créés (${stats.actifsCrees.length})</span></div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Date</th><th>N° actif</th><th>Produit</th><th>Statut</th></tr></thead>
          <tbody>${actifCreesRows}</tbody>
        </table></div>
        <div class="card-hd" style="border-top:1px solid var(--border)"><span class="card-ttl"><i class="ti ti-device-desktop-off" style="color:#dc2626"></i>Actifs sortis (${stats.actifsSortis.length})</span></div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Date sortie</th><th>N° actif</th><th>Produit</th><th>Statut</th></tr></thead>
          <tbody>${actifSortisRows}</tbody>
        </table></div>
      </div>
      <div class="card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:0">
        <div class="card-hd"><span class="card-ttl"><i class="ti ti-transfer" style="color:#3b82f6"></i>Prêts démarrés (${stats.pretsDemarres.length})</span></div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Date début</th><th>Actif</th><th>Produit</th><th>Emprunteur</th><th>Statut</th></tr></thead>
          <tbody>${pretsDemarresRows}</tbody>
        </table></div>
        <div class="card-hd" style="border-top:1px solid var(--border)"><span class="card-ttl"><i class="ti ti-transfer-in" style="color:#10b981"></i>Prêts rendus (${stats.pretsRendus.length})</span></div>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Date retour</th><th>Actif</th><th>Produit</th><th>Emprunteur</th><th>Statut</th></tr></thead>
          <tbody>${pretsRendusRows}</tbody>
        </table></div>
      </div>
    </div>` : ''}
  `;
}

function renderRapportHebdoSection(weekStart, weekEnd, entry) {
  const showP = canSeePrix();
  const isCurrent = weekStart.getTime() === startOfWeekMonday(new Date()).getTime();
  const selector = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-right:auto">
        <i class="ti ti-calendar-week" style="color:var(--teal)"></i> ${labelSemaine(weekStart, weekEnd)}
      </div>
      ${btn('← Semaine précédente', '#64748b', true, 'weekPrev()', 'ti-arrow-left')}
      ${btn('Cette semaine', '#4f46e5', true, 'weekToday()', 'ti-calendar')}
      <button class="btn btn-outline" style="border-color:#94a3b8;color:#94a3b8;${isCurrent ? 'opacity:.45;cursor:not-allowed' : ''}" ${isCurrent ? 'disabled' : ''} onclick="${isCurrent ? '' : 'weekNext()'}">
        <i class="ti ti-arrow-right"></i> Semaine suivante →
      </button>
    </div>`;

  let body;
  if (entry.loading && !entry.data) {
    body = `<div class="info-banner"><i class="ti ti-loader-2" style="color:var(--teal)"></i><div>Chargement du rapport hebdomadaire…</div></div>`;
  } else if (entry.error) {
    body = `<div class="info-banner" style="background:var(--err-bg);border-color:var(--err-bd);color:var(--err-fg)">
      <i class="ti ti-alert-circle" style="color:#dc2626"></i>
      <div>Impossible de charger le rapport : ${entry.error} · <span style="text-decoration:underline;cursor:pointer" onclick="weekRetry()">Réessayer</span></div>
    </div>`;
  } else {
    const depts = [];
    if (canSeeIT())  depts.push('IT');
    if (canSeeFin()) depts.push('Finance');
    body = depts.length
      ? depts.map(dept => renderWeekDeptBlock(dept, computeWeekDeptStats(dept, entry, weekStart, weekEnd), weekStart, weekEnd, showP)).join('')
      : `<div class="info-banner"><i class="ti ti-lock"></i><div>Aucun département accessible.</div></div>`;
  }

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-hd">
        <span class="card-ttl"><i class="ti ti-calendar-week" style="color:var(--teal)"></i>Rapport hebdomadaire — Flux de transactions</span>
        <span class="tag" style="color:var(--text2);background:var(--kbd-bg)">${showP ? 'Montants visibles' : 'Montants masqués'}</span>
      </div>
      <div style="padding:14px 16px">
        <div class="info-banner" style="margin-bottom:14px">
          <i class="ti ti-info-circle" style="color:#0ea5e9"></i>
          <div>Semaine <strong>lundi → dimanche</strong> · date de transaction = <code>created_at || date</code>. Le rapport est indépendant du filtre de période de la barre supérieure.</div>
        </div>
        ${selector}
      </div>
    </div>
    ${body}
  `;
}

// ── RAPPORTS — TABLEAU DE BORD DÉCISIONNEL (Point 3) ──
function renderRapports() {
  const weekStart = startOfWeekMonday(ST.weekRef || new Date());
  const weekEnd   = endOfWeekSunday(weekStart);
  const weekEntry = ensureWeekFluxData(weekStart, weekEnd);
  const weeklySection = renderRapportHebdoSection(weekStart, weekEnd, weekEntry);

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
    <td><span class="tag" style="color:var(--text2);background:var(--kbd-bg)">${p.categorie}</span></td>
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

    ${weeklySection}

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
      <td><span class="tag" style="color:var(--text2);background:var(--kbd-bg)">${a.categorie || '—'}</span></td>
      <td><span class="tag" style="color:var(--blue-fg);background:var(--blue-bg)">${a.emplacement || '—'}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${fmt(a.valeur_achat)} MGA</td>
      <td style="font-size:11px;color:var(--text3)">${fmtDate(a.date_achat)}</td>
      <td style="font-size:11px;color:var(--text3)">${(a.duree_amortissement/12).toFixed(1)}a · <strong>${taux}%/an</strong></td>
      <td style="font-size:11px;color:var(--text3)">${annuite?fmt(annuite)+' MGA/an':'—'}</td>
      <td>
        <div style="font-weight:700;color:${c}">${vnc===0?'<span class="tag" style="color:var(--err-fg);background:var(--err-bg)">Totalement amorti</span>':fmt(vnc)+' MGA'}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
          <div class="amort-bar" style="width:90px"><div class="amort-fill" style="width:${pct}%;background:${c}"></div></div>
          <span style="font-size:10px;color:${c};font-weight:700">${pct}%</span>
        </div>
      </td>
      <td>${isLecteur() ? btn('🕘', '#6366f1', true, `openActifHistorique('${a.id}')`) : btn('✏', '#64748b', true, `openEditActif('${a.id}')`)}</td>
    </tr>`;
  }).join('');

  const totalsFooterRow = filtered.length ? `<tr style="background:var(--surface);font-weight:800">
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
    <td><span class="tag" style="color:var(--text2);background:var(--kbd-bg)">${a.categorie || '—'}</span></td>
    <td>${isLecteur() ? '<span style="color:var(--text3);font-size:11px">—</span>' : btn('Configurer', '#4f46e5', true, `openEditActif('${a.id}')`)}</td>
  </tr>`).join('');

  return `<p class="page-title">Amortissement Linéaire des Actifs</p>
    <p class="page-sub">Valeur nette comptable (VNC) — Méthode linéaire, calculée actif par actif</p>
    <div class="info-banner" style="background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn-fg)">
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
  const cs=getComputedStyle(document.documentElement);
  const gc=(cs.getPropertyValue('--border').trim()||'#e2e8f0');
  const tc=(cs.getPropertyValue('--text3').trim()||'#94a3b8');
  const baseOpts={ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} };
  if (document.getElementById('chart-mvt')) {
    const mvtAll=[...fMvtIT(),...fMvtFin()];
    const dates=[...new Set(mvtAll.map(m=>(m.created_at||m.date).slice(0,10)))].sort().slice(-8);
    new Chart(document.getElementById('chart-mvt'),{type:'bar',data:{labels:dates.map(d=>new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})),datasets:[{label:'Entrées',data:dates.map(d=>mvtAll.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Entrée').reduce((s,m)=>s+m.qty,0)),backgroundColor:'#10b981',borderRadius:4},{label:'Sorties',data:dates.map(d=>mvtAll.filter(m=>(m.created_at||m.date).slice(0,10)===d&&m.type==='Sortie').reduce((s,m)=>s+m.qty,0)),backgroundColor:'#ef4444',borderRadius:4}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:9}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9}},grid:{color:gc}}}}});
  }
  if (document.getElementById('chart-pie')) {
    // FIX (Dashboard — camembert valeur stock incomplet) : getValeurStockActuel()
    // renvoie 0 pour tout produit amortissable (règle métier volontaire — sa
    // valorisation vit exclusivement dans le module Actifs via la VNC). Le
    // camembert n'affichait donc que la valeur des produits NON amortissables,
    // sous-évaluant silencieusement IT et Finance. On additionne désormais la
    // VNC des actifs "En service"/"En prêt" par département — même calcul déjà
    // appliqué correctement au bloc Lecteur (chart-lecteur-repart), désormais
    // cohérent pour tous les rôles voyant ce Dashboard.
    const vIT = ST.produits.filter(p=>p.dept==='IT').reduce((s,p)=>s+getValeurStockActuel(p.id),0)
      + (ST.actifs||[]).filter(a=>a.dept==='IT'&&(a.statut==='En service'||a.statut==='En prêt')).reduce((s,a)=>s+(calcVNC(a)||0),0);
    const vFin = ST.produits.filter(p=>p.dept==='Finance').reduce((s,p)=>s+getValeurStockActuel(p.id),0)
      + (ST.actifs||[]).filter(a=>a.dept==='Finance'&&(a.statut==='En service'||a.statut==='En prêt')).reduce((s,a)=>s+(calcVNC(a)||0),0);
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
    new Chart(document.getElementById('chart-amort'),{type:'bar',data:{labels:actifsA.map(a=>(a.produit_nom||a.id).slice(0,14)),datasets:[{label:'Valeur acquisition',data:actifsA.map(a=>Math.round((a.valeur_achat||0)/1e6*100)/100),backgroundColor:cs.getPropertyValue('--indigo-bg').trim()||'#e0e7ff',borderRadius:3},{label:'VNC',data:actifsA.map(a=>Math.round((calcVNC(a)||0)/1e6*100)/100),backgroundColor:'#4f46e5',borderRadius:3}]},options:{...baseOpts,plugins:{legend:{display:true,labels:{font:{size:10},boxWidth:9}}},scales:{x:{ticks:{color:tc,font:{size:8}},grid:{color:gc}},y:{ticks:{color:tc,font:{size:9},callback:v=>v+'M'},grid:{color:gc}}}}});
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
