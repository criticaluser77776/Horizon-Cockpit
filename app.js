'use strict';
/* Horizon-Cockpit – Gerüst (P1): Anmeldung, Account, Lage, Ereignisse, Pläne (Liste + Freigabe), Wissen, Geräte & Rechte.
   Alle Daten aus Supabase (cloud.js); Texte aus der Datenbank werden immer escaped. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => n == null || n === '' || !isFinite(n) ? '–'
  : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const dt = t => t ? new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
function ago(t) {
  if (!t) return '–';
  const s = Math.round((Date.now() - new Date(t)) / 1000);
  if (s < 90) return 'gerade eben';
  if (s < 5400) return `vor ${Math.round(s / 60)} min`;
  if (s < 172800) return `vor ${fmt(s / 3600, 1)} h`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}
function dur(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return (d ? `${d} d ` : '') + `${h} h ${String(m).padStart(2, '0')} min`;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}

const S = { acc: null, wissen: null };
const ROLE = { owner: 'Owner', executor: 'Skript', claude: 'Claude', viewer: 'Lesen' };
const STAGES = ['Doku', 'Parser', 'Erkennung', 'Live erhoben', 'Probelauf', 'Erste Aktion', 'Frei'];

function accounts() { return Cloud.access()?.accounts || []; }
function account() { return accounts().find(a => a.id === S.acc) || null; }
function isOwner() { return account()?.role === 'owner'; }

/* ---------- Start und Anmeldung ---------- */

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('hashchange', route);
  if (!Cloud.loggedIn()) return renderLogin();
  try { await Cloud.touch(); } catch (e) {
    if (e instanceof LoginNeeded) return renderLogin(e.message);
    toast(e.message);  // offline: mit gespeichertem Stand weiter
  }
  afterLogin();
}

function afterLogin() {
  try { S.acc = localStorage.getItem('hz.acc'); } catch { /* egal */ }
  if (!accounts().some(a => a.id === S.acc)) S.acc = accounts()[0]?.id || null;
  renderAccSelect();
  if (!S.acc) return renderNoAccount();
  $('#tabs').hidden = false;
  route();
}

function renderAccSelect() {
  const a = Cloud.access();
  const list = accounts();
  $('#acc').innerHTML = !a?.code ? '' : list.length > 1
    ? `<select id="accSel">${list.map(x => `<option value="${esc(x.id)}"${x.id === S.acc ? ' selected' : ''}>${esc(x.player)} (${esc(ROLE[x.role] || x.role)})</option>`).join('')}</select>`
    : `${esc(account()?.player || a.group || '')}${account() ? ` · ${esc(ROLE[account().role] || '')}` : ''}`;
  $('#accSel')?.addEventListener('change', e => {
    S.acc = e.target.value;
    try { localStorage.setItem('hz.acc', S.acc); } catch { /* egal */ }
    renderAccSelect(); route();
  });
}

function renderLogin(msg = '') {
  $('#tabs').hidden = true; $('#acc').innerHTML = '';
  $('#view').innerHTML = `
  <div class="login stack">
    <div class="card">
      <h2>Anmelden</h2>
      <p class="muted small">Mit dem Gruppen-Code deiner Gruppe. Jedes Gerät meldet sich einmal an.</p>
      <form id="fLogin">
        <label class="f"><span>Gruppen-Code</span><input name="code" autocomplete="off" autocapitalize="characters" required></label>
        <label class="f"><span>Name dieses Geräts</span><input name="name" placeholder="z. B. Handy" required></label>
        <button class="primary">Anmelden</button> <span class="err" id="eLogin">${esc(msg)}</span>
      </form>
    </div>
    <div class="card">
      <h2>Neue Gruppe</h2>
      <p class="muted small">Nur mit einmaligem Einladungscode. Dieses Gerät wird Admin; der Gruppen-Code wird einmal angezeigt.</p>
      <form id="fGroup">
        <label class="f"><span>Einladungscode</span><input name="invite" autocomplete="off" autocapitalize="characters" required></label>
        <label class="f"><span>Name der Gruppe</span><input name="group" required></label>
        <label class="f"><span>Name dieses Geräts</span><input name="name" placeholder="z. B. Handy" required></label>
        <button class="primary">Gruppe anlegen</button> <span class="err" id="eGroup"></span>
      </form>
    </div>
  </div>`;
  $('#fLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try { await Cloud.login(f.code.value, f.name.value); afterLogin(); }
    catch (err) { $('#eLogin').textContent = err.message; }
  });
  $('#fGroup').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      const code = await Cloud.createGroup(f.invite.value, f.group.value, f.name.value);
      $('#view').innerHTML = `<div class="login card"><h2>Gruppe angelegt</h2>
        <p>Gruppen-Code (jetzt notieren, er wird nicht wieder angezeigt):</p>
        <p style="font-size:1.6rem;font-weight:700;letter-spacing:.08em">${esc(code)}</p>
        <p class="muted small">Damit melden sich weitere Geräte an: Firefox mit den Skripten, Claude-Wächter, später die Allianz.</p>
        <button class="primary" id="goOn">Weiter</button></div>`;
      $('#goOn').onclick = afterLogin;
    } catch (err) { $('#eGroup').textContent = err.message; }
  });
}

function renderNoAccount() {
  $('#tabs').hidden = true;
  $('#view').innerHTML = `
  <div class="login stack">
    <div class="card">
      <h2>Spielaccount anlegen</h2>
      <p class="muted small">Dieses Gerät wird Owner des Accounts: Es gibt Pläne frei und vergibt Rechte an Skripte und Claude.</p>
      <form id="fAcc">
        <label class="f"><span>Spielername</span><input name="player" value="Mariner77" required></label>
        <label class="f"><span>Runde</span><input name="round" value="Runde 8"></label>
        <label class="f"><span>Heimatplanet (G:S:O)</span><input name="home" value="1:156:7"></label>
        <button class="primary">Anlegen</button> <span class="err" id="eAcc"></span>
      </form>
    </div>
    <div class="card"><p class="muted small">Oder: Ein Owner gibt diesem Gerät Rechte für einen bestehenden Account
      (Mehr → Geräte &amp; Rechte). Gerät: <b>${esc(Cloud.access()?.name)}</b></p>
      <button id="reload">Neu prüfen</button> <button id="out">Abmelden</button></div>
  </div>`;
  $('#fAcc').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      S.acc = await Cloud.rpc('create_account', { p_player: f.player.value, p_round: f.round.value, p_home: f.home.value });
      try { localStorage.setItem('hz.acc', S.acc); } catch { /* egal */ }
      await Cloud.touch(); afterLogin();
    } catch (err) { $('#eAcc').textContent = err.message; }
  });
  $('#reload').onclick = async () => { await Cloud.touch().catch(e => toast(e.message)); afterLogin(); };
  $('#out').onclick = () => { Cloud.logout(); renderLogin(); };
}

/* ---------- Navigation ---------- */

const VIEWS = { lage: viewLage, ereignisse: viewEvents, plaene: viewPlans, wissen: viewWissen, mehr: viewMore };

async function route() {
  if (!Cloud.loggedIn() || !S.acc) return;
  const [tab = 'lage', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = VIEWS[tab] || viewLage;
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (VIEWS[tab] ? tab : 'lage')));
  $('#view').innerHTML = '<p class="muted pad">Lädt …</p>';
  try { await fn(rest); } catch (e) {
    if (e instanceof LoginNeeded) return renderLogin(e.message);
    $('#view').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><button onclick="route()">Erneut versuchen</button></div>`;
  }
  updateBadge();
}

async function updateBadge() {
  try {
    const r = await Cloud.q('events', { select: 'id', account_id: `eq.${S.acc}`, level: 'eq.hoch', seen_at: 'is.null', limit: 99 });
    $('#evBadge').hidden = !r.length; $('#evBadge').textContent = r.length;
  } catch { /* egal */ }
}

/* ---------- Lage ---------- */

const RES = ['Eisenerz', 'Mineral', 'Treibstoff'];

async function viewLage() {
  const acc = `eq.${S.acc}`;
  const [snaps, beats, evs, feats] = await Promise.all([
    Cloud.q('state_latest', { account_id: acc, select: 'kind,collected_at,version,data' }),
    Cloud.q('heartbeats', { account_id: acc, order: 'at.desc' }),
    Cloud.q('events', { account_id: acc, order: 't.desc', limit: 6 }),
    Cloud.q('features', { account_id: acc, order: 'key' }),
  ]);
  const live = snaps.find(s => s.kind === 'live');
  const d = live?.data;
  let html = '';
  if (!d) {
    html += `<div class="card warn"><h2>Noch kein Live-Stand</h2><p class="muted">Sobald der Collector (ab Version 0.2) mit diesem Account
      verbunden ist, erscheint hier der Spielstand. Bis dahin: Mehr → Geräte &amp; Rechte → Firefox-Gerät als „Skript“ freigeben.</p></div>`;
  } else {
    const st = d.start || {}, prod = d.prod || {};
    const at = new Date(live.collected_at);
    const age = (Date.now() - at) / 3600e3;
    html += `<div class="card${age > 3 ? ' warn' : ''}"><div class="row between"><h2>${esc(st.planet || '')} <span class="muted">${esc(st.coords || '')}</span></h2>
      <span class="muted small">Stand ${esc(dt(live.collected_at))} (${esc(ago(live.collected_at))})</span></div>
      <div class="muted small">${esc(st.player || '')} · Rang ${esc(st.rank ?? '–')} · ${fmt(st.points)} Punkte · ${esc(st.status || '')}</div></div>`;
    html += '<div class="grid">';
    // Rohstoffe: Bestand hochgerechnet auf jetzt
    const stock = prod['Aktueller Lagerbestand'] || {}, rate = prod['Förderung'] || {}, use = prod['Verbrauch'] || {};
    const cap = prod['Maximal stabile Menge'] || {};
    const hrs = (Date.now() - at) / 3600e3;
    html += `<div class="card"><h2>Rohstoffe</h2><table><tr><th></th><th class="num">jetzt ca.</th><th class="num">/h</th><th class="num">stabil bis</th><th class="num">voll in</th></tr>${
      RES.map(r => {
        const net = (rate[r] || 0) - (use[r] || 0);
        const now = Math.min((stock[r] || 0) + net * hrs, cap[r] || Infinity);
        const full = net > 0 && cap[r] ? (cap[r] - now) / net * 3600 : null;
        return `<tr><td>${r}</td><td class="num">${fmt(now)}</td><td class="num">${fmt(net)}</td><td class="num">${fmt(cap[r])}</td><td class="num">${full == null ? '–' : dur(full)}</td></tr>`;
      }).join('')}</table>`;
    const avail = prod['Aktuelle Verfügbarkeit'] || {}, need = prod['Benötigte Kapazitäten'] || {};
    html += `<h3>Arbeiter und Energie</h3><table>${['Arbeiter', 'Energie'].map(k => {
      const ratio = need[k] ? Math.min(1, (avail[k] || 0) / need[k]) : 1;
      return `<tr><td>${k}</td><td class="num">${fmt(avail[k])} / ${fmt(need[k])}</td><td style="width:40%"><div class="bar"><i style="width:${Math.round(ratio * 100)}%"></i></div></td><td class="num">${fmt(ratio * 100)} %</td></tr>`;
    }).join('')}</table></div>`;
    // laufende Aufträge
    const jobs = [...(d.buildings?.items || []).map(i => ({ ...i, k: 'Bau' })), ...(d.research?.items || []).map(i => ({ ...i, k: 'Forschung' }))]
      .filter(i => i.inProgress);
    html += `<div class="card"><h2>Laufende Aufträge</h2>${jobs.length ? `<table>${jobs.map(j => {
      const end = j.remaining != null ? new Date(at.getTime() + j.remaining * 1000) : null;
      const left = end ? (end - Date.now()) / 1000 : null;
      const pct = j.totalTime && j.remaining != null ? Math.min(100, Math.max(0, 100 - left / j.totalTime * 100)) : null;
      return `<tr><td><span class="tag">${j.k}</span> ${esc(j.name || j.type)} → ${esc(j.level)}
        ${pct == null ? '' : `<div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div>`}</td>
        <td class="num">${end ? `${left > 0 ? dur(left) : 'fertig'}<div class="muted small">${esc(dt(end))}</div>` : '–'}</td></tr>`;
    }).join('')}</table>` : '<p class="muted">Keine – Baustelle/Labor frei.</p>'}</div>`;
    // Stufen
    const W = await loadWissen().catch(() => null);  // Namen für noch nicht gebaute Stufen
    const nm = (i, set) => i.name || W?.[set]?.[i.type]?.n || i.type;
    const lv = (items, set) => items.map(i => `<tr><td>${esc(nm(i, set))}</td><td class="num">${esc(i.levelDone ?? i.level)}${i.inProgress ? ` → ${esc(i.level)}` : ''}</td></tr>`).join('');
    html += `<div class="card"><h2>Gebäude</h2><table>${lv(d.buildings?.items || [], "B")}</table>
      ${d.buildings?.space ? `<p class="muted small">Bauplatz frei ${fmt(d.buildings.space.free)} von ${fmt(d.buildings.space.total)}</p>` : ''}</div>`;
    html += `<div class="card"><h2>Forschung</h2><table>${lv(d.research?.items || [], "R") || '<tr><td class="muted">–</td></tr>'}</table></div>`;
    html += '</div>';
  }
  html += '<div class="grid" style="margin-top:12px">';
  html += `<div class="card"><h2>Skripte</h2>${beats.length ? `<table>${beats.map(b => {
    const old = (Date.now() - new Date(b.at)) / 60e3 > 30;
    return `<tr><td>${esc(b.script)} <span class="muted small">${esc(b.version)}</span></td><td class="num${old ? ' err' : ''}">${esc(ago(b.at))}</td></tr>`;
  }).join('')}</table>` : '<p class="muted">Noch keine Lebenszeichen.</p>'}</div>`;
  html += `<div class="card"><div class="row between"><h2>Letzte Ereignisse</h2><a href="#/ereignisse" class="small">alle</a></div>${evs.length ? evs.map(evRow).join('') : '<p class="muted">Keine.</p>'}</div>`;
  html += `<div class="card"><h2>Funktionen</h2>${feats.length ? `<table>${feats.map(f => `<tr><td>${esc(f.label || f.key)}${f.unlocked_at ? '' : ' <span class="muted small">(gesperrt)</span>'}</td>
    <td title="${esc(STAGES[f.stage])}"><span class="stage">${STAGES.map((_, i) => `<i class="${i <= f.stage ? 'on' : ''}"></i>`).join('')}</span> <span class="small muted">${esc(STAGES[f.stage])}</span></td></tr>`).join('')}</table>`
    : '<p class="muted">Noch keine erfasst. Der Collector trägt Freischaltungen ein (Werft, Raumhafen, Flotte …).</p>'}</div>`;
  html += '</div>';
  $('#view').innerHTML = html;
}

function evRow(e) {
  return `<div class="list-item ev${e.seen_at ? '' : ' unseen'}" data-id="${esc(e.id)}"><div class="row between">
    <span><span class="tag ${esc(e.level)}">${esc(e.level)}</span> ${esc(e.kind)}</span><span class="muted small">${esc(dt(e.t))}</span></div>
    <div>${esc(e.text)}</div><div class="muted small">${esc(e.origin)}</div></div>`;
}

/* ---------- Ereignisse ---------- */

async function viewEvents() {
  const lvl = sessionStorage.getItem('hz.evlvl') || '';
  const p = { account_id: `eq.${S.acc}`, order: 't.desc', limit: 200 };
  if (lvl) p.level = `eq.${lvl}`;
  const evs = await Cloud.q('events', p);
  const canSee = ['owner', 'viewer'].includes(account()?.role);
  $('#view').innerHTML = `<div class="card"><div class="row between"><h2>Ereignisse</h2>
    <div class="row"><select id="lvl"><option value="">alle Stufen</option>${['hoch', 'mittel', 'niedrig'].map(l => `<option${l === lvl ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${canSee ? '<button id="seenAll">alle gesehen</button>' : ''}</div></div>
    ${evs.length ? evs.map(evRow).join('') : '<p class="muted">Keine Ereignisse.</p>'}</div>`;
  $('#lvl').onchange = e => { sessionStorage.setItem('hz.evlvl', e.target.value); route(); };
  $('#seenAll')?.addEventListener('click', async () => {
    await Cloud.rest(`events?account_id=eq.${S.acc}&seen_at=is.null`, { method: 'PATCH', body: { seen_at: new Date().toISOString() }, prefer: 'return=minimal' });
    route();
  });
}

/* ---------- Pläne ---------- */

const KIND = { build: 'Bau', research: 'Forschung', ship: 'Schiffe', probe: 'Sonden', trade: 'Handel', defense: 'Verteidigung', fleet: 'Flotte', transport: 'Transport' };

async function viewPlans() {
  const plans = await Cloud.q('plans', { account_id: `eq.${S.acc}`, order: 'created_at.desc', limit: 50,
    select: 'id,kind,source,status,title,note,plan_hash,created_at,approved_at,status_at' });
  const own = isOwner();
  $('#view').innerHTML = `<div class="card"><h2>Pläne</h2>
    <p class="muted small">Entwürfe kommen vom Optimierer oder von Claude. Ausgeführt wird nur, was du freigibst; die Skripte melden den Fortschritt.</p>
    ${plans.length ? plans.map(p => `<div class="list-item"><div class="row between">
      <span><span class="tag">${esc(KIND[p.kind] || p.kind)}</span> <b>${esc(p.title || '(ohne Titel)')}</b></span>
      <span class="tag ${esc(p.status)}">${esc(p.status)}</span></div>
      <div class="muted small">${esc(p.source)} · ${esc(dt(p.created_at))}${p.plan_hash ? ` · Plan-id ${esc(p.plan_hash)}` : ''}${p.approved_at ? ` · freigegeben ${esc(dt(p.approved_at))}` : ''}</div>
      ${p.note ? `<div class="small" style="white-space:pre-wrap">${esc(p.note)}</div>` : ''}
      ${own && p.status === 'entwurf' ? `<div class="row" style="margin-top:6px"><button class="primary" data-act="freigegeben" data-id="${esc(p.id)}">Freigeben</button>
        <button data-act="verworfen" data-id="${esc(p.id)}">Verwerfen</button></div>` : ''}
      ${own && ['freigegeben', 'aktiv'].includes(p.status) ? `<div class="row" style="margin-top:6px"><button class="danger" data-act="abgebrochen" data-id="${esc(p.id)}">Abbrechen</button></div>` : ''}
    </div>`).join('') : '<p class="muted">Noch keine Pläne. Ab P3 legt der Optimierer jeden neuen Bauplan hier als Entwurf ab.</p>'}</div>`;
  $('#view').querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    const q = { freigegeben: 'Plan freigeben? Die Skripte dürfen ihn danach ausführen (Start nur per Kommando).',
      verworfen: 'Entwurf verwerfen?', abgebrochen: 'Plan abbrechen? Laufende Skripte halten an.' }[act];
    if (!confirm(q)) return;
    try { await Cloud.rpc('plan_status', { p_id: b.dataset.id, p_status: act }); toast('Gespeichert'); route(); }
    catch (e) { toast(e.message); }
  }));
}

/* ---------- Wissen (Gebäude und Forschung, Datenbank Runde 7) ---------- */

async function loadWissen() {
  if (S.wissen) return S.wissen;
  let r = await fetch('data/horizon-data.json').catch(() => null);
  if (!r?.ok) r = await fetch('../analyse/horizon-data.json');  // lokale Vorschau aus dem Repo
  const d = await r.json();
  for (const o of Object.values(d.B)) o.L = Object.fromEntries(o.l.map(x => [x[0], x]));
  return (S.wissen = d);
}

async function viewWissen(rest) {
  const { B, R } = await loadWissen();
  const [sel = ''] = rest;
  const all = [...Object.entries(B).map(([id, o]) => ({ k: 'b', id, o })), ...Object.entries(R).map(([id, o]) => ({ k: 'r', id, o }))]
    .sort((a, b) => a.o.n.localeCompare(b.o.n, 'de'));
  const filt = sessionStorage.getItem('hz.wq') || '';
  $('#view').innerHTML = `<div class="wissen"><div class="card"><input class="search" id="wq" placeholder="Gebäude oder Forschung suchen" value="${esc(filt)}">
    <div class="wlist" id="wl"></div></div><div class="card" id="wd"><p class="muted">Eintrag wählen. Werte aus der Datenbank von Runde 7 (100 % Betriebsfaktor); live gilt vorrangig.</p></div></div>`;
  const list = q => {
    const t = q.trim().toLowerCase();
    $('#wl').innerHTML = all.filter(x => !t || x.o.n.toLowerCase().includes(t) || x.id.includes(t))
      .map(x => `<button data-k="${x.k}" data-id="${esc(x.id)}" class="${x.k + ':' + x.id === sel ? 'on' : ''}">${esc(x.o.n)} <span class="tag">${x.k === 'b' ? 'Gebäude' : 'Forschung'}</span></button>`).join('');
  };
  list(filt);
  $('#wq').oninput = e => { sessionStorage.setItem('hz.wq', e.target.value); list(e.target.value); };
  $('#wl').onclick = e => { const b = e.target.closest('button'); if (b) location.hash = `#/wissen/${b.dataset.k}:${b.dataset.id}`; };
  if (sel) showWissen(sel, B, R);
}

function showWissen(sel, B, R) {
  const [k, id] = sel.split(':');
  const o = (k === 'b' ? B : R)[id];
  if (!o) return;
  const name = (kk, i) => esc(((kk === 'b' ? B : R)[i] || {}).n || i);
  const req = o.q.map(([a, b, rs]) => `<tr><td class="num">${a === b ? a : `${a}–${b}`}</td><td>${rs.map(([kk, i, l]) => `${name(kk, i)} ${l}`).join(', ') || '–'}</td></tr>`).join('');
  let body = '';
  if (k === 'b') {
    body = `<div class="scroll"><table><tr><th class="num">Stufe</th><th>Name</th><th class="num">Erz</th><th class="num">Mineral</th><th class="num">Treibstoff</th><th class="num">Bauplatz</th><th>Bedarf</th><th>Wirkung</th></tr>${
      o.l.map(([l, n, c, u, w]) => `<tr><td class="num">${l}</td><td>${esc(n)}</td><td class="num">${fmt(c.Eisenerz)}</td><td class="num">${fmt(c.Mineral)}</td><td class="num">${fmt(c.Treibstoff)}</td><td class="num">${fmt(c.Bauplatz)}</td>
        <td class="small">${Object.entries(u || {}).map(([a, v]) => `${esc(a)} ${fmt(v)}`).join(' · ')}</td><td class="small">${Object.entries(w || {}).map(([a, v]) => `${esc(a)} ${fmt(v, 1)}`).join(' · ')}</td></tr>`).join('')}</table></div>`;
  } else {
    const m = o.c === 'Allianzforschung' ? 2.5 : 1.5;
    const rows = Array.from({ length: Math.min(o.f || 20, 30) }, (_, i) => i + 1)
      .map(l => `<tr><td class="num">${l}</td>${(o.k || [0, 0, 0]).map(x => `<td class="num">${fmt(Math.floor(x * Math.pow(m, l - 1)))}</td>`).join('')}</tr>`).join('');
    body = `${o.w ? `<p>${esc(o.w)}</p>` : ''}<div class="scroll"><table><tr><th class="num">Stufe</th><th class="num">Erz</th><th class="num">Mineral</th><th class="num">Treibstoff</th></tr>${rows}</table></div>
      <p class="muted small">Kosten ohne Spieler-Rabatt.</p>`;
  }
  $('#wd').innerHTML = `<h2>${esc(o.n)} <span class="muted small">${esc(o.c || '')} · max. ${esc(o.f ?? '–')}</span></h2>
    <h3>Voraussetzungen</h3><table><tr><th class="num">für Stufe</th><th>benötigt</th></tr>${req || '<tr><td colspan="2">–</td></tr>'}</table>
    <h3>${k === 'b' ? 'Stufen' : 'Kosten'}</h3>${body}`;
}

/* ---------- Mehr: Geräte & Rechte, Gruppe, Abmelden ---------- */

async function viewMore() {
  const a = Cloud.access();
  const info = await Cloud.rpc('group_info');
  const own = isOwner();
  const members = info.members || [];
  const roleSel = m => {
    const r = m.accounts?.[S.acc] || 'none';
    if (!own || m.id === info.me) return `<span class="tag">${esc(ROLE[r] || 'kein Zugriff')}</span>`;
    return `<select data-member="${esc(m.id)}">${[['none', 'kein Zugriff'], ['viewer', 'Lesen'], ['executor', 'Skript'], ['claude', 'Claude'], ['owner', 'Owner']]
      .map(([v, t]) => `<option value="${v}"${v === r ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  };
  $('#view').innerHTML = `<div class="grid">
    <div class="card"><h2>Geräte &amp; Rechte <span class="muted small">für ${esc(account()?.player || '')}</span></h2>
      ${members.length ? `<table><tr><th>Gerät</th><th>zuletzt</th><th>Recht</th></tr>${members.map(m => `<tr><td>${esc(m.name || '(ohne Namen)')}${m.id === info.me ? ' <span class="muted small">(dieses)</span>' : ''}${m.role === 'admin' ? ' <span class="tag">Admin</span>' : ''}</td>
        <td class="small muted">${esc(ago(m.last_seen))}</td><td>${roleSel(m)}</td></tr>`).join('')}</table>`
        : '<p class="muted">Mitgliederliste nur für Admins und Owner.</p>'}
      <p class="muted small">Neue Geräte melden sich mit dem Gruppen-Code an und erscheinen hier. Skript = Tampermonkey (Collector, Autobuilder);
        Claude = Wächter (nur Entwürfe und Antworten, nie Freigaben).</p></div>
    <div class="card"><h2>Gruppe</h2><p>${esc(info.group)} · dieses Gerät: <b>${esc(a?.name)}</b>${info.role === 'admin' ? ' (Admin)' : ''}</p>
      <form id="fName" class="row"><input name="name" value="${esc(a?.name)}" style="flex:1"><button>Umbenennen</button></form>
      ${info.role === 'admin' ? '<p><button id="newCode" class="danger">Neuen Gruppen-Code erzeugen</button></p><p class="muted small">Alle anderen Geräte müssen sich danach neu anmelden (auch Skripte und Claude).</p>' : ''}
      <p><button id="logout">Abmelden</button></p></div>
    <div class="card"><h2>Über</h2><p class="small">Version ${esc(window.APP_VERSION?.number)} · ${esc(window.APP_VERSION?.built)}</p>
      <p class="small muted">Gerätekennung ${esc(Cloud.device.slice(0, 8))}…</p>
      <p class="small muted">Plan und Stand: doku/stand/cockpit.md im Horizon-Repo.</p></div></div>`;
  $('#view').querySelectorAll('select[data-member]').forEach(s => s.addEventListener('change', async () => {
    try { await Cloud.rpc('account_grant', { p_account: S.acc, p_member: s.dataset.member, p_role: s.value }); toast('Recht gespeichert'); }
    catch (e) { toast(e.message); route(); }
  }));
  $('#fName').addEventListener('submit', async e => {
    e.preventDefault();
    const n = e.target.name.value.trim();
    if (!n) return;
    try { await Cloud.login(Cloud.access().code, n); toast('Gespeichert'); renderAccSelect(); route(); }  // touch setzt den Namen
    catch (err) { toast(err.message); }
  });
  $('#newCode')?.addEventListener('click', async () => {
    if (!confirm('Neuen Gruppen-Code erzeugen? Alle anderen Geräte müssen sich neu anmelden.')) return;
    try {
      const code = await Cloud.rpc('admin_new_code');
      await Cloud.login(code, Cloud.access().name);
      alert(`Neuer Gruppen-Code: ${code}\nBitte notieren.`);
    } catch (e) { toast(e.message); }
  });
  $('#logout').onclick = () => { if (confirm('Abmelden?')) { Cloud.logout(); renderLogin(); } };
}

boot();
