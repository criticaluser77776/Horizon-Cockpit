// Öffentliche Verbindung zum Cockpit-Supabase (Projekt ynjkkhowlnivxvsfsyct). Der anon-Key ist öffentlich gedacht;
// ohne Gruppen-Code liefert die Datenbank nichts (Row Level Security). tools/deploy_cockpit.py ergänzt APP_VERSION.
window.APP_CONFIG = {
  supabaseUrl: 'https://ynjkkhowlnivxvsfsyct.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluamtraG93bG5pdnh2c2ZzeWN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MzQ4NjAsImV4cCI6MjA3NTExMDg2MH0.r49xQlSPY5mdrCg46uXZEGghEhQH82suFumqwTmuTHQ',
};
window.APP_VERSION = window.APP_VERSION || { number: 0, built: 'lokal' };
window.APP_VERSION = {"number": 1, "built": "2026-10-11T15:50:31+02:00"};
