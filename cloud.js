'use strict';
/* Supabase-Anbindung ohne Zusatzbibliothek (nur fetch), Muster der Discounter-App:
   - Zugang per Gruppen-Code (Header x-group-code) und zufälliger Gerätekennung (Header x-device)
   - Rechte je Spielaccount (owner/executor/claude/viewer) prüft die Datenbank selbst (RLS + RPCs) */

class LoginNeeded extends Error {
  constructor(msg = 'Bitte Gruppen-Code eingeben') { super(msg); this.name = 'LoginNeeded'; }
}

const Cloud = (() => {
  const cfg = window.APP_CONFIG || {};
  const url = (cfg.supabaseUrl || '').replace(/\/$/, '');
  const key = cfg.supabaseKey || '';
  const ACCESS = 'hz.access';
  let access = null;  // { code, name, gid, group, me, role, accounts, touched }
  try { access = JSON.parse(localStorage.getItem(ACCESS)); } catch { /* kein Speicher */ }
  let device = '';
  try { device = localStorage.getItem('hz.device') || ''; } catch { /* kein Speicher */ }
  if (!device) {
    device = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('hz.device', device); } catch { /* egal */ }
  }

  function setAccess(a) {
    access = a;
    try { a ? localStorage.setItem(ACCESS, JSON.stringify(a)) : localStorage.removeItem(ACCESS); } catch { /* egal */ }
  }

  async function rest(path, { method = 'GET', body, prefer, code, noCode } = {}) {
    const c = code ?? access?.code;
    if (!c && !noCode) throw new LoginNeeded();
    let r;
    try {
      r = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers: { apikey: key, 'x-group-code': c || '', 'x-device': device, 'Content-Type': 'application/json',
          ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new Error('Keine Verbindung zum Server'); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (j.code === '42501' && /Kein Zugang/.test(j.message || '')) {
        if (!code && !noCode) setAccess(null);
        throw new LoginNeeded('Kein Zugang: Gruppen-Code falsch/geändert oder Gerät entfernt');
      }
      throw new Error(j.message || `Serverfehler ${r.status}`);
    }
    if (prefer?.includes('return=minimal') || r.status === 204) return null;
    return r.json();
  }
  const rpc = (name, body = {}, opts = {}) => rest(`rpc/${name}`, { method: 'POST', body, ...opts });

  async function touch() {
    const r = await rpc('touch', { p_name: access?.name || '' });
    setAccess({ ...access, gid: r.gid, group: r.group, me: r.me, role: r.role, accounts: r.accounts, touched: Date.now() });
    return access;
  }

  return {
    device,
    loggedIn: () => !!access?.code,
    access: () => access,
    touch,
    async login(code, name) {
      setAccess({ code: code.trim(), name: name.trim() });
      try { await touch(); } catch (e) { setAccess(null); throw e; }
    },
    async createGroup(invite, group, name) {
      const r = await rpc('create_group', { p_invite: invite.trim(), p_group: group.trim(), p_name: name.trim() }, { noCode: true });
      setAccess({ code: r.code, name: name.trim() });
      await touch();
      return r.code;
    },
    logout() { setAccess(null); },
    rpc,
    rest,
    // Hilfen für Tabellen: Abfrage im PostgREST-Format, z. B. q('events', {account_id: 'eq.…', order: 't.desc', limit: 50})
    q(table, params = {}) {
      return rest(`${table}?${new URLSearchParams(params)}`);
    },
  };
})();
