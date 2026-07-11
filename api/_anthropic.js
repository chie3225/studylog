// api/_anthropic.js
async function callClaude({ system, imageBase64, text, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('サーバーにANTHROPIC_API_KEYが設定されていません');
  }

  const content = [];
  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } });
  }
  content.push({ type: 'text', text });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens || 2000,
      system,
      messages: [{ role: 'user', content }],
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error('Anthropic APIエラー: ' + (data.error.message || JSON.stringify(data.error)));
  }

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('AIの応答にテキストが含まれていません。stop_reason=' + data.stop_reason);
  }

  return textBlock.text;
}

function extractJson(rawText) {
  let clean = rawText.replace(/```json|```/g, '').trim();
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(clean);
}

module.exports = { callClaude, extractJson };
