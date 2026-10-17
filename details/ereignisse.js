'use strict';
/* Horizon Atlas – Reiter Ereignisse: alle Stufen, Filter, ausblenden, „alle gesehen“. Kopie aus cockpit/app.js (D1);
   Entscheidungen beantworten und „Notfall verbauen“ wie im Cockpit (nur Owner, mit Rückfrage; Code in common.js, Entscheidung 7.3). */

// Filter dauerhaft je Gerät (Nutzer 16.10.: vorher sessionStorage, nach dem Schließen weg)
async function viewEvents() {
  const lvl = evGet('hz.evlvl'), cat = evGet('hz.evcat');
  const p = { account_id: `eq.${S.acc}`, order: 't.desc', limit: 200 };
  if (lvl) p.level = `eq.${lvl}`;
  if (cat) p.cat = `eq.${cat}`;
  S.showDismissed = evGet('hz.evdis') === '1';
  if (!S.showDismissed) p.dismissed_at = 'is.null';
  const evs = await Cloud.q('events', p);
  const canSee = ['owner', 'viewer'].includes(account()?.role);
  $('#view').innerHTML = `<div class="card"><div class="row between"><h2>Ereignisse</h2>
    <div class="row"><select id="cat"><option value="">alle Bereiche</option>${Object.entries(CAT).map(([k, t]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <select id="lvl"><option value="">alle Stufen</option>${['hoch', 'mittel', 'niedrig'].map(l => `<option${l === lvl ? ' selected' : ''}>${l}</option>`).join('')}</select>
    ${canSee ? '<button id="seenAll">alle gesehen</button>' : ''}</div></div>
    <label class="small"><input type="checkbox" id="evDis"${S.showDismissed ? ' checked' : ''}> ausgeblendete zeigen</label>
    ${canSee ? '<span class="muted small"> · ✕ = ausblenden</span>' : ''}
    <p class="muted small">Builder = Autobuilder und Sitzungen · Cockpit = Freigaben und Kommandos · Spiel = Berichte und Nachrichten · System = Supabase-Wächter</p>
    ${evs.length ? evs.map(evRow).join('') : '<p class="muted">Keine Ereignisse.</p>'}</div>`;
  $('#lvl').onchange = e => evSet('hz.evlvl', e.target.value);
  $('#cat').onchange = e => evSet('hz.evcat', e.target.value);
  $('#evDis').onchange = e => evSet('hz.evdis', e.target.checked ? '1' : '');
  swipeEvents($('#view'));
  $('#seenAll')?.addEventListener('click', async () => {
    await Cloud.rest(`events?account_id=eq.${S.acc}&seen_at=is.null`, { method: 'PATCH', body: { seen_at: new Date().toISOString() }, prefer: 'return=minimal' });
    route();
  });
}
