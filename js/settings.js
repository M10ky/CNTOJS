'use strict';

// ═══ PARAMÈTRES ═══
window.addParam = async (cle, inputId) => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur",'err'); return; }
  const val=document.getElementById(inputId)?.value?.trim();
  if (!val) return;
  if (ST.params[cle]?.includes(val)) { showToast('Valeur déjà existante','err'); return; }
  try {
    const { error } = await db.from('parametres').insert({cle,valeur:val});
    if (error) throw error;
    document.getElementById(inputId).value='';
    showToast('Ajouté avec succès'); await loadParams(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

window.removeParam = async (cle, val) => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur",'err'); return; }
  try {
    const { error } = await db.from('parametres').delete().eq('cle',cle).eq('valeur',val);
    if (error) throw error;
    showToast('Supprimé'); await loadParams(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

window.toggleUserActive = async (userId, currentState) => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur",'err'); return; }
  try {
    const { error } = await db.from('profiles').update({is_active:!currentState}).eq('id',userId);
    if (error) throw error;
    showToast(currentState?'Compte désactivé':'Compte activé');
    await loadAllProfiles(); render();
  } catch(err) { showToast('Erreur: '+err.message,'err'); }
};

// ── Changement de rôle ────────────────────────────────────────
window.changeUserRole = async (userId, newRole, selectEl) => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur", 'err'); return; }
  const u = ST.allProfiles.find(x => x.id === userId);
  if (!u || u.role === newRole) return;
  const oldRole = u.role;

  // Revenir immédiatement à l'ancienne valeur dans le select :
  // si l'utilisateur annule, le select ne reste pas sur la nouvelle valeur.
  if (selectEl) selectEl.value = oldRole;

  showConfirm(
    `Changer le rôle de « ${u.name} » ?`,
    `<strong>${oldRole}</strong> → <strong>${newRole}</strong><br>
     <span style="font-size:11px;color:var(--text3)">
       Ce changement prend effet immédiatement à la prochaine connexion de l'utilisateur.
     </span>`,
    async () => {
      try {
        const { error } = await db.from('profiles').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
        showToast(`Rôle de « ${u.name} » → ${newRole}`);
        await loadAllProfiles(); render();
      } catch(err) { showToast('Erreur : ' + err.message, 'err'); }
    },
    '#6366f1'
  );
};

// ── Réinitialisation mot de passe ─────────────────────────────
window.resetUserPassword = async (email) => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur", 'err'); return; }
  showConfirm(
    `Réinitialiser le mot de passe de ${email} ?`,
    'Un e-mail avec un lien de réinitialisation sera envoyé. L\'utilisateur devra cliquer sur le lien pour définir un nouveau mot de passe.',
    async () => {
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) { showToast(error.message, 'err'); return; }
      showToast(`Lien de réinitialisation envoyé à ${email}`);
    },
    '#6366f1'
  );
};

// ── Suppression du profil ─────────────────────────────────────
// Supprime uniquement le profil dans la table profiles.
// Le compte Supabase Auth doit être supprimé séparément dans le dashboard Supabase.
window.deleteUserProfile = async (userId, name) => {
  if (!isAdmin()) { showToast("Réservé à l'administrateur", 'err'); return; }
  if (userId === ST.user?.id) { showToast('Impossible de supprimer votre propre compte', 'err'); return; }
  showConfirm(
    `Supprimer le profil de « ${name} » ?`,
    `Le profil sera retiré de l'application. Le compte Supabase Auth devra être supprimé
     séparément dans le dashboard (<em>Authentication → Users</em>). Cette action est irréversible.`,
    async () => {
      try {
        const { error } = await db.from('profiles').delete().eq('id', userId);
        if (error) throw error;
        showToast(`Profil de « ${name} » supprimé`);
        await loadAllProfiles(); render();
      } catch(err) { showToast('Erreur : ' + err.message, 'err'); }
    },
    '#ef4444'
  );
};

// ── UTILISATEURS ──
function renderUtilisateurs() {
  if (!isAdmin()) return accessDenied();

  const ALL_ROLES = [
    'Administrateur','Support IT','Responsable Finance',
    'Utilisateur IT','Utilisateur Finance','Lecteur',
  ];
  const ROLE_COLORS = {
    'Administrateur':      { c:'#6d28d9', bg:'#ede9fe' },
    'Support IT':          { c:'#3730a3', bg:'#e0e7ff' },
    'Responsable Finance': { c:'#065f46', bg:'#d1fae5' },
    'Utilisateur IT':      { c:'#1e40af', bg:'#dbeafe' },
    'Utilisateur Finance': { c:'#064e3b', bg:'#d1fae5' },
    'Lecteur':             { c:'#92400e', bg:'#fef3c7' },
  };

  // ── Filtrage ──────────────────────────────────────────────
  const q       = (ST.search.inline.query   || '').toLowerCase().trim();
  const roleF   =  ST.search.inline.userRole || '';
  const statutF =  ST.search.inline.statDem  || '';

  const filtered = ST.allProfiles.filter(u => {
    if (q && !matchesQuery([u.name, u.email || '', u.role, u.dept === 'both' ? 'IT Finance' : u.dept], q)) return false;
    if (roleF   && u.role !== roleF)                      return false;
    if (statutF === 'actif'   && !u.is_active)            return false;
    if (statutF === 'inactif' &&  u.is_active)            return false;
    return true;
  });

  const total   = ST.allProfiles.length;
  const actifs  = ST.allProfiles.filter(u => u.is_active).length;
  const inactifs = total - actifs;

  // ── KPIs ─────────────────────────────────────────────────
  const kpis = [
    { lbl:'Total comptes', val:total,    s:`${actifs} actif(s) · ${inactifs} inactif(s)`, c:'#4f46e5' },
    { lbl:'Actifs',        val:actifs,   s:'comptes actifs',    c:'#10b981' },
    { lbl:'Inactifs',      val:inactifs, s:'comptes désactivés',c:'#94a3b8' },
    ...ALL_ROLES
      .map(r => ({ r, n: ST.allProfiles.filter(u => u.role === r).length }))
      .filter(({ n }) => n > 0)
      .map(({ r, n }) => ({
        lbl: r.replace('Responsable ','Resp. ').replace('Utilisateur ','Util. '),
        val: n, s:'utilisateur(s)',
        c: ROLE_COLORS[r]?.c || '#64748b',
      })),
  ];

  // ── Filtre-pills rôle ─────────────────────────────────────
  const rolePills = ALL_ROLES.map(r => {
    const on  = roleF === r;
    const rc  = ROLE_COLORS[r];
    const lbl = r.replace('Responsable ','Resp. ').replace('Utilisateur ','Util. ');
    return `<span class="csb-pill${on ? ' on' : ''}"
      style="${on ? `background:${rc.c};border-color:${rc.c};color:#fff` : ''}"
      onclick="setUserRoleFilter('${on ? '' : r}')">${lbl}</span>`;
  }).join('');

  const hasFilter = !!(q || roleF || statutF);

  // ── Barre de recherche ────────────────────────────────────
  const searchBar = `
    <div class="content-search-bar" style="margin-bottom:12px">
      <div class="csb-row csb-row-search">
        <div class="csb-input-wrap">
          <i class="ti ti-search"></i>
          <input class="csb-input" type="text"
            placeholder="Rechercher par nom, email, rôle, département…"
            value="${q.replace(/"/g,'&quot;')}"
            oninput="setInlineFilterQuery(this.value)"
            onkeydown="if(event.key==='Escape'){setInlineFilterQuery('');this.value='';}">
          ${q ? `<button class="csb-clear-input"
              onclick="setInlineFilterQuery('');document.querySelector('.csb-input').value=''">
              <i class="ti ti-x"></i></button>` : ''}
        </div>
        <span class="csb-count">${filtered.length} / ${total}</span>
        ${hasFilter ? `<button class="csb-reset" onclick="resetInlineFilters()">
            <i class="ti ti-refresh" style="font-size:11px"></i> Réinit.</button>` : ''}
      </div>
      <div class="csb-row csb-row-filters">
        <div class="csb-chip-group">
          <span class="csb-filter-label">Statut</span>
          <span class="csb-pill${statutF==='actif'?' on on-ok':''}"
            onclick="toggleInlineFilter('statDem','actif')">● Actifs</span>
          <span class="csb-pill${statutF==='inactif'?' on':''}"
            style="${statutF==='inactif'?'background:#94a3b8;border-color:#94a3b8;color:#fff':''}"
            onclick="toggleInlineFilter('statDem','inactif')">○ Inactifs</span>
        </div>
        <div class="csb-chip-group" style="flex-wrap:wrap;gap:4px">
          <span class="csb-filter-label">Rôle</span>
          ${rolePills}
        </div>
      </div>
    </div>`;

  // ── Lignes du tableau ─────────────────────────────────────
  const rows = filtered.map(u => {
    const rc     = ROLE_COLORS[u.role] || { c:'#475569', bg:'#f1f5f9' };
    const dLabel = u.dept === 'both' ? 'IT + Finance' : (u.dept || '—');
    const isSelf = u.id === ST.user?.id;

    const roleOpts = ALL_ROLES.map(r =>
      `<option value="${r}"${u.role === r ? ' selected' : ''}>${r}</option>`
    ).join('');

    return `<tr${!u.is_active ? ' class="row-inactif"' : ''}>
      <td>
        <div style="display:flex;align-items:center;gap:9px">
          <div style="width:34px;height:34px;border-radius:50%;background:${u.color||'#64748b'};
            display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;
            color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.15)">
            ${u.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:600;font-size:12.5px">${highlight(u.name, q)}</div>
            <div style="font-size:10px;color:var(--text3)">${highlight(u.email || u.id.slice(0,16)+'…', q)}</div>
          </div>
        </div>
      </td>
      <td>
        <select class="role-select-inline"
          style="border-color:${rc.c};color:${rc.c};background:${rc.bg}"
          ${isSelf ? 'disabled title="Impossible de changer son propre rôle"' : ''}
          onchange="changeUserRole('${u.id}', this.value, this)">
          ${roleOpts}
        </select>
      </td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${highlight(dLabel, q)}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="status-dot" style="background:${u.is_active ? '#22c55e' : '#94a3b8'}"></span>
          <span style="font-size:11.5px;font-weight:600;color:${u.is_active ? '#16a34a' : '#94a3b8'}">
            ${u.is_active ? 'Actif' : 'Inactif'}
          </span>
        </div>
      </td>
      <td style="font-size:11px;color:var(--text3)">${fmtDate(u.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
          ${!isSelf
            ? btn(u.is_active ? 'Désactiver' : 'Activer',
                  u.is_active ? '#f59e0b'    : '#10b981',
                  true, `toggleUserActive('${u.id}',${u.is_active})`)
            : ''}
          ${u.email
            ? btn('🔑 Réinit. mdp', '#6366f1', true, `resetUserPassword('${u.email}')`)
            : ''}
          ${!isSelf
            ? btn('🗑', '#ef4444', true, `deleteUserProfile('${u.id}','${u.name.replace(/'/g,"\\\'")}')`)
            : `<span style="font-size:10px;color:var(--text3);white-space:nowrap">Compte actuel</span>`}
        </div>
      </td>
    </tr>`;
  }).join('');

  const emptyState = `<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--text3)">
    Aucun utilisateur trouvé
    ${hasFilter ? `— <a href="#" onclick="resetInlineFilters();return false;" style="color:var(--teal)">Réinitialiser les filtres</a>` : ''}
  </td></tr>`;

  return `<p class="page-title">Gestion des Utilisateurs</p>
    <p class="page-sub">${total} compte(s) · ${actifs} actif(s) · ${inactifs} inactif(s)</p>

    <div class="kpi-grid">${kpis.slice(0, 8).map(k =>
      `<div class="kpi" style="border-left-color:${k.c}">
        <div class="kpi-lbl">${k.lbl}</div>
        <div class="kpi-val">${k.val}</div>
        <div class="kpi-s">${k.s || ''}</div>
      </div>`
    ).join('')}</div>

    <div class="card" style="background:#eff6ff;border-color:#bfdbfe;margin-bottom:12px">
      <div style="padding:13px 16px;font-size:12px;color:#1e40af">
        <i class="ti ti-info-circle" style="vertical-align:middle;margin-right:6px"></i>
        <strong>Inviter un utilisateur :</strong>
        Supabase → Authentication → Users → <em>Invite User</em>,
        puis insérer le profil dans <code>profiles</code> avec le même UUID et les champs :
        <code>name</code>, <code>role</code>, <code>dept</code>, <code>color</code>, <code>is_active</code>.
        <a href="https://supabase.com/dashboard" target="_blank"
          style="margin-left:8px;color:#1d4ed8;font-weight:700;text-decoration:none">
          Ouvrir Supabase ↗
        </a>
      </div>
    </div>

    ${searchBar}

    <div class="card">
      <div class="card-hd">
        <span class="card-ttl">
          <i class="ti ti-users" style="color:var(--teal)"></i>
          Annuaire des comptes (${filtered.length})
        </span>
        <div class="btn-row">
          ${btn('↓ CSV', '#10b981', true, 'exportUtilisateursCSV()', 'ti-download')}
        </div>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr>
          ${['Utilisateur','Rôle','Département','Statut','Créé le','Actions']
            .map(h => `<th>${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rows || emptyState}</tbody>
      </table></div>
    </div>`;
}

// ── PARAMÈTRES SYSTÈME ──
function renderParams() {
  if (!isAdmin()) return accessDenied();
  const mkList=(items,cle)=>items.map(v=>`<div class="tag-item">${v}<span class="del" onclick="removeParam('${cle}','${v.replace(/'/g,"\\'")}')">×</span></div>`).join('');
  return `<p class="page-title">Paramètres Système</p>
    <p class="page-sub">Configuration des listes métier</p>
    <div class="param-section">
      <div class="param-title"><i class="ti ti-map-pin" style="color:var(--teal)"></i>Destinations / Plateaux</div>
      <div class="tag-list">${mkList(ST.params.destinations,'destinations')}</div>
      <div class="tag-add-row"><input id="new-dest" placeholder="Ex: Plateau RH – 3ème étage…" onkeydown="if(event.key==='Enter')addParam('destinations','new-dest')">${btn('Ajouter','#00c9a7',false,"addParam('destinations','new-dest')",'ti-plus')}</div>
    </div>
    <div class="param-section">
      <div class="param-title"><i class="ti ti-package" style="color:#6366f1"></i>Emplacements de Stockage</div>
      <div class="tag-list">${mkList(ST.params.emplacements,'emplacements')}</div>
      <div class="tag-add-row"><input id="new-empl" placeholder="Ex: Stock Principal, Réserve B…" onkeydown="if(event.key==='Enter')addParam('emplacements','new-empl')">${btn('Ajouter','#6366f1',false,"addParam('emplacements','new-empl')",'ti-plus')}</div>
    </div>
    <div class="param-section">
      <div class="param-title"><i class="ti ti-truck" style="color:#0ea5e9"></i>Fournisseurs</div>
      <div class="tag-list">${mkList(ST.params.fournisseurs||[],'fournisseurs')}</div>
      <div class="tag-add-row">
        <input id="new-fourn" placeholder="Ex: SIMKO, Digit Technology, Connectic…"
          onkeydown="if(event.key==='Enter')addParam('fournisseurs','new-fourn')">
        ${btn('Ajouter','#0ea5e9',false,"addParam('fournisseurs','new-fourn')",'ti-plus')}
      </div>
    </div>
    <div class="param-section">
      <div class="param-title"><i class="ti ti-device-laptop" style="color:#4f46e5"></i>Catégories IT</div>
      <div class="tag-list">${mkList(ST.params.categoriesIT,'categoriesIT')}</div>
      <div class="tag-add-row"><input id="new-cat-it" placeholder="Nouvelle catégorie IT…" onkeydown="if(event.key==='Enter')addParam('categoriesIT','new-cat-it')">${btn('Ajouter','#4f46e5',false,"addParam('categoriesIT','new-cat-it')",'ti-plus')}</div>
    </div>
    <div class="param-section">
      <div class="param-title"><i class="ti ti-files" style="color:#10b981"></i>Catégories Finance</div>
      <div class="tag-list">${mkList(ST.params.categoriesFin,'categoriesFin')}</div>
      <div class="tag-add-row"><input id="new-cat-fin" placeholder="Nouvelle catégorie Finance…" onkeydown="if(event.key==='Enter')addParam('categoriesFin','new-cat-fin')">${btn('Ajouter','#10b981',false,"addParam('categoriesFin','new-cat-fin')",'ti-plus')}</div>
    </div>
    <div class="param-section" style="background:#fafbff">
      <div class="param-title"><i class="ti ti-info-circle" style="color:#6366f1"></i>Informations système</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px">
        ${[['Produits IT',ST.produits.filter(p=>p.dept==='IT').length,'#4f46e5'],['Produits Finance',ST.produits.filter(p=>p.dept==='Finance').length,'#10b981'],['Utilisateurs',ST.allProfiles.length,'#f59e0b'],['Destinations',ST.params.destinations.length,'#00c9a7'],['Fournisseurs',(ST.params.fournisseurs||[]).length,'#0ea5e9']].map(([l,v,c])=>`<div style="background:#fff;border:1px solid var(--border);border-radius:9px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:${c}">${v}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${l}</div></div>`).join('')}
      </div>
    </div>`;
}