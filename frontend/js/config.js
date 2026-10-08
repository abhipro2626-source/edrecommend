// Public browser settings — safe to commit. The publishable key is meant to be public;
// Row Level Security in Supabase protects every table. NEVER put the service_role key here.
export const SUPABASE_URL = 'https://xgdrlxxgjbaoehxcxscj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_kuaVRt81DGZfldHaGU_E4Q_lls9XM1v';

// Where the Python API runs.
//  - Locally, the FastAPI server serves this page itself, so '' (same origin) is right.
//  - On Netlify, the page calls the Render service. Change RENDER_API if Render gives
//    your service a different address.
const RENDER_API = 'https://edrecommend-api.onrender.com';
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const API_BASE = isLocal || location.hostname.endsWith('.onrender.com') ? '' : RENDER_API;
