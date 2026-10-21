'use strict';
/* Horizon Atlas – Einstellungen eines Parameter-Laufs auf Work (Teil A, 20.10.2026, doku/stand/atlas-sim-parameter.md).
   Reine Logik ohne DOM (Test Horiversum/tests/sim_params.test.js): Standardwerte = tools/sim_params.py DEFAULTS
   (= heutige DEFAULT_ARGS in tools/sim_actions.py), Formularfelder ↔ Einstellungen, Prüfung mit denselben Mustern wie Work.
   Gesendet werden feste JSON-Felder über public.plan_rechnen(p_params); Work prüft sie noch einmal (Positivliste). */
(function (root) {
  const AUFWAND = {
    schnell: { iter: 60, rounds: 1, patience: 20, kicks: 20 },
    normal: { iter: 150, rounds: 3, patience: 40, kicks: 60 },
    gruendlich: { iter: 300, rounds: 4, patience: 60, kicks: 100 },
  };
  const DEFAULTS = {
    v: 1, ziel: 'kolo3', kolo: ['5:JUPL:rohstoff', '6:RKPL:rohstoff'], platzbahn: null, kolopflicht: [],
    flotte: ['PFLS:1', 'PTRN:2'], flottebis: 'nach', werft: 1,
    pflicht: ['b:spaceobservatory:2'], verbot: [], aus: ['b:fissionreactor'], bunker: 3, rabatt: 0.1, makroziele: 1, makro: 30,
    movi: null, aufwand: { stufe: 'normal', ...AUFWAND.normal }, seeds: ['result.json', 'kolo3-stpl-live1821.json'],
    lager: null, kolominen: null, kolohilfe: null, versorgung: null, bis: null, mass: null,
  };
  const ID = '[a-z][a-z0-9_]{1,39}';
  const PAT = {
    kolo: /^(\d{1,2}|K|N\d{0,2}):([A-Z]{4}|\?):(rohstoff|kolozentrum|auto)$/,
    kolopflicht: new RegExp(`^(\\*|[1-4]):b:${ID}:(\\d{1,2}|heimat)$`),
    flotte: /^[A-Z]{4}:\d{1,2}$/,
    pflicht: new RegExp(`^[br]:${ID}:\\d{1,2}$`),
    verbot: new RegExp(`^[br]:${ID}$`),
    aus: new RegExp(`^b:${ID}$`),
    kolohilfe: new RegExp(`^${ID}:\\d{1,2}$`),
    seeds: /^[\w.-]{1,80}\.json$/,
  };
  const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)?$/;
  const CHOICE = { ziel: ['scol', 'kolo3', 'kolo4', 'kolo5'], flottebis: ['nach', 'kolo3'], lager: ['getrennt', 'kolopool', 'pool'],
    versorgung: ['voll', 'aus'], mass: ['landung', 'foerderung'] };
  const INTS = { platzbahn: [1, 15], werft: [1, 10], bunker: [0, 10], makroziele: [0, 5], makro: [0, 300] };
  const AUF_MAX = { iter: 2000, rounds: 10, patience: 500, kicks: 500 };
  const LISTS = ['kolo', 'kolopflicht', 'flotte', 'pflicht', 'verbot', 'aus', 'seeds'];

  const clone = o => JSON.parse(JSON.stringify(o));
  const splitList = s => String(s || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  const numOrNull = s => String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.'));
  const zeit = s => { const t = String(s ?? '').trim(); return t === '' ? null : ISO.test(t) ? t : Number(t.replace(',', '.')); };

  // Formularwerte (Texte aus den Feldern, Name = Einstellung; Aufwand aufwand_stufe/_iter…; MoVi movi_modus/_zeit/…) → Einstellungen
  function fromForm(f) {
    const p = { v: 1 };
    for (const k of ['ziel', 'flottebis']) p[k] = f[k];
    for (const k of ['lager', 'versorgung', 'mass']) p[k] = f[k] ? f[k] : null;
    for (const k of LISTS) p[k] = splitList(f[k]);
    for (const k of Object.keys(INTS)) p[k] = numOrNull(f[k]);
    p.rabatt = numOrNull(f.rabatt);
    p.kolominen = String(f.kolominen || '').trim() || null;
    const kh = String(f.kolohilfe || '').trim();
    p.kolohilfe = kh === '' ? null : /^(ja|standard)$/i.test(kh) ? true : splitList(kh);
    p.bis = zeit(f.bis);
    const st = f.aufwand_stufe || 'normal';
    p.aufwand = st === 'eigen'
      ? { stufe: 'eigen', ...Object.fromEntries(Object.keys(AUF_MAX).map(k => [k, numOrNull(f[`aufwand_${k}`])])) }
      : { stufe: st, ...AUFWAND[st] };
    p.movi = !f.movi_modus || f.movi_modus === 'aus' ? null : {
      zeit: f.movi_modus === 'auto' ? 'auto' : zeit(f.movi_zeit), faktor: numOrNull(f.movi_faktor) ?? 24,
      schiff: f.movi_schiff !== 'nein', neustart: f.movi_neustart === 'ja' };
    return p;
  }

  // Einstellungen → Formularwerte (Texte)
  function toForm(p) {
    const f = {};
    for (const k of ['ziel', 'flottebis']) f[k] = p[k];
    for (const k of ['lager', 'versorgung', 'mass']) f[k] = p[k] || '';
    for (const k of LISTS) f[k] = (p[k] || []).join(', ');
    for (const k of [...Object.keys(INTS), 'rabatt']) f[k] = p[k] == null ? '' : String(p[k]);
    f.kolominen = p.kolominen || '';
    f.kolohilfe = p.kolohilfe === true ? 'ja' : (p.kolohilfe || []).join(', ');
    f.bis = p.bis == null ? '' : String(p.bis);
    f.aufwand_stufe = p.aufwand.stufe;
    for (const k of Object.keys(AUF_MAX)) f[`aufwand_${k}`] = String(p.aufwand[k]);
    f.movi_modus = !p.movi ? 'aus' : p.movi.zeit === 'auto' ? 'auto' : 'zeit';
    f.movi_zeit = p.movi && p.movi.zeit !== 'auto' ? String(p.movi.zeit) : '';
    f.movi_faktor = String(p.movi?.faktor ?? 24);
    f.movi_schiff = p.movi?.schiff === false ? 'nein' : 'ja';
    f.movi_neustart = p.movi?.neustart ? 'ja' : 'nein';
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
    for (const [k, hi] of Object.entries(AUF_MAX)) int(p.aufwand[k], [k === 'kicks' ? 0 : 1, hi], `Aufwand ${k}`);
    if (p.movi) {
      if (p.movi.zeit !== 'auto' && !(typeof p.movi.zeit === 'string' || (Number.isFinite(p.movi.zeit) && p.movi.zeit >= 0 && p.movi.zeit <= 2000))) e.push('Motivationsvideo: Planstunde oder ISO-Zeit');
      if (!(p.movi.faktor >= 1 && p.movi.faktor <= 100)) e.push('Motivationsvideo Faktor: 1…100');
    }
    if (p.kolominen != null && !/^\d{1,2}(:[1-4])?$/.test(p.kolominen)) e.push('kolominen: Form 16 oder 16:1');
    if (Array.isArray(p.kolohilfe)) for (const x of p.kolohilfe) if (!PAT.kolohilfe.test(x)) e.push(`kolohilfe: „${x}“ (Form gebäude:stufe oder „ja“)`);
    if (p.bis != null && !(typeof p.bis === 'string' || (Number.isFinite(p.bis) && p.bis >= 0 && p.bis <= 2000))) e.push('bis: Planstunde oder ISO-Zeit');
    const kz = p.ziel !== 'scol';
    if (!kz) {
      if (p.kolopflicht.length) e.push('Kolonie-Pflichten nur mit Ziel Kolopunkt 3/4/5');
      if (p.flotte.length) e.push('Flotte nur mit Ziel Kolopunkt 3/4/5');
      if (p.kolohilfe != null) e.push('kolohilfe nur mit Ziel Kolopunkt 3/4/5');
    } else if (p.kolo.length < +p.ziel.slice(4) - 1) e.push(`Kolonien: für ${p.ziel} mindestens ${+p.ziel.slice(4) - 1} Ziele`);
    if (p.mass === 'foerderung' && p.bis == null) e.push('Maß Förderung braucht „bis“');
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
