// api/generate-quiz.js
// 画像から、タイピングクイズ用の問題リストを抽出する。
// quizType: 'kanji' (漢字の読み) | 'vocab' (英単語) | 'prep' (英語の予習・見開きページ)

const { callClaude, extractJson } = require('./_anthropic');

const SYSTEM_BY_TYPE = {
  kanji:
    'あなたは中学生・高校生向けの学習教材を作成するアシスタントです。添付された写真には漢字の単語や熟語が写っています。' +
    '写っている漢字の単語を見つけて、それぞれの読み方(ひらがな)を答えてください。' +
    '写真に読みが書かれている場合はそれを正解として使い、書かれていない場合は一般的な読み方を採用してください。' +
    'JSON以外は一切出力しないでください。出力フォーマット: {"items": [{"kanji": "文字列", "yomi": "ひらがなの文字列"}]}',
  vocab:
    'あなたは中学生・高校生向けの英単語学習教材を作成するアシスタントです。添付された写真には英単語とその日本語の意味が写っています。' +
    '写っている単語を見つけて、日本語の意味と対応する英単語のペアを作成してください。' +
    'JSON以外は一切出力しないでください。出力フォーマット: {"items": [{"ja": "日本語", "en": "英単語"}]}',
  prep:
    'あなたは中学生・高校生向けの英語の予習教材を作成するアシスタントです。添付された写真には教科書の見開きページ(文法の説明、例文、ダイアログなど)が写っています。' +
    'このページで実際に使われている例文・フレーズをもとに、日本語の文を見て対応する英語表現を答える練習問題を作成してください。' +
    '「比較級」のような文法用語そのものを答えさせる問題は絶対に作らないでください。必ずページに載っている具体的な例文や一部空欄の文(例: 「キリンはゾウより背が高い」→「The giraffe is taller than the elephant.」)を使ってください。' +
    '写真の文字がはっきり読み取れない場合や、意味の通る自然な例文にできない場合は、その部分を無理に使わず、確実に読み取れて意味が通る例文だけを使ってください。存在しない文章を創作することは絶対にしないでください。' +
    'ページに載っている例文・表現はできるだけ多く拾い、最低10問以上作成してください(ページの分量が多ければそれ以上でも構いません)。' +
    'JSON以外は一切出力しないでください。出力フォーマット: {"items": [{"ja": "日本語の文", "en": "対応する英語の文または表現"}]}',

};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
    return;
  }

  const { image_base64, quiz_type } = req.body || {};
  if (!image_base64) {
    res.status(400).json({ error: '画像データ(image_base64)がありません' });
    return;
  }
  const system = SYSTEM_BY_TYPE[quiz_type];
  if (!system) {
    res.status(400).json({ error: 'quiz_typeはkanji, vocab, prepのいずれかである必要があります' });
    return;
  }

  try {
    const rawText = await callClaude({ system, imageBase64: image_base64, text: '上記のフォーマットで出力してください。', maxTokens: 3000 });
    const parsed = extractJson(rawText);
    if (!Array.isArray(parsed.items) || !parsed.items.length) {
      throw new Error('問題を抽出できませんでした');
    }
    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
