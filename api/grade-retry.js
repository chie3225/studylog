// api/grade-retry.js
// やり直しの類似問題に対して生徒が実際に入力した答えを、AIに採点してもらう。
// 表記の違い(順序、空白、±の書き方など)は許容し、内容的に正しければ正解とする。
// 不正解の場合は、正解を直接教えずに短いヒントだけを返す。

const { callClaude, extractJson } = require('./_anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
    return;
  }

  const { subject, task, problem, modelAnswer, studentAnswer } = req.body || {};
  if (!problem || !studentAnswer) {
    res.status(400).json({ error: 'problem, studentAnswer は必須です' });
    return;
  }

  const system =
    'あなたは中学生の答案を採点するアシスタントです。生徒が類似の練習問題に取り組んだ結果を見て、正しく解けているかどうかを判定してください。' +
    '表記の違い(解の順序、空白、全角半角、±の書き方の違いなど)は許容し、数学的・内容的に正しければ正解としてください。' +
    '不正解の場合は、正しい答えを絶対に直接教えないでください。短く(1文程度)、どこを見直せばよいかのヒントだけを日本語で書いてください。' +
    '正解の場合は「正解です！」のような短い日本語の一言を書いてください。' +
    'JSON以外は一切出力しないでください。出力フォーマット: {"correct": true または false, "feedback": "文字列"}';

  const text =
    `教科: ${subject || '不明'} / 課題: ${task || '不明'}\n` +
    `問題: ${problem}\n` +
    `模範解答(参考・生徒には見せない): ${modelAnswer || '(なし)'}\n` +
    `生徒の解答: ${studentAnswer}\n` +
    '上記のフォーマットで採点結果を出力してください。';

  try {
    const rawText = await callClaude({ system, text, maxTokens: 300 });
    const parsed = extractJson(rawText);
    if (typeof parsed.correct !== 'boolean') {
      throw new Error('採点結果の形式が想定と異なります');
    }
    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
