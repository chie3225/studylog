// api/missed-reasons.js
const { getSupabaseClient } = require('./_supabase');

module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  if (req.method === 'POST') {
    const { date, reason } = req.body || {};
    if (!date || !reason) {
      res.status(400).json({ error: 'date, reason は必須です' });
      return;
    }
    const { error } = await supabase
      .from('missed_reasons')
      .upsert({ date, reason, updated_at: new Date().toISOString() }, { onConflict: 'date' });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'GET') {
    const { month } = req.query || {};
    let query = supabase.from('missed_reasons').select('*');
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01`;
      const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      query = query.gte('date', start).lt('date', nextMonth);
    }
    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ reasons: data });
    return;
  }

  res.status(405).json({ error: 'GET または POST のみ対応しています' });
};
