'use strict';

// ═══ AUTHENTIFICATION ═══
async function init() {
  setLoaderMsg('Vérification de la session…');
  try {
    const { data:{ session } } = await db.auth.getSession();
    if (session) {
      setLoaderMsg('Chargement du profil…');
      await loadProfile(session.user);
      if (!ST.profile) { showLoginErr("Profil introuvable. Contactez l'administrateur."); showLogin(); return; }
      setLoaderMsg('Chargement des données…');
      await loadAllData(); showApp(); setupRealtime();
    } else { showLogin(); }
  } catch(err) { console.error(err); showLogin(); }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event==='SIGNED_IN' && session && !ST.profile) {
      await loadProfile(session.user);
      if (!ST.profile) { showLoginAlert('Profil introuvable.','err'); doLogout(); return; }
      await loadAllData(); showApp(); setupRealtime();
    } else if (event==='SIGNED_OUT') {
      cleanupRealtime(); ST.user=null; ST.profile=null; showLogin();
    } else if (event==='USER_UPDATED') { if (session) await loadProfile(session.user); }
  });
}

async function loadProfile(authUser) {
  ST.user = authUser;
  const { data, error } = await db.from('profiles').select('*').eq('id',authUser.id).single();
  if (error||!data) { ST.profile=null; return; }
  if (!data.is_active) { ST.profile=null; showLoginAlert('Compte désactivé.','err'); return; }
  ST.profile = data;
}

window.doLogin = async () => {
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-pwd').value;
  clearLoginAlert();
  if (!email) { showLoginAlert('Veuillez saisir votre adresse e-mail.','err'); document.getElementById('login-email').classList.add('error'); return; }
  if (!pwd)   { showLoginAlert('Veuillez saisir votre mot de passe.','err'); document.getElementById('login-pwd').classList.add('error'); return; }
  setLoginLoading(true);
  const { data, error } = await db.auth.signInWithPassword({ email, password:pwd });
  if (error) {
    const msgs={'Invalid login credentials':'E-mail ou mot de passe incorrect.','Email not confirmed':'Veuillez confirmer votre e-mail avant de vous connecter.','Too many requests':'Trop de tentatives. Réessayez dans quelques minutes.'};
    showLoginAlert(msgs[error.message]||error.message,'err');
    setLoginLoading(false);
  }
};

window.doLogout = async () => {
  cleanupRealtime(); ST.produits=[]; ST.mouvements=[]; ST.demandes=[]; ST.allProfiles=[];
  await db.auth.signOut();
};

window.forgotPassword = async () => {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { showLoginAlert('Saisissez votre e-mail pour recevoir le lien.','info'); return; }
  const { error } = await db.auth.resetPasswordForEmail(email,{ redirectTo:window.location.origin+window.location.pathname });
  if (error) { showLoginAlert(error.message,'err'); return; }
  showLoginAlert('Lien envoyé à '+email+'. Vérifiez vos spams.','ok');
};

window.togglePwd = () => {
  const inp=document.getElementById('login-pwd'), icon=document.getElementById('eye-icon');
  const h=inp.type==='password'; inp.type=h?'text':'password'; icon.className=h?'ti ti-eye-off':'ti ti-eye';
};

function setLoginLoading(on) {
  const b=document.getElementById('login-btn');
  document.getElementById('login-btn-text').textContent=on?'Connexion en cours…':'Se connecter';
  document.getElementById('login-btn-icon').className=on?'':'ti ti-login';
  b.disabled=on;
  if (on) { const sp=document.createElement('span'); sp.className='btn-spinner'; b.prepend(sp); }
  else b.querySelector('.btn-spinner')?.remove();
}

function showLoginAlert(msg,type='err') {
  const el=document.getElementById('login-alert');
  const icons={err:'ti-alert-circle',ok:'ti-circle-check',info:'ti-info-circle'};
  el.innerHTML=`<i class="ti ${icons[type]||'ti-alert-circle'}"></i> ${msg}`;
  el.className=`login-alert ${type}`; el.style.display='flex';
}

function clearLoginAlert() {
  document.getElementById('login-alert').style.display='none';
  ['login-email','login-pwd'].forEach(id=>document.getElementById(id)?.classList.remove('error'));
}

function showLoginErr(msg) { showLoginAlert(msg,'err'); }

function showLogin() {
  hideLoader();
  document.getElementById('login-wrap').style.display='flex';
  document.getElementById('app').style.display='none';
  setLoginLoading(false);
  setTimeout(()=>document.getElementById('login-email').focus(),100);
}

function showApp() {
  hideLoader();
  document.getElementById('login-wrap').style.display='none';
  document.getElementById('app').style.display='flex';
  if      (isAdmin())     ST.tab='dashboard';
  else if (isSupportIT()) ST.tab='stock-it';
  else if (isResFin())    ST.tab='stock-fin';
  else if (isUserIT())    ST.tab='dem-it';
  else if (isUserFin())   ST.tab='dem-fin';
  else if (isLecteur())   ST.tab='dashboard';
  else                    ST.tab='dashboard';
  const p=ST.profile;
  if (p) {
    const av=document.getElementById('ua');
    av.textContent=p.name.charAt(0).toUpperCase();
    av.style.background=`linear-gradient(135deg,${p.color},${p.color}bb)`;
    document.getElementById('un').textContent=p.name;
    document.getElementById('ur').textContent=p.role;
  }
  render();
}

function setLoaderMsg(msg) { document.getElementById('loader-msg').textContent=msg; }
function showLoader()  { document.getElementById('global-loader').classList.remove('hidden'); }
function hideLoader()  { document.getElementById('global-loader').classList.add('hidden'); }

// ═══ REALTIME ═══
function setupRealtime() {
  cleanupRealtime();
  const ch = db.channel('connecteo-stock-rt')
    .on('postgres_changes',{event:'*',schema:'public',table:'produits'},   async()=>{ await loadProduits();   render(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'mouvements'}, async()=>{ await loadMouvements(); render(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'demandes'},   async()=>{ await loadDemandes();   render(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'parametres'},        async()=>{ await loadParams();  render(); })
    .on('postgres_changes',{event:'*',schema:'public',table:'actifs_individuels'},async()=>{ await loadActifs(); render(); }) // ← Étape C
    .on('postgres_changes',{event:'*',schema:'public',table:'prets'},             async()=>{ await loadPrets();  render(); }) // ← Étape E
    .subscribe(status=>{ if(status==='SUBSCRIBED') console.log('[RT] Connecté'); });
  ST.rtChannels=[ch];
}

function cleanupRealtime() { ST.rtChannels.forEach(c=>db.removeChannel(c)); ST.rtChannels=[]; }