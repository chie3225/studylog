// api/submissions.js
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
    const { date, time, subject, task, type, photo, marks, explanations, retry_problems, retry_answers, retry_resolved, retry_dismissed, quiz_result } = req.body || {};
    if (!date || !time || !subject || !task || !type) {
      res.status(400).json({ error: 'date, time, subject, task, type は必須です' });
      return;
    }
    const { data, error } = await supabase
      .from('submissions')
      .insert([
        {
          date, time, subject, task, type,
          photo: photo || '',
          marks: marks || {},
          explanations: explanations || {},
          retry_problems: retry_problems || {},
          retry_answers: retry_answers || {},
          retry_resolved: retry_resolved || {},
          retry_dismissed: retry_dismissed || {},
          quiz_result: quiz_result || {},
        },
      ])
      .select();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true, submission: data[0] });
    return;
  }

  if (req.method === 'PATCH') {
    const { id, retry_resolved, retry_answers, retry_dismissed } = req.body || {};
    if (!id || (!retry_resolved && !retry_answers && !retry_dismissed)) {
      res.status(400).json({ error: 'id と、retry_resolved・retry_answers・retry_dismissed のいずれかが必要です' });
      return;
    }
    const updates = {};
    if (retry_resolved) updates.retry_resolved = retry_resolved;
    if (retry_answers) updates.retry_answers = retry_answers;
    if (retry_dismissed) updates.retry_dismissed = retry_dismissed;
    const { error } = await supabase.from('submissions').update(updates).eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'GET') {
    const { month, from, to, subject, date } = req.query || {};
    let query = supabase.from('submissions').select('*').order('time', { ascending: true });

    if (date) {
      query = query.eq('date', date);
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const start = `${month}-01`;
      const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
      query = query.gte('date', start).lt('date', nextMonth);
    }
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    if (subject) query = query.eq('subject', subject);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ submissions: data });
    return;
  }

  res.status(405).json({ error: 'GET, POST, PATCH のいずれかで呼び出してください' });
};
