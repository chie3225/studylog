// api/_supabase.js
const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL または SUPABASE_SERVICE_KEY が設定されていません');
  }
  return createClient(url, key);
}

module.exports = { getSupabaseClient };
