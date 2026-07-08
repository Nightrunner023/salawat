/* Ṣalawāt — logique du frontend */

const nf = new Intl.NumberFormat('fr-FR');
const dayShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayMonthShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const $ = (id) => document.getElementById(id);
const asDate = (iso) => new Date(iso + 'T12:00:00Z');
function localToday() {
  return new Date().toLocaleDateString('en-CA'); // AAAA-MM-JJ, fuseau local
}

let CLIENT_ID = '';
let STATE = null;
let SELECTED_DATE = null; // jour sélectionné pour la saisie (défaut : aujourd'hui)

// --- Appels API ---------------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// --- Connexion Google -----------------------------------------------------------
function showLogin(note) {
  $('appView').hidden = true;
  $('loginView').hidden = false;
  if (note) $('loginNote').textContent = note;
  initGoogleButton();
}

let googleInit = false;
function initGoogleButton() {
  if (googleInit) return;
  if (!CLIENT_ID) {
    $('loginNote').textContent = 'Configuration manquante : GOOGLE_CLIENT_ID absent côté serveur.';
    return;
  }
  const tryInit = () => {
    if (!(window.google && google.accounts && google.accounts.id)) {
      setTimeout(tryInit, 150);
      return;
    }
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: onGoogleCredential,
      ux_mode: 'popup',
    });
    google.accounts.id.renderButton($('googleBtn'), {
      theme: 'outline', size: 'large', text: 'signin_with', locale: 'fr', width: 280,
    });
    googleInit = true;
  };
  tryInit();
}

async function onGoogleCredential(response) {
  const { status } = await api('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential: response.credential }),
  });
  if (status === 200) {
    await loadState();
  } else {
    $('loginNote').textContent = 'La connexion a échoué. Réessayez.';
  }
}

// --- Chargement et rendu ----------------------------------------------------------
async function loadState() {
  const { status, data } = await api('/api/state?today=' + localToday());
  if (status === 401) return showLogin();
  if (!data.ok) return showLogin('Erreur de chargement. Réessayez.');
  STATE = data;
  render();
}

function render() {
  $('loginView').hidden = true;
  $('appView').hidden = false;

  const w = STATE.week;
  $('userName').textContent = STATE.user.name ? 'As-salāmu ʿalaykum, ' + STATE.user.name : '';
  $('weekRange').textContent =
    'Semaine du ' + dayMonth.format(asDate(w.start)) + ' au ' + dayMonth.format(asDate(w.end));
  $('weekTotal').textContent = nf.format(w.total);

  // Jour sélectionné : aujourd'hui par défaut, ou la sélection précédente si
  // elle appartient toujours à la semaine affichée.
  const today = localToday();
  const inWeek = w.days.some((d) => d.date === SELECTED_DATE);
  if (!SELECTED_DATE || !inWeek) SELECTED_DATE = today;

  // Jours (cliquables : on peut créditer un autre jour de la semaine)
  const days = $('days');
  days.innerHTML = '';
  for (const d of w.days) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'day'
      + (d.date === today ? ' day--today' : '')
      + (d.date > today ? ' day--future' : '')
      + (d.date === SELECTED_DATE ? ' day--selected' : '');
    const name = dayShort.format(asDate(d.date)).replace('.', '');
    el.innerHTML = `<p class="day__name">${name}</p><p class="day__count">${nf.format(d.total)}</p>`;
    el.addEventListener('click', () => {
      SELECTED_DATE = d.date;
      render();
    });
    days.appendChild(el);
  }
  updateEntryButton();

  // Historique
  $('allTime').textContent = nf.format(STATE.allTimeTotal);
  const list = $('historyList');
  list.innerHTML = '';
  $('historyEmpty').hidden = STATE.history.length > 0;
  for (const h of STATE.history) {
    const li = document.createElement('li');
    li.className = 'history__item';
    li.innerHTML =
      `<span class="history__range">${dayMonthShort.format(asDate(h.start_date))} au ${dayMonthShort.format(asDate(h.end_date))}</span>` +
      `<span class="history__total">${nf.format(h.total)}</span>`;
    list.appendChild(li);
  }

  // Réglage
  $('weekStartSelect').value = String(STATE.user.weekStart);

  if (STATE.archivedNow > 0) {
    flash('Semaine(s) passée(s) enregistrée(s) dans l\'historique.');
  }
}

// Libellé du bouton selon le jour visé.
function updateEntryButton() {
  const btn = $('entrySubmit');
  if (SELECTED_DATE === localToday()) {
    btn.textContent = 'Ajouter à aujourd\'hui';
  } else {
    const name = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' })
      .format(asDate(SELECTED_DATE));
    btn.textContent = 'Ajouter à ' + name;
  }
}

function flash(msg) {
  const el = $('entryMsg');
  el.textContent = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.textContent = ''; }, 3500);
}

// --- Actions -------------------------------------------------------------------
$('entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('entryAmount');
  const n = parseInt(input.value, 10);
  if (!Number.isInteger(n) || n < 1) { flash('Entrez un nombre valide.'); return; }
  const { status } = await api('/api/entries', {
    method: 'POST',
    body: JSON.stringify({ date: SELECTED_DATE || localToday(), amount: n }),
  });
  if (status === 401) return showLogin();
  if (status === 200) {
    input.value = '';
    flash('+ ' + nf.format(n) + ' — qu\'Allah les accepte.');
    await loadState();
  } else {
    flash('Erreur, réessayez.');
  }
});

$('btnUndo').addEventListener('click', async () => {
  const target = SELECTED_DATE || localToday();
  const { status, data } = await api('/api/entries/last?date=' + target, { method: 'DELETE' });
  if (status === 401) return showLogin();
  if (status === 200) {
    flash('Dernière saisie annulée (' + nf.format(data.removed) + ').');
    await loadState();
  } else if (status === 404) {
    flash('Rien à annuler ce jour-là.');
  }
});

$('btnClose').addEventListener('click', async () => {
  if (!STATE || STATE.week.total <= 0) { flash('Rien à enregistrer cette semaine.'); return; }
  const ok = confirm(
    'Clôturer la semaine ?\n\nLe total de ' + nf.format(STATE.week.total) +
    ' ṣalawāt sera enregistré dans l\'historique, puis le compteur repartira à zéro.'
  );
  if (!ok) return;
  const { status } = await api('/api/week/close', {
    method: 'POST',
    body: JSON.stringify({ today: localToday() }),
  });
  if (status === 401) return showLogin();
  if (status === 200) {
    flash('Semaine enregistrée. Qu\'Allah accepte.');
    await loadState();
  }
});

$('weekStartSelect').addEventListener('change', async (e) => {
  const { status } = await api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ week_start: Number(e.target.value) }),
  });
  if (status === 401) return showLogin();
  await loadState();
});

$('btnLogout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  googleInit = false;
  showLogin('Vous êtes déconnecté.');
});

// --- Démarrage -------------------------------------------------------------------
(async function init() {
  const cfg = await api('/api/config');
  CLIENT_ID = (cfg.data && cfg.data.clientId) || '';
  await loadState();
})();

// Mode application (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
