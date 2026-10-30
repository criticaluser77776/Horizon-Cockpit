'use strict';
/* Gemeinsamer Code für Cockpit (app.js) und Horizon Atlas (details/), Schritt C0 der Cockpit-Aufteilung
   (doku/stand/cockpit-aufteilung.md): Formate und Zeiten, Anzeigenummern, Konto/Rolle, Toast, Ereignis-Zeilen,
   Sitzungen/Lauf, Spieldaten. Klassisches Skript (kein Modul): die Namen sind global und werden von app.js,
   kompendium.js, werft.js, planetwerte.js und den Atlas-Dateien zur Laufzeit genutzt. Erwartet je Seite
   route(); Kommandos (postCmd, Notfall) stehen hier. Lädt nach config.js und cloud.js. */

// Wurzel der Web-App (Ordner von common.js), damit Pfade auch aus details/ stimmen
const HZ_ROOT = new URL('./', document.currentScript?.src || location.href).href;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => n == null || n === '' || !isFinite(n) ? '–'
  : Number(n).toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
/* Zeiten (B16, 15.10.2026): überall dasselbe Format „Do 15.10. 15:02“, Ortszeit Berlin (MESZ/MEZ), nie rohe ISO-Zeiten.
   dt = Wochentag Datum Uhrzeit · when = „vor 12 min“ / „in 20 min“ bis 1 h Abstand, sonst dt · clockT = nur Uhrzeit, wenn heute
   ago = immer relativ (Alter eines Stands) · tidy = Zeiten, Snapshot-Namen und IDs in Texten aus der Datenbank lesbar machen */
const TZ = 'Europe/Berlin';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const dtParts = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return { wd: p.weekday.replace('.', ''), day: `${p.day}.${p.month}.`, time: `${p.hour}:${p.minute}`, ymd: `${p.year}${p.month}${p.day}` };
};
const toDate = t => t == null || t === '' ? null : t instanceof Date ? t : new Date(typeof t === 'string' && /^\d+$/.test(t) ? +t : t);
function dt(t) {
  const d = toDate(t);
  if (!d || isNaN(d)) return '–';
  const p = dtParts(d);
  return `${p.wd} ${p.day} ${p.time}`;
}
const clockT = t => {
  const d = toDate(t);
  if (!d || isNaN(d)) return '–';
  const p = dtParts(d);
  return p.ymd === dtParts(new Date()).ymd ? p.time : `${p.wd} ${p.day} ${p.time}`;
};
function ago(t) {
  const d = toDate(t);
  if (!d || isNaN(d)) return '–';
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 90) return 'gerade eben';
  if (s < 5400) return `vor ${Math.round(s / 60)} min`;
  if (s < 172800) return `vor ${fmt(s / 3600, 1)} h`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}
function when(t) {
  const d = toDate(t);
  if (!d || isNaN(d)) return '–';
  const m = (d - Date.now()) / 60e3;
  if (Math.abs(m) < 1.5) return 'gerade eben';
  if (Math.abs(m) < 60) return m < 0 ? `vor ${Math.round(-m)} min` : `in ${Math.round(m)} min`;
  return dt(d);
}

/* Anzeigenummern (B16): Pläne „Plan 1, 2, 3 …“ in der Reihenfolge ihres Anlegens, Optimierer-Läufe „Lauf 1, 2 …“ nach Datum.
   Technische Kennungen (Plan-id/Hash, UUID, Lauf-id) nur im Klapper „Details“. Werden alte Pläne gelöscht (B15), rücken die
   Nummern nach – sie sind nur Anzeige, gespeichert bleibt immer die Kennung. */
const NUMS = { acc: null, at: 0, plan: {}, run: {} };
const RUN_RE = /\bauto-(\d{2})(\d{2})T(\d{2})(\d{2})\b/g;
async function loadNums(force) {
  if (!force && NUMS.acc === S.acc && Date.now() - NUMS.at < 30e3) return NUMS;
  const rows = await Cloud.q('plans', { account_id: `eq.${S.acc}`, order: 'created_at.asc', limit: 1000, select: 'id,plan_hash,created_at,note' }).catch(() => null);
  if (!rows) return NUMS;
  const plan = {}, runs = new Set();
  rows.forEach((r, i) => {
    plan[r.id] = i + 1;
    if (r.plan_hash && !plan[r.plan_hash]) plan[r.plan_hash] = i + 1;
    for (const m of String(r.note || '').matchAll(RUN_RE)) runs.add(m[0]);
  });
  const run = Object.fromEntries([...runs].sort().map((k, i) => [k, i + 1]));
  Object.assign(NUMS, { acc: S.acc, at: Date.now(), plan, run });
  return NUMS;
}
const planNo = key => NUMS.plan[key] || null;
const planLabel = key => !key ? '–' : planNo(key) ? `Plan ${planNo(key)}` : 'unbekannter Plan';
// Lauf-id „auto-MMTTThhmm“ (UTC): Nummer, sonst Datum des Laufs
function runLabel(id) {
  if (NUMS.run[id]) return `Lauf ${NUMS.run[id]}`;
  const m = /auto-(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(id);
  if (!m) return 'Lauf';
  const y = new Date().getUTCFullYear(), d = new Date(Date.UTC(y, m[1] - 1, +m[2], +m[3], +m[4]));
  return `Lauf vom ${dt(d > Date.now() + 30 * 864e5 ? new Date(Date.UTC(y - 1, m[1] - 1, +m[2], +m[3], +m[4])) : d)}`;
}
// Texte aus der Datenbank (Ereignisse, Notizen, Antworten): ISO-Zeiten, „15.10.2026 15:05:44“, Snapshot-Namen, Lauf-ids,
// Plan-Hashes und UUIDs in die Anzeigeform bringen. Ergebnis ist Klartext (danach escapen).
const WD_BEFORE = '(?<!\\b(?:Mo|Di|Mi|Do|Fr|Sa|So)\\.?,?\\s)';
function tidy(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\bsnapshot-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})\.json\b/g, (_, y, mo, d, h, mi) => `Snapshot ${dt(new Date(Date.UTC(+y, mo - 1, +d, +h, +mi)))}`)
    .replace(/\b(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?/g, (all, y, mo, d, h, mi, z) => {
      const x = z ? new Date(all.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')) : new Date(Date.UTC(+y, mo - 1, +d, +h, +mi));   // ohne Zone = UTC (Snapshots)
      return isNaN(x) ? all : dt(x);
    })
    .replace(new RegExp(`${WD_BEFORE}\\b(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})?,?\\s+(\\d{1,2}):(\\d{2})(?::\\d{2})?\\b`, 'g'), (all, d, mo, y, h, mi) => {
      const now = new Date(), yy = +y || now.getFullYear();
      let x = new Date(yy, mo - 1, +d, +h, +mi);
      if (!y && x - now > 60 * 864e5) x = new Date(yy - 1, mo - 1, +d, +h, +mi);
      return isNaN(x) ? all : dt(x);
    })
    .replace(/\b(?:(automatischer\s+|Optimierer-)?Lauf\s+)?auto-\d{4}T\d{4}\b/g, (m, pre) => (pre && !/Optimierer/.test(pre) ? pre : '') + runLabel(m.match(/auto-\d{4}T\d{4}/)[0]))
    .replace(/\b(?:(Lauf|Plan(?:-id)?|id)\s+)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{10})\b/g, (all, w, k) => {
      const n = planNo(k);
      if (w === 'Lauf') return n ? `Lauf mit Plan ${n}` : 'Lauf';
      return n ? `Plan ${n}` : w && /^Plan/.test(w) ? 'unbekannter Plan' : w === 'id' ? 'Plan ?' : '…';
    });
}
function dur(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return (d ? `${d} d ` : '') + `${h} h ${String(m).padStart(2, '0')} min`;
}
// Restzeit als dd:hh:mm (ab 1 Tag), darunter hh:mm; zweistellig, ohne Wert „–“
function durDHM(sec) {
  if (sec == null || !isFinite(sec)) return '–';
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), p = n => String(n).padStart(2, '0');
  return (d ? `${p(d)}:` : '') + `${p(h)}:${p(m)}`;
}
function toast(msg, action) {     // action = { label, run } → Knopf im Toast (z. B. Rückgängig), dann 6 s sichtbar
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  if (action) {
    const b = document.createElement('button'); b.className = 'link'; b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); }; t.append(' ', b);
  }
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3500);
}

const S = { acc: null, wissen: null };
const ROLE = { owner: 'Owner', executor: 'Skript', claude: 'Claude', viewer: 'Lesen' };
const STAGES = ['Doku', 'Parser', 'Erkennung', 'Live erhoben', 'Probelauf', 'Erste Aktion', 'Frei'];

function accounts() { return Cloud.access()?.accounts || []; }
function account() { return accounts().find(a => a.id === S.acc) || null; }
function isOwner() { return account()?.role === 'owner'; }

const CAT = { builder: 'Builder', cockpit: 'Cockpit', spiel: 'Spiel', system: 'System' };
/* Horizon Atlas (details/, D1): setzt window.HZ_ATLAS vor common.js. Seit Entscheidung 7.3 (17.10. abends) zeigt der Atlas
   dieselben Owner-Knöpfe an Ereignissen wie das Cockpit (Entscheidung beantworten, Notfall verbauen; je mit Rückfrage, Kommando
   über postCmd). Seit 27.10.2026 auch „Freigeben“ an jedem Bauplan-Entwurf (takeNewPlan). Lauf-Steuerung („bis #“, Start/Stopp)
   bleibt im Cockpit – dorthin führt COCKPIT_LINK. */
const ATLAS = !!window.HZ_ATLAS;
const COCKPIT_LINK = (h, txt) => `<a href="${esc(HZ_ROOT + h)}">${esc(txt)} →</a>`;
/* „Claude fragen“ (25.10.2026): Der Owner stellt aus einer Meldung oder Planeten-Karte einen Auftrag (requests) mit Kontext
   (requests.context, jsonb). Eine Claude-Sitzung mit Wächter übernimmt ihn (tools/watch.py zeigt ctx=…, auftrag.py show den ganzen
   Kontext) und antwortet per Push. kind: 'ereignis' (Meldung) | 'schritt' (Planeten-Karte). Gilt im Cockpit und im Atlas. */
window.HZ_ASK = async (kind, text, context) => {
  if (!isOwner()) return toast('Nur der Owner kann Claude fragen');
  try {
    await Cloud.rest('requests', { method: 'POST', prefer: 'return=minimal',
      body: { account_id: S.acc, kind, target: 'any', text: String(text).slice(0, 8000), context: context || {} } });
    if (ATLAS) toast('Auftrag an Claude gestellt', { label: 'Im Cockpit ansehen', run: () => window.open(HZ_ROOT + '#/claude', '_blank', 'noopener') });
    else { toast('Auftrag an Claude gestellt'); location.hash = '#/claude'; }
  } catch (e) { toast(e.message); }
};
const EV_ASK = new Map();   // Ereignis-id → Zeile (für „Claude fragen“; evRow trägt sie ein)
// Auftragstext und Kontext zu einer Ereigniszeile
function askEventPayload(e) {
  return { kind: 'ereignis', text: `Woran liegt das? ${e.kind}: ${String(e.text ?? '').slice(0, 300)}`,
    context: { event_id: e.id, kind: e.kind, cat: e.cat, level: e.level, src_name: e.src_name, t: e.t, data: e.data ?? null } };
}
/* Planeten-Karte: die „interessanteste“ Feed-Zeile – überfällig (next.due) vor wartend (next) vor laufend (nur run) */
function askPickRow(rows) {
  const list = (rows || []).filter(r => r && (r.next || r.run));
  const rank = r => r.next?.due != null ? 0 : r.next ? 1 : 2;
  return list.slice().sort((a, b) => rank(a) - rank(b))[0] || null;   // sort ist stabil: bei Gleichstand die frühere Schlange (Bau vor Forschung vor Werft)
}
// Auftragstext und Kontext zu einer Planeten-Karte; planId = Datenbank-id des aktiven Plans (oder null), steps = plan.steps
function askPlanetPayload(p, rows, planId, steps) {
  const r = askPickRow(rows), name = p.name || p.coords, iso = t => Number.isFinite(t) ? new Date(t).toISOString() : null;
  const nm = i => (Number.isInteger(i) && steps?.[i]?.[5]) || '';
  const context = { planet: p.coords };
  if (!r) return { kind: 'schritt', text: `Lage auf ${name}: Woran liegt das?`, context };
  const why = r.next && typeof Zeitfeed !== 'undefined' ? Zeitfeed.whyText(r.next.why) : '';
  if (r.next) {
    const x = r.next;
    context.step = { n: Number.isInteger(x.i) ? x.i + 1 : null, text: nm(x.i) };
    Object.assign(context, { why, at: iso(x.at), due: iso(x.due), src: x.src || null, srcAt: iso(x.srcAt) });
  } else {
    context.step = { n: Number.isInteger(r.run.i) ? r.run.i + 1 : null, text: r.run.name || nm(r.run.i) };
    context.run_end = iso(r.run.end);
  }
  if (r.q) context.queue = r.q;
  if (planId) context.plan = planId;
  return { kind: 'schritt', text: `Lage auf ${name}: Woran liegt das?${why ? ` ${why}${r.next.due != null ? ', überfällig' : ''}` : ''}`, context };
}
/* Verdrahtet die „Claude fragen“-Knöpfe der Planeten-Karten (planetKarte, .askgo); ctxOf(coords) → { kind, text, context } */
function bindAsk(container, ctxOf) {
  if (!container || !window.HZ_ASK || !isOwner()) return;
  container.querySelectorAll('.askgo').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const x = ctxOf(b.dataset.ask);
    if (x) window.HZ_ASK(x.kind, x.text, x.context);
  }));
}
function evRow(e) {
  EV_ASK.set(String(e.id), e);
  const can = ['owner', 'viewer'].includes(account()?.role);
  return `<div class="list-item ev${e.seen_at ? '' : ' unseen'}${e.dismissed_at ? ' dismissed' : ''}" data-id="${esc(e.id)}"><div class="row between">
    <span><span class="tag ${esc(e.level)}">${esc(e.level)}</span> <span class="tag">${esc(CAT[e.cat] || e.cat || '')}</span> ${esc(e.kind)}${e.dismissed_at ? ' <span class="tag">ausgeblendet</span>' : ''}</span>
    <span class="muted small nowrap">${esc(when(e.t))}${can ? ` <button class="link small evx" title="${e.dismissed_at ? 'wieder einblenden' : 'ausblenden (oder nach rechts wischen)'}" aria-label="${e.dismissed_at ? 'wieder einblenden' : 'ausblenden'}">${e.dismissed_at ? '↺' : '✕'}</button>` : ''}</span></div>
    <div class="wrapall">${esc(tidy(e.text))}</div>${e.kind === 'anflug' && e.level === 'hoch' && isOwner() && Date.now() - new Date(e.t) < 6 * 3600e3
      ? '<div class="row" style="margin:4px 0"><button class="danger small nfgo">Notfall verbauen</button></div>' : ''}${bannerSlots(e)}${msgBody(e)}${e.kind === 'abweichung' && e.data?.offer === 'neu_planen' ? `<div class="small"><a href="#/plaene">Planabweichung ansehen / neu planen →</a></div>` : ''}<div class="row between muted small"><span>${esc(e.src_name || e.origin)}</span>${isOwner() ? '<button class="link small askev">Claude fragen</button>' : ''}</div></div>`;
}
/* Nachrichten (B1, Autobuilder ab 0.5.13): Inhalt, Links und Effekt stehen in data des Ereignisses „bericht“.
   Links nur als Text – das Cockpit macht daraus keine klickbaren Verweise (Spiel-Links tragen Einmal-Token, fremde Ziele
   ruft niemand automatisch auf). */
const EFF_SRC = { datum: 'Ende laut Nachricht', text: 'Dauer laut Nachricht', typisch: 'typische Dauer (geschätzt)' };
function msgBody(e) {
  const x = e.kind === 'bericht' ? e.data : null;
  if (!x?.body && !x?.effect && !x?.decision) return '';
  const eff = x.effect?.until ? `<div class="small">Effekt bis <b>${esc(dt(x.effect.until))}</b>${Date.parse(x.effect.until) > Date.now()
    ? ` (noch ${esc(dur((Date.parse(x.effect.until) - Date.now()) / 1000))})` : ' (abgelaufen)'} <span class="muted">· ${esc(EFF_SRC[x.effect.src] || x.effect.src || '')}</span></div>` : '';
  const links = Array.isArray(x.links) && x.links.length ? `<div class="small muted">Links (nur Text, nicht aufrufen): ${x.links.map(l =>
    `${esc(l.text || 'ohne Text')} <code>${esc(l.href)}</code>`).join(' · ')}</div>` : '';
  return msgDecision(e, x) + traderRows(x.body) + eff + (x.body ? `<details class="msg"><summary class="small">Inhalt</summary><div class="msgbody small">${esc(tidy(x.body))}</div>${links}</details>` : '');
}
/* Fliegender Händler (D5, 30.10.2026, Altskript nachricht-fliegender-haendler): Angebote „Bis zu X Metall für nur Y Treibstoff.“
   gegen den Standardkurs Metall : Minerale : Treibstoff = 4 : 2 : 1 (Mengen gleichen Werts → Wert je Einheit 1 : 2 : 4).
   Preis = Wert der Gegenleistung ÷ Wert der Ware; über 105 % teuer, unter 95 % günstig (Toleranz 5 % wie im Altskript). */
const TRADER_VAL = { metall: 1, erz: 1, mineral: 2, minerale: 2, treibstoff: 4 };
function traderOffers(body) {
  const out = [], re = /(?:bis zu\s+)?([\d.'’\s]+?)\s*(Metall|Erz|Minerale?|Treibstoff)\s+f(?:ü|ue)r\s+nur\s+([\d.'’\s]+?)\s*(Metall|Erz|Minerale?|Treibstoff)/gi;
  const num = s => +String(s).replace(/\D/g, '');
  let m;
  while ((m = re.exec(String(body || '')))) {
    const x = num(m[1]), y = num(m[3]), vx = TRADER_VAL[m[2].toLowerCase()], vy = TRADER_VAL[m[4].toLowerCase()];
    if (!x || !y || vx === vy) continue;
    const pct = y * vy / (x * vx) * 100;
    out.push({ menge: x, ware: m[2], preis: y, gegen: m[4], pct, urteil: pct > 105 ? 'teuer' : pct < 95 ? 'günstig' : 'fair' });
  }
  return out;
}
function traderRows(body) {
  const o = traderOffers(body);
  if (!o.length) return '';
  const col = { teuer: 'var(--bad)', fair: 'var(--muted)', 'günstig': 'var(--ok)' };
  return `<div class="small" style="margin:4px 0"><b>Händler-Kurse</b> <span class="muted">(gegen 4 : 2 : 1, ±5 %)</span>${o.map(a =>
    `<div>${fmt(a.menge)} ${esc(a.ware)} für ${fmt(a.preis)} ${esc(a.gegen)}: <b style="color:${col[a.urteil]}">${fmt(a.pct, 0)} % – ${a.urteil}</b></div>`).join('')}</div>`;
}
/* Entscheidungen beantworten (Paket B, Autobuilder ab 0.5.29, Nutzer 17.10.2026: per Tipp wie beim Werbebanner).
   decision = [{i, text, href, cost?}] (bis 0.5.28 nur Texte → nur Anzeige). Knopf je Option (nur Owner) → confirm() mit Text,
   Kosten und Frist → Kommando „antwort“ {msgId, option, text} an ein eingeloggtes Gerät, sonst an ein ausgeloggtes (es loggt
   einmal ein, antwortet und loggt wieder aus; ein dort schlafender Lauf schläft bis zur alten Weckzeit weiter). Das Ergebnis
   trägt Supabase aus dem Ereignis „antwort“ an der Nachricht ein (data.answer, Migration 20261017100001). */
function msgDecision(e, x) {
  const dec = Array.isArray(x.decision) ? x.decision : [], a = x.answer;
  if (a?.ok) return `<div class="small"><b>Beantwortet</b>: ${esc(a.text || `Option ${a.option}`)}${a.t ? ` <span class="muted">· ${esc(when(a.t))}</span>` : ''}${a.result ? `<div class="muted">${esc(a.result)}</div>` : ''}</div>`;
  if (!dec.length) return '';
  const objs = dec.every(d => d && typeof d === 'object' && Number.isInteger(d.i));
  const head = `<div class="small"><b>Entscheidung offen</b>${x.frist ? ` · Frist ${esc(x.frist)}` : ''}${a && !a.ok ? ` <span class="err">· letzte Antwort nicht gesendet: ${esc(a.result || '')}</span>` : ''}</div>`;
  if (!objs) return head.replace('</div>', ` – im Spiel antworten: ${dec.map(d => esc(typeof d === 'string' ? d : d?.text || '')).join(' · ')}</div>`);
  const btns = isOwner() ? `<div class="row wrap" style="margin:4px 0;gap:4px">${dec.map(d => `<button class="small ansgo" data-msg="${esc(x.msgId)}" data-opt="${esc(d.i)}"
    data-text="${esc(d.text)}" data-cost="${esc((d.cost || []).join(', '))}" data-frist="${esc(x.frist || '')}">${esc(d.text)}</button>`).join('')}</div>`
    : `<div class="small">${dec.map(d => esc(d.text)).join(' · ')}</div>`;
  return head + btns;
}
// Ziel: eingeloggtes Gerät (Halter zuerst), sonst ausgeloggtes (Halter eines Laufs zuerst – ein anderes lehnt dann ab)
const answerDev = sess => {
  const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at) && verCmp(x.ab.version, '0.5.29') >= 0);
  const pick = page => { const l = live.filter(x => x.ab.state?.page === page); return l.find(x => x.holds) || l[0] || null; };
  return pick('game') || (sess.devs.some(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game') ? null : pick('login'));
};
async function sendAnswer(b) {
  const msgId = b.dataset.msg, option = +b.dataset.opt, text = b.dataset.text, cost = b.dataset.cost, frist = b.dataset.frist;
  const sess = await loadSessions().catch(() => null);
  const dev = sess && answerDev(sess);
  if (!dev) return toast('Kein Autobuilder ab 0.5.29 erreichbar (oder eingeloggt nur mit älterer Version)');
  const login = dev.ab.state?.page === 'login', sleep = login && dev.ab.state?.sleeping;
  if (!confirm(`Im Spiel antworten: „${text}“?${cost ? `\nKosten laut Option: ${cost}` : ''}${frist ? `\nFrist: ${frist}` : ''}\n\nGerät: ${dev.name}`
    + (login ? `\n${dev.name} ist ausgeloggt: Es loggt einmal ein, antwortet und loggt danach wieder aus${sleep ? ' (der schlafende Lauf schläft bis zu seiner Weckzeit weiter)' : ''}. Ein Spiel auf einem anderen Gerät wird dabei abgemeldet.` : '')
    + '\nDie Antwort lässt sich im Spiel nicht zurücknehmen.')) return;
  try {
    await postCmd(dev, 'antwort', { msgId: String(msgId), option, text });
    toast(`Antwort an ${dev.name} gesendet – Ergebnis in 15–60 s an der Nachricht`);
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}
/* Kommandos an den Autobuilder (Cockpit und Atlas, Entscheidung 7.3): je Gerät eine Zeile in commands; vorher immer confirm().
   Notfall verbauen: Ziel für den Knopf am Anflug = eingeloggter Autobuilder, Halter zuerst. */
async function postCmd(dev, cmd, args = {}, planId = null) {
  await Cloud.rest('commands', { method: 'POST', prefer: 'return=minimal',
    body: { account_id: S.acc, script: 'autobuilder', cmd, args, plan_id: planId, target_device: dev.device } });
}
/* Bauplan freigeben (Cockpit: Angebot und Entwürfe; Atlas seit 27.10.2026: jeder Entwurf unter „Alle Baupläne“).
   o = { draft: Plan-Zeile, teil: Teilplan-Info aus draftGains }. */
async function takeNewPlan(o, sess) {
  const stale = o.teil?.stale ? `
Achtung: Teilplan auf Basis ${o.teil.basis}, der aktive Plan ist inzwischen ein anderer.` : '';
  if (!confirm(`${planLabel(o.draft.id)} („${tidy(o.draft.title)}“) freigeben? Der bisher freigegebene Bauplan wird damit abgelöst.${stale}`)) return;
  try {
    await Cloud.rpc('plan_status', { p_id: o.draft.id, p_status: 'freigegeben' });
    S.planCache = null;
    // F2 (13.10.): direkt „Übernehmen auf <Gerät>“ anbieten. Der Collector legt den Plan im selben Abgleich als Angebot ab,
    // in dem er das Kommando abholt; der Autobuilder übernimmt auch ausgeloggt (ab 0.5.8), aber nicht während eines Laufs.
    const live = sess.devs.filter(x => x.ab && isFresh(x.ab.at));
    const tgt = live.find(x => x.holds) || live.find(x => x.ab.state?.page === 'game') || live[0];
    if (tgt && o.draft.plan_hash && !tgt.ab.state?.running) {
      if (confirm(`Freigegeben. Plan jetzt auf ${tgt.name} übernehmen? Danach „bis #“ neu wählen (neue Schrittnummern).`)) {
        await postCmd(tgt, 'adopt', { plan: o.draft.plan_hash }, o.draft.id);
        toast(`Übernehmen an ${tgt.name} gesendet – Ergebnis im Cockpit unter Steuerung`);
      } else toast('Freigegeben – übernehmen im Cockpit unter Steuerung');
    } else toast(tgt ? `Freigegeben – ${tgt.name} läuft noch: erst stoppen, dann im Cockpit unter Steuerung übernehmen`
      : 'Freigegeben – kein Autobuilder erreichbar; übernehmen im Cockpit unter Steuerung, sobald ein Gerät da ist');
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}
const nfTarget = sess => sess.devs.filter(x => x.ab && isFresh(x.ab.at) && x.ab.state?.page === 'game').sort((a, b) => b.holds - a.holds)[0] || null;
const NF_ASK = name => `Notfall verbauen auf ${name}? 2 Stunden lang startet der Autobuilder in jeder freien Schlange sofort den teuersten startbaren Planschritt der nächsten 25 – auch außer der Reihe, nichts außerhalb des Plans, kein Abbrechen. Das kann den Plan etwas verschieben.`;
async function sendNotfall(dev, args) {
  try {
    await postCmd(dev, 'notfall', args);
    toast(`Kommando an ${dev.name} gesendet – Ergebnis in 15–60 s`);
    setTimeout(() => route(true), 1500);
  } catch (e) { toast(e.message); }
}
async function anflugNotfall() {
  const sess = await loadSessions().catch(() => null);
  const dev = sess && nfTarget(sess);
  if (!dev) return toast('Kein eingeloggter Autobuilder erreichbar – erst im Spiel einloggen');
  if (confirm(NF_ASK(dev.name))) sendNotfall(dev, { hours: 2 });
}
// Lage: aktive Effekte aus Berichten (Ende in der Zukunft), je Name nur der jüngste
function effectsCard(effs) {
  const seen = new Set(), list = (effs || []).filter(r => r.eff?.until && !seen.has(r.eff.name) && seen.add(r.eff.name))
    .sort((a, b) => Date.parse(a.eff.until) - Date.parse(b.eff.until));
  if (!list.length) return '';
  return `<div class="card"><div class="row between"><h2>Aktive Effekte</h2><span class="muted small">aus Berichten</span></div><table class="small">${list.map(r => `<tr>
    <td>${esc(String(r.eff.name || '').split(/\s*·\s*/)[0])}</td><td class="num">noch ${esc(dur((Date.parse(r.eff.until) - Date.now()) / 1000))}</td>
    <td class="muted">bis ${esc(dt(r.eff.until))}${r.eff.src === 'typisch' ? ' (geschätzt)' : ''}</td></tr>`).join('')}</table></div>`;
}
// Werbebanner (Autobuilder ab 0.5.1): Ziele nur als Text zeigen; ob und wie sie geöffnet werden, ist noch offen
function bannerSlots(e) {
  const s = e.kind === 'banner' && Array.isArray(e.data?.slots) ? e.data.slots : [];
  return s.length ? `<div class="small">${s.map(x => `${x.url !== undefined ? 'Vote' : 'Monitor'} ${esc(x.slot)}: ${esc(x.host || (x.href ? 'intern' : 'ohne Link'))}`).join('<br>')}</div>
    <details class="sub"><summary class="small muted">Details</summary><div class="small muted wrapall">${s.map(x => esc(x.url || x.href || x.onclick || x.src || '–')).join('<br>')}</div></details>` : '';
}
// Ereignis ausblenden: nach rechts wischen (Handy) oder ✕ (Rechner); Rückgängig im Toast. Nur Owner/Lesen (wie „gesehen“).
async function setDismissed(id, on) {
  await Cloud.rest(`events?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { dismissed_at: on ? new Date().toISOString() : null }, prefer: 'return=minimal' });
}
async function dismissEvent(el) {
  const id = el.dataset.id, undo = el.classList.contains('dismissed');
  try {
    await setDismissed(id, !undo);
    if (undo) { route(true); return toast('Wieder eingeblendet'); }
    el.style.transition = 'opacity .2s'; el.style.opacity = '0';
    setTimeout(() => (S.showDismissed ? route(true) : el.remove()), 200);
    toast('Ausgeblendet', { label: 'Rückgängig', run: async () => { try { await setDismissed(id, false); route(true); } catch (e) { toast(e.message); } } });
  } catch (e) { el.style.transform = ''; toast(e.message); }
}
function swipeEvents(root) {
  if (!['owner', 'viewer'].includes(account()?.role)) return;
  root.querySelectorAll('.ev .nfgo').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); anflugNotfall(); }));
  root.querySelectorAll('.ev .ansgo').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); if (isOwner()) sendAnswer(b); }));
  root.querySelectorAll('.ev .askev').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const e = EV_ASK.get(b.closest('.ev').dataset.id);
    if (e && isOwner()) { const x = askEventPayload(e); window.HZ_ASK(x.kind, x.text, x.context); }
  }));
  root.querySelectorAll('.ev .evx').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); dismissEvent(b.closest('.ev')); }));
  root.querySelectorAll('.ev:not(.dismissed)').forEach(el => {
    let x0 = null, y0 = 0, dx = 0;
    el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; el.style.transition = ''; }, { passive: true });
    el.addEventListener('touchmove', e => {
      if (x0 == null) return;
      dx = e.touches[0].clientX - x0;
      if (Math.abs(e.touches[0].clientY - y0) > Math.abs(dx)) { x0 = null; el.style.transform = ''; return; }   // senkrecht = scrollen
      if (dx > 0) el.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      if (x0 == null) return;
      x0 = null; el.style.transition = 'transform .15s';
      if (dx > Math.min(120, el.offsetWidth * 0.35)) { el.style.transform = 'translateX(100%)'; dismissEvent(el); }
      else el.style.transform = '';
    });
  });
}

/* ---------- Sitzungen und Lauf (mehrere PCs) ----------
   runs: genau ein Lauf je Account (Gerät, Plan, bis #, Zustand); heartbeats je Gerät: Autobuilder (voller Zustand inkl.
   Seite Spiel/Login) und Collector. „verloren“ setzt Supabase selbst (pg_cron), wenn der Halter 3 min schweigt. */
const RUNST = { laeuft: 'läuft', schlaeft: 'schläft (ausgeloggt)', angehalten: 'angehalten', verloren: 'verloren' };
// B13: Pause – der Lauf bleibt „läuft“/„schläft“, nur dieser Merker (runs.paused_at)
const pauseTag = r => r?.paused_at && ['laeuft', 'schlaeft', 'verloren'].includes(r.state) ? ` · <b class="warn">⏸ pausiert seit ${esc(clockT(r.paused_at))}</b>` : '';
const isFresh = (t, min = 3) => !!t && (Date.now() - new Date(t)) / 60e3 < min;
async function loadSessions() {
  const acc = `eq.${S.acc}`;
  const [runs, hbs] = await Promise.all([
    Cloud.q('runs', { account_id: acc, script: 'eq.autobuilder' }),
    Cloud.q('heartbeats', { account_id: acc, order: 'at.desc' }),
  ]);
  const by = {};
  for (const h of hbs) {
    const x = by[h.device] ||= { device: h.device, name: '', ab: null, col: null };
    if (h.script === 'autobuilder') x.ab = h; else if (h.script === 'collector') x.col = h;
    if (h.name && !x.name) x.name = h.name;
  }
  const run = runs[0] || null;
  const devs = Object.values(by).map(x => ({ ...x, name: x.name || 'Gerät ohne Namen', holds: run?.device === x.device,
    last: [x.ab?.at, x.col?.at].filter(Boolean).sort().pop() }));
  devs.sort((a, b) => (b.holds - a.holds) || String(b.last).localeCompare(String(a.last)));
  return { run, devs };
}
// Zustand des Laufs (wer baut gerade, bis #, schläft/verloren, Status der letzten Prüfung)
function runBody(sess, { drift = true } = {}) {   // drift:false, wenn direkt darunter driftLine/driftCard dieselbe Zahl zeigen
  const r = sess.run, h = r && sess.devs.find(x => x.holds), s = h?.ab?.state || {};
  if (!r) return '<p class="muted">Noch kein Lauf. Start im Spiel (Knopf) oder unter Pläne.</p>';
  let html = `<p><b class="${r.state === 'verloren' ? 'err' : ''}">${esc(RUNST[r.state] || r.state)}</b> · ${r.mode === 'live' ? 'Lauf' : 'Probelauf'} bis ${esc(untilTxt(r.until, r.until_by))}
    auf <b>${esc(r.name || 'unbekanntem Gerät')}</b>${r.state === 'schlaeft' && r.wake_at ? ` · Login ${esc(clockT(r.wake_at))}` : ''}${pauseTag(r)}</p>`;
  if (r.paused_at && s.hand) html += `<p class="small warn">In der Pause von Hand: ${esc(s.hand)}</p>`;
  if (r.state === 'verloren' || r.state === 'angehalten') html += `<p class="small ${r.state === 'verloren' ? 'err' : 'muted'}">${esc(tidy(r.reason))}</p>`;
  if (['laeuft', 'schlaeft'].includes(r.state) && h?.ab) {
    const dl = drift ? driftLagText() : '';   // eine Abweichungszahl: Server (plan_abweichung_akt), nicht der Vorlauf des Autobuilders
    html += `<p class="small muted">${s.planInfo ? esc(tidy(s.planInfo)) : ''}${dl ? `${s.planInfo ? ' · ' : ''}${esc(dl)}` : ''}${s.next ? ` · nächste Prüfung ${esc(clockT(s.next))}` : ''}
      · Lebenszeichen ${esc(ago(h.ab.at))}</p>${s.status ? `<p class="small">${esc(tidy(s.status))}</p>` : ''}`;
  }
  return html;
}
// Versionen vergleichen ('0.5.10' > '0.5.9')
const verCmp = (a, b) => {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

const evGet = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const evSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } route(); };

const KIND = { build: 'Bau', research: 'Forschung', ship: 'Schiffe', probe: 'Sonden', trade: 'Handel', defense: 'Verteidigung', fleet: 'Flotte', transport: 'Transport' };

/* ---------- Bauplan mit mehreren Planeten (M1/M5, doku/stand/autobuilder-mehrplaneten.md) ----------
   Ein Plan, eine Nummernfolge: plan.stepPlanet {Nr: Koordinaten} nur für Kolonie-Schritte, plan.planets [{id, name, coords,
   bahn}] = Kolonien, plan.planet = Heimat (ältere Pläne ohne: Live-Stand). Forschung ist global. stepPlanet als Liste
   (Pläne vor M1, z. B. a8d36cc9b3: Simulator-Nummern, Kolonie-Schritte nicht in steps) gilt nicht → Einplaneten-Ansicht. */
const planAway = (plan, n) => { const sp = plan?.stepPlanet; return sp && !Array.isArray(sp) && typeof sp[n] === 'string' ? sp[n] : null; };
const planMulti = plan => (plan?.steps || []).some((s, i) => planAway(plan, i + 1));
// Reiter: alle · heim · je Kolonie (Koordinaten) · r (Forschung global)
function planTabs(plan, home) {
  const h = plan.planet?.coords ? plan.planet : home;
  const kol = (Array.isArray(plan.planets) ? plan.planets : []).filter(p => typeof p?.coords === 'string').map(p => ({ ...p }));
  (plan.steps || []).forEach((s, i) => { const c = planAway(plan, i + 1); if (c && !kol.some(p => p.coords === c)) kol.push({ name: '', coords: c }); });
  return [{ k: 'alle', t: 'Alle' }, { k: 'heim', t: h?.coords ? `${h.name || 'Heimat'} (${h.coords})` : 'Heimat' },
    ...kol.map(p => ({ k: p.coords, t: `${p.name || 'Kolonie'} (${p.coords})`, kol: true })), { k: 'r', t: 'Forschung (global)' }];
}
// Schritt Nr. n im Reiter k? Heimat = Gebäude und Schiffe ohne Planet
const planInTab = (plan, k, s, n) => !k || k === 'alle' ? true : k === 'r' ? s[0] === 'r' : k === 'heim' ? s[0] !== 'r' && !planAway(plan, n) : planAway(plan, n) === k;
// Feste Schrittkennung (M7): <Planet|r>:<Art>:<Typ>:<Stufe>, Planet = Koordinaten (Kolonie), 'h' Heimat, Forschung 'r';
// doppelte Kennungen mit „~2“ … Gleiche Regel wie der Autobuilder (stepKeys in Horiversum/src/autobuilder/06-planstand.js).
function planStepKeys(plan) {
  const seen = {};
  return (plan?.steps || []).map((s, i) => {
    const k = `${s[0] === 'r' ? 'r' : planAway(plan, i + 1) || 'h'}:${s[0]}:${s[1]}:${s[2]}`;
    seen[k] = (seen[k] || 0) + 1;
    return seen[k] > 1 ? `${k}~${seen[k]}` : k;
  });
}
// Teilentwurf (M9, push_plan.py --teil): payload.meta = {teil: <Koordinaten>, basis: <Plan-id des aktiven Plans bei Anlage>}.
// Unterschiede nur für den Planeten teil (Kennungen M7): neu, entfallen; veraltet, wenn die Basis nicht mehr der aktive Plan ist.
function planTeilDiff(draft, active) {
  const t = draft?.meta?.teil;
  if (!t) return null;
  const pre = t + ':', ks = p => planStepKeys(p).filter(k => k.startsWith(pre)).map(k => k.slice(pre.length));
  const a = active?.payload ? ks(active.payload) : [], d = ks(draft);
  return { teil: t, basis: draft.meta.basis || '', stale: !!active && draft.meta.basis !== active.plan_hash,
    add: d.filter(k => !a.includes(k)), del: a.filter(k => !d.includes(k)), n: d.length };
}
// Anzeige eines Teilentwurfs (Cockpit-Karten und Atlas-Liste); Kennung b:<Typ>:<Stufe> lesbar als „<Typ> <Stufe>“
function planTeilHtml(x) {
  if (!x) return '';
  const nice = k => { const [, typ, lv] = k.replace(/~\d+$/, '').split(':'); return `${typ} ${lv}`; };
  const list = (l, w) => l.length ? `<div class="small">${w}: ${esc(l.slice(0, 12).map(nice).join(', '))}${l.length > 12 ? ` … (+${l.length - 12})` : ''}</div>` : '';
  return `<div class="small"><span class="tag">Teilplan ${esc(x.teil)}</span> nur dieser Planet neu gerechnet, ${x.n} Schritte dort; übrige Planeten und Forschung wie im aktiven Plan.</div>`
    + list(x.add, 'neu') + list(x.del, 'entfällt') + (!x.add.length && !x.del.length ? '<div class="small muted">Gleiche Schritte, andere Reihenfolge/Zeiten.</div>' : '')
    + (x.stale ? `<div class="small warn">Achtung: gerechnet auf Basis ${esc(x.basis)}, der aktive Plan ist inzwischen ein anderer – Freigabe ersetzt auch dessen Änderungen an anderen Planeten.</div>` : '');
}
// Ausführungen des Plans (executions mit plan_id) plus die aus anderen Plänen mit gleicher Kennung (data.key, Autobuilder ab
// 0.5.47): so behält ein neuer Plan den Stand unveränderter Planeten. step = Nummer in diesem Plan.
// Fremde Ausführungen nur mit den Kennungen dieses Plans, in Blöcken zu 60 (URL-Länge); vorher alle mit Kennung, begrenzt auf
// die neuesten 1000 (Review C3: wächst mit jedem Plan um 150–300).
async function loadPlanExecs(accId, planId, plan) {
  const keys = [...new Set(planStepKeys(plan))], blocks = [];
  for (let i = 0; i < keys.length; i += 60) blocks.push(keys.slice(i, i + 60));
  const [own, ...keyedBlocks] = await Promise.all([
    Cloud.q('executions', { account_id: accId, plan_id: `eq.${planId}`, select: 't,step,action,src_name,end:data->>end', order: 't.asc', limit: 1000 }),
    ...blocks.map(b => Cloud.q('executions', { account_id: accId, or: `(plan_id.is.null,plan_id.neq.${planId})`, ok: 'is.true',
      'data->>key': `in.(${b.map(k => `"${k}"`).join(',')})`, select: 't,action,src_name,key:data->>key', order: 't.desc', limit: 1000 }).catch(() => [])),
  ]);
  const keyed = keyedBlocks.flat().sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  const no = new Map(planStepKeys(plan).map((k, i) => [k, i + 1])), have = new Set(own.filter(e => e.step).map(e => e.step));
  const more = [];
  for (const e of keyed) { const n = no.get(e.key); if (n && !have.has(n)) { have.add(n); more.push({ t: e.t, step: n, action: e.action, src_name: e.src_name, carried: true }); } }
  return [...own, ...more].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
const planTabName = (plan, c) => (Array.isArray(plan.planets) && plan.planets.find(p => p?.coords === c)?.name) || c;
// Forschungs-Startplanet (M6): plan.researchPlanet {Nr: Koordinaten} nur für Forschung, die auf einer Kolonie startet (dort
// günstiger, Simulator --forschort); Forschung bleibt global (Reiter „Forschung (global)“, Kennung r:…). null = Heimat.
const planResPlanet = (plan, n) => { const c = plan?.researchPlanet?.[n]; return plan?.steps?.[n - 1]?.[0] === 'r' && typeof c === 'string' ? c : null; };
const planResTag = (plan, n) => { const c = planResPlanet(plan, n); return c ? ` <span class="tag aktiv" title="Forschung startet auf ${esc(c)}">startet auf ${esc(planTabName(plan, c))}</span>` : ''; };
// „bis“ je Reiter (M8, Autobuilder ab 0.5.65): Gruppe eines Schritts wie grpOf im Autobuilder – 'r' Forschung, Koordinaten
// (Kolonie), sonst 'h' (Heimat mit Schiffen). Reiter 'heim' = Gruppe 'h', 'alle' = keine Gruppe (gemeinsames „bis #“).
const planGrp = (plan, n) => plan.steps[n - 1]?.[0] === 'r' ? 'r' : planAway(plan, n) || 'h';
const planGroups = plan => [...new Set(['h', ...(plan?.steps || []).map((s, i) => planGrp(plan, i + 1))])];
const tabGrp = k => !k || k === 'alle' ? null : k === 'heim' ? 'h' : k;
const grpName = (plan, g) => g === 'h' ? 'Heimat' : g === 'r' ? 'Forschung' : plan ? planTabName(plan, g) : g;
// „#40“ oder „#40 (Heimat #35, Yontaurza V #50)“ – nur Reiter mit anderer Grenze (wie untilTxt im Autobuilder);
// by = {Gruppe: Nummer} aus Lebenszeichen (untilBy) oder Lauf (runs.until_by)
function untilTxt(until, by, plan) {
  const d = by && typeof by === 'object' ? Object.entries(by).filter(([, n]) => n !== until) : [];
  return `#${until ?? '–'}` + (d.length ? ` (${d.map(([g, n]) => `${grpName(plan, g)} #${n}`).join(', ')})` : '');
}
// Autobuilder-Version v mindestens w („0.5.65“)?
function verGe(v, w) {
  const a = String(v || '').split('.').map(Number), b = w.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}
// Reiter-Leiste (Klick setzt S.planTab, eigene Wahl unabhängig vom Planeten im Reiter Imperium)
const planTabsHtml = (tabs, cur) => `<div class="kseg pltabs" style="margin:4px 0">${tabs.map(t => `<button type="button" data-pltab="${esc(t.k)}" aria-pressed="${t.k === cur}">${esc(t.t)}</button>`).join('')}</div>`;
const planTabCur = tabs => tabs.some(t => t.k === S.planTab) ? S.planTab : 'alle';
function planTabsWire(root) {
  root?.querySelectorAll('[data-pltab]').forEach(b => b.addEventListener('click', () => { S.planTab = b.dataset.pltab; route(true); }));
}
// Live-Zeitplan (zeitplan.js, Nutzer 24.10.2026): erwartete Zeiten je Schritt wie im Autobuilder. Fertig laut isDone(n); läuft:
// Ausführung mit Ende in der Zukunft (executions.data.end); Startpunkte je Schlange aus dem Lebenszeichen des Autobuilders mit
// diesem Plan (hb.fc, ab 0.5.75), sonst Abweichung je Schlange aus den Starts, sonst sein Vorlauf. Überfälliges rückt auf jetzt.
function planLive(plan, isDone, execs, hb, now = Date.now()) {
  const ends = {}, starts = [];
  for (const e of execs || []) {
    if (!e.step || !plan.steps[e.step - 1]) continue;
    if (!e.carried) starts.push({ i: e.step - 1, t: Date.parse(e.t) });
    if (+e.end > now) ends[e.step - 1] = +e.end;
  }
  const mine = hb && hb.plan === plan.id ? hb : null;
  const lag = mine?.ahead != null ? -mine.ahead : 0;
  const F = Zeitplan.forecast(plan, { now, state: i => i in ends ? '1' : isDone(i + 1) ? '2' : '0', ends,
    anchors: mine?.fc || {}, lags: Zeitplan.lagsFrom(plan, starts), lag });
  F.lagB = Zeitplan.lagsFrom(plan, starts).b ?? lag;
  return F;
}
// Zeit-Feed (zeitfeed.js): je Schlange „läuft gerade / nächster Start + Wartegrund“ aus getData (gd = Zeile getdata_state), dem
// Lebenszeichen des Laufhalters (sonst eines Geräts mit diesem Plan) und dem Live-Zeitplan. Ergebnis: Zeitfeed.feed (Array je Schlange).
function planFeed(plan, execs, sess, gd, now = Date.now()) {
  const dev = sess?.devs?.find(x => x.holds && x.ab) || sess?.devs?.find(x => x.ab?.state?.plan === plan.id) || null;
  const st = dev?.ab?.state || {}, hst = st.plan === plan.id ? st : {};
  const ex = execs || [];
  const F = planLive(plan, planStepDone(plan, hst, ex), ex, hst, now);
  const hb = dev?.ab ? { ...st, at: dev.ab.at } : null;
  return Zeitfeed.feed(plan, F, { gd: gd || null, hb, execs: ex }, now);
}
/* Planetenkarte der Lage (Cockpit-Umbau PR 5, 25.10.2026): ein Planet kompakt, nur Realzeit (Zeitfeed), nie rohe Planzeiten.
   Reine String-Funktion (kein DOM). p = Planet aus empirePlanets ({name, coords}); rows = Feed-Zeilen dieses Planeten
   (Zeitfeed.feed: q 'b'/'b:<coords>' Bau, 's'/'s:<coords>' Werft, 'r' Forschung; ohne Plan Zeilen nur mit run {end, name}).
   opts: { research: Forschungsschlange gehört zu diesem Planeten, steps: plan.steps (für die Schrittnamen), current: im Spiel gewählt (◉), now,
   plan: null (Lage) | { plan, st, execs, W, LT, home } (Pläne, PR 6): zusätzlich Verteidigung (Platzhalter) und die Planschritte der
   nächsten 24 h (stepsTable opt.horizonH, Reiter heim bzw. Koordinaten; bei opts.research auch die Forschung global). st = Autobuilder-Stand
   mit until/untilBy/halts/open (je Reiter wird until aus untilBy gewählt), LT = planLive, home = Heimat-Koordinaten.
   Planetenwerte stehen seit den Nacharbeiten (25.10.2026, Nutzer) nur noch im Atlas (Planeten-DB). */
// Feed-Zeilen (Zeitfeed.feed bzw. liveJobRows) je Planet verteilt (Lage und Pläne teilen diese Zuordnung): Bau/Werft über die Koordinaten der
// Schlange ('heim' oder leer = Heimat), Forschung über den Startplaneten des nächsten/laufenden Schritts (plan.researchPlanet), sonst Heimat.
// plan darf null sein (Feed nur aus getData). planets = Koordinaten (oder Planeten mit coords); Ergebnis { <coords>: [Zeile] }, Zeilen
// fremder Planeten fallen weg.
function feedByPlanet(plan, feed, home, planets) {
  const coords = (planets || []).map(p => typeof p === 'string' ? p : p?.coords).filter(Boolean);
  const owner = r => {
    if (r.q === 'r') { const i = (r.next || r.run)?.i; return (plan && Number.isInteger(i) && planResPlanet(plan, i + 1)) || (r.planet !== null && r.planet !== undefined && r.planet !== 'heim' ? r.planet : home); }
    return r.planet === 'heim' || !r.planet ? home : r.planet;
  };
  const out = Object.fromEntries(coords.map(c => [c, []]));
  for (const r of feed || []) { const o = owner(r); if (out[o]) out[o].push(r); }
  return out;
}
// Heimat-Koordinaten eines Plans: getData (gd.colony), sonst Plan (plan.planet als Text oder Objekt), sonst Rückfall fb
const planHomeCoords = (plan, gd, fb) => (typeof gd?.colony?.coords === 'string' && gd.colony.coords)
  || (typeof plan?.planet === 'string' && plan.planet) || (typeof plan?.planet?.coords === 'string' && plan.planet.coords) || fb || null;
// Pläne-Teil der Planetenkarte (PR 6, Nacharbeiten 25.10.2026): Verteidigung (folgt), Planschritte der nächsten 24 h dieses Planeten,
// darüber der zuletzt abgeschlossene Schritt und aufklappbar die 10 davor
function planKarteSchritte(p, pp, research) {
  const { plan, st, execs, W, LT, home } = pp;
  const table = (k, label) => {
    if (!plan.steps.some((s, i) => planInTab(plan, k, s, i + 1))) return '';
    const g = tabGrp(k), hs = { ...st, until: (g && st?.untilBy?.[g]) || st?.until };
    return (label ? `<div class="small muted">${label}</div>` : '') + stepsTable(plan, hs, execs, W, k, LT, { fcRows: false, horizonH: 24 });
  };
  return '<div class="small muted">Verteidigung: folgt</div>'
    + table(p.coords === home ? 'heim' : p.coords, 'Planschritte (nächste 24 h)')
    + (research ? table('r', 'Forschung (global, nächste 24 h)') : '');
}
function planetKarte(p, rows, opts = {}) {
  const now = opts.now ?? Date.now(), steps = Array.isArray(opts.steps) ? opts.steps : null;
  const find = c => (rows || []).find(r => r && typeof r.q === 'string' && r.q[0] === c);
  const line = (label, r) => {
    if (!r) return '';
    const nm = i => (Number.isInteger(i) && steps?.[i]?.[5]) || '';
    let name, time, title = '', sub = [];
    if (r.run && r.run.end > now) {
      name = r.run.name || nm(r.run.i) || 'läuft';
      time = `noch ${esc(durDHM((r.run.end - now) / 1000))}`; title = `fertig ${dt(r.run.end)}`;
    } else if (r.next) {
      const x = r.next;
      name = nm(x.i) || `Schritt ${Number.isInteger(x.i) ? x.i + 1 : '?'}`;
      time = x.at != null ? `ab ${esc(clockT(x.at))}` : '–';
      const why = typeof Zeitfeed !== 'undefined' ? Zeitfeed.whyText(x.why) : '';
      if (why) sub.push(esc(why));
      if (x.due != null) sub.push(`fällig seit ${esc(dt(x.due))}`);
      title = [x.src && `Quelle ${x.src}`, x.srcAt != null && `Stand ${ago(x.srcAt)}`].filter(Boolean).join(', ');
    } else return '';
    return `<div class="plrow"><div class="pll"><b>${label}</b> ${esc(name)}${sub.length ? `<div class="small muted">${sub.join(' · ')}</div>` : ''}</div>`
      + `<div class="plt"${title ? ` title="${esc(title)}"` : ''}>${time}</div></div>`;
  };
  let body = line('Bau', find('b')) + (opts.research ? line('Forschung', find('r')) : '') + line('Werft', find('s'));
  if (!body) body = '<div class="small muted">Nichts in der Schlange.</div>';
  if (opts.plan?.plan) body += planKarteSchritte(p, opts.plan, !!opts.research);
  if (opts.extra) body += opts.extra;   // Lage (Umbau 2 U2): aufklappbar Ausbau je Art und Flotten (lageAusbau in app.js)
  const ask = typeof window !== 'undefined' && window.HZ_ASK && (typeof isOwner !== 'function' || isOwner()) ?`<div class="plfoot"><button class="small askgo" data-ask="${esc(p.coords)}">Claude fragen</button></div>` : '';
  return `<div class="card plcard"><h2>${esc(p.name || p.coords)} <span class="muted small">${esc(p.coords)}</span>${opts.current ? ' <span title="im Spiel gewählt">◉</span>' : ''}</h2>${body}${ask}</div>`;
}
const PLAN_LIVE_NOTE ='Zeiten live je Schlange (Heimat, Forschung, je Kolonie): laufende Aufträge bis zu ihrem Ende, sonst Startschätzung des Autobuilders bzw. Abweichung der Schlange; Überfälliges ab jetzt (reine Planzeit als Tooltip)';
// Zeitzelle eines Schritts (Tabellen und Kopfzeile): läuft bis …, fällig seit … oder erwarteter Start; done = Ausführung
function planLiveCell(x, e) {
  if (!x) return e ? esc(dt(e.t)) : '';
  if (x.run) return `läuft bis ${esc(dt(x.e))}`;
  return x.due != null ? `<span class="warn">fällig seit ${esc(dt(x.due))}</span>` : esc(dt(x.a));
}
// Kopfzeile Imperium: je Reiter der nächste offene Schritt mit Live-Zeit (LT = planLive), Überfälliges markiert
function planEmpire(plan, tabs, isDone, LT, now = Date.now(), col = false) {
  const rows = tabs.filter(t => t.k !== 'alle').map(t => {
    const i = plan.steps.findIndex((s, j) => planInTab(plan, t.k, s, j + 1) && LT.t[j] && !LT.t[j].run);
    const s = plan.steps[i];
    const nx = !s ? '<span class="muted">keine offenen Schritte</span>' : `nächster #${i + 1} ${esc(s[5])} · ${planLiveCell(LT.t[i])}`;
    return `<div><b>${esc(t.t)}</b>${t.kol && !col ? ' <span class="muted">(von Hand)</span>' : ''}: ${nx}</div>`;
  });
  return `<div class="small" style="margin:4px 0">${rows.join('')}<div class="muted">${col ? 'Der Autobuilder baut auf Heimat und Kolonien (Option „Kolonie-Schritte ausführen“), Forschung global.' : 'Der Autobuilder baut auf der Heimat; Kolonie-Schritte von Hand (Option „Kolonie-Schritte ausführen“ aus), Forschung global.'}</div></div>`;
}

/* ---------- Spieldaten (Gebäude und Forschung, Datenbank Runde 7); Reiter Kompendium in kompendium.js ---------- */

async function loadWissen() {
  if (S.wissen) return S.wissen;
  let r = await fetch(HZ_ROOT + 'data/horizon-data.json').catch(() => null);
  if (!r?.ok) r = await fetch(HZ_ROOT + '../analyse/horizon-data.json');  // lokale Vorschau aus dem Repo
  const d = await r.json();
  for (const o of Object.values(d.B)) o.L = Object.fromEntries(o.l.map(x => [x[0], x]));
  return (S.wissen = d);
}

// ---- Gemeinsame Plan-/Imperiums-Helfer (PR cockpit-umbau) ----
// Vorher doppelt in app.js und details/plaene.js bzw. details/imperium.js. RES (Rohstoffliste) bleibt je Seite in app.js bzw.
// details/imperium.js und wird von empireRes erst beim Aufruf gelesen.

/* ---------- Imperium (B2/B10): Planeten aus d.empire, Rohstoffe gesamt ---------- */
function empirePlanets(d) {
  const e = d?.empire;
  if (!e || e.error) return [];
  const list = (e.planets || []).map(p => ({ ...p }));
  // Spalten der Übersicht (Koordinaten) und Zeilen von emp_prod (nur Name) den Planeten zuordnen
  for (const p of list) {
    for (const t of ['buildings', 'ships', 'defence']) {
      const o = e[t], k = o?.planets ? o.planets.findIndex(x => x.coords === p.coords) : -1;
      p[t] = k >= 0 ? o.items.map(i => ({ type: i.type, cat: i.cat, n: i.values[k], busy: (i.busy || []).includes(k) })).filter(i => i.n) : [];
    }
    for (const [t, v] of Object.entries(e.res || {})) p[t] = v?.planets?.find(x => x.name === p.name) || null;
  }
  return list;
}
function empireRes(d, hrs) {
  const pl = empirePlanets(d).filter(p => p.storage);
  if (!pl.length) return null;
  const cur = d.start?.coords, stab = d.prod?.['Maximal stabile Menge'] || {};
  return RES.map(x => {
    let now = 0, net = 0, full = null;
    for (const p of pl) {
      const r = (p.production?.[x] ?? 0) / 24, cap = p.coords === cur ? stab[x] : null;   // Grenze nur für den gewählten Planeten bekannt
      const v = Math.min((p.storage[x] || 0) + r * hrs, cap || Infinity);
      now += v; net += r;
      if (r > 0 && cap && pl.length === 1) full = (cap - v) / r * 3600;
    }
    return { x, now, net, full };
  });
}

/* ---------- Plan: Faktorwechsel, Erledigt-Logik, Schrittliste ---------- */
const FMT_PCT = f => `${Math.round(f * 10) * 10} %`;
// Faktorwechsel des Plans: [Planzeit h, {typ: Anteil}] → nur die Änderungen gegenüber der vorigen Liste
function factorChanges(plan) {
  const out = [];
  let prev = {};
  for (const [tau, f] of plan.factors || []) {
    const ch = Object.entries(f).filter(([k, v]) => Math.round((prev[k] ?? 1) * 10) !== Math.round(v * 10)).map(([k, v]) => [k, prev[k] ?? 1, v]);
    if (ch.length) out.push({ tau, ch });
    prev = { ...prev, ...f };
  }
  return out;
}
// Erledigt: Ausführung (executions) oder vor dem ersten offenen Schritt des Autobuilders – Kolonie-Schritte baut er (bis M3)
// nicht, für sie zählt nur eine Ausführung
const planStepDone = (plan, st, execs) => {
  const open = (st.open || []).filter(Number.isInteger), first = open.length ? Math.min(...open) : null;
  const done = new Set(execs.filter(e => e.step).map(e => e.step));
  return n => done.has(n) || (first != null && n < first && !planAway(plan, n));
};
/* Planschritte (Reiter aus planTabs/planInTab, M5): tab = 'alle' | 'heim' | Koordinaten einer Kolonie | 'r' (Forschung).
   Zeiten: Live-Zeitplan (LT = planLive, Nutzer 24.10.2026, wie im Autobuilder), reine Planzeit als Tooltip.
   opt.all = true: alle Schritte nach Live-Zeit mit Historie (Atlas, Pläne); false: Ausschnitt wie im Cockpit (C1, 17.10.2026) –
   die nächsten opt.nearLimit Schritte ab dem ersten offenen (im Reiter eines Planeten: die nächsten offenen dieses Reiters)
   und ±3 um „bis #“, Lücken als „…“, mit ⏸ (Halt) und Marke „bis #“.
   opt.fcRows = false lässt die Faktorwechsel-Zeilen weg. opt.marks = 'farben' (Atlas, Gesamtplan): je Schlange eine Farbe (qc0…qc5 in
   details.css), laufender Schritt ▶ und erster offener ⏵ in Schlangenfarbe, darüber eine Legende (Namen wie die Reiter, opt.home = Heimatplanet).
   opt.horizonH = h (Cockpit, Planeten-Karten unter Pläne, Nutzer 25.10.2026): alle laufenden und offenen Schritte des Reiters mit Live-Start
   bis jetzt + h (mindestens die nächsten 5), oben der zuletzt abgeschlossene, darüber aufklappbar die 10 davor; kein Fenster um „bis #“. */
// Zeilenfarbe je Art (Nutzer 26.10.2026): Forschung, Schiffe und Transporte farblich vom Bau abgesetzt (style.css tr.kr/ks/kt)
const KIND_ROW = { r: ' kr', s: ' ks' };
// Transporte im Reiter tab: alle/ohne Reiter und Heimat alle, Kolonie die eigenen, Forschung keine
const planTransports = (plan, tab) => (Array.isArray(plan?.transporte) ? plan.transporte : [])
  .filter(x => x && isFinite(x.t) && (!tab || tab === 'alle' || tab === 'heim' || (tab !== 'r' && (x.nach === tab || x.von === tab))));
const planLadung = l => { const p = (Array.isArray(l) ? l : []).map((v, i) => +v > 0 ? `${['Erz', 'Min', 'Treib'][i]} ${fmt(+v)}` : '').filter(Boolean); return p.length ? p.join(' · ') : 'leer'; };
// Kosten eines Planschritts (steps[i][6] = [Eisenerz, Mineral, Treibstoff]) als kleine Zeile unter dem Namen (Nutzer 30.10.2026)
const stepKosten = c => { const p = (Array.isArray(c) ? c : []).map((v, i) => +v > 0 ? `${['E', 'M', 'T'][i]} ${fmt(+v)}` : '').filter(Boolean); return p.length ? `<div class="small muted">${esc(p.join(' · '))}</div>` : ''; };
function stepsTable(plan, st, execs, W, tab, LT, opt = {}) {
  const { all = false, fcRows = true, nearLimit = 12, marks = null, home = null, horizonH = null, now = Date.now() } = opt;
  const t0 = Date.parse(plan.startTime);
  const tip = tau => ` title="Plan: ${esc(dt(t0 + tau * 3600e3))}"`;
  const fcAt = tau => esc(dt(Zeitplan.atTau(plan, LT, tau, 'b', LT.lagB)));
  const open = (st.open || []).filter(Number.isInteger);
  const first = open.length ? Math.min(...open) : null;
  const until = st.until || null;
  const done = new Map(execs.filter(e => e.step).map(e => [e.step, e]));
  const isDone = planStepDone(plan, st, execs);
  const nameOf = k => W?.B?.[k]?.n || k;
  const fcs = fcRows && (!tab || tab === 'alle' || tab === 'heim') ? factorChanges(plan) : [];   // Faktoren gelten für die Heimat
  const fcKey = fc => Zeitplan.atTau(plan, LT, fc.tau, 'b', LT.lagB);
  const stepRow = (s, i) => ({ tau: s[3], n: i + 1, s, k: Zeitplan.sortKey(plan, LT, i, Date.parse(done.get(i + 1)?.t)) });
  const cmp = (a, b) => a.k - b.k || (a.fc ? -1 : b.fc ? 1 : a.tr ? 1 : b.tr ? -1 : a.n - b.n);   // nach Live-Zeit, bei Gleichstand #Nr (Nutzer 24.10.2026)
  // Farbmarken je Schlange (opt.marks = 'farben'): Farbindex nach erstem Vorkommen im Plan, ab der 7. Schlange wieder von vorn
  const qcols = marks === 'farben' ? (() => {
    const m = new Map();
    plan.steps.forEach((s, i) => { const q = Zeitplan.queueOf(plan, i); if (!m.has(q)) m.set(q, `qc${m.size % 6}`); });
    return m;
  })() : null;
  const qmark = (ch, q) => `<span class="qmark ${qcols.get(q) || ''}">${ch}</span>`;
  const qLegend = steps => {
    if (!qcols) return '';
    const tabs = planTabs(plan, home), qs = [...new Set(steps.map(i => Zeitplan.queueOf(plan, i)))].filter(q => qcols.has(q));
    const label = q => {
      const c = q.slice(2), t = tabs.find(x => x.k === (q === 'r' ? 'r' : c || 'heim'));
      return q[0] === 's' ? `Werft${c ? ' ' + (t ? t.t : c) : ''}` : t ? t.t : q;
    };
    return qs.length ? `<div class="small qlegend">${qs.map(q => `<span class="tag">${qmark('⏵', q)} ${esc(label(q))}</span>`).join(' ')}</div>` : '';
  };
  const row = r => {
    const e = done.get(r.n), run = LT.t[r.n - 1]?.run, kol = planAway(plan, r.n), isUntil = !all && r.n === until;
    const mark = run ? '⏵' : isDone(r.n) ? '✓' : open.includes(r.n) ? '▶' : !all && (st.halts || []).includes(r.n) ? '⏸' : '';
    const q = qcols ? Zeitplan.queueOf(plan, r.n - 1) : null;
    const qm = !qcols ? '' : run ? qmark('▶', q) + ' ' : LT.first?.[q]?.i === r.n - 1 ? qmark('⏵', q) + ' ' : '';
    return `<tr class="step${KIND_ROW[r.s[0]] || ''}${isDone(r.n) && !run ? ' muted' : ''}${isUntil ? ' until' : ''}" data-i="${r.n}"><td class="num">${mark} #${r.n}</td><td>${qm}${esc(r.s[5])}${r.s[0] === 'r' ? ' <span class="tag">global</span>' + planResTag(plan, r.n) : ''}${kol && (!tab || tab === 'alle') ? ` <span class="tag aktiv">${esc(planTabName(plan, kol))}</span>` : ''}${kol && !isDone(r.n) && !st.colony ? ' <span class="muted">· von Hand</span>' : ''}${isUntil ? ' <span class="tag ok">bis #</span>' : ''}${stepKosten(r.s[6])}${e ? `<div class="small">gestartet ${esc(dt(e.t))} · ${esc(e.src_name)}${all && e.carried ? ' · aus Vorplan (gleiche Kennung)' : ''}</div>` : ''}</td>
      <td class="num"${tip(r.tau)}>${planLiveCell(LT.t[r.n - 1], e)}</td></tr>`;
  };
  // Transporte des Plans (payload.transporte, Takt-Flüge) als eigene Zeilen; Zeit wie Faktorwechsel an der Heimat-Bauschlange ausgerichtet
  const trAt = h => Zeitplan.atTau(plan, LT, h, 'b', LT.lagB);
  const hc = plan.planet?.coords || home?.coords, plName = c => c && c === hc ? plan.planet?.name || home?.name || 'Heimat' : planTabName(plan, c);
  const trRow = (x, at) => `<tr class="step kt"><td class="num">T${esc(x.nr)}</td><td>Transport ${esc(plName(x.von))} → ${esc(plName(x.nach))}`
    + `<div class="small muted">hin ${esc(planLadung(x.hin))} · zurück ${esc(planLadung(x.zurueck))} · abhaken im Cockpit (Transporte)</div></td><td class="num"${tip(x.t)}>${esc(dt(at))}</td></tr>`;
  const kindLegend = '<div class="small qlegend"><span class="tag kr">Forschung</span> <span class="tag ks">Schiffe</span> <span class="tag kt">Transporte</span> <span class="tag">Gebäude</span></div>';
  const fcRow = fc => `<tr class="muted"><td></td><td>⚙ Faktor ${fc.ch.map(([k, a, b]) => `${esc(nameOf(k))} ${FMT_PCT(a)} → ${FMT_PCT(b)}`).join(', ')}</td><td class="num"${tip(fc.tau)}>${fcAt(fc.tau)}</td></tr>`;
  if (all) {   // alle Schritte, erledigte nach ihrem Start; tau bleibt Planzeit (Tooltip)
    const rows = [];
    plan.steps.forEach((s, i) => { if (planInTab(plan, tab, s, i + 1)) rows.push(stepRow(s, i)); });
    for (const fc of fcs) rows.push({ tau: fc.tau, fc, k: fcKey(fc) });
    for (const x of planTransports(plan, tab)) { const k = trAt(x.t); rows.push({ tau: x.t, tr: x, k }); }
    rows.sort(cmp);
    return `${qLegend(rows.filter(r => !r.fc && !r.tr).map(r => r.n - 1))}${kindLegend}<table class="small">${rows.map(r => r.fc ? fcRow(r.fc) : r.tr ? trRow(r.tr, r.k) : row(r)).join('')}</table>`;
  }
  if (horizonH != null) {
    const mine = [];
    plan.steps.forEach((s, i) => { if (planInTab(plan, tab, s, i + 1)) mine.push(i + 1); });
    const isRun = n => !!LT.t[n - 1]?.run;
    const startOf = n => { const x = LT.t[n - 1]; return !x ? Infinity : x.run ? -Infinity : x.due != null ? now : x.a ?? Infinity; };
    const open = mine.filter(n => isRun(n) || !isDone(n)).map(n => stepRow(plan.steps[n - 1], n - 1)).sort(cmp);
    let next = open.filter(r => startOf(r.n) <= now + horizonH * 3600e3);
    if (next.length < 5) next = open.slice(0, Math.max(5, next.length));   // mindestens die nächsten 5, sonst alle der nächsten h Stunden (Nutzer 30.10.2026)
    const past = mine.filter(n => isDone(n) && !isRun(n)).map(n => stepRow(plan.steps[n - 1], n - 1)).sort(cmp).slice(-11);
    const lastOne = past.pop();
    if (!next.length && !lastOne) return '<p class="muted small">Keine Planschritte.</p>';
    const older = past.length ? `<details class="sub"><summary class="small muted">Letzte ${past.length} einblenden</summary><table class="small">${past.map(row).join('')}</table></details>` : '';
    return `${older}<table class="small">${lastOne ? row(lastOne) : ''}${next.map(row).join('')}</table>${!next.length ? '<p class="muted small">Kein offener Schritt.</p>' : ''}`;
  }
  // Ausschnitt (Cockpit): im Reiter eines Planeten/der Forschung die nächsten nearLimit offenen Schritte dieses Reiters statt des Nummernfensters
  const own = plan.steps.map((s, i) => i + 1).filter(n => tab && tab !== 'alle' && planInTab(plan, tab, plan.steps[n - 1], n) && !isDone(n));
  const from = tab && tab !== 'alle' ? own[0] ?? first ?? 1 : first ?? 1;
  const near = n => tab && tab !== 'alle' ? own.indexOf(n) >= 0 && own.indexOf(n) < nearLimit : n >= from && n < from + nearLimit;
  const show = n => near(n) || (until && Math.abs(n - until) <= 3);
  const steps = [];
  plan.steps.forEach((s, i) => { if (show(i + 1) && planInTab(plan, tab, s, i + 1)) steps.push(stepRow(s, i)); });
  if (!steps.length) return `<p class="muted small">Kein offener Schritt${until ? ` bis #${esc(until)}` : ''}${first ? ` (als Nächstes #${first})` : ''}.</p>`;
  // zusammenhängende Gruppen (Lücke = „…“); Faktorwechsel nur innerhalb einer Gruppe
  const groups = [];
  const gap = until && until - 3 > from + nearLimit;   // Ausschnitt um „bis #“ getrennt vom Anfang
  for (const r of steps) { const g = groups[groups.length - 1]; if (g && !(gap && near(g[g.length - 1].n) && !near(r.n))) g.push(r); else groups.push([r]); }
  // je Abschnitt nach Live-Zeit, bei Gleichstand #Nr (Nutzer 24.10.2026); Faktorwechsel mit ihrer Live-Zeit dazwischen
  return `${qLegend(steps.map(r => r.n - 1))}<table class="small">${groups.map(g => {
    const ks = g.map(r => r.k), lo = Math.min(...ks), hi = Math.max(...ks);
    const list = [...g, ...fcs.map(fc => ({ tau: fc.tau, fc, k: fcKey(fc) })).filter(r => r.k >= lo && r.k <= hi)].sort(cmp);
    return list.map(r => r.fc ? fcRow(r.fc) : row(r)).join('');
  }).join('<tr class="muted"><td></td><td>…</td><td></td></tr>')}</table>`;
}

/* ---------- Entwürfe: Gewinn gegenüber dem aktiven Plan (B14) ---------- */
const PLAN_GAIN_MIN = 0.5;   // h, Rückfall ohne Zielzeit-Vergleich, wie SCHWELLE in tools/push_plan.py
const PLAN_GAIN_MIN_PCT = 1;   // % früher am Ziel (B1 29.10.2026; Schwelle 1 % seit 24.10.), wie SCHWELLE_PCT in tools/push_plan.py
const planEnd = p => {
  const h = +p?.hours || +(String(p?.created || '').match(/([\d.]+) h$/) || [])[1];
  return p?.startTime && h ? Date.parse(p.startTime) + h * 3600e3 : null;
};
// Verschiebung des aktiven Plans in h (positiv = später): Startverzug + Rückstand bzw. − Vorlauf; vor dem ersten Start die Wartezeit
const planShift = drift => !drift ? 0 : drift.lag != null ? (+drift.offset || 0) + +drift.lag : Math.max(+drift.wait || 0, 0);
const activeEnd = (active, drift) => {
  const end = planEnd(active?.payload);
  return end ? end + planShift(drift) * 3600e3 : null;
};
// Ausführungsrelevanter Inhalt eines Bauplans wie INHALT in tools/push_plan.py: Felder der Plan-ID (analyse/build_autobuilder.js
// planHash) plus Haltepunkte und Faktor-Grenzen, ohne Metadaten (id, created, parent, lauf, bis, vergleich …)
const PLAN_INHALT = ['startTime', 'steps', 'factors', 'stepPlanet', 'researchPlanet', 'planetFactors', 'park', 'halts', 'limits'];
const PLAN_INHALT_SELECT = PLAN_INHALT.map(k => `${k}:payload->${k}`).join(',');
const leerWert = x => x == null || x === '' || (Array.isArray(x) ? !x.length : typeof x === 'object' && !Object.keys(x).length);
// Tiefer Vergleich unabhängig von der Schlüsselreihenfolge (jsonb ordnet Schlüssel um), Zahlen per Wert
function gleichJson(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') return typeof a === 'number' && typeof b === 'number' && a === b;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => gleichJson(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && gleichJson(a[k], b[k]));
}
// true, wenn beide Pläne denselben Inhalt haben (Atlas „Plan neu starten“ ohne Änderung: neue Plan-id, gleicher Inhalt); fehlende,
// null und leere Felder gelten gleich (der Plan-Editor löscht leere halts/limits). Ohne Schritte nie gleich.
function gleicherPlanInhalt(a, b) {
  if (!Array.isArray(a?.steps) || !a.steps.length) return false;
  return PLAN_INHALT.every(k => leerWert(a[k]) && leerWert(b?.[k]) || gleichJson(a[k], b?.[k]));
}
// Zeit bis zum Ziel (B1, 29.10.2026; vorher Förderung bei T): { pctZ (% früher), zielNeu, zielAkt (h, null = nie), kopieVon? } bzw.
// { fehlt: Grund } ohne Vergleichswert; null ohne bis.ziel. Aktiver Wert: vergleich.goalAt des Entwurfs (Optimierer --gegen, selber
// Lauf), wenn vergleich.planId oder planIdOhnePark = Plan-id des aktiven Plans oder der aktive Plan eine unveränderte Kopie eines
// dieser Pläne ist (refs: {plan_hash, …PLAN_INHALT}, 27.10.2026) und zulässig – erreicht er das Ziel dort nie, gilt 100 %; sonst
// bis.zielUhr des aktiven Plans (eigener Lauf, grob); sonst kein Vergleich (Stunden-Rückfall, „Vergleich fehlt“). Wie tools/push_plan.py.
// Läufe mit --bedarf (Nachtlauf seit 29.10.2026 abends): Maß Deckungstage bei T (d.deck gegen d.vDeck desselben Laufs, weniger = besser;
// { deckung: true, pctZ, zielNeu, zielAkt in d }); kein Rückfall auf den eigenen Lauf des aktiven Plans. Wie tools/push_plan.py.
function zielVergleich(d, active, refs = []) {
  const num = x => x != null && x !== '' ? +x : NaN;
  const ids = [d.vPlan, d.vPlanOP].filter(Boolean), ah = active?.plan_hash;
  const kopie = ah && !ids.includes(ah) ? refs.find(r => ids.includes(r.plan_hash) && gleicherPlanInhalt(active.payload, r))?.plan_hash : null;
  const deck = num(d.deck);
  if (deck >= 0) {
    const gleich = ah && (ids.includes(ah) || kopie), akt = num(d.vDeck), ga = num(d.vZiel), t = num(d.bisH);
    if (gleich && d.vOk === 'true' && akt > 0) {
      if (!(ga >= 0) || ga > t + 1e-6) return { deckung: true, pctZ: 100, zielNeu: deck, zielAkt: null, kopieVon: kopie || null };
      return { deckung: true, pctZ: (akt - deck) / akt * 100, zielNeu: deck, zielAkt: akt, kopieVon: kopie || null };
    }
    return { fehlt: !ids.length ? 'Lauf ohne Vergleich' : !gleich ? `Lauf verglich gegen ${ids.join('/')}, aktiver Plan ${ah || '–'} ist ein anderer`
      : d.vOk !== 'true' ? 'aktiver Plan im Lauf unzulässig' : 'Lauf ohne Deckungstage des aktiven Plans' };
  }
  const neu = num(d.zielH);
  if (!(neu >= 0)) return null;
  let akt = NaN, kopieVon = null;
  if (ah && (ids.includes(ah) || kopie) && d.vOk === 'true') {
    if (d.vZiel == null || d.vZiel === '') return { pctZ: 100, zielNeu: neu, zielAkt: null, kopieVon: kopie || null };
    akt = +d.vZiel; kopieVon = kopie || null;
  } else if (active?.payload?.bis?.zielUhr && d.zielUhr) akt = neu + (Date.parse(active.payload.bis.zielUhr) - Date.parse(d.zielUhr)) / 3600e3;
  if (akt > 0) return { pctZ: (akt - neu) / akt * 100, zielNeu: neu, zielAkt: akt, kopieVon };
  const fehlt = !ids.length ? 'Lauf ohne Vergleich' : !ids.includes(ah) && !kopie
    ? `Lauf verglich gegen ${ids.join('/')}, aktiver Plan ${ah || '–'} ist ein anderer` : 'aktiver Plan im Lauf unzulässig';
  return { fehlt };
}
// Pläne mit den verglichenen Plan-ids (Inhalt) für die Kopie-Erkennung; nur nötig, wenn ein Entwurf gegen eine andere id verglich.
// Je aktivem Plan und Id-Menge gecacht (die Pläne-Ansicht lädt alle 30 s neu).
async function vergleichRefs(rows, active) {
  const ids = [...new Set(rows.flatMap(d => [d.vPlan, d.vPlanOP]).filter(x => x && /^[0-9a-f]{6,64}$/.test(x) && x !== active?.plan_hash))].sort();
  if (!ids.length || !active?.payload) return [];
  const key = `${S.acc}|${active.id}|${ids.join(',')}`;
  if (S.vRefs?.key === key) return S.vRefs.rows || [];
  const refs = await Cloud.q('plans', { account_id: `eq.${S.acc}`, kind: 'eq.build',
    plan_hash: `in.(${ids.join(',')})`, select: `plan_hash,${PLAN_INHALT_SELECT}` }).catch(() => null);
  if (refs) S.vRefs = { key, rows: refs };   // Fehler nicht cachen: beim nächsten Laden neu versuchen
  return refs || [];
}
// Gewinn je Bauplan-Entwurf: { end, gain (h), pct (% der Restzeit des aktiven Plans bis zum Ziel), pctZ/zielNeu/zielAkt (Zeit bis zum Ziel), agreed, better }
async function draftGains(plans, active, drift) {
  const drafts = plans.filter(p => p.kind === 'build' && p.status === 'entwurf');
  if (!drafts.length) return {};
  const rows = await Cloud.q('plans', { id: `in.(${drafts.map(p => p.id).join(',')})`,
    select: 'id,startTime:payload->>startTime,hours:payload->>hours,created:payload->>created,agreed:payload->>agreed,teil:payload->meta->>teil,'
      + 'zielH:payload->bis->>ziel,zielUhr:payload->bis->>zielUhr,vPlan:payload->vergleich->>planId,vPlanOP:payload->vergleich->>planIdOhnePark,'
      + 'vZiel:payload->vergleich->>goalAt,vOk:payload->vergleich->>ok,deck:payload->bis->>deckung,bisH:payload->bis->>h,vDeck:payload->vergleich->>deckung' });
  const aEnd = activeEnd(active, drift), rest = aEnd ? Math.max((aEnd - Date.now()) / 3600e3, 0.01) : null;
  const refs = active ? await vergleichRefs(rows.filter(d => drafts.find(x => x.id === d.id)?.source !== 'user'), active) : [];
  // Teilentwürfe (M9): Inhalt nachladen, Unterschiede für den Planeten gegen den aktiven Plan
  const teile = rows.filter(d => d.teil).map(d => d.id), teilOf = {};
  if (teile.length) for (const t of await Cloud.q('plans', { id: `in.(${teile.join(',')})`, select: 'id,payload' })) teilOf[t.id] = planTeilDiff(t.payload, active);
  const out = {};
  for (const d of rows) {
    const p = drafts.find(x => x.id === d.id), end = planEnd(d);
    // eigene Entwürfe tragen Planstart und Stunden des Ausgangsplans → kein Vergleich
    const gain = end && aEnd && p.source !== 'user' ? (aEnd - end) / 3600e3 : null, agreed = d.agreed === 'true';
    const f = p.source !== 'user' && active ? zielVergleich(d, active, refs) : null;
    out[d.id] = { end, gain, pct: gain != null ? gain / rest * 100 : null, ...(f || {}), agreed, teil: teilOf[d.id] || null,
      better: agreed || !!teilOf[d.id] || !active || (f?.pctZ != null ? f.pctZ >= PLAN_GAIN_MIN_PCT : gain == null || gain > PLAN_GAIN_MIN) };
  }
  return out;
}
// ohne Zielzeit-Vergleich (g.fehlt): klar als „Vergleich fehlt“ kennzeichnen, Stundenmaß nur als grober Rückfall (27.10.2026)
const gainText = g => g?.deckung ? `Deckungstage bei T ${fmt(Math.abs(g.pctZ), 1)} % ${g.pctZ >= 0 ? 'weniger' : 'mehr'} (aktiv ${g.zielAkt != null ? fmt(g.zielAkt, 1) + ' d' : 'Ziel nicht bis T'} → neu ${fmt(g.zielNeu, 1)} d${g.kopieVon ? `; aktiver Plan = unveränderte Kopie von ${g.kopieVon}` : ''})`
  : g?.pctZ != null ? `Ziel ${fmt(Math.abs(g.pctZ), 1)} % ${g.pctZ >= 0 ? 'früher' : 'später'} (aktiv ${g.zielAkt != null ? fmt(g.zielAkt, 1) + ' h' : 'nie'} → neu ${fmt(g.zielNeu, 1)} h${g.kopieVon ? `; aktiver Plan = unveränderte Kopie von ${g.kopieVon}` : ''})`
  : [g?.fehlt ? `Vergleich der Zielzeit fehlt (${g.fehlt})` : '',
     g?.gain == null ? '' : `${g?.fehlt ? 'Rückfall, nur grob: ' : ''}SCOL ${fmt(Math.abs(g.gain), 1)} h ${g.gain >= 0 ? 'früher' : 'später'} (${fmt(Math.abs(g.pct), 1)} % der Restzeit)`].filter(Boolean).join(' · ');
const gainOk = g => g?.pctZ != null ? g.pctZ >= PLAN_GAIN_MIN_PCT : g?.gain > PLAN_GAIN_MIN;

// Herkunft und Klapper „Details“ eines Plans (B16): Notiz in Anzeigeform, darunter die technischen Kennungen.
// Werft-/Def-Pläne: im Atlas die Vorschau aus details/werft.js, im Cockpit ein Link dorthin (Vorschau seit C1 im Atlas)
const SRC = { optimizer: 'Optimierer', user: 'eigener Entwurf', claude: 'Claude' };
const WERFT_KINDS = ['ship', 'defense', 'probe'];
function planDetails(p) {
  if (!p.note && !p.plan_hash && !p.id) return '';
  return `<details class="sub"><summary class="small muted">Details</summary>${p.note ? `<div class="small wrapall" style="white-space:pre-wrap">${esc(tidy(p.note))}</div>` : ''}
    <div class="small muted wrapall">Plan-id ${esc(p.plan_hash || '–')} · Datensatz ${esc(p.id)}${p.parent_id ? ` · Vorlage ${esc(p.parent_id)}` : ''}</div></details>`
    + (ATLAS ? (window.HzWerftCockpit?.details(p) || '')
      : WERFT_KINDS.includes(p.kind) ? `<div class="small"><a href="details/#/werft" target="_blank" rel="noopener">Schritte und Auftragsliste im Atlas →</a></div>` : '');
}

/* ---------- Planabweichung (B4): Stundentexte ---------- */
const hrs = h => `${fmt(Math.abs(h), 1)} h`;
const lagText = h => h == null ? '–' : h >= 0.05 ? `Plan läuft ${hrs(h)} nach` : h <= -0.05 ? `Plan läuft ${hrs(h)} vor` : 'genau im Plan';
// Abweichung des aktiven Bauplans vom Server (RPC plan_abweichung_akt = private.plan_lag), 60 s im Cache: S.drift = { acc, at, d }.
// Fehler → d null (Anzeige bleibt leer). force = Cache ignorieren (Pläne-Ansicht lädt alle 30 s neu).
async function loadDrift(force = false) {
  if (!force && S.drift?.acc === S.acc && Date.now() - S.drift.at < 60000) return S.drift.d;
  const acc = S.acc;
  let d = null;
  try { d = await Cloud.rpc('plan_abweichung_akt', { p_account: acc }) || null; } catch { d = null; }
  S.drift = { acc, at: Date.now(), d };
  return d;
}
// Text der Abweichung für Lauf-Zeilen: leer, solange nichts geladen, kein Plan oder noch nichts gestartet (lag null); nach 5 min veraltet
const driftLagText = () => S.drift?.d?.lag != null && S.drift.acc === S.acc && Date.now() - S.drift.at < 300000 ? lagText(S.drift.d.lag) : '';

/* ---------- Kommandos: Liste und Nachsehen (Cockpit-Lage und Atlas, Cockpit-Umbau PR 4) ----------
   „Letzte Kommandos“ steht seit PR 4 nur noch im Atlas (Imperium → Wartung); die Lage zeigt keine Kommandoliste mehr.
   NF_CMDS = Kommandos der Notfallzentrale/Wartung (Filter für die Liste). */
const NF_CMDS = ['stop', 'reload', 'snapshot', 'factors', 'factor', 'notfall', 'antwort'];
// Kommandos als zweizeilige Liste (B16: passt aufs Handy): Was → Gerät, Zeit; darunter Status und Ergebnis
const CMD_DE = { start: 'Start', stop: 'Stopp', adopt: 'Plan übernehmen', reload: 'Neu laden', snapshot: 'Lage lesen', factors: 'Faktoren sichern',
  factor: 'Faktor', banner: 'Werbebanner', pause: 'Pause', weiter: 'Weiter' };
const cmdTable = cmds => !cmds.length ? '' : `<h3>Letzte Kommandos</h3>${cmds.map(c => `<div class="list-item small"><div class="row between">
    <span><b>${esc(c.cmd === 'start' && c.args?.mode === 'dry' ? 'Probelauf' : CMD_DE[c.cmd] || c.cmd)}</b>${c.args?.accept ? ' (von Hand übernehmen)' : ''}${c.args?.until ? ' bis ' + esc(untilTxt(c.args.until, c.args.untilBy)) : ''}${c.cmd === 'factor' ? ` ${esc(c.args?.type)} ${esc(c.args?.to)} %` : ''}${c.target_name ? ` → ${esc(c.target_name)}` : ''}</span>
    <span class="muted nowrap">${esc(when(c.created_at))}</span></div>
    <div><span class="tag">${esc(c.status)}</span> <span class="muted">${esc(tidy(c.result))}${c.taken_name && c.taken_name !== c.target_name ? ` · ${esc(c.taken_name)}` : ''}</span></div></div>`).join('')}`;

// Offene Kommandos (neu/angenommen) alle 5 s nachsehen, ohne die Seite neu aufzubauen; fertig → einmal neu laden
const OPEN_CMD = c => ['neu', 'angenommen'].includes(c.status);
function watchCmds(cmds, since = Date.now(), el = '#nfCmds', filter = {}) {
  clearTimeout(watchCmds.t);
  if (!cmds.some(OPEN_CMD)) return;
  watchCmds.t = setTimeout(async () => {
    if (!$(el) || Date.now() - since > 5 * 60e3) return;
    try {
      const fresh = await Cloud.q('commands', { account_id: `eq.${S.acc}`, script: 'eq.autobuilder', order: 'id.desc', limit: 5, ...filter });
      if (!$(el)) return;
      $(el).innerHTML = cmdTable(fresh);
      if (fresh.some(OPEN_CMD)) watchCmds(fresh, since, el, filter); else route(true);
    } catch { watchCmds(cmds, since, el, filter); }
  }, 5000);
}

/* ---------- Aktiver Bauplan (Lage-Steuerung und Pläne) ----------
   Kopf des freigegebenen/aktiven Bauplans plus Payload (bis ca. 30 KB, nur einmal je Plan über S.planCache geladen).
   Liefert { row, payload } oder null, wenn kein Plan freigegeben ist. */
async function loadActivePlan() {
  const heads = await Cloud.q('plans', { account_id: `eq.${S.acc}`, kind: 'eq.build', status: 'in.(freigegeben,aktiv)', order: 'approved_at.desc.nullslast', limit: 1,
    select: 'id,status,title,plan_hash' });
  const row = heads[0];
  if (!row) return null;
  if (S.planCache?.id !== row.id) S.planCache = { id: row.id, payload: (await Cloud.q('plans', { id: `eq.${row.id}`, select: 'payload' }))[0]?.payload };
  return { row, payload: S.planCache.payload };
}
