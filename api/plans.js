// api/plans.js
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
    const { entries } = req.body || {};
    if (!Array.isArray(entries) || !entries.length) {
      res.status(400).json({ error: 'entries(配列)が必要です' });
      return;
    }
    const rows = entries.map((e) => ({ date: e.date, subject: e.subject, task: e.task }));
    const { error } = await supabase.from('plans').insert(rows);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true, count: rows.length });
    return;
  }

  if (req.method === 'GET') {
    const { month, date } = req.query || {};
    let query = supabase.from('plans').select('*').order('date', { ascending: true });

    if (date) {
      query = query.eq('date', date);
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
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
    res.status(200).json({ plans: data });
    return;
  }

  res.status(405).json({ error: 'GET または POST のみ対応しています' });
};
