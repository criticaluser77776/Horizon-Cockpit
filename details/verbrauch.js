'use strict';
/* Horizon Atlas – Reiter Verbrauch (D2, 17.10.2026). Karte als Kopie aus cockpit/app.js (Mehr → Verbrauch, im Cockpit bis C1). */

/* ---------- Verbrauch (B5, 15.10.) ----------
   usage_daily: Größen trägt die DB stündlich selbst ein (pg_cron verbrauch-db), Actions-Minuten und Anfragen die GitHub Action
   verbrauch.yml (tools/verbrauch.py, täglich 23:40 UTC). Actions seit 16.10. aus der Abrechnung des ganzen GitHub-Kontos:
   actions_ms = Minuten privater Repos (belasten das Freikontingent), actions_by je Repo, öffentliche mit „(öffentlich)“. Monat = Kalendermonat UTC wie bei GitHub; Supabase rechnet je
   Abrechnungszeitraum der Organisation (Dashboard), die Grenzen gelten dort je Monat. Egress gibt es nicht per API. */
const USE_LIMIT = { db: 500 * 2 ** 20, storage: 2 ** 30, actions: 2000 };
const mb = b => b == null ? '–' : b >= 2 ** 30 ? fmt(b / 2 ** 30, 2) + ' GB' : fmt(b / 2 ** 20, b < 10 * 2 ** 20 ? 2 : 1) + ' MB';
function useRow(label, val, lim, text, proj) {
  const pct = lim && val != null ? Math.min(100, val / lim * 100) : 0;
  const pp = lim && proj != null ? proj / lim * 100 : null;
  const col = pp == null ? '' : pp >= 100 ? 'var(--bad)' : pp >= 70 ? 'var(--warn)' : 'var(--ok)';
  return `<div style="margin:8px 0"><div class="row between"><span>${label}</span><span class="small">${text}</span></div>
    <div class="bar"><i style="width:${pct.toFixed(1)}%${col ? ';background:' + col : ''}"></i></div>
    ${pp != null ? `<div class="small muted">Hochrechnung Monatsende: <b style="color:${col}">${fmt(pp, 0)} %</b> der Free-Grenze</div>` : ''}</div>`;
}
async function fillUseCard() {
  const el = $('#useCard');
  if (!el) return;
  let rows;
  try { rows = await Cloud.q('usage_daily', { order: 'day.asc', day: `gte.${new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10)}` }); }
  catch (e) { el.innerHTML = `<h2>Verbrauch</h2><p class="warn small">${esc(e.message)}</p>`; return; }
  const now = new Date(), month = now.toISOString().slice(0, 7);
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayNo = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;   // vergangene Tage im Monat
  const cur = rows.filter(r => r.day.startsWith(month));
  const sized = rows.filter(r => r.db_bytes != null);
  const last = sized[sized.length - 1];
  // DB: Zuwachs je Tag über die letzten bis zu 14 Tage mit Messwert, fortgeschrieben bis Monatsende
  const ref = sized.length > 1 ? sized[Math.max(0, sized.length - 15)] : null;
  const span = ref ? (Date.parse(last.day) - Date.parse(ref.day)) / 864e5 : 0;
  const perDay = span > 0 ? (last.db_bytes - ref.db_bytes) / span : 0;
  const dbProj = last ? last.db_bytes + Math.max(0, perDay) * (dim - dayNo) : null;
  const actMin = cur.reduce((s, r) => s + (r.actions_ms || 0), 0) / 60000;
  const actProj = dayNo > 0.5 ? actMin / dayNo * dim : null;
  const req = cur.filter(r => r.requests != null);
  const reqSum = req.reduce((s, r) => s + r.requests, 0);
  const by = {};
  for (const r of cur) for (const [k, v] of Object.entries(r.actions_by || {})) by[k] = (by[k] || 0) + v / 60000;
  const maxMin = Math.max(1, ...cur.map(r => (r.actions_ms || 0) / 60000));
  const bars = cur.length ? `<svg viewBox="0 0 ${dim * 10} 40" width="100%" height="40" role="img" aria-label="Actions-Minuten je Tag">
    ${cur.map(r => { const d = +r.day.slice(8) - 1, h = Math.max(1, (r.actions_ms || 0) / 60000 / maxMin * 38);
      return `<rect x="${d * 10 + 1}" y="${40 - h}" width="8" height="${h}" fill="var(--accent)"><title>${esc(r.day.slice(8))}.${esc(r.day.slice(5, 7))}.: ${fmt((r.actions_ms || 0) / 60000)} min${r.actions_runs != null ? `, ${r.actions_runs} Läufe` : ''}</title></rect>`; }).join('')}
    </svg><div class="small muted row between"><span>1.</span><span>Actions-Minuten je Tag (max. ${fmt(maxMin)})</span><span>${dim}.</span></div>` : '';
  el.innerHTML = `<h2>Verbrauch <span class="muted small">${esc(now.toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}, Free-Grenzen</span></h2>
    ${!rows.length ? '<p class="muted small">Noch keine Messung (DB stündlich, Actions täglich 23:40 UTC).</p>' : ''}
    ${last ? useRow('Supabase-Datenbank', last.db_bytes, USE_LIMIT.db, `${mb(last.db_bytes)} von 500 MB${perDay > 0 ? ` · +${mb(perDay)}/Tag` : ''}`, dbProj) : ''}
    ${last ? useRow('Supabase-Dateispeicher', last.storage_bytes, USE_LIMIT.storage, `${mb(last.storage_bytes)} von 1 GB`, null) : ''}
    ${useRow('GitHub Actions (Konto, private Repos)', actMin, USE_LIMIT.actions, `${fmt(actMin)} von 2000 min`, actProj)}
    ${Object.keys(by).length ? `<p class="small muted">${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${fmt(v)} min`).join(' · ')}</p>` : ''}
    ${bars}
    <p class="small">Supabase-Anfragen: ${req.length ? `<b>${fmt(reqSum)}</b> in ${req.length} Tagen (Ø ${fmt(reqSum / req.length)}/Tag)` : '<span class="muted">ohne Zugangstoken nicht erhoben (doku/stand/cockpit.md)</span>'}</p>
    <p class="small muted">Egress (Free 5 GB) gibt Supabase nicht per API heraus: <a href="https://supabase.com/dashboard/org/_/usage" target="_blank" rel="noopener">Usage im Dashboard</a>.
      Stand ${esc(last ? when(last.updated_at) : '–')}.</p>`;
}


async function viewVerbrauch() {
  $('#view').innerHTML = '<div class="card" id="useCard"><h2>Verbrauch</h2><p class="muted small">wird geladen …</p></div>';
  await fillUseCard();
}
