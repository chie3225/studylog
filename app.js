// app.js

const subjectsConfig = [
  { subject:'国語', task:'漢字ノート', type:'kanji-quiz', daily:true },
  { subject:'数学', task:'解きまくり', type:'work-photo', daily:true },
  { subject:'理科', task:'予習(動画+ワークシート)', type:'work-photo', daily:true, hasVideoLink:true },
  { subject:'理科', task:'テスト直し', type:'work-photo', daily:false },
  { subject:'社会', task:'単元テスト', type:'work-photo', daily:false },
  { subject:'英語(標準)', task:'書きまくり', type:'vocab-quiz', daily:true },
  { subject:'英語(標準)', task:'予習', type:'prep-quiz', daily:true },
];

const QUIZ_TYPE_MAP = { 'kanji-quiz':'kanji', 'vocab-quiz':'vocab', 'prep-quiz':'prep' };
const QUIZ_PROMPT_KEY = { 'kanji-quiz':'kanji', 'vocab-quiz':'ja', 'prep-quiz':'ja' };
const QUIZ_ANSWER_KEY = { 'kanji-quiz':'yomi', 'vocab-quiz':'en', 'prep-quiz':'en' };
const QUIZ_SUBLABEL = { 'kanji-quiz':'ひらがなで読みを入力してね', 'vocab-quiz':'英語で入力してね', 'prep-quiz':'英語で入力してね' };
const QUIZ_UPLOAD_LABEL = {
  'kanji-quiz':'🖼️ 漢字ノートの画像をアップロード',
  'vocab-quiz':'🖼️ 単語ページの画像をアップロード',
  'prep-quiz':'🖼️ 教科書の見開きページの画像をアップロード',
};
const QUIZ_DONE_MESSAGE = {
  'kanji-quiz':'🎉 今日の分は終わりです！',
  'vocab-quiz':'🎉 今日の分は終わりです！',
  'prep-quiz':'⭐ 今日も予習ができました！',
};

const state = subjectsConfig.map((cfg) => {
  if (cfg.type === 'work-photo') {
    return {
      uploading:false, uploaded:false, marksDetected:false, marks:{}, explanations:{},
      retryProblems:{}, retryUserAnswers:{}, retryFeedback:{}, retryGrading:{}, retryResolved:{},
      submissionId:null, refLink:'', errorMsg:null
    };
  }
  return { uploading:false, uploaded:false, started:false, rawItems:[], queue:[], current:null, input:'', feedback:null, wrongItems:[], correctCounts:{}, attemptLog:[], done:false, errorMsg:null };
});

let openIdx = null;
let todayPlanKeys = new Set();

// ---------- 共通ユーティリティ ----------
function todayISO(d = new Date()){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function normalizeAnswerStr(str){
  return String(str || '').toLowerCase().replace(/[.\u2026]+$/g, '').replace(/\s+/g, ' ').trim();
}

// ---------- 画像プレビュー(ライトボックス) ----------
function openImageLightbox(src){
  if(!src) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:10px;';
  overlay.appendChild(img);
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function attachImagePreviewHandlers(selector){
  document.querySelectorAll(selector).forEach(img => {
    img.style.cursor = 'zoom-in';
    img.onclick = (e) => { e.stopPropagation(); openImageLightbox(img.src); };
  });
}

// ---------- 問題と解答の一覧プレビュー(生徒側画面用) ----------
function openQAModal(title, items){
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:16px;max-width:480px;width:100%;margin-top:36px;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
  const rows = (items || []).map((it, i) => `
    <div style="padding:10px 0;border-bottom:1px solid #eee;">
      <div style="font-size:12px;color:#888;">問${i+1}</div>
      <div style="font-weight:600;margin:2px 0;">${escapeHtml(it.prompt)}</div>
      <div style="color:#2a8a5a;">→ ${escapeHtml(it.answer)}</div>
    </div>
  `).join('');
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:700;">${escapeHtml(title)}</div>
      <div data-close-modal style="font-size:20px;padding:4px 10px;cursor:pointer;color:#888;">✕</div>
    </div>
    <div>${rows || '<div class="empty-state">問題の記録がありません</div>'}</div>
  `;
  overlay.appendChild(box);
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
  box.querySelector('[data-close-modal]').onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ---------- 実際のやり取りログ(親の管理画面用) ----------
function openAttemptLogModal(title, attempts, fallbackItems){
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:16px;max-width:480px;width:100%;margin-top:36px;box-shadow:0 8px 30px rgba(0,0,0,0.2);';

  let rows = '';
  if(attempts && attempts.length){
    rows = attempts.map((a, i) => `
      <div style="padding:10px 0;border-bottom:1px solid #eee;">
        <div style="font-size:12px;color:#888;">問${i+1}</div>
        <div style="font-weight:600;margin:2px 0;">${escapeHtml(a.prompt)}</div>
        <div style="color:${a.correct ? '#2a8a5a' : '#c0392b'};">
          こたえた内容: ${escapeHtml(a.userAnswer || '(無回答)')} ${a.correct ? '⭕ 正解' : '❌ 不正解'}
        </div>
        ${a.correct ? '' : `<div style="color:#2a8a5a;font-size:13px;">正しい答え: ${escapeHtml(a.correctAnswer)}</div>`}
      </div>
    `).join('');
  } else if(fallbackItems && fallbackItems.length){
    rows = `<div class="sub-note" style="margin-bottom:8px;color:#aaa;">この回は詳しい解答記録がありません(問題と正解のみ表示)</div>` +
      fallbackItems.map((it, i) => `
        <div style="padding:10px 0;border-bottom:1px solid #eee;">
          <div style="font-size:12px;color:#888;">問${i+1}</div>
          <div style="font-weight:600;margin:2px 0;">${escapeHtml(it.prompt)}</div>
          <div style="color:#2a8a5a;">→ ${escapeHtml(it.answer)}</div>
        </div>
      `).join('');
  }

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-weight:700;">${escapeHtml(title)}</div>
      <div data-close-modal style="font-size:20px;padding:4px 10px;cursor:pointer;color:#888;">✕</div>
    </div>
    <div>${rows || '<div class="empty-state">記録がありません</div>'}</div>
  `;
  overlay.appendChild(box);
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
  box.querySelector('[data-close-modal]').onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

function resizeImage(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if(w > h && w > maxDim){ h = Math.round(h * maxDim/w); w = maxDim; }
        else if(h > maxDim){ w = Math.round(w * maxDim/h); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({base64: dataUrl.split(',')[1], dataUrl});
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function pickImageFile(){
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

async function apiCall(path, options){
  const res = await fetch(path, options);
  let data;
  try{ data = await res.json(); }
  catch(e){
    const text = await res.text().catch(()=> '(本文取得失敗)');
    throw new Error('サーバー応答異常 status=' + res.status + ' body=' + text.slice(0, 300));
  }

  if(!res.ok){ throw new Error(data.error || 'サーバーエラーが発生しました'); }
  return data;
}

async function gradeMathRetry(subject, task, problem, modelAnswer, studentAnswer){
  return apiCall('/api/grade-retry', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ subject, task, problem, modelAnswer, studentAnswer })
  });
}

document.getElementById('today-label').textContent =
  new Date().toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'});

// ---------- Tabs ----------
document.getElementById('tab-student').onclick = () => switchMode('student');
document.getElementById('tab-parent').onclick = () => switchMode('parent');
function switchMode(mode){
  document.getElementById('tab-student').classList.toggle('active', mode==='student');
  document.getElementById('tab-parent').classList.toggle('active', mode==='parent');
  document.getElementById('student-view').hidden = mode!=='student';
  document.getElementById('parent-view').hidden = mode!=='parent';
  if(mode==='parent') switchParentSubtab(parentSubtab);
}

let parentSubtab = 'calendar';
document.getElementById('subtab-calendar').onclick = () => switchParentSubtab('calendar');
document.getElementById('subtab-retry').onclick = () => switchParentSubtab('retry');
document.getElementById('subtab-analysis').onclick = () => switchParentSubtab('analysis');
function switchParentSubtab(sub){
  parentSubtab = sub;
  document.getElementById('subtab-calendar').classList.toggle('active', sub==='calendar');
  document.getElementById('subtab-retry').classList.toggle('active', sub==='retry');
  document.getElementById('subtab-analysis').classList.toggle('active', sub==='analysis');
  document.getElementById('parent-calendar-subview').hidden = sub!=='calendar';
  document.getElementById('parent-retry-subview').hidden = sub!=='retry';
  document.getElementById('parent-analysis-subview').hidden = sub!=='analysis';
  if(sub==='calendar') renderCalendar();
  if(sub==='retry') renderRetryPage();
  if(sub==='analysis') renderAnalysisPage();
}

// ---------- きょうの課題: 初期化 ----------
async function initStudentView(){
  const today = todayISO();

  try{
    const data = await apiCall(`/api/plans?date=${today}`);
    todayPlanKeys = new Set((data.plans || []).map(p => p.subject + '|' + p.task));
  }catch(e){
    todayPlanKeys = new Set();
  }

  let todaysSubmissions = [];
  try{
    const data = await apiCall(`/api/submissions?date=${today}`);
    todaysSubmissions = data.submissions || [];
  }catch(e){ /* 取得できなくても続行 */ }

  subjectsConfig.forEach((cfg, idx) => {
    const existing = todaysSubmissions.find(s => s.subject === cfg.subject && s.task === cfg.task);
    if(!existing) return;
    const s = state[idx];
    if(cfg.type === 'work-photo'){
      s.uploaded = true;
      s.marksDetected = Object.keys(existing.marks || {}).length > 0;
      s.marks = existing.marks || {};
      s.explanations = existing.explanations || {};
      s.retryProblems = existing.retry_problems || {};
      s.retryUserAnswers = existing.retry_answers || {};
      s.retryResolved = existing.retry_resolved || {};
      s.retryFeedback = {};
      s.retryGrading = {};
      s.submissionId = existing.id;
    } else {
      s.uploaded = true;
      s.started = true;
      s.done = true;
      s.wrongItems = (existing.quiz_result && existing.quiz_result.wrongItems) || [];
      const restoredItems = (existing.quiz_result && existing.quiz_result.items) || [];
      s.attemptLog = (existing.quiz_result && existing.quiz_result.attempts) || [];
      const promptKey = QUIZ_PROMPT_KEY[cfg.type];
      const answerKey = QUIZ_ANSWER_KEY[cfg.type];
      s.rawItems = restoredItems.map((it, i) => ({ [promptKey]: it.prompt, [answerKey]: it.answer, _id: i }));
    }
  });

  renderAll();
}

function isSubjectVisibleToday(cfg){
  return cfg.daily || todayPlanKeys.has(cfg.subject + '|' + cfg.task);
}

function renderAll(){
  const listEl = document.getElementById('subject-list');
  const visible = subjectsConfig
    .map((cfg, idx) => ({cfg, idx}))
    .filter(({cfg}) => isSubjectVisibleToday(cfg));

  if(!visible.length){
    listEl.innerHTML = '<div class="empty-state">今日の課題はまだ同期されていません(「管理」タブで課題表を同期してね)</div>';
    return;
  }

  listEl.innerHTML = visible.map(({cfg, idx}) => renderSubjectRow(cfg, idx)).join('');
  attachSubjectHandlers();
  attachImagePreviewHandlers('.photo-thumb');
}

function getStatus(cfg, idx){
  const s = state[idx];
  if(cfg.type === 'work-photo'){
    if(s.uploading) return {label:'🔍 確認中…', cls:'warn'};
    if(!s.uploaded) return {label:'未着手', cls:'notstarted'};
    if(!s.marksDetected) return {label:'🚨 丸つけをしましょう', cls:'warn'};
    const wrongNums = Object.keys(s.marks).filter(k => s.marks[k] === '×' || s.marks[k] === '✕');
    const unresolved = wrongNums.filter(n => !s.retryResolved[n]);
    if(unresolved.length) return {label:`🔁 やり直し中(残り${unresolved.length})`, cls:'progress'};
    return {label:'✅ 完了', cls:'done'};
  }
  if(!s.uploaded) return {label:'未着手', cls:'notstarted'};
  if(!s.started) return {label:'画像アップロード済み', cls:'warn'};
  if(!s.done) return {label:`🔁 進行中(残り${s.queue.length})`, cls:'progress'};
  return cfg.type === 'prep-quiz' ? {label:'⭐ 予習できた!', cls:'star'} : {label:'✅ 完了', cls:'done'};
}

function renderSubjectRow(cfg, idx){
  const status = getStatus(cfg, idx);
  const isOpen = openIdx === idx;
  const borderCls = status.cls === 'warn' ? 'warn' : status.cls === 'progress' ? 'progress' : status.cls === 'done' ? 'done' : '';
  return `
    <div class="subject-row ${borderCls}">
      <div class="subject-head" data-toggle="${idx}">
        <span class="subject-name">${escapeHtml(cfg.subject)}</span>
        <span class="subject-task">${escapeHtml(cfg.task)}</span>
        <span class="status-badge ${status.cls}">${status.label}</span>
        <span class="chevron">${isOpen ? '▲' : '▼'}</span>
      </div>
      <div class="subject-body ${isOpen ? 'open' : ''}">
        ${cfg.type === 'work-photo' ? renderWorkPhotoBody(cfg, idx) : renderQuizBody(cfg, idx)}
      </div>
    </div>
  `;
}

// ---------- 写真提出+自己丸つけ検出+AI解説(work-photo) ----------
function renderWorkPhotoBody(cfg, idx){
  const s = state[idx];
  const refHtml = cfg.hasVideoLink ? renderVideoLinkField(idx, s.refLink) : '';

  if(s.uploading){
    return `${refHtml}<div class="sub-note" style="text-align:center;padding:12px 0;"><span class="spinner dark"></span>写真を確認しています…</div>`;
  }

  if(!s.uploaded){
    return `${refHtml}<div class="sub-note" style="margin-bottom:8px;">自分で○×をつけた(丸つけ済みの)ページの写真をアップロードしてね</div><button class="photo-btn" data-work-upload="${idx}">🖼️ 写真をアップロード</button>${s.errorMsg ? `<div class="error-text">${escapeHtml(s.errorMsg)}</div>` : ''}`;
  }

  if(!s.marksDetected){
    return `
      ${refHtml}
      <img class="photo-thumb" src="${s.photoDataUrl || ''}" alt="">
      <div class="warn-banner" style="margin-top:10px;">🚨 丸つけをしましょう！この写真には○×をつけた跡が見つかりませんでした。答え合わせをして、もう一度アップロードしてね</div>
      <button class="action-btn secondary" data-work-reupload="${idx}">写真を撮り直す</button>
    `;
  }

  const wrongNums = Object.keys(s.marks).filter(k => s.marks[k] === '×' || s.marks[k] === '✕');
  if(!wrongNums.length){
    return `${refHtml}<img class="photo-thumb" src="${s.photoDataUrl || ''}" alt=""><div class="warn-banner" style="background:var(--green-soft);color:var(--green);margin-top:10px;">🎉 全問○がついていました！この教科は完了です</div><button class="action-btn secondary" data-work-reupload="${idx}" style="margin-top:8px;">🖼️ もう一度アップロードする</button>`;
  }

  const allResolved = wrongNums.every(num => s.retryResolved[num]);

  const retryHtml = wrongNums.map((num) => {
    const resolved = s.retryResolved[num];
    if(resolved){
      return `
        <div class="retry-box resolved">
          <div class="num">${escapeHtml(num)} ✅ 直せました</div>
          <div class="explain">${escapeHtml(s.explanations[num] || '')}</div>
        </div>
      `;
    }

    const rp = s.retryProblems[num] || {};
    const problemText = typeof rp === 'string' ? rp : (rp.problem || '');
    const answerVal = s.retryUserAnswers[num] || '';
    const feedback = s.retryFeedback[num];
    const grading = s.retryGrading[num];

    return `
      <div class="retry-box">
        <div class="num">${escapeHtml(num)} ×がついていました</div>
        <div class="explain">${escapeHtml(s.explanations[num] || '')}</div>
        <div class="retry-problem">${escapeHtml(problemText)}</div>
        <input type="text" class="quiz-input ${feedback ? (feedback.correct ? 'correct' : 'wrong') : ''}" id="retry-input-${idx}-${num}" value="${escapeHtml(answerVal)}" placeholder="ここに答えを書いてね" ${grading ? 'disabled' : ''}>
        ${feedback ? `<div class="quiz-feedback ${feedback.correct ? 'correct' : 'wrong'}">${escapeHtml(feedback.feedback)}</div>` : ''}
        <button class="action-btn secondary" data-work-retry-check="${idx}|${num}" ${grading ? 'disabled' : ''}>${grading ? '採点中…' : 'こたえ合わせ'}</button>
      </div>
    `;
  }).join('');

  const finishHtml = allResolved
    ? `<div class="warn-banner" style="background:var(--green-soft);color:var(--green);margin-top:10px;">🎉 やり直し完了です！</div><button class="action-btn secondary" data-work-reupload="${idx}" style="margin-top:8px;">🖼️ もう一度アップロードする(次の問題)</button>`
    : '';

  return `${refHtml}<img class="photo-thumb" src="${s.photoDataUrl || ''}" alt="">` + retryHtml + finishHtml;
}

function renderVideoLinkField(idx, savedLink){
  if(savedLink){
    return `
      <div class="sub-note" style="margin-bottom:8px;">
        <a class="link-btn" href="${escapeHtml(savedLink)}" target="_blank" rel="noopener">▶ 今日の解説動画を見る</a>
        <span style="margin-left:6px;color:var(--muted);cursor:pointer;" data-clear-link="${idx}">(変更する)</span>
      </div>
    `;
  }
  return `
    <div class="sub-note" style="margin-bottom:6px;">今日の解説動画のリンクを貼っておくと、ここから見られます(任意)</div>
    <input type="text" class="quiz-input" id="video-link-input-${idx}" placeholder="https://..." style="text-align:left;font-size:13px;">
    <button class="action-btn secondary" data-save-link="${idx}" style="margin-bottom:10px;">リンクを保存</button>
  `;
}

// ---------- タイピングクイズ(漢字の読み/英単語/英語予習 共通) ----------
function renderQuizBody(cfg, idx){
  const s = state[idx];
  const promptKey = QUIZ_PROMPT_KEY[cfg.type];
  const answerKey = QUIZ_ANSWER_KEY[cfg.type];
  const subLabel = QUIZ_SUBLABEL[cfg.type];
  const uploadLabel = QUIZ_UPLOAD_LABEL[cfg.type];
  const doneMessage = QUIZ_DONE_MESSAGE[cfg.type];

  if(s.uploading){
    return `<div class="sub-note" style="text-align:center;padding:12px 0;"><span class="spinner dark"></span>問題を作成しています…</div>`;
  }

  if(!s.uploaded){
    return `<button class="photo-btn" data-quiz-upload="${idx}">${uploadLabel}</button>${s.errorMsg ? `<div class="error-text">${escapeHtml(s.errorMsg)}</div>` : ''}`;
  }

  if(!s.started){
    return `
      <img class="photo-thumb" src="${s.photoDataUrl || ''}" alt="">
      <div class="sub-note" style="margin:10px 0;">画像から${s.rawItems.length}問を作成しました</div>
      <button class="action-btn" data-quiz-start="${idx}">スタート</button>
      <button class="action-btn secondary" data-quiz-preview="${idx}" style="margin-top:8px;">📋 問題と解答を確認する</button>
    `;
  }

  if(s.done){
    const canRestart = Array.isArray(s.rawItems) && s.rawItems.length > 0;
    return `
      <div class="quiz-done-banner">${doneMessage}（間違えた数: ${s.wrongItems.length}個）</div>
      ${canRestart
        ? `<button class="action-btn secondary" data-quiz-restart="${idx}" style="margin-top:8px;">🔁 もう一度チャレンジする</button>
           <button class="action-btn secondary" data-quiz-preview="${idx}" style="margin-top:8px;">📋 問題と解答を確認する</button>`
        : `<div class="sub-note" style="margin-top:8px;">もう一度やり直すには、画像をアップロードし直してね</div><button class="photo-btn" data-quiz-reupload="${idx}" style="margin-top:6px;">${uploadLabel}</button>`
      }
    `;
  }

  const pair = s.current;
  const feedbackHtml = s.feedback
    ? `<div class="quiz-feedback ${s.feedback.correct ? 'correct' : 'wrong'}">${
        s.feedback.correct
          ? (s.feedback.requiredPasses > 1
              ? (s.feedback.passCount >= s.feedback.requiredPasses ? '🎉 合格！(3回正解達成)' : `正解！(${s.feedback.passCount}/${s.feedback.requiredPasses}回)`)
              : '正解！')
          : `正解は "${escapeHtml(s.feedback.answer)}"`
      }</div>`
    : '';
  return `
    <div class="quiz-counter">のこり ${s.queue.length + 1} 問</div>
    <div class="quiz-prompt">${escapeHtml(pair[promptKey])}</div>
    <div class="quiz-sub">${subLabel}</div>
    <input type="text" class="quiz-input ${s.feedback ? (s.feedback.correct ? 'correct' : 'wrong') : ''}" id="quiz-input-${idx}" value="${escapeHtml(s.input)}" ${s.feedback ? 'readonly' : ''} placeholder="入力してね">
    ${feedbackHtml}
    ${s.feedback
      ? `<button class="action-btn" data-quiz-next="${idx}">つぎへ</button>`
      : `<button class="action-btn" data-quiz-submit="${idx}|${answerKey}">こたえる</button>`
    }
  `;
}

// ---------- きょうの課題: イベント処理 ----------
function attachSubjectHandlers(){
  document.querySelectorAll('[data-toggle]').forEach(el => {
    el.onclick = () => {
      const idx = Number(el.getAttribute('data-toggle'));
      openIdx = openIdx === idx ? null : idx;
      renderAll();
    };
  });

  document.querySelectorAll('[data-work-upload]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-work-upload'));
      await handleWorkPhotoUpload(idx);
    };
  });

  document.querySelectorAll('[data-work-reupload]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-work-reupload'));
      const s = state[idx];
      s.uploaded = false; s.marksDetected = false; s.marks = {}; s.explanations = {};
      s.retryProblems = {}; s.retryUserAnswers = {}; s.retryFeedback = {}; s.retryGrading = {};
      s.retryResolved = {}; s.submissionId = null; s.photoDataUrl = null;
      renderAll();
    };
  });

  document.querySelectorAll('[data-work-retry-check]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const [idxStr, num] = el.getAttribute('data-work-retry-check').split('|');
      const idx = Number(idxStr);
      const s = state[idx];
      const cfg = subjectsConfig[idx];
      const inputEl = document.getElementById(`retry-input-${idx}-${num}`);
      const typed = (inputEl ? inputEl.value : '').trim();

      if(!typed){
        s.retryFeedback[num] = { correct:false, feedback:'答えを入力してね' };
        renderAll();
        return;
      }

      s.retryUserAnswers[num] = typed;
      s.retryGrading[num] = true;
      s.retryFeedback[num] = null;
      renderAll();

      const rp = s.retryProblems[num] || {};
      const problemText = typeof rp === 'string' ? rp : (rp.problem || '');
      const modelAnswer = typeof rp === 'string' ? '' : (rp.answer || '');

      let result;
      try{
        result = await gradeMathRetry(cfg.subject, cfg.task, problemText, modelAnswer, typed);
      }catch(err){
        result = { correct:false, feedback:'採点でエラーが発生しました。もう一度試してみてね' };
      }

      s.retryGrading[num] = false;
      s.retryFeedback[num] = result;
      if(result.correct){
        s.retryResolved[num] = true;
      }
      renderAll();

      if(s.submissionId){
        try{
          const patchBody = { id: s.submissionId, retry_answers: s.retryUserAnswers };
          if(result.correct) patchBody.retry_resolved = s.retryResolved;
          await apiCall('/api/submissions', {
            method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patchBody)
          });
        }catch(err){ /* 保存失敗しても表示上は進める */ }
      }
    };
  });

  document.querySelectorAll('[data-save-link]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-save-link'));
      const inputEl = document.getElementById('video-link-input-' + idx);
      const url = inputEl ? inputEl.value.trim() : '';
      if(url) state[idx].refLink = url;
      renderAll();
    };
  });

  document.querySelectorAll('[data-clear-link]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-clear-link'));
      state[idx].refLink = '';
      renderAll();
    };
  });

  document.querySelectorAll('[data-quiz-upload]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-quiz-upload'));
      await handleQuizUpload(idx);
    };
  });

  document.querySelectorAll('[data-quiz-reupload]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-quiz-reupload'));
      const s = state[idx];
      s.uploaded = false; s.started = false; s.done = false;
      s.rawItems = []; s.queue = []; s.current = null;
      s.wrongItems = []; s.correctCounts = {}; s.attemptLog = []; s.input = ''; s.feedback = null;
      renderAll();
    };
  });

  document.querySelectorAll('[data-quiz-start]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-quiz-start'));
      const s = state[idx];
      const shuffled = [...s.rawItems].sort(() => Math.random() - 0.5);
      s.queue = shuffled.slice(1);
      s.current = shuffled[0];
      s.started = true;
      s.input = ''; s.feedback = null;
      renderAll();
    };
  });

  document.querySelectorAll('[data-quiz-restart]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-quiz-restart'));
      const s = state[idx];
      const shuffled = [...s.rawItems].sort(() => Math.random() - 0.5);
      s.queue = shuffled.slice(1);
      s.current = shuffled[0];
      s.done = false;
      s.wrongItems = [];
      s.correctCounts = {};
      s.attemptLog = [];
      s.input = ''; s.feedback = null;
      renderAll();
    };
  });

  document.querySelectorAll('[data-quiz-preview]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-quiz-preview'));
      const s = state[idx];
      const cfg = subjectsConfig[idx];
      const promptKey = QUIZ_PROMPT_KEY[cfg.type];
      const answerKey = QUIZ_ANSWER_KEY[cfg.type];
      const items = (s.rawItems || []).map(it => ({ prompt: it[promptKey], answer: it[answerKey] }));
      openQAModal(`${cfg.subject} ${cfg.task}`, items);
    };
  });

  document.querySelectorAll('[data-quiz-submit]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const [idxStr, answerKey] = el.getAttribute('data-quiz-submit').split('|');
      const idx = Number(idxStr);
      const s = state[idx];
      const cfg = subjectsConfig[idx];
      const promptKey = QUIZ_PROMPT_KEY[cfg.type];
      const inputEl = document.getElementById('quiz-input-' + idx);
      const rawTyped = (inputEl ? inputEl.value : '').trim();
      const typed = rawTyped.toLowerCase();
      const correctAnswer = String(s.current[answerKey]).trim().toLowerCase();
      const isCorrect = normalizeAnswerStr(typed) === normalizeAnswerStr(correctAnswer);

      const requiredPasses = cfg.type === 'vocab-quiz' ? 3 : 1;
      s.correctCounts = s.correctCounts || {};
      const itemId = s.current._id;

      s.attemptLog = s.attemptLog || [];
      s.attemptLog.push({
        prompt: s.current[promptKey],
        correctAnswer: s.current[answerKey],
        userAnswer: rawTyped,
        correct: isCorrect
      });

      if(!isCorrect){
        s.wrongItems.push({ prompt: s.current[promptKey], answer: s.current[answerKey] });
        s.queue.push(s.current);
      } else {
        s.correctCounts[itemId] = (s.correctCounts[itemId] || 0) + 1;
        if(s.correctCounts[itemId] < requiredPasses){
          s.queue.push(s.current);
        }
      }
      s.feedback = { correct:isCorrect, answer:s.current[answerKey], passCount: s.correctCounts[itemId] || 0, requiredPasses };
      s.input = typed;
      renderAll();
    };
  });

  document.querySelectorAll('[data-quiz-next]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const idx = Number(el.getAttribute('data-quiz-next'));
      const s = state[idx];
      s.feedback = null; s.input = '';
      if(s.queue.length === 0){
        s.done = true;
        s.current = null;
        renderAll();
        await saveQuizSubmission(idx);
      } else {
        s.current = s.queue.shift();
        renderAll();
      }
    };
  });
}

async function handleWorkPhotoUpload(idx){
  const cfg = subjectsConfig[idx];
  const s = state[idx];
  const file = await pickImageFile();
  if(!file) return;

  s.uploading = true; s.errorMsg = null;
  renderAll();

  try{
    const { base64, dataUrl } = await resizeImage(file, 1000, 0.65);
    s.photoDataUrl = dataUrl;

    const result = await apiCall('/api/detect-marks', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ image_base64: base64, subject: cfg.subject, task: cfg.task })
    });

    s.uploaded = true;
    s.marksDetected = result.marksDetected;
    s.marks = {}; s.explanations = {}; s.retryProblems = {};
    s.retryUserAnswers = {}; s.retryFeedback = {}; s.retryGrading = {};
    (result.items || []).forEach(item => {
      s.marks[item.number] = item.mark;
      if(item.mark === '×' || item.mark === '✕'){
        s.explanations[item.number] = item.explain || '';
        s.retryProblems[item.number] = { problem: item.retryProblem || '', answer: item.retryAnswer || '' };
      }
    });
    s.retryResolved = {};

    if(result.marksDetected){
      const now = new Date();
      const saved = await apiCall('/api/submissions', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          date: todayISO(now), time: now.toISOString(), subject: cfg.subject, task: cfg.task,
          type:'work-photo', photo: dataUrl, marks: s.marks, explanations: s.explanations,
          retry_problems: s.retryProblems, retry_answers: {}, retry_resolved: {}
        })
      });
      s.submissionId = saved.submission.id;
    }
  }catch(err){
    s.errorMsg = err.message;
    s.uploaded = false;
  }finally{
    s.uploading = false;
    renderAll();
  }
}

async function handleQuizUpload(idx){
  const cfg = subjectsConfig[idx];
  const s = state[idx];
  const file = await pickImageFile();
  if(!file) return;

  s.uploading = true; s.errorMsg = null;
  renderAll();

  try{
    const { base64, dataUrl } = await resizeImage(file, 800, 0.5);
    s.photoDataUrl = dataUrl;

    const result = await apiCall('/api/generate-quiz', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ image_base64: base64, quiz_type: QUIZ_TYPE_MAP[cfg.type] })
    });

    s.rawItems = result.items.map((it, i) => ({ ...it, _id: i }));
    s.correctCounts = {};
    s.attemptLog = [];
    s.uploaded = true;
  }catch(err){
    s.errorMsg = err.message;
    s.uploaded = false;
  }finally{
    s.uploading = false;
    renderAll();
  }
}

async function saveQuizSubmission(idx){
  const cfg = subjectsConfig[idx];
  const s = state[idx];
  const promptKey = QUIZ_PROMPT_KEY[cfg.type];
  const answerKey = QUIZ_ANSWER_KEY[cfg.type];
  const now = new Date();
  try{
    await apiCall('/api/submissions', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        date: todayISO(now), time: now.toISOString(), subject: cfg.subject, task: cfg.task,
        type: cfg.type, photo: s.photoDataUrl || '',
        quiz_result: {
          total: s.rawItems.length, wrongCount: s.wrongItems.length, wrongItems: s.wrongItems,
          items: s.rawItems.map(it => ({ prompt: it[promptKey], answer: it[answerKey] })),
          attempts: s.attemptLog || []
        }
      })
    });
  }catch(err){ /* 保存に失敗しても画面上の完了表示は維持する */ }
}

initStudentView();

// ================= 管理タブ: カレンダー =================
let calYear, calMonth;
{
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
}
let selectedDate = todayISO();
let syncState = 'idle';
let calendarCache = { submissions: [], plans: [], missedReasons: [] };

document.getElementById('prev-month').onclick = () => changeMonth(-1);
document.getElementById('next-month').onclick = () => changeMonth(1);
function changeMonth(delta){
  calMonth += delta;
  if(calMonth < 0){ calMonth = 11; calYear--; }
  if(calMonth > 11){ calMonth = 0; calYear++; }
  renderCalendar();
}

function renderSyncArea(){
  const el = document.getElementById('sync-area');
  if(syncState === 'idle'){
    el.innerHTML = `<button class="photo-btn" data-sync-upload>🖼️ 課題表の画像を貼り付けて同期する</button>`;
    el.querySelector('[data-sync-upload]').onclick = async () => {
      const file = await pickImageFile();
      if(!file) return;
      syncState = 'scanning';
      renderSyncArea();
      try{
        const { base64 } = await resizeImage(file, 1400, 0.7);
        const result = await apiCall('/api/sync-schedule', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ image_base64: base64, year: calYear, month: calMonth+1 })
        });
        if(result.entries && result.entries.length){
          await apiCall('/api/plans', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ entries: result.entries })
          });
        }
        syncState = 'done';
        renderCalendar();
      }catch(err){
        syncState = 'idle';
        el.innerHTML = `<div class="error-text">同期に失敗しました: ${escapeHtml(err.message)}</div>`;
        setTimeout(renderSyncArea, 2500);
      }
    };
  } else if(syncState === 'scanning'){
    el.innerHTML = `<div class="sub-note"><span class="spinner dark"></span>画像を読み取って予定に反映しています…</div>`;
  } else {
    el.innerHTML = `
      <div class="sub-note" style="color:var(--green);margin-bottom:6px;">✅ 同期しました</div>
      <button class="action-btn secondary" data-sync-again>🖼️ 別の画像でもう一度同期する</button>
    `;
    el.querySelector('[data-sync-again]').onclick = () => { syncState = 'idle'; renderSyncArea(); };
  }
}

async function renderCalendar(){
  renderSyncArea();
  document.getElementById('month-label').textContent = `${calYear}年${calMonth+1}月`;
  const DOW = ['日','月','火','水','木','金','土'];
  document.getElementById('cal-dow-row').innerHTML = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const monthStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
  document.getElementById('cal-grid').innerHTML = '<div class="loading-state">読み込み中…</div>';

  try{
    const [subsData, plansData, reasonsData] = await Promise.all([
      apiCall(`/api/submissions?month=${monthStr}`),
      apiCall(`/api/plans?month=${monthStr}`),
      apiCall(`/api/missed-reasons?month=${monthStr}`),
    ]);
    calendarCache.submissions = subsData.submissions || [];
    calendarCache.plans = plansData.plans || [];
    calendarCache.missedReasons = reasonsData.reasons || [];
  }catch(err){
    document.getElementById('cal-grid').innerHTML = `<div class="empty-state">読み込みエラー: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const firstDay = new Date(calYear, calMonth, 1);
  const startDow = firstDay.getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();

  const byDate = {};
  calendarCache.submissions.forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  const starDates = new Set(calendarCache.submissions.filter(s => s.subject === '英語(標準)' && s.task === '予習').map(s => s.date));
  const planDates = new Set(calendarCache.plans.map(p => p.date));

  let html = '';
  for(let i=0;i<startDow;i++) html += `<div class="cal-day empty"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const iso = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const subs = byDate[iso];
    let dots = '';
    if(subs && subs.length){
      const hasWrong = subs.some(s => Object.values(s.marks || {}).some(m => m === '×' || m === '✕'));
      dots = `<div class="dots"><div class="dot ${hasWrong ? 'red' : 'green'}"></div></div>`;
    }
    const sel = selectedDate === iso ? 'selected' : '';
    html += `<div class="cal-day ${sel}" data-date="${iso}">${d}${dots}${starDates.has(iso) ? '<div class="star-mark">⭐</div>' : ''}${planDates.has(iso) ? '<div class="star-mark">📌</div>' : ''}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
  document.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.onclick = () => { selectedDate = el.getAttribute('data-date'); renderDayDetail(); };
  });

  renderDayDetail();
}

function renderDayDetail(){
  const title = document.getElementById('day-detail-title');
  const list = document.getElementById('day-detail-list');

  if(!selectedDate){ title.textContent = '日付を選んでね'; list.innerHTML = ''; return; }

  title.textContent = selectedDate + ' の記録';

  const subs = calendarCache.submissions.filter(s => s.date === selectedDate);
  const plans = calendarCache.plans.filter(p => p.date === selectedDate);
  const reasonRow = calendarCache.missedReasons.find(r => r.date === selectedDate);
  const star = subs.some(s => s.subject === '英語(標準)' && s.task === '予習');

  let html = '';

  if(plans.length){
    html += `<div class="sub-note" style="margin-bottom:6px;font-weight:600;">📌 提出予定(課題表から自動反映)</div>`;
    html += plans.map(p => `<div class="sub-note" style="margin-bottom:4px;">・${escapeHtml(p.subject)} ${escapeHtml(p.task)}</div>`).join('');
    html += `<div style="margin-bottom:14px;"></div>`;
  }

  if(star){
    html += `<div class="sub-note" style="margin-bottom:10px;">⭐ 英語の予習を提出済み</div>`;
  }

  if(!subs.length){
    html += '<div class="empty-state">この日はまだ提出がありません</div>';
  } else {
    html += subs.map(s => {
      const marks = s.marks || {};
      const hasMarks = Object.keys(marks).length > 0;
      let sub2 = '';
      if(hasMarks){
        const correctCount = Object.values(marks).filter(m => m === '○').length;
        sub2 = `${correctCount}/${Object.keys(marks).length} 正解`;
      } else if(s.quiz_result && typeof s.quiz_result.total === 'number'){
        const correctCount = s.quiz_result.total - (s.quiz_result.wrongCount || 0);
        sub2 = `${correctCount}/${s.quiz_result.total} 正解`;
      }
      const isQuizType = s.quiz_result && Array.isArray(s.quiz_result.items) && s.quiz_result.items.length > 0;
      const thumbAttr = isQuizType ? `data-day-log="${s.id}"` : '';
      const badge = isQuizType
        ? '<div class="quiz-log-badge" style="position:absolute;bottom:2px;right:2px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:2px 5px;border-radius:6px;pointer-events:none;">📋 記録</div>'
        : '';
      return `
        <div class="sub-block">
          <div class="sub-block-head">
            <div style="position:relative;display:inline-block;">
              <img class="sub-thumb ${isQuizType ? 'quiz-log-thumb' : ''}" src="${s.photo || ''}" alt="" ${thumbAttr}>
              ${badge}
            </div>
            <div>
              <span class="sub-subject-tag">${escapeHtml(s.subject)}</span>
              <div class="sub-time">${escapeHtml(s.task)} ・ ${sub2}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  const isPast = selectedDate < todayISO();
  const nothingSubmitted = !subs.length && !star;

  if(isPast && nothingSubmitted){
    if(reasonRow){
      html += `<div class="warn-banner" style="margin-top:12px;">${escapeHtml(reasonRow.reason)}</div>`;
    } else {
      html += `
        <div class="warn-banner" style="margin-top:12px;">この日は提出がないまま過ぎています。理由を記録しておきますか？</div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="action-btn secondary" style="font-size:12px;padding:9px 6px;" data-missed-reason="🤒 体調不良">🤒 体調不良</button>
          <button class="action-btn secondary" style="font-size:12px;padding:9px 6px;" data-missed-reason="📅 予定が詰まっていた">📅 予定が詰まっていた</button>
          <button class="action-btn secondary" style="font-size:12px;padding:9px 6px;" data-missed-reason="🎮 遊んでた">🎮 遊んでた</button>
        </div>
      `;
    }
  }

  list.innerHTML = html;

  document.querySelectorAll('[data-missed-reason]').forEach(el => {
    el.onclick = async () => {
      const reason = el.getAttribute('data-missed-reason');
      try{
        await apiCall('/api/missed-reasons', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ date: selectedDate, reason })
        });
        calendarCache.missedReasons.push({ date: selectedDate, reason });
        renderDayDetail();
      }catch(err){ /* 失敗時は何もしない */ }
    };
  });

  document.querySelectorAll('[data-day-log]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-day-log');
      const sub = calendarCache.submissions.find(x => String(x.id) === String(id));
      if(!sub) return;
      openAttemptLogModal(
        `${sub.subject} ${sub.task}`,
        (sub.quiz_result && sub.quiz_result.attempts) || [],
        (sub.quiz_result && sub.quiz_result.items) || []
      );
    };
  });

  attachImagePreviewHandlers('.sub-thumb:not(.quiz-log-thumb)');
}

// ================= 管理タブ: テスト前やり直し =================
let retryPageState = {}; // key -> { grading:false, feedback:null, answer:'' }
let retryActiveSubject = null;

function buildDedupeKey(subject, task, text){
  return `${subject}|${task}|${(text || '').trim().toLowerCase()}`;
}

function printSubjectSheet(subject, items){
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  const rows = items.map((it, i) => `
    <div style="margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #ccc;">
      <div style="font-weight:bold;font-size:15px;">${i+1}. ${escapeHtml(it.task)} ${escapeHtml(it.num)}</div>
      <div style="margin:8px 0;font-size:14px;">${escapeHtml(it.retryProblem)}</div>
      ${it.explain ? `<div style="color:#666;font-size:12px;">${escapeHtml(it.explain)}</div>` : ''}
      <div style="height:36px;margin-top:10px;"></div>
    </div>
  `).join('');
  doc.open();
  doc.write(`
    <html><head><meta charset="utf-8"><title>${escapeHtml(subject)} やり直しシート</title></head>
    <body style="font-family:sans-serif;padding:16px;color:#222;">
      <h2 style="margin-bottom:16px;">${escapeHtml(subject)} やり直しシート(${items.length}問)</h2>
      ${rows}
    </body></html>
  `);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => { document.body.removeChild(iframe); }, 1000);
  }, 300);
}

function renderRetryItemBox(item){
  const st = retryPageState[item.key] || {};
  const grading = st.grading;
  const badge = item.occurrences > 1 ? `<span style="background:#fde2e2;color:#c0392b;font-size:11px;padding:2px 6px;border-radius:8px;margin-left:6px;">${item.occurrences}回目</span>` : '';
  const doneLabel = item.resolved ? ' ✅ 直せたことがあります' : '';

  const feedback = st.feedback;
  const val = st.answer != null ? st.answer : '';
  return `
    <div class="retry-box">
      <div class="num">${escapeHtml(item.task)} ${escapeHtml(item.num)}${badge}${doneLabel}</div>
      <div class="explain">${escapeHtml(item.explain)}</div>
      <div class="retry-problem">${escapeHtml(item.retryProblem)}</div>
      <input type="text" class="quiz-input ${feedback ? (feedback.correct ? 'correct' : 'wrong') : ''}" id="retry-page-input-${item.key}" value="${escapeHtml(val)}" placeholder="ここに答えを書いてね" ${grading ? 'disabled' : ''}>
      ${feedback ? `<div class="quiz-feedback ${feedback.correct ? 'correct' : 'wrong'}">${escapeHtml(feedback.feedback)}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:6px;">
        <button class="action-btn secondary" style="flex:1;" data-retry-page-check="${item.key}" ${grading ? 'disabled' : ''}>${grading ? '採点中…' : 'こたえ合わせ'}</button>
        <button class="action-btn secondary" style="flex:1;background:#f0f0f0;" data-retry-page-dismiss="${item.key}">✅ もう大丈夫</button>
      </div>
    </div>
  `;
}

function openBulkDismissConfirm(subject, unresolvedItems, onSaveAndDismiss, onDismissOnly){
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;padding:20px;max-width:420px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
  box.innerHTML = `
    <div style="font-weight:700;font-size:16px;margin-bottom:8px;">${escapeHtml(subject)}の未解決 ${unresolvedItems.length}件を、本当に全部消していいですか？</div>
    <div style="color:#888;font-size:13px;margin-bottom:18px;">一度消すと元には戻せません。</div>
    <button data-bulk-save-dismiss class="action-btn secondary" style="margin-bottom:8px;width:100%;">📄 最後にPDFで保存してから消す</button>
    <button data-bulk-dismiss class="action-btn secondary" style="margin-bottom:8px;width:100%;">いいよ！(そのまま消す)</button>
    <button data-bulk-cancel class="action-btn secondary" style="width:100%;background:#f0f0f0;">やっぱ消しちゃダメ</button>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  box.querySelector('[data-bulk-save-dismiss]').onclick = () => { overlay.remove(); onSaveAndDismiss(); };
  box.querySelector('[data-bulk-dismiss]').onclick = () => { overlay.remove(); onDismissOnly(); };
  box.querySelector('[data-bulk-cancel]').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
}

async function bulkDismissItems(items, submissions){
  // submissionIdごとにまとめて更新する
  const bySubmission = {};
  items.forEach(it => { (bySubmission[it.submissionId] = bySubmission[it.submissionId] || []).push(it); });

  for(const submissionId of Object.keys(bySubmission)){
    const submission = submissions.find(s => String(s.id) === String(submissionId));
    const mergedResolved = Object.assign({}, (submission && submission.retry_resolved) || {});
    bySubmission[submissionId].forEach(it => {
      const key = it.isQuiz ? it.quizKey : it.num;
      mergedResolved[key] = true;
    });
    try{
      await apiCall('/api/submissions', {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id: Number(submissionId) || submissionId, retry_resolved: mergedResolved })
      });
    }catch(e){ /* ignore */ }
  }
}

async function renderRetryPage(){
  const listEl = document.getElementById('retry-list');
  listEl.innerHTML = '<div class="loading-state">読み込み中…</div>';

  let submissions = [];
  try{
    const to = todayISO();
    const from = todayISO(new Date(Date.now() - 90*24*60*60*1000));
    const data = await apiCall(`/api/submissions?from=${from}&to=${to}`);
    submissions = data.submissions || [];
  }catch(err){
    listEl.innerHTML = `<div class="empty-state">読み込みエラー: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const allItems = [];

  submissions.forEach(s => {
    const marks = s.marks || {};
    const retryResolved = s.retry_resolved || {};
    const retryProblems = s.retry_problems || {};
    const retryAnswers = s.retry_answers || {};

    Object.keys(marks).forEach(num => {
      if(marks[num] !== '×' && marks[num] !== '✕') return;
      const rp = retryProblems[num] || {};
      const problemText = typeof rp === 'string' ? rp : (rp.problem || '');
      const modelAnswer = typeof rp === 'string' ? '' : (rp.answer || '');
      allItems.push({
        key: `w-${s.id}-${num}`, submissionId: s.id, subject: s.subject, task: s.task, num, date: s.date,
        explain: (s.explanations || {})[num] || '',
        retryProblem: problemText, modelAnswer, isMath: true,
        savedAnswer: retryAnswers[num] || '',
        resolved: !!retryResolved[num],
        dedupeKey: buildDedupeKey(s.subject, s.task, problemText || (s.explanations || {})[num]),
      });
    });

    if(s.quiz_result && Array.isArray(s.quiz_result.wrongItems)){
      s.quiz_result.wrongItems.forEach((w, i) => {
        const key = 'q' + i;
        allItems.push({
          key: `z-${s.id}-${key}`, submissionId: s.id, subject: s.subject, task: s.task, num:'', date: s.date,
          explain: `問題「${w.prompt}」`, retryProblem: w.prompt, modelAnswer: w.answer,
          isQuiz: true, quizKey: key, savedAnswer: '',
          resolved: !!retryResolved[key],
          dedupeKey: buildDedupeKey(s.subject, s.task, w.prompt),
        });
      });
    }
  });

  if(!allItems.length){
    listEl.innerHTML = '<div class="empty-state">まだ間違えた問題の記録がありません</div>';
    return;
  }

  const freqMap = {};
  allItems.forEach(it => { freqMap[it.dedupeKey] = (freqMap[it.dedupeKey] || 0) + 1; });
  allItems.forEach(it => { it.occurrences = freqMap[it.dedupeKey]; });

  const bySubjectAll = {};
  allItems.forEach(it => { (bySubjectAll[it.subject] = bySubjectAll[it.subject] || []).push(it); });

  Object.values(bySubjectAll).forEach(arr => {
    arr.sort((a, b) => (b.occurrences - a.occurrences) || (a.date < b.date ? -1 : 1));
  });

  const subjectNames = Object.keys(bySubjectAll);
  if(!retryActiveSubject || !bySubjectAll[retryActiveSubject]){
    retryActiveSubject = subjectNames[0];
  }

  const totalUnresolved = allItems.filter(it => !it.resolved).length;

  let html = `<div class="sub-note" style="margin-bottom:10px;font-weight:600;">未解決 ${totalUnresolved}件</div>`;

  html += `<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:10px;">`;
  html += subjectNames.map(subject => {
    const active = subject === retryActiveSubject;
    const count = bySubjectAll[subject].filter(it => !it.resolved).length;
    return `<button data-retry-tab="${escapeHtml(subject)}" style="flex-shrink:0;padding:8px 14px;border-radius:20px;border:none;font-size:14px;font-weight:600;cursor:pointer;background:${active ? '#333' : '#f0f0f0'};color:${active ? '#fff' : '#555'};">${escapeHtml(subject)}(${count})</button>`;
  }).join('');
  html += `</div>`;

  const subjectItems = (bySubjectAll[retryActiveSubject] || []).slice().sort((a, b) => {
    if(a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return 0;
  });
  const unresolvedInSubject = subjectItems.filter(it => !it.resolved);

  if(subjectItems.length){
    html += `<button class="action-btn secondary" data-retry-print="${escapeHtml(retryActiveSubject)}" style="margin-bottom:8px;">📄 ${escapeHtml(retryActiveSubject)}のPDFで保存(${subjectItems.length}問)</button>`;
  }
  if(unresolvedInSubject.length){
    html += `<button class="action-btn secondary" data-retry-bulk-dismiss style="margin-bottom:12px;background:#f0f0f0;">🗑️ ${escapeHtml(retryActiveSubject)}を全部もう大丈夫！</button>`;
  }

  if(!subjectItems.length){
    html += `<div class="warn-banner" style="background:var(--green-soft);color:var(--green);">🎉 この科目の間違いはありません</div>`;
  } else {
    html += subjectItems.map(renderRetryItemBox).join('');
  }

  listEl.innerHTML = html;

  document.querySelectorAll('[data-retry-tab]').forEach(el => {
    el.onclick = () => {
      retryActiveSubject = el.getAttribute('data-retry-tab');
      renderRetryPage();
    };
  });

  const printBtn = listEl.querySelector('[data-retry-print]');
  if(printBtn){
    printBtn.onclick = () => {
      printSubjectSheet(retryActiveSubject, subjectItems);
    };
  }

  const bulkBtn = listEl.querySelector('[data-retry-bulk-dismiss]');
  if(bulkBtn){
    bulkBtn.onclick = () => {
      openBulkDismissConfirm(
        retryActiveSubject,
        unresolvedInSubject,
        async () => {
          printSubjectSheet(retryActiveSubject, unresolvedInSubject);
          setTimeout(async () => {
            await bulkDismissItems(unresolvedInSubject, submissions);
            renderRetryPage();
          }, 1200);
        },
        async () => {
          await bulkDismissItems(unresolvedInSubject, submissions);
          renderRetryPage();
        }
      );
    };
  }

  async function resolveItem(item, extraAnswer){
    const submission = submissions.find(s => s.id === item.submissionId);
    const resolvedKey = item.isQuiz ? item.quizKey : item.num;
    const mergedResolved = Object.assign({}, (submission && submission.retry_resolved) || {}, { [resolvedKey]: true });
    const patchBody = { id: item.submissionId, retry_resolved: mergedResolved };
    if(item.isMath && extraAnswer != null){
      const mergedAnswers = Object.assign({}, (submission && submission.retry_answers) || {}, { [item.num]: extraAnswer });
      patchBody.retry_answers = mergedAnswers;
    }
    try{
      await apiCall('/api/submissions', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patchBody) });
    }catch(e){ /* ignore */ }
  }

  document.querySelectorAll('[data-retry-page-dismiss]').forEach(el => {
    el.onclick = async () => {
      const key = el.getAttribute('data-retry-page-dismiss');
      const item = subjectItems.find(u => u.key === key);
      if(!item) return;
      await resolveItem(item, null);
      renderRetryPage();
    };
  });

  document.querySelectorAll('[data-retry-page-check]').forEach(el => {
    el.onclick = async () => {
      const key = el.getAttribute('data-retry-page-check');
      const item = subjectItems.find(u => u.key === key);
      if(!item) return;
      const inputEl = document.getElementById('retry-page-input-' + key);
      const typed = (inputEl ? inputEl.value : '').trim();

      if(!typed){
        retryPageState[key] = { grading:false, feedback:{ correct:false, feedback:'答えを入力してね' }, answer: typed };
        renderRetryPage();
        return;
      }

      retryPageState[key] = { grading:true, feedback:null, answer: typed };
      renderRetryPage();

      let result;
      try{
        if(item.isQuiz){
          const correct = normalizeAnswerStr(typed) === normalizeAnswerStr(item.modelAnswer);
          result = { correct, feedback: correct ? '正解！' : `正解は "${item.modelAnswer}"` };
        } else {
          result = await gradeMathRetry(item.subject, item.task, item.retryProblem, item.modelAnswer, typed);
        }
      }catch(err){
        result = { correct:false, feedback:'採点でエラーが発生しました。もう一度試してみてね' };
      }

      retryPageState[key] = { grading:false, feedback:result, answer: typed };

      if(result.correct && !item.resolved){
        await resolveItem(item, typed);
      }

      renderRetryPage();
    };
  });
}


// ================= 管理タブ: 分析 =================
async function renderAnalysisPage(){
  const listEl = document.getElementById('subject-analysis-list');
  listEl.innerHTML = '<div class="loading-state">分析中…(データが多いと少し時間がかかります)</div>';

  try{
    const data = await apiCall('/api/analysis');
    const analysis = data.analysis || [];
    if(!analysis.length){
      listEl.innerHTML = '<div class="empty-state">まだ分析できる記録がありません</div>';
      return;
    }
    listEl.innerHTML = analysis.map((a, i) => `
      <div class="analysis-card">
        <div class="analysis-unit">${i+1}. ${escapeHtml(a.unit)}</div>
        <div class="analysis-line">
          <span class="analysis-label trouble">つまずきポイント:</span>
          <span class="analysis-text">${escapeHtml(a.trouble)}</span>
        </div>
        <div class="analysis-line">
          <span class="analysis-label tip">克服のコツ:</span>
          <span class="analysis-text">${escapeHtml(a.tip)}</span>
        </div>
      </div>
    `).join('');
  }catch(err){
    listEl.innerHTML = `<div class="empty-state">分析エラー: ${escapeHtml(err.message)}</div>`;
  }
}
