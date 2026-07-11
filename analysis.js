// api/analysis.js
// 直近の提出データ(丸つけの解説・クイズの間違い)を集計し、
// 単元ごとに「つまずきポイント」「克服のコツ」を文章で生成する。

const { getSupabaseClient } = require('./_supabase');
const { callClaude, extractJson } = require('./_anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GETのみ対応しています' });
    return;
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const fromDate = sixtyDaysAgo.toISOString().slice(0, 10);

  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('*')
    .gte('date', fromDate);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // 教科+課題名を「単元」の単位として、間違いの材料をまとめる
  const byUnit = {};
  (submissions || []).forEach((s) => {
    const unitKey = `${s.subject} - ${s.task}`;
    if (!byUnit[unitKey]) byUnit[unitKey] = [];

    if (s.type === 'work-photo' && s.explanations) {
      Object.values(s.explanations).forEach((explain) => {
        if (explain) byUnit[unitKey].push(explain);
      });
    }
    if ((s.type === 'vocab-quiz' || s.type === 'kanji-quiz' || s.type === 'prep-quiz') && s.quiz_result && Array.isArray(s.quiz_result.wrongItems)) {
      s.quiz_result.wrongItems.forEach((item) => {
        byUnit[unitKey].push(`「${item.prompt}」を「${item.answer}」と間違えた`);
      });
    }
  });

  const units = Object.entries(byUnit).filter(([, list]) => list.length > 0);

  if (!units.length) {
    res.status(200).json({ analysis: [] });
    return;
  }

  const materialText = units
    .map(([unit, list]) => `【${unit}】\n${list.map((l) => '・' + l).join('\n')}`)
    .join('\n\n');

  const system =
    'あなたは中学生・高校生の学習データを分析する家庭教師です。以下は、生徒がこれまでに間違えた問題についての具体的な情報を、単元ごとにまとめたものです。' +
    'それぞれの単元について、生徒がどんな点でつまずいているのか(つまずきポイント)と、どう改善すればよいか(克服のコツ)を、保護者や先生が読むことを想定して簡潔にまとめてください。' +
    '数値の羅列ではなく、具体的で分かりやすい日本語の文章にしてください(それぞれ1〜2文程度)。' +
    'JSON以外は一切出力しないでください。' +
    '出力フォーマット: {"analysis": [{"unit": "文字列", "trouble": "文字列", "tip": "文字列"}]}';

  try {
    const rawText = await callClaude({ system, text: materialText, maxTokens: 2000 });
    const parsed = extractJson(rawText);
    if (!Array.isArray(parsed.analysis)) {
      throw new Error('分析結果の形式が想定と異なります');
    }
    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
