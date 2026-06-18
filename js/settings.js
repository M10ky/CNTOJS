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

// ── UTILISATEURS ──
function renderUtilisateurs() {
  if (!isAdmin()) return accessDenied();
  const roleColors={'Administrateur':{c:'#6d28d9',bg:'#ede9fe'},'Support IT':{c:'#3730a3',bg:'#e0e7ff'},'Responsable Finance':{c:'#065f46',bg:'#d1fae5'},'Utilisateur IT':{c:'#1e40af',bg:'#dbeafe'},'Utilisateur Finance':{c:'#064e3b',bg:'#d1fae5'}};
  const permMatrix=`<div class="card" style="margin-bottom:12px">
    <div class="card-hd"><span class="card-ttl"><i class="ti ti-shield-check" style="color:var(--teal)"></i>Matrice des droits par rôle</span></div>
    <div style="overflow-x:auto;padding:0 2px"><table>
      <thead><tr><th>Fonctionnalité</th><th style="color:#6d28d9">Admin</th><th style="color:#3730a3">Support IT</th><th style="color:#065f46">Resp. Finance</th><th style="color:#1e40af">Util. IT</th><th style="color:#064e3b">Util. Finance</th></tr></thead>
      <tbody>${[['Dashboard global','✅','✅','✅','—','—'],['Inventaire IT','✅','✅','—','✅ (lecture)','—'],['Inventaire Finance','✅','—','✅','—','✅ (lecture)'],['Mouvements IT','✅','✅','—','—','—'],['Mouvements Finance','✅','—','✅','—','—'],['Demandes IT (créer)','✅','✅','—','✅','—'],['Demandes Finance (créer)','✅','—','✅','—','✅'],['Valider demandes IT','✅','✅','—','—','—'],['Valider demandes Finance','✅','—','✅','—','—'],['Historique & Rapports','✅','—','—','—','—'],['Amortissement','✅','—','—','—','—'],['Gestion utilisateurs','✅','—','—','—','—'],['Paramètres système','✅','—','—','—','—'],['Voir prix / valeurs','✅','✅','✅','—','—']].map(([f,...v])=>`<tr><td style="font-weight:500;font-size:12px">${f}</td>${v.map(x=>`<td style="text-align:center;font-size:13px">${x}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></div>`;
  const rows=ST.allProfiles.map(u=>{
    const rc=roleColors[u.role]||{c:'#475569',bg:'#f1f5f9'};
    const dLabel=u.dept==='both'?'IT + Finance':u.dept;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="width:30px;height:30px;border-radius:50%;background:${u.color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">${u.name.charAt(0).toUpperCase()}</div>
        <div><div style="font-weight:600;font-size:12.5px">${u.name}</div><div style="font-size:10px;color:var(--text3)">${u.email||u.id.slice(0,12)+'…'}</div></div>
      </div></td>
      <td><span class="role-badge" style="color:${rc.c};background:${rc.bg}">${u.role}</span></td>
      <td><span class="tag" style="color:#475569;background:#f1f5f9">${dLabel}</span></td>
      <td><div style="display:flex;align-items:center;gap:6px"><span class="status-dot" style="background:${u.is_active?'#22c55e':'#94a3b8'}"></span><span style="font-size:11.5px;color:${u.is_active?'#16a34a':'#94a3b8'};font-weight:600">${u.is_active?'Actif':'Inactif'}</span></div></td>
      <td>${fmtDT(u.created_at)}</td>
      <td>${u.id!==ST.user?.id?btn(u.is_active?'Désactiver':'Activer',u.is_active?'#ef4444':'#10b981',true,`toggleUserActive('${u.id}',${u.is_active})`):'<span style="font-size:11px;color:var(--text3)">Compte actuel</span>'}</td>
    </tr>`;
  }).join('');
  return `<p class="page-title">Gestion des Utilisateurs</p>
    <p class="page-sub">${ST.allProfiles.length} utilisateur(s) enregistré(s)</p>
    <div class="card" style="margin-bottom:12px;background:#eff6ff;border-color:#bfdbfe"><div style="padding:13px 16px;font-size:12px;color:#1e40af"><i class="ti ti-info-circle" style="vertical-align:middle;margin-right:6px"></i>Pour créer des utilisateurs : <strong>Supabase → Authentication → Users → Invite User</strong>, puis insérer le profil dans <code>profiles</code> avec le même UUID.</div></div>
    ${permMatrix}
    <div class="card">
      <div class="card-hd">
        <span class="card-ttl"><i class="ti ti-users" style="color:var(--teal)"></i>Liste des comptes</span>
        <div class="btn-row">${btn('↓ CSV','#10b981',true,'exportUtilisateursCSV()','ti-download')}</div>
      </div>
      <div style="overflow-x:auto"><table>
        <thead><tr>${['Utilisateur','Rôle','Département','Statut','Créé le','Action'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">Aucun profil</td></tr>'}</tbody>
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
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        ${[['Produits IT',ST.produits.filter(p=>p.dept==='IT').length,'#4f46e5'],['Produits Finance',ST.produits.filter(p=>p.dept==='Finance').length,'#10b981'],['Utilisateurs',ST.allProfiles.length,'#f59e0b'],['Destinations',ST.params.destinations.length,'#00c9a7']].map(([l,v,c])=>`<div style="background:#fff;border:1px solid var(--border);border-radius:9px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:${c}">${v}</div><div style="font-size:10px;color:var(--text3);margin-top:2px">${l}</div></div>`).join('')}
      </div>
    </div>`;
}