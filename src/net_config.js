// Online islands (step 6). Empty url + key = the local MOCK backend (this browser only, sample islands, no network).
// To go online: follow server/SETUP.md, then paste your Supabase Project URL and its PUBLIC anon / publishable key here.
// The anon key is meant to be public (Row Level Security in server/schema.sql protects the data).
// NEVER put the service_role key or the database password in this file or anywhere in the game.
window.NET_CONFIG = {
  url: 'https://rdsjgmswwwcspiklgsav.supabase.co',          // the user's free project (2026-10-31)
  anonKey: 'sb_publishable_acEonY9LmFvRFnKbL_idcw_NvEGcFOy',  // publishable key: public by design
};
