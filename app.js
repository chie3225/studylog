// app.js

// ---------- 教科設定 ----------
// daily: true の教科は毎日固定表示。falseのものは、その日の同期済み予定(plans)に
// 「教科+課題名」が一致するものがある時だけ表示される。
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
    return { uploading:false, uploaded:false, marksDetected:false, marks:{}, explanations:{}, retryProblems:{}, retryResolved:{}, submissionId:null, refLink:'', errorMsg:null };
  }
  return { uploading:false, uploaded:false, started:false, rawItems:[], queue:[], current:null, input:'', feedback:null, wrongItems:[], correctCounts:{}, done:false, errorMsg:null };
});

let openIdx = null;
let todayPlanKeys = new Set(); // "subject|task" 形式

// ---------- 共通ユーティリティ ----------
function todayISO(d = new Date()){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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

  // 今日の同期済み予定を取得(理科テスト直し・社会単元テストの表示判定に使う)
  try{
    const data = await apiCall(`/api/plans?date=${today}`);
    todayPlanKeys = new Set((data.plans || []).map(p => p.subject + '|' + p.task));
  }catch(e){
    todayPlanKeys = new Set();
  }

  // 今日すでに提出済みのものがあれば状態に反映(リロードしても消えないように)
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
      s.retryResolved = existing.retry_resolved || {};
      s.submissionId = existing.id;
    } else {
      s.uploaded = true;
      s.started = true;
      s.done = true;
      s.wrongItems = (existing.quiz_result && existing.quiz_result.wrongItems) || [];
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
  // quiz系(kanji-quiz / vocab-quiz / prep-quiz)
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
    return `${refHtml}<img class="photo-thumb" src="${s.photoDataUrl || ''}" alt=""><div class="warn-banner" style="background:var(--green-soft);color:var(--green);margin-top:10px;">🎉 全問○がついていました！この教科は完了です</div>`;
  }

  const retryHtml = wrongNums.map((num) => {
    const resolved = s.retryResolved[num];
    return `
      <div class="retry-box ${resolved ? 'resolved' : ''}">
        <div class="num">${escapeHtml(num)} ${resolved ? '✅ 直せました' : '×がついていました'}</div>
        <div class="explain">${escapeHtml(s.explanations[num] || '')}</div>
        ${resolved ? '' : `
          <div class="retry-problem">類似問題: ${escapeHtml(s.retryProblems[num] || '')}</div>
          <button class="action-btn secondary" data-work-retry="${idx}|${num}">とけた！</button>
        `}
      </div>
    `;
  }).join('');

  return `${refHtml}<img class="photo-thumb" src="${s.photoDataUrl || ''}" alt="">` + retryHtml;
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
    `;
  }

  if(s.done){
    return `<div class="quiz-done-banner">${doneMessage}（間違えた数: ${s.wrongItems.length}個）</div>`;
  }

  const pair = s.current;
  const requiredPasses = cfg.type === 'vocab-quiz' ? 3 : 1;
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
      s.retryProblems = {}; s.retryResolved = {}; s.submissionId = null; s.photoDataUrl = null;
      renderAll();
    };
  });

  document.querySelectorAll('[data-work-retry]').forEach(el => {
    el.onclick = async (e) => {
      e.stopPropagation();
      const [idxStr, num] = el.getAttribute('data-work-retry').split('|');
      const idx = Number(idxStr);
      const s = state[idx];
      s.retryResolved[num] = true;
      renderAll();
      if(s.submissionId){
        try{
          await apiCall('/api/submissions', {
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id: s.submissionId, retry_resolved: s.retryResolved })
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

  document.querySelectorAll('[data-quiz-submit]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const [idxStr, answerKey] = el.getAttribute('data-quiz-submit').split('|');
      const idx = Number(idxStr);
      const s = state[idx];
      const cfg = subjectsConfig[idx];
      const promptKey = QUIZ_PROMPT_KEY[cfg.type];
      const inputEl = document.getElementById('quiz-input-' + idx);
      const typed = (inputEl ? inputEl.value : '').trim().toLowerCase();
      const correctAnswer = String(s.current[answerKey]).trim().toLowerCase();
      const normalize = (str) => str.replace(/[.\u2026]+$/g, '').replace(/\s+/g, ' ').trim();
      const isCorrect = normalize(typed) === normalize(correctAnswer);

      const requiredPasses = cfg.type === 'vocab-quiz' ? 3 : 1;
      s.correctCounts = s.correctCounts || {};
      const itemId = s.current._id;

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
    (result.items || []).forEach(item => {
      s.marks[item.number] = item.mark;
      if(item.mark === '×' || item.mark === '✕'){
        s.explanations[item.number] = item.explain || '';
        s.retryProblems[item.number] = item.retryProblem || '';
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
          retry_problems: s.retryProblems, retry_resolved: {}
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

    const result = await apiCall('/api/generate-quiz', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ image_base64: base64, quiz_type: QUIZ_TYPE_MAP[cfg.type] })
    });

    s.rawItems = result.items.map((it, i) => ({ ...it, _id: i }));
    s.correctCounts = {};
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
  const now = new Date();
  try{
    await apiCall('/api/submissions', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        date: todayISO(now), time: now.toISOString(), subject: cfg.subject, task: cfg.task,
        type: cfg.type, photo: s.photoDataUrl || '',
        quiz_result: { total: s.rawItems.length, wrongCount: s.wrongItems.length, wrongItems: s.wrongItems }
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
let syncState = 'idle'; // idle | scanning | done
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
        const monthStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
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
      return `
        <div class="sub-block">
          <div class="sub-block-head">
            <img class="sub-thumb" src="${s.photo || ''}" alt="">
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
}

// ================= 管理タブ: テスト前やり直し =================
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

  const unresolved = [];
  const resolved = [];
  submissions.forEach(s => {
    const marks = s.marks || {};
    const retryResolved = s.retry_resolved || {};
    Object.keys(marks).forEach(num => {
      if(marks[num] !== '×' && marks[num] !== '✕') return;
      const item = {
        submissionId: s.id, subject: s.subject, task: s.task, num,
        explain: (s.explanations || {})[num] || '',
        retryProblem: (s.retry_problems || {})[num] || '',
      };
      if(retryResolved[num]) resolved.push(item); else unresolved.push(item);
    });

    if(s.quiz_result && Array.isArray(s.quiz_result.wrongItems)){
      s.quiz_result.wrongItems.forEach((w, i) => {
        const key = 'q' + i;
        const item = {
          submissionId: s.id, subject: s.subject, task: s.task, num: '',
          explain: `問題「${w.prompt}」の正解は「${w.answer}」`,
          retryProblem: '', isQuiz: true, quizKey: key,
        };
        if(retryResolved[key]) resolved.push(item); else unresolved.push(item);
      });
    }
  });

  if(!unresolved.length && !resolved.length){
    listEl.innerHTML = '<div class="empty-state">まだ間違えた問題の記録がありません</div>';
    return;
  }

  let html = '';
  if(unresolved.length){
    html += `<div class="sub-note" style="margin-bottom:8px;font-weight:600;">未解決 ${unresolved.length}件</div>`;
    html += unresolved.map((w, i) => `
      <div class="retry-box">
        <div class="num">${escapeHtml(w.subject)} ${escapeHtml(w.task)} ${escapeHtml(w.num)}</div>
        <div class="explain">${escapeHtml(w.explain)}</div>
        <div class="retry-problem">${escapeHtml(w.retryProblem)}</div>
        <button class="action-btn secondary" data-retry-page-resolve="${i}">とけた！</button>
      </div>
    `).join('');
  } else {
    html += `<div class="warn-banner" style="background:var(--green-soft);color:var(--green);">🎉 今のところ未解決の間違いはありません</div>`;
  }

  if(resolved.length){
    html += `<div class="sub-note" style="margin:16px 0 8px;font-weight:600;">解決済み ${resolved.length}件</div>`;
    html += resolved.map(w => `
      <div class="retry-box resolved">
        <div class="num">${escapeHtml(w.subject)} ${escapeHtml(w.task)} ${escapeHtml(w.num)} ✅ 直せました</div>
        <div class="explain">${escapeHtml(w.explain)}</div>
      </div>
    `).join('');
  }

  listEl.innerHTML = html;

  document.querySelectorAll('[data-retry-page-resolve]').forEach(el => {
    el.onclick = async () => {
      const i = Number(el.getAttribute('data-retry-page-resolve'));
      const item = unresolved[i];
      const submission = submissions.find(s => s.id === item.submissionId);
      const key = item.isQuiz ? item.quizKey : item.num;
      const mergedResolved = Object.assign({}, (submission && submission.retry_resolved) || {}, { [key]: true });
      try{
        await apiCall('/api/submissions', {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ id: item.submissionId, retry_resolved: mergedResolved })
        });
      }catch(e){ /* ignore */ }
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
