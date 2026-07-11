// api/detect-marks.js
// 生徒が自分で○×をつけた(丸つけ済みの)写真を受け取り、
// その跡を「読み取る」だけを行う。AI自身は正誤を判定しない。

const { callClaude, extractJson } = require('./_anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTメソッドのみ対応しています' });
    return;
  }

  const { image_base64, subject, task } = req.body || {};
  if (!image_base64) {
    res.status(400).json({ error: '画像データ(image_base64)がありません' });
    return;
  }

    const system =
    'あなたは生徒の自己採点(丸つけ)の跡を読み取るアシスタントです。あなた自身が問題の正誤を判定することは絶対にしないでください。' +
    '写真には、生徒が自分で答え合わせをして手書きの印をつけた形跡があるはずです。次のルールに従って、印を読み取ってください。' +
    '【正解のサイン】答えを丸で囲んでいる場合(小さい丸でも、解答全体を大きく囲むような丸でも)は「○」(正解)です。' +
    '【不正解のサイン】レ点(チェックマーク、V字の印)、または右肩上がりの斜め線・バツ印がついている場合は「×」(不正解)です。' +
    '丸と、レ点・斜線・バツ印を絶対に混同しないでください。線の大きさや形の違いではなく、丸で囲んでいるかどうかだけを正解の基準にしてください。' +
    '写真のどこにも丸つけの形跡が見当たらない場合は、marksDetectedをfalseにし、itemsは空配列にしてください。' +
    '形跡がある場合はmarksDetectedをtrueにし、見つかった問題番号ごとにmarkを"○"か"×"で記録してください。' +
    '×がついている問題については、生徒が書いた解答内容を見て、具体的にどこでどう間違えたのかを短く解説してください(1〜2文)。' +
    'さらに、同じ考え方を使うことで解ける類似の練習問題を1問作成してください(数値や表現を変えた程度の、同じ単元・同じ難易度の問題)。' +
    '○がついている問題にはexplainとretryProblemは不要です(nullにしてください)。' +
    'JSON以外は一切出力せず、前置きや説明、コードブロックの記法も禁止です。' +
    '出力フォーマット: {"marksDetected": true または false, "items": [{"number": "文字列", "mark": "○" または "×", "explain": "文字列またはnull", "retryProblem": "文字列またはnull"}]}';


  const contextText = `教科: ${subject || '不明'} / 課題: ${task || '不明'}`;

  try {
    const rawText = await callClaude({ system, imageBase64: image_base64, text: contextText, maxTokens: 4000 });
    const parsed = extractJson(rawText);
    if (typeof parsed.marksDetected !== 'boolean' || !Array.isArray(parsed.items)) {
      throw new Error('応答の形式が想定と異なります');
    }
    res.status(200).json(parsed);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
