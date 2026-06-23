'use strict';

// ═══════════════════════════════════════════════════════════════
//   PRÊTS — MODULE COMPLET
//   Dépendances (ordre de chargement) : utils.js → stock.js →
//   actifs.js → export.js → prets.js
// ═══════════════════════════════════════════════════════════════

// ─── Chargement depuis Supabase ───────────────────────────────
// Le statut "En retard" est calculé côté client (lecture seule).
// Aucun UPDATE automatique en base pour éviter des écritures parasites.
async function loadPrets() {
  const { data, error } = await db
    .from('prets')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('[loadPrets]', error); return; }
  const now = new Date();
  ST.prets = (data || []).map(p => ({
    ...p,
    // Enrichissement mémoire : si "En cours" et date dépassée → "En retard"
    statut: (p.statut === 'En cours' && p.date_retour_prevue && new Date(p.date_retour_prevue) < now)
      ? 'En retard'
      : p.statut,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────
function isEnRetard(pret) {
  if (!pret || pret.statut === 'Retourné') return false;
  return !!(pret.date_retour_prevue && new Date(pret.date_retour_prevue) < new Date());
}

// Retourne le nombre de jours jusqu'au retour prévu (négatif = retard)
function joursRestants(pret) {
  if (!pret.date_retour_prevue || pret.statut === 'Retourné') return null;
  const diff = new Date(pret.date_retour_prevue) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function pretStatutBadge(statut) {
  if (statut === 'En cours')   return `<span class="tag pret-encours">⇄ En cours</span>`;
  if (statut === 'En retard')  return `<span class="tag pret-retard">⚠ En retard</span>`;
  if (statut === 'Retourné')   return `<span class="tag pret-retourne">✓ Retourné</span>`;
  return `<span class="tag">${statut || '—'}</span>`;
}

// ─── Vue principale ────────────────────────────────────────────
function renderPrets(dept) {
  if (dept === 'IT'      && !canManIT())  return accessDenied();
  if (dept === 'Finance' && !canManFin()) return accessDenied();

  const color    = dept === 'IT' ? '#4f46e5' : '#10b981';
  const il       = ST.search.inline;
  const q        = (il.query || '').trim();

  const all       = (ST.prets || []).filter(p => p.dept === dept);
  const enCours   = all.filter(p => p.statut === 'En cours');
  const enRetard  = all.filter(p => p.statut === 'En retard');
  const retournes = all.filter(p => p.statut === 'Retourné');

  // Filtrage texte libre
  const filtered = all.filter(a => {
    if (!q) return true;
    return matchesQuery(
      [a.actif_id, a.emprunteur, a.produit_nom, a.categorie, a.motif, a.destination, a.statut, a.id],
      q
    );
  });

  const kpis = [
    { lbl: 'En cours',  val: enCours.length,   s: 'prêts actifs',         c: '#3b82f6' },
    { lbl: 'En retard', val: enRetard.length,   s: 'dépassement échéance', c: '#ef4444' },
    { lbl: 'Retournés', val: retournes.length,  s: 'sur la période',       c: '#10b981' },
    { lbl: 'Total',     val: all.length,         s: 'enregistrements',      c: '#64748b' },
  ];

  // Bannière d'alerte retard
  const alertBanner = enRetard.length > 0
    ? `<div class="info-banner" style="background:#fef2f2;border-color:#fecaca;color:#dc2626">
        <i class="ti ti-alert-triangle" style="color:#dc2626"></i>
        <div><strong>${enRetard.length} actif(s) en retard de restitution.</strong> Contactez les emprunteurs concernés.</div>
      </div>`
    : '';

  // Barre de recherche
  const searchBar = buildContentSearchBar({
    placeholder: `Rechercher dans les prêts ${dept} (n° actif, emprunteur, produit, motif…)`,
    count:         all.length,
    filteredCount: filtered.length,
  });

  const hdrs = [
    'ID Prêt', 'N° Actif', 'Produit', 'Emprunteur',
    'Date prêt', 'Retour prévu', 'Délai',
    'Destination', 'Motif', 'Statut', 'Retour effectif', 'Action',
  ];

  const rows = filtered.map(p => {
    const jours = joursRestants(p);
    let delaiCell = '<span style="color:var(--text3)">—</span>';
    if (p.statut !== 'Retourné' && jours !== null) {
      const c2   = jours < 0 ? '#dc2626' : jours <= 2 ? '#d97706' : '#16a34a';
      const lbl  = jours < 0
        ? `${Math.abs(jours)}j de retard`
        : jours === 0 ? 'Aujourd\'hui' : `J−${jours}`;
      delaiCell = `<span style="color:${c2};font-weight:700;font-size:11px">${lbl}</span>`;
    }

    const actionCell = p.statut !== 'Retourné'
      ? btn('↩ Retour', '#10b981', true, `retournerPret('${p.id}')`)
      : '<span style="font-size:11px;color:var(--text3)">—</span>';

    const rowStyle = p.statut === 'En retard'
      ? ' style="background:#fff5f5"'
      : p.statut === 'Retourné' ? ' class="row-inactif"' : '';

    return `<tr${rowStyle}>
      <td><code style="font-size:9px">${highlight(p.id, q)}</code></td>
      <td><code class="actif-id">${highlight(p.actif_id || '—', q)}</code></td>
      <td style="font-weight:600;font-size:12.5px">${highlight(p.produit_nom || '—', q)}</td>
      <td style="font-weight:500">${highlight(p.emprunteur || '—', q)}</td>
      <td>${fmtDate(p.date_pret || p.created_at)}</td>
      <td style="font-weight:600">${p.date_retour_prevue ? fmtDate(p.date_retour_prevue) : '—'}</td>
      <td>${delaiCell}</td>
      <td style="font-size:11px;color:var(--text2)">${highlight(p.destination || '—', q)}</td>
      <td style="font-size:11px;color:var(--text3);max-width:120px">${highlight((p.motif || '').slice(0, 55), q)}</td>
      <td>${pretStatutBadge(p.statut)}</td>
      <td style="font-size:11px;color:var(--text3)">${p.date_retour_effective ? fmtDate(p.date_retour_effective) : '—'}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');

  const emptyRow = !filtered.length
    ? `<tr class="no-result-row"><td colspan="${hdrs.length}">
        <div class="nri">${q ? '🔍' : '📋'}</div>
        <div class="nrt">${q
          ? `Aucun prêt ne correspond à « ${q} »`
          : `Aucun prêt enregistré pour le département ${dept}`
        }</div>
        ${q ? `<div style="font-size:11px;margin-top:4px">
          <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a>
        </div>` : ''}
      </td></tr>`
    : '';

  return `<p class="page-title">Gestion des Prêts — ${dept}</p>
    <p class="page-sub">${enCours.length} prêt(s) en cours${enRetard.length
      ? ` · <span style="color:#dc2626;font-weight:700">${enRetard.length} en retard</span>`
      : ''} · ${all.length} total</p>
    ${alertBanner}
    <div class="kpi-grid">${kpis.map(k =>
      `<div class="kpi" style="border-left-color:${k.c}">
        <div class="kpi-lbl">${k.lbl}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-s">${k.s}</div>
      </div>`
    ).join('')}</div>
    <div class="btn-row" style="margin-bottom:12px">
      ${btn('↓ CSV', '#10b981', true, `exportPretsCSV('${dept}')`, 'ti-download')}
      ${btn('+ Nouveau prêt', color, false, `openPret('${dept}')`, 'ti-plus')}
    </div>
    ${searchBar}
    <div class="card">
      <div class="card-hd">
        <span class="card-ttl">
          <i class="ti ti-transfer" style="color:${color}"></i>
          Registre des prêts ${dept}
        </span>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${hdrs.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows || emptyRow}</tbody>
      </table></div>
    </div>`;
}

// ─── Modal — Nouveau Prêt ──────────────────────────────────────
window.openPret = (dept) => {
  ST.modal = { type: 'pret', dept };
  renderModalPret();
};

function renderModalPret() {
  document.getElementById('modal-el')?.remove();
  if (!ST.modal || ST.modal.type !== 'pret') return;

  const { dept }  = ST.modal;
  const color     = dept === 'IT' ? '#4f46e5' : '#10b981';
  const destOpts  = ST.params.destinations.map(d => `<option value="${d}">${d}</option>`).join('');

  // Actifs disponibles pour ce département (uniquement "En service")
  const actifsDispos = (ST.actifs || []).filter(a => a.dept === dept && a.statut === 'En service');
  const actifOpts    = actifsDispos.map(a =>
    `<option value="${a.id}" data-nom="${escQ(a.produit_nom || '')}">${a.id} — ${a.produit_nom || '—'} (${a.emplacement || '—'})</option>`
  ).join('');

  // Date minimale de retour : demain
  const tomorrow    = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Champ emprunteur : liste déroulante si allProfiles est chargé, sinon saisie libre
  const emprunteurField = ST.allProfiles.length > 0
    ? `<select id="f-pret-emprunteur">
        ${ST.allProfiles
          .filter(u => u.dept === dept || u.dept === 'both' || u.role === 'Administrateur')
          .map(u => `<option value="${u.name}">${u.name} (${u.role})</option>`)
          .join('')}
      </select>`
    : `<input id="f-pret-emprunteur" type="text" placeholder="Nom de l'emprunteur…">`;

  const noActifBanner = !actifsDispos.length
    ? `<div class="info-banner" style="margin-top:8px;font-size:11.5px">
        <i class="ti ti-info-circle"></i>
        Aucun actif « En service » disponible pour le département ${dept}.
        Vérifiez l'onglet <strong>Actifs ${dept}</strong>.
      </div>`
    : '';

  const body = `
    <div class="form-2col">
      <div class="form-row">
        <label class="form-lbl">Département</label>
        <input value="${dept}" disabled class="field-readonly" style="font-weight:700;color:${color}">
      </div>
      <div class="form-row">
        <label class="form-lbl">Valideur</label>
        <input value="${ST.profile?.name || ''}" readonly class="field-readonly">
      </div>
    </div>

    <div class="form-row">
      <label class="form-lbl">Actif à prêter <span class="req">*</span></label>
      ${actifsDispos.length
        ? `<select id="f-pret-actif" onchange="onActifPretChange(this)">
            <option value="">— Sélectionner un actif en service —</option>
            ${actifOpts}
          </select>`
        : `<input value="Aucun actif disponible" disabled class="field-readonly">`
      }
      ${noActifBanner}
    </div>

    <div class="form-row">
      <label class="form-lbl">Produit</label>
      <input id="f-pret-produit" readonly class="field-readonly" placeholder="Auto-rempli à la sélection de l'actif">
    </div>

    <div class="form-2col">
      <div class="form-row">
        <label class="form-lbl">Emprunteur <span class="req">*</span></label>
        ${emprunteurField}
      </div>
      <div class="form-row">
        <label class="form-lbl">Date de retour prévue <span class="req">*</span></label>
        <input id="f-pret-retour" type="date" min="${tomorrowStr}" value="${tomorrowStr}">
      </div>
    </div>

    <div class="form-row">
      <label class="form-lbl">Destination / Affectation</label>
      <select id="f-pret-dest">
        <option value="">— Optionnel —</option>
        ${destOpts}
      </select>
    </div>

    <div class="form-row">
      <label class="form-lbl">Motif <span class="req">*</span></label>
      <textarea id="f-pret-motif" rows="2"
        placeholder="Contexte et raison du prêt…"
        style="resize:vertical"></textarea>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
      ${btn('Annuler', '#94a3b8', true, 'closeModal()')}
      ${actifsDispos.length
        ? btn('✓ Enregistrer le prêt', color, false, 'submitPret()')
        : ''}
    </div>`;

  const ov = document.createElement('div');
  ov.id    = 'modal-el';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" onclick="event.stopPropagation()">
    <div class="modal-h">
      <span class="modal-ttl">📋 Nouveau prêt — ${dept}</span>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    ${body}
  </div>`;
  ov.addEventListener('click', closeModal);
  document.body.appendChild(ov);
}

// Auto-remplissage du champ Produit à la sélection de l'actif
window.onActifPretChange = (sel) => {
  const opt      = sel.options[sel.selectedIndex];
  const prodNom  = opt?.getAttribute('data-nom') || '';
  const inp      = document.getElementById('f-pret-produit');
  if (inp) inp.value = prodNom;
};

// ─── Création d'un prêt ────────────────────────────────────────
window.submitPret = async () => {
  const dept = ST.modal?.dept;
  if (!dept) return;
  if (dept === 'IT' && !canManIT() || dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }

  const actifId        = document.getElementById('f-pret-actif')?.value?.trim();
  const emprunteur     = document.getElementById('f-pret-emprunteur')?.value?.trim();
  const dateRetourPrev = document.getElementById('f-pret-retour')?.value;
  const dest           = document.getElementById('f-pret-dest')?.value || '';
  const motif          = document.getElementById('f-pret-motif')?.value?.trim() || '';

  // Validations
  if (!actifId)        { showToast('Sélectionnez un actif', 'err');              return; }
  if (!emprunteur)     { showToast('L\'emprunteur est requis', 'err');           return; }
  if (!dateRetourPrev) { showToast('Date de retour prévue requise', 'err');      return; }
  if (!motif)          { showToast('Le motif est requis', 'err');                return; }

  // Vérification fraîche de la disponibilité de l'actif
  const actif = (ST.actifs || []).find(a => a.id === actifId);
  if (!actif) { showToast('Actif introuvable', 'err'); return; }
  if (actif.statut !== 'En service') {
    showToast(`"${actifId}" n'est plus disponible (statut : ${actif.statut})`, 'err'); return;
  }

  // Résolution de l'emprunteur_id si profiles chargés
  const emprunteurProfile  = ST.allProfiles.find(u => u.name === emprunteur);
  const emprunteur_id_val  = emprunteurProfile?.id || null;

  const id    = genId(dept === 'IT' ? 'PRT-IT' : 'PRT-FIN');
  const tsNow = nowISO();

  try {
    // 1. Créer l'enregistrement de prêt
    const { error: pErr } = await db.from('prets').insert({
      id,
      actif_id:              actifId,
      produit_nom:           actif.produit_nom    || '',
      dept,
      emprunteur,
      emprunteur_id:         emprunteur_id_val,
      date_pret:             tsNow,
      date_retour_prevue:    dateRetourPrev,
      date_retour_effective: null,
      statut:                'En cours',
      motif,
      destination:           dest,
      valideur:              ST.profile?.name     || '',
      valideur_id:           ST.user?.id          || null,
      created_at:            tsNow,
      updated_at:            tsNow,
    });
    if (pErr) throw pErr;

    // 2. Passer l'actif en statut "En prêt"
    // FIX : pas de 'updated_at' sur actifs_individuels (colonne inexistante)
    const { error: aErr } = await db
      .from('actifs_individuels')
      .update({ statut: 'En prêt' })
      .eq('id', actifId);
    if (aErr) throw aErr;

    closeModal();
    showToast(`Prêt enregistré — "${actifId}" confié à ${emprunteur} jusqu'au ${fmtDate(dateRetourPrev)}`);
    await Promise.all([loadPrets(), loadActifs()]);
    render();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'err');
  }
};

// ─── Retour d'un actif prêté ───────────────────────────────────
window.retournerPret = async (id) => {
  const pret = (ST.prets || []).find(p => p.id === id);
  if (!pret) return;

  const { dept } = pret;
  if (dept === 'IT' && !canManIT() || dept === 'Finance' && !canManFin()) {
    showToast('Action non autorisée', 'err'); return;
  }
  if (pret.statut === 'Retourné') {
    showToast('Ce prêt est déjà clôturé', 'err'); return;
  }

  showConfirm(
    `Confirmer le retour de "${pret.actif_id}" ?`,
    `L'actif <strong>${pret.produit_nom || pret.actif_id}</strong> confié à <strong>${pret.emprunteur}</strong>
     sera marqué comme <strong>Retourné</strong> et repassera en statut <strong>En service</strong>.`,
    async () => {
      try {
        const tsNow = nowISO();

        // 1. Clôturer le prêt
        const { error: pErr } = await db.from('prets').update({
          statut:                'Retourné',
          date_retour_effective: tsNow,
          updated_at:            tsNow,
        }).eq('id', id);
        if (pErr) throw pErr;

        // 2. Remettre l'actif en service
        // FIX : pas de 'updated_at' sur actifs_individuels
        const { error: aErr } = await db
          .from('actifs_individuels')
          .update({ statut: 'En service' })
          .eq('id', pret.actif_id);
        if (aErr) throw aErr;

        showToast(`"${pret.actif_id}" retourné — remis en service`);
        await Promise.all([loadPrets(), loadActifs()]);
        render();
      } catch (err) {
        showToast('Erreur : ' + err.message, 'err');
      }
    },
    '#10b981'
  );
};

// ─── Export CSV ────────────────────────────────────────────────
window.exportPretsCSV = (dept) => {
  const all = (ST.prets || []).filter(p => p.dept === dept);

  const headers = [
    'ID Prêt', 'N° Actif', 'Produit', 'Catégorie', 'Département',
    'Emprunteur', 'Valideur',
    'Date prêt', 'Retour prévu', 'Retour effectif',
    'Destination', 'Motif', 'Statut',
  ];

  const rows = all.map(p => [
    p.id,
    p.actif_id                    || '',
    p.produit_nom                 || '',
    p.categorie                   || '',
    p.dept,
    p.emprunteur                  || '',
    p.valideur                    || '',
    fmtDT(p.date_pret || p.created_at),
    p.date_retour_prevue          || '',
    p.date_retour_effective ? fmtDT(p.date_retour_effective) : '',
    p.destination                 || '',
    p.motif                       || '',
    p.statut,
  ]);

  exportToCSV(rows, headers, `prets_${dept.toLowerCase()}_${todayFileDate()}.csv`);
};