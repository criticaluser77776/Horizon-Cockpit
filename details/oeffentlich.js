'use strict';
/* Horizon Atlas – öffentliche Quellen (mit dem Nutzer abgestimmt 23.10.2026): STAN (Rundenstatistik) und Galaxy Mag
   (Spielzeitung) aus der Tabelle „wissen“, Schlüssel „stan“ und „zeitung“ (täglich von tools/oeffentlich_holen.py --hochladen,
   GitHub Action oeffentlich.yml). Genutzt von Kompendium (Spieler-Rabatt je Stufe), Statistik (Unterreiter „STAN“) und
   Galaxie (Galaxy Mag in der Nähe). Schreibt nichts. */

const OE_B = 0.789;   // Spieler-Rabatt = 1 − b^(k/N), geeicht an STAN 18.10. (analyse/SPIELMECHANIK.md Abschnitt 18)
const OE_TYP = { PLAYERNEW: 'Neuer Spieler', BATTLEATT: 'Kampf', BATTLESPY: 'Spionage', ALIENKILLCOLO: 'Kolonie an Aliens verloren',
  HYPERJUMPFATAL: 'Hypersprung gescheitert', ALLIANCENEW: 'Allianz gegründet', ALLIANCEENTER: 'Allianz-Beitritt',
  ALLIANCELEAVE: 'Allianz verlassen', ALLIANCEKICK: 'Allianz-Ausschluss', ALLIANCEDEL: 'Allianz aufgelöst' };
const OE_NAH = 15;    // Galaxie: Artikel bis ± so viele Systeme um das angezeigte System

let oeCache = null;
// beide Schlüssel in einer Abfrage, 10 min im Speicher
async function oeLoad() {
  if (oeCache && Date.now() - oeCache.t < 600e3) return oeCache;
  const r = await Cloud.q('wissen', { key: 'in.(stan,zeitung)', select: 'key,content,updated_at' }).catch(() => []);
  const by = Object.fromEntries((r || []).map(x => [x.key, x]));
  oeCache = { t: Date.now(), stan: by.stan?.content || null, zeitung: by.zeitung?.content || null,
    at: { stan: by.stan?.updated_at || null, zeitung: by.zeitung?.updated_at || null } };
  return oeCache;
}

const oeDate = d => /^\d{8}$/.test(d || '') ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : (d || '');
const oePct = x => fmt(x * 100, 1) + ' %';
// k = Spieler mit Stufe ≥ l in einem STAN-Stand (Stufen dort: Anzahl genau auf Stufe n)
function oeK(st, id, l) {
  const lv = st?.research?.[id];
  if (!lv) return null;
  let k = 0;
  for (const [n, c] of Object.entries(lv)) if (+n >= l) k += c;
  return k;
}
// Rabatt einer Forschungsstufe nach dem neuesten STAN-Stand; Untergrenze, weil k im Lauf der Runde wächst
function oeRabatt(stan, id, l) {
  const st = stan?.staende?.[0], k = oeK(st, id, l);
  if (k == null || !st.players) return null;
  return { k, N: st.players, r: 1 - Math.pow(stan.b || OE_B, k / st.players), date: st.date };
}
const oeMax = stan => 1 - (stan?.b || OE_B);   // höchster Rabatt (alle Spieler haben die Stufe)

// Spieler eines Artikels: Text oder Liste (Kampf: [{ name, allianz }] bzw. Namen)
const oeWer = a => Array.isArray(a.spieler) ? a.spieler.map(x => x?.name || x).filter(Boolean).join(' gegen ') : (a.spieler || '');
const oeKoord = k => /^(\d+):(\d+):(\d+)$/.exec(k || '');

// Galaxie: Artikel nach Koordinate (für die Markierung der Bahnen)
function oeByKoord(z) {
  const m = new Map();
  for (const a of z?.artikel || []) if (oeKoord(a.koord)) (m.get(a.koord) || m.set(a.koord, []).get(a.koord)).push(a);
  return m;
}
// Galaxie: Karte „Galaxy Mag in der Nähe“ – Artikel in Galaxie g bis ± OE_NAH Systeme um s, neueste zuerst; Abstand zum Heimatsystem
function oeNearCard(oe, g, s, hm) {
  const z = oe?.zeitung;
  if (!z) return '';
  const inGal = (z.artikel || []).map(a => ({ a, m: oeKoord(a.koord) })).filter(x => x.m && +x.m[1] === g);
  const near = inGal.filter(x => Math.abs(+x.m[2] - s) <= OE_NAH)
    .sort((x, y) => String(y.a.zeit).localeCompare(String(x.a.zeit))).slice(0, 40);
  const home = hm && +hm[1] === g ? +hm[2] : null;
  const rows = near.map(({ a, m }) => {
    const d = home != null ? Math.abs(+m[2] - home) : null, here = +m[2] === s;
    return `<tr${here ? ' class="oehere"' : ''}><td class="small nowrap">${esc(dt(a.zeit))}</td><td class="small">${esc(OE_TYP[a.typ] || a.typ)}</td>
      <td class="small nowrap"><a href="#/galaxie/${m[1]}/${m[2]}">${esc(a.koord)}</a></td><td class="small">${esc(oeWer(a))}${a.planet ? ` <span class="muted">· ${esc(a.planet)}</span>` : ''}</td>
      <td class="num small${d != null && d <= 10 ? ' warn' : ''}">${d != null ? esc(fmt(d)) : '–'}</td></tr>`;
  }).join('');
  const typen = Object.entries(inGal.reduce((o, x) => (o[x.a.typ] = (o[x.a.typ] || 0) + 1, o), {}))
    .map(([t, n]) => `${esc(OE_TYP[t] || t)} ${n}`).join(' · ');
  return `<div class="card"><h3>Galaxy Mag in der Nähe <span class="small muted">System ${Math.max(1, s - OE_NAH)}–${s + OE_NAH} in Galaxie ${g}</span></h3>
    ${rows ? `<div class="pdscroll"><table class="wide small"><thead><tr><th>Zeit</th><th>Was</th><th>Koordinate</th><th>Wer</th><th class="num" title="Systeme bis zum eigenen Heimatsystem">Abstand ⌂</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="small muted">Keine Meldung in diesem Bereich.</p>'}
    <p class="small muted">Galaxie ${g} gesamt: ${typen || 'keine Meldung'}. Quelle: Galaxy Mag (Spielzeitung, ${esc(fmt(z.ausgaben || 0))} Ausgaben seit Rundenstart${oe.at.zeitung ? `, geholt ${esc(dt(oe.at.zeitung))}` : ''}). Gelb = höchstens 10 Systeme vom eigenen Heimatsystem.</p></div>`;
}
