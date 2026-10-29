'use strict';
/* Horizon Atlas – Einstellungen eines Parameter-Laufs auf Work (Teil A, 20.10.2026, doku/stand/atlas-sim-parameter.md).
   Reine Logik ohne DOM (Test Horiversum/tests/sim_params.test.js): Standardwerte = tools/sim_params.py DEFAULTS
   (= DEFAULT_ARGS in tools/sim_actions.py), Formularfelder ↔ Einstellungen, Prüfung mit denselben Mustern wie Work.
   Gesendet werden feste JSON-Felder über public.plan_rechnen(p_params); Work prüft sie noch einmal (Positivliste). */
(function (root) {
  const AUFWAND = {   // L3 (24.10.2026): auf kolo4 angepasst, gleich tools/sim_params.py
    schnell: { iter: 40, rounds: 1, patience: 20, kicks: 2 },
    normal: { iter: 60, rounds: 1, patience: 20, kicks: 4 },
    gruendlich: { iter: 100, rounds: 2, patience: 30, kicks: 10 },
  };
  const DEFAULTS = {
    v: 1, kolo: ['5:JUPL:rohstoff', '6:RKPL:rohstoff', '11:RKPL:rohstoff'], platzbahn: 6,
    // Ziel nach kolo4: alle Minen 16 auf Heimat (h) und Kolonien (B1, Nutzer 29.10.2026)
    kolopflicht: ['*:b:metalmine:16', '*:b:crystalmine:16', '*:b:fuelrefinery:16', 'h:b:metalmine:16', 'h:b:crystalmine:16',
      'h:b:fuelrefinery:16', '1:b:researchcenter:heimat'], flotte: ['PFLS:1', 'PTRN:1'], werft: 1,
    pflicht: ['kolo:4'], verbot: [], aus: [], techcap: ['r:miningtech:14', 'r:refinerytech:12'],
    rabatt: 0,             // Boden für den STAN-Rabatt je Stufe; 0 = STAN allein (Nutzer 27.10.2026, bis dahin 0.1)
    movi: null, aufwand: { stufe: 'eigen', iter: 40, rounds: 1, patience: 20, kicks: 2 },
    seeds: ['k1o-A2-T2-1022.json', 'k1z-T2-T2-1021.json', 'k1o-B0-T2-1022.json'],
    kolominen: '16', kolohilfe: true, forschort: ['JUPL:0.69', 'heimat:1'], versorgung: 'voll', bis: '+14d',
    kololive: true, flugfaktor: 0.043,
    takt: 6, taktlast: 12000, taktmod: ['tempo:-0.5'],   // Transport 6 Flüge/Tag mit 1 PTRN (12 000 t live, Nutzer 25.10.)
  };
  const ID = '[a-z][a-z0-9_]{1,39}';
  const PAT = {
    kolo: /^(\d{1,2}|K|N\d{0,2}):([A-Z]{4}|\?):(rohstoff|kolozentrum|auto)$/,
    kolopflicht: new RegExp(`^(\\*|[1-4]|h):b:${ID}:(\\d{1,2}|heimat)$`),
    flotte: /^[A-Z]{4}:\d{1,2}$/,
    pflicht: new RegExp(`^(kolo:[345]|[br]:${ID}:\\d{1,2})$`),
    verbot: new RegExp(`^[br]:${ID}$`),
    aus: new RegExp(`^b:${ID}$`),
    techcap: new RegExp(`^[br]:${ID}:\\d{1,2}$`),
    kolohilfe: new RegExp(`^${ID}:\\d{1,2}$`),
    seeds: /^[\w.-]{1,80}\.json$/,
    forschort: /^([A-Z]{4}|heimat):\d(\.\d{1,3})?$/,
    taktmod: /^(laderaum|tempo):-?(0(\.\d{1,3})?|1(\.0{1,3})?)$/,
  };
  const ISO = /^(\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)?|\+\d{1,3}[dh])$/;   // oder +14d / +36h ab Snapshot
  const CHOICE = { versorgung: ['voll', 'aus'] };
  const INTS = { platzbahn: [1, 15], werft: [1, 10] };
  const AUF_MAX = { iter: 2000, rounds: 10, patience: 500, kicks: 500 };
  const LISTS = ['kolo', 'kolopflicht', 'flotte', 'pflicht', 'verbot', 'aus', 'techcap', 'seeds', 'forschort'];

  const clone = o => JSON.parse(JSON.stringify(o));
  const splitList = s => String(s || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  const numOrNull = s => String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.'));
  const zeit = s => { const t = String(s ?? '').trim(); return t === '' ? null : ISO.test(t) ? t : Number(t.replace(',', '.')); };

  // Formularwerte (Texte aus den Feldern, Name = Einstellung; Aufwand aufwand_stufe/_iter…; MoVi movi_modus/_zeit/…) → Einstellungen
  function fromForm(f) {
    const p = { v: 1 };
    p.versorgung = f.versorgung ? f.versorgung : null;
    for (const k of LISTS) p[k] = splitList(f[k]);
    for (const k of Object.keys(INTS)) p[k] = numOrNull(f[k]);
    p.rabatt = numOrNull(f.rabatt);
    p.kolominen = String(f.kolominen || '').trim() || null;
    const kh = String(f.kolohilfe || '').trim();
    p.kolohilfe = kh === '' ? null : /^(ja|standard)$/i.test(kh) ? true : splitList(kh);
    p.bis = zeit(f.bis);
    p.kololive = f.kololive === 'ja' ? true : null;
    p.flugfaktor = numOrNull(f.flugfaktor);
    p.takt = numOrNull(f.takt);
    p.taktlast = numOrNull(f.taktlast);
    p.taktmod = splitList(f.taktmod);
    const st = f.aufwand_stufe || 'normal';
    p.aufwand = st === 'eigen'
      ? { stufe: 'eigen', ...Object.fromEntries(Object.keys(AUF_MAX).map(k => [k, numOrNull(f[`aufwand_${k}`])])) }
      : { stufe: st, ...AUFWAND[st] };
    p.movi = !f.movi_modus || f.movi_modus === 'aus' ? null : {
      zeit: f.movi_modus === 'auto' ? 'auto' : zeit(f.movi_zeit), faktor: numOrNull(f.movi_faktor) ?? 25,
      schiff: f.movi_schiff !== 'nein', neustart: f.movi_neustart !== 'nein' };
    return p;
  }

  // Einstellungen → Formularwerte (Texte)
  function toForm(p) {
    const f = {};
    f.versorgung = p.versorgung || '';
    for (const k of LISTS) f[k] = (p[k] || []).join(', ');
    for (const k of [...Object.keys(INTS), 'rabatt']) f[k] = p[k] == null ? '' : String(p[k]);
    f.kolominen = p.kolominen || '';
    f.kolohilfe = p.kolohilfe === true ? 'ja' : (p.kolohilfe || []).join(', ');
    f.bis = p.bis == null ? '' : String(p.bis);
    f.kololive = p.kololive ? 'ja' : 'nein';
    f.flugfaktor = p.flugfaktor == null ? '' : String(p.flugfaktor);
    f.takt = p.takt == null ? '' : String(p.takt);
    f.taktlast = p.taktlast == null ? '' : String(p.taktlast);
    f.taktmod = (p.taktmod || []).join(', ');
    f.aufwand_stufe = p.aufwand.stufe;
    for (const k of Object.keys(AUF_MAX)) f[`aufwand_${k}`] = String(p.aufwand[k]);
    f.movi_modus = !p.movi ? 'aus' : p.movi.zeit === 'auto' ? 'auto' : 'zeit';
    f.movi_zeit = p.movi && p.movi.zeit !== 'auto' ? String(p.movi.zeit) : '';
    f.movi_faktor = String(p.movi?.faktor ?? 25);
    f.movi_schiff = p.movi?.schiff === false ? 'nein' : 'ja';
    f.movi_neustart = p.movi?.neustart === false ? 'nein' : 'ja';
    return f;
  }

  // Prüfung wie tools/sim_params.py check() → Liste der Fehler (leer = in Ordnung)
  function check(p) {
    const e = [];
    const int = (v, [lo, hi], n) => { if (!(Number.isInteger(v) && v >= lo && v <= hi)) e.push(`${n}: ganze Zahl ${lo}…${hi}`); };
    for (const [k, opts] of Object.entries(CHOICE)) if (p[k] != null && !opts.includes(p[k])) e.push(`${k}: eins von ${opts.join(', ')}`);
    for (const [k, r] of Object.entries(INTS)) if (p[k] != null || k !== 'platzbahn') int(p[k], r, k);   // nur platzbahn darf fehlen
    if (!(typeof p.rabatt === 'number' && p.rabatt >= 0 && p.rabatt <= 0.5)) e.push('rabatt: Zahl 0…0,5');
    for (const k of LISTS) {
      if (p[k].length > (k === 'seeds' ? 4 : 12)) e.push(`${k}: zu viele Einträge`);
      for (const x of p[k]) if (!PAT[k].test(x)) e.push(`${k}: „${x}“ hat nicht die erwartete Form`);
    }
    if (!p.seeds.length) e.push('Startplan: mindestens einer');
    if (p.forschort.some(x => !(+x.split(':')[1] > 0))) e.push('Forschungsort: Faktoren > 0');
    for (const [k, hi] of Object.entries(AUF_MAX)) int(p.aufwand[k], [k === 'kicks' ? 0 : 1, hi], `Aufwand ${k}`);
    if (p.movi) {
      if (p.movi.zeit !== 'auto' && !(typeof p.movi.zeit === 'string' || (Number.isFinite(p.movi.zeit) && p.movi.zeit >= 0 && p.movi.zeit <= 2000))) e.push('Motivationsvideo: Planstunde oder ISO-Zeit');
      if (!(p.movi.faktor >= 1 && p.movi.faktor <= 100)) e.push('Motivationsvideo Faktor: 1…100');
    }
    if (p.kolominen != null && !/^\d{1,2}$/.test(p.kolominen)) e.push('kolominen: Zahl 1–99');
    if (Array.isArray(p.kolohilfe)) for (const x of p.kolohilfe) if (!PAT.kolohilfe.test(x)) e.push(`kolohilfe: „${x}“ (Form gebäude:stufe oder „ja“)`);
    if (p.bis != null && !((typeof p.bis === 'string' && ISO.test(p.bis)) || (Number.isFinite(p.bis) && p.bis >= 0 && p.bis <= 2000))) e.push('bis: +14d, Planstunde oder ISO-Zeit');
    if (p.kololive != null && p.kololive !== true) e.push('Gelandete Kolonien: ja oder leer');
    if (p.flugfaktor != null && !(Number.isFinite(p.flugfaktor) && p.flugfaktor >= 0.001 && p.flugfaktor <= 5)) e.push('Flugfaktor: Zahl 0,001…5');
    if (p.takt != null && !(Number.isFinite(p.takt) && p.takt >= 0.5 && p.takt <= 24)) e.push('Transport: Flüge je Tag 0,5…24');
    if (p.taktlast != null && !(Number.isFinite(p.taktlast) && p.taktlast >= 1000 && p.taktlast <= 1e6)) e.push('Transport-Ladung: Zahl 1 000…1 000 000');
    if (p.taktmod.length > 2) e.push('Flottenmods: höchstens zwei');
    for (const x of p.taktmod) if (!PAT.taktmod.test(x)) e.push(`Flottenmods: „${x}“ (Form laderaum:0.5 oder tempo:-0.5)`);
    if (p.takt == null && (p.taktlast != null || p.taktmod.length)) e.push('Transport-Ladung/Flottenmods nur mit Transport');
    const kn = p.pflicht.filter(x => x.startsWith('kolo:')).map(x => +x.slice(5));
    if (kn.length > 1) e.push('Pflicht: höchstens ein kolo:N');
    // Ziel ist immer ein Kolopunkt (Schritt 2, 24.10.2026: kein SCOL-Ziel mehr)
    if (!kn.length) e.push('Pflicht: kolo:N fehlt (Ziel Kolopunkt, z. B. kolo:4)');
    else if (p.kolo.length < kn[0] - 1) e.push(`Kolonien: für kolo:${kn[0]} mindestens ${kn[0] - 1} Ziele`);
    if (p.bis == null) e.push('Stichtag „bis“ fehlt (z. B. +14d)');
    if (p.versorgung != null && !p.kolopflicht.length) e.push('Versorgung nur mit Kolonie-Pflichten');
    return e;
  }

  // Abweichungen vom Standard, kurz für die Anzeige („Ziel kolo4, Aufwand gründlich“)
  function diff(p) {
    const d = [];
    for (const k of Object.keys(DEFAULTS)) {
      if (k === 'v' || JSON.stringify(p[k]) === JSON.stringify(DEFAULTS[k])) continue;
      const v = p[k];
      d.push(`${k} ${v == null ? '–' : k === 'aufwand' ? (v.stufe === 'eigen' ? `${v.iter}/${v.rounds}/${v.patience}/${v.kicks}` : v.stufe)
        : k === 'movi' ? `${v.zeit}${v.faktor !== 24 ? ` ×${v.faktor}` : ''}` : Array.isArray(v) ? (v.join(', ') || 'keine') : v}`);
    }
    return d;
  }

  const api = { AUFWAND, DEFAULTS, PAT, fromForm, toForm, check, diff, defaults: () => clone(DEFAULTS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HZ_SIMPARAMS = api;
})(typeof window !== 'undefined' ? window : globalThis);
