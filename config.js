// Öffentliche Verbindung zum Cockpit-Supabase (Projekt ynjkkhowlnivxvsfsyct). Der Publishable Key (ab 16.10.2026 statt anon-JWT) ist öffentlich gedacht;
// ohne Gruppen-Code liefert die Datenbank nichts (Row Level Security). tools/deploy_cockpit.py ergänzt APP_VERSION.
window.APP_CONFIG = {
  supabaseUrl: 'https://ynjkkhowlnivxvsfsyct.supabase.co',
  supabaseKey: 'sb_publishable__2RSF5BCobEg0AgGy9fkcw_RKfaczwY',
};
window.APP_VERSION = window.APP_VERSION || { number: 0, built: 'lokal' };
window.APP_VERSION = {"number": 66, "built": "2026-10-18T20:01:15+02:00"};
