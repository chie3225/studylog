// api/sync-schedule.js
// 学校の課題表(スプレッドシートのスクリーンショット)を読み取り、
// 表示されている月の、日付ごとの教科・課題を抽出する。

const { callClaude, extractJson } = require('./_anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
    return;
  }

  const { image_base64, year, month } = req.body || {};
  if (!image_base64) {
    res.status(400).json({ error: '画像データ(image_base64)がありません' });
    return;
  }
  if (!year || !month) {
    res.status(400).json({ error: 'yearとmonthが必要です' });
    return;
  }

  const system =
    'あなたは学校の課題表(スプレッドシート)の画像を読み取るアシスタントです。' +
    '表は「日」の列と、国語・数学・理科・社会・英語(発展)・英語(標準)・保体などの教科ごとの列で構成されています。' +
    '各行(日付)について、教科の列に何か文字が書かれていれば、それはその日にやるべき課題です。' +
    '行事予定の列(テストや式典などの学校行事)は無視してください。空欄のセルも無視してください。' +
    '見つかったものをすべて、日付(その月の何日か、数字のみ)・教科名・課題内容のセットとしてリストアップしてください。' +
    'JSON以外は一切出力しないでください。前置きや説明は不要です。' +
    '出力フォーマット: {"entries": [{"day": 数値, "subject": "文字列", "task": "文字列"}]}';

  const contextText = `この画像は${year}年${month}月のシートです。`;

  try {
    const rawText = await callClaude({ system, imageBase64: image_base64, text: contextText, maxTokens: 3000 });
    const parsed = extractJson(rawText);
    if (!Array.isArray(parsed.entries)) {
      throw new Error('予定を抽出できませんでした');
    }
    const entries = parsed.entries
      .filter((e) => e.day && e.subject && e.task)
      .map((e) => ({
        date: `${year}-${String(month).padStart(2, '0')}-${String(e.day).padStart(2, '0')}`,
        subject: e.subject,
        task: e.task,
      }));
    res.status(200).json({ entries });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
