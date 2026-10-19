
'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  schoolName: '', term: 1, unit: '1', mode: 'mix', classNo: null, studentNo: null,
  attempt: null, index: 0, answers: [], answered: false,
  teacherToken: null, records: [], classes: []
};

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function message(err) { return err instanceof Error ? err.message : String(err); }
function setBusy(button, busy, text) {
  button.disabled = busy;
  if (text) button.textContent = text;
}
// The HTML app is served by Pages; this hidden relay retains server-side grading and Sheets storage.
let relay=null;
const pendingRequests=new Map();
function randomHex(){return [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function connection(){
  if(relay)return relay.promise;
  let backend;
  try{backend=new URL(window.QUIZ_CONFIG.backendUrl);if(backend.origin!=='https://script.google.com'||!backend.pathname.endsWith('/exec'))throw Error();}
  catch(_){return Promise.reject(new Error('기록 서버 주소 설정을 확인해 주세요.'));}
  const nonce=randomHex(),frame=document.createElement('iframe');
  frame.hidden=true;frame.title='학습 기록 서버 연결';frame.setAttribute('aria-hidden','true');frame.referrerPolicy='strict-origin';
  backend.searchParams.set('bridge','1');backend.searchParams.set('parentOrigin',location.origin);backend.searchParams.set('nonce',nonce);
  frame.src=backend.href;
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const state={promise,frame,nonce,source:null,origin:null};relay=state;
  const timeout=setTimeout(()=>{if(!state.source){frame.remove();window.removeEventListener('message',receive);if(relay===state)relay=null;reject(new Error('기록 서버 연결이 지연되고 있어요. 잠시 후 다시 눌러 주세요.'));}},30000);
  function receive(event){
    const m=event.data;
    if(!m||m.channel!=='math-school-v1'||m.nonce!==nonce||!/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/.test(event.origin))return;
    if(m.kind==='ready'&&!state.source&&event.source){state.source=event.source;state.origin=event.origin;clearTimeout(timeout);resolve(state);return;}
    if(event.source!==state.source||event.origin!==state.origin||m.kind!=='response')return;
    const request=pendingRequests.get(m.id);if(!request)return;
    pendingRequests.delete(m.id);clearTimeout(request.timeout);
    try{const data=typeof m.raw==='string'?JSON.parse(m.raw):m.raw;if(data?.ok)request.resolve(data);else request.reject(new Error(data?.error||'서버 응답을 확인해 주세요.'));}
    catch(error){request.reject(error);}
  }
  window.addEventListener('message',receive);document.body.appendChild(frame);
  return promise;
}
async function api(action,payload={}){
  const bridge=await connection(),id=randomHex();
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pendingRequests.delete(id);reject(new Error('저장 응답이 늦어지고 있어요. 다시 시도해 주세요.'));},45000);
    pendingRequests.set(id,{resolve,reject,timeout});
    bridge.source.postMessage({channel:'math-school-v1',nonce:bridge.nonce,kind:'request',id,payload:JSON.stringify({action,...payload})},bridge.origin);
  });
}

let navigationVersion = 0;
function goHome() {
  navigationVersion++;
  $('teacher-password').value = '';
  logoutTeacher();
}
function positiveInteger(raw) {
  const text = String(raw).trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n <= 2147483647 ? n : null;
}
function setChoice(group, property, value) {
  state[property] = property === 'term' ? Number(value) : value;
  if(property==='term'){state.unit='1';renderUnits();}
  document.querySelectorAll(group).forEach((b) => {
    const selected = b.dataset[property] === String(value);
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
}
function openStudent() {
  try{$('school-name').value=localStorage.getItem('math-school-name')||'';}catch(_){}
  $('student-error').textContent = '';
  renderUnits();
  show('student');
}

async function startQuiz() {
  const navigation = navigationVersion;
  $('student-error').textContent = '';
  const schoolName=$('school-name').value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!/^[\p{L}\p{N} .()·-]{2,60}$/u.test(schoolName)){$('student-error').textContent='학교의 정식 이름을 2~60자로 입력해 주세요.';return;}
  const classNo = positiveInteger($('class-no').value);
  const studentNo = positiveInteger($('student-no').value);
  if (!classNo || !studentNo) {
    $('student-error').textContent = '반과 번호를 1 이상의 숫자로 입력해 주세요.';
    return;
  }
  const b = $('start-quiz');
  setBusy(b, true, '⏳ 문제를 준비하고 있어요...');
  try {
    const result = await api('start', { schoolName, classNo, studentNo, term: state.term, unit: state.unit, mode: state.unit==='all'||selectedUnit()?.arithmetic ? state.mode : 'mix' });
    if (navigation !== navigationVersion) return;
    state.schoolName=result.schoolName||schoolName;
    try{localStorage.setItem('math-school-name',state.schoolName);}catch(_){}
    state.classNo = classNo;
    state.studentNo = studentNo;
    state.attempt = result;
    state.index = 0;
    state.answers = Array(result.questions.length).fill(null);
    show('quiz');
    showQuestion();
  } catch (e) { $('student-error').textContent = message(e); }
  finally { setBusy(b, false, '🚀 퀴즈 시작!'); }
}
function rightAnswer(q) {
  if(q.answer !== undefined)return q.answer;
  const c = q.c ?? 0;
  return q.operator === '+' ? q.a + q.b + c : q.a - q.b - c;
}
function showQuestion() {
  window.scrollTo({top:0,behavior:"instant"});
  state.answered = false;
  const q = state.attempt.questions[state.index];
  $('player-label').textContent = `${state.schoolName} · ${state.classNo}반 ${state.studentNo}번 · ${state.term}학기 ${unitLabel(state.term,state.attempt.unit || state.unit)}`;
  $('progress-label').textContent = `${state.index + 1} / ${state.attempt.questions.length}`;
  $('progress-fill').style.width = `${(state.index + 1) / state.attempt.questions.length * 100}%`;
  $('quiz-emoji').textContent = '🐱';
  $('story').textContent = q.story;
  $('equation').textContent = q.expression;
  $('quiz-feedback').textContent = '';
  $('quiz-error').textContent = '';
  $('hint-box').classList.add('hidden');
  $('hint-text').textContent = '';
  $('solution-box').classList.add('hidden');
  $('solution-text').textContent = '';
  $('next-question').classList.add('hidden');
  $('next-question').disabled = false;
  /* $('visual').textContent = state.term === 1
    ? q.operator === '+'
      ? '🟠'.repeat(q.a) + ' ➕ ' + '🔵'.repeat(q.b)
      : '🟠'.repeat(q.a - q.b) + ' ⚪'.repeat(q.b)
    : ''; */
  drawVisual(q);
  const grid = $('options');
  grid.replaceChildren();
  q.choices.forEach((number) => {
    const btn = document.createElement('button');
    btn.className = 'answer';
    btn.type = 'button';
    btn.textContent = String(number);
    btn.dataset.value = String(number);
    btn.addEventListener('click', () => answer(number));
    grid.appendChild(btn);
  });
}
// 첫 번째 오답에는 정답을 노출하지 않고 연산 방법만 힌트로 안내합니다.
function learningHint(q) {
  if(q.hint)return q.hint;
  switch (q.type) {
    case 'smallAdd': return '🟠와 🔵를 하나씩 짚어 가며 모두 세어 보세요. 손가락을 사용해도 좋아요!';
    case 'smallSub': return '동그라미에서 빼야 할 개수를 지우고, 남은 것만 다시 세어 보세요.';
    case 'tenAdd': return '두 수를 손가락으로 나타낸 다음, 모두 모아 세어 보세요.';
    case 'tenSub': return '손가락을 펼치고 빼는 수만큼 접은 뒤 남은 수를 세어 보세요.';
    case 'carryAdd': return '큰 수를 먼저 10으로 만든 뒤, 남은 수를 더해 보세요.';
    case 'borrowSub': return '십몇을 10과 몇으로 나누어 생각하고, 10에서 먼저 빼 보세요.';
    case 'noCarryAdd': return '십의 자리와 일의 자리를 나누어 생각해 보세요.';
    case 'noBorrowSub': return '일의 자리 수끼리 먼저 빼고, 십의 자리도 확인해 보세요.';
    case 'threeAdd': return '맨 앞의 두 수를 먼저 더한 다음, 마지막 수를 더해 보세요.';
    case 'threeSub': return '왼쪽에서 오른쪽으로, 한 번씩 차례대로 빼 보세요.';
    default: return '수를 하나씩 세면서 다시 계산해 보세요.';
  }
}

// 두 번째도 틀렸을 때 정답과 한 단계씩 계산한 풀이를 보여줍니다.
function workedSolution(q) {
  if(q.solution)return q.solution;
  if(q.type==='noCarryAdd'||q.type==='noBorrowSub'){
    const tensA=Math.floor(q.a/10)*10,tensB=Math.floor(q.b/10)*10,onesA=q.a%10,onesB=q.b%10;
    const sign=q.operator;
    return `십끼리 ${tensA} ${sign} ${tensB} = ${sign==='+'?tensA+tensB:tensA-tensB}, 낱개끼리 ${onesA} ${sign} ${onesB} = ${sign==='+'?onesA+onesB:onesA-onesB}이에요. 둘을 모으면 ${rightAnswer(q)}이에요.`;
  }
  const correct = rightAnswer(q);
  if (q.c != null) {
    const first = q.operator === '+' ? q.a + q.b : q.a - q.b;
    return `먼저 ${q.a} ${q.operator} ${q.b} = ${first}, 그다음 ${first} ${q.operator} ${q.c} = ${correct}이에요.`;
  }
  if (q.type === 'carryAdd') {
    const makeTen = 10 - q.a;
    return `${q.a}에 ${makeTen}을 더하면 10이에요. 남은 ${q.b - makeTen}을 더하면 ${correct}이에요.`;
  }
  if (q.type === 'borrowSub') {
    const ones = q.a - 10;
    return `${q.a}는 10과 ${ones}이에요. 10 - ${q.b} = ${10 - q.b}, 여기에 ${ones}을 더하면 ${correct}이에요.`;
  }
  return q.operator === '+'
    ? `${q.a}개와 ${q.b}개를 모두 모으면 ${correct}개예요.`
    : `${q.a}개에서 ${q.b}개를 빼면 ${correct}개가 남아요.`;
}

function finishQuestion(value, correct, fromHint) {
  state.answered = true;
  document.querySelectorAll('#options .answer').forEach((b) => {
    b.disabled = true;
    const n = b.dataset.value;
    if (n === String(correct)) b.classList.add('correct');
    else if (n === String(value)) b.classList.add('wrong');
  });
  if (value === correct) {
    $('quiz-emoji').textContent = '🥳';
    $('quiz-feedback').style.color = '#158754';
    $('quiz-feedback').textContent = fromHint
      ? '🌟 힌트를 보고 스스로 맞혔어요! 멋져요!'
      : '🌟 한 번에 정답! 정말 잘했어요!';
    $('hint-box').classList.add('hidden');
  } else {
    $('quiz-emoji').textContent = '🐻';
    $('quiz-feedback').style.color = '#a66838';
    $('quiz-feedback').textContent = `괜찮아요! 정답은 ${correct}이에요. 풀이를 살펴봐요!`;
    $('hint-box').classList.add('hidden');
    $('solution-text').textContent = workedSolution(state.attempt.questions[state.index]);
    $('solution-box').classList.remove('hidden');
  }
  $('next-question').textContent = state.index === state.attempt.questions.length - 1
    ? '🏆 점수 저장하고 결과 보기' : '다음 문제 ➡️';
  $('next-question').classList.remove('hidden');
}

function answer(value) {
  if (state.answered) return;
  const q = state.attempt.questions[state.index];
  const correct = rightAnswer(q);
  const entry = state.answers[state.index];
  if (entry === null) {
    // 첫 번째 선택: 정답이면 종료, 오답이면 힌트를 보여주고 다시 선택합니다.
    state.answers[state.index] = { first: value, second: null };
    if (value === correct) {
      finishQuestion(value, correct, false);
      return;
    }
    document.querySelectorAll('#options .answer').forEach((b) => {
      if (b.dataset.value === String(value)) {
        b.disabled = true;
        b.classList.add('wrong');
      }
    });
    $('quiz-emoji').textContent = '💡';
    $('quiz-feedback').style.color = '#a66838';
    $('quiz-feedback').textContent = '조금 아쉬워요! 힌트를 읽고 한 번 더 골라 보세요.';
    $('hint-text').textContent = learningHint(q);
    $('hint-box').classList.remove('hidden');
    return;
  }
  // 첫 번째와 같은 답을 두 번 제출하지 못하게 합니다.
  if (value === entry.first || entry.second !== null) return;
  entry.second = value;
  finishQuestion(value, correct, true);
}
async function nextQuestion() {
  const navigation = navigationVersion;
  if (!state.answered || $('next-question').disabled) return;
  if (state.index + 1 < state.attempt.questions.length) {
    state.index += 1;
    showQuestion();
    return;
  }
  const btn = $('next-question');
  setBusy(btn, true, '⏳ 점수를 저장하고 있어요...');
  $('quiz-error').textContent = '';
  try {
    const result = await api('submit', { attemptId: state.attempt.attemptId, answers: state.answers });
    if (navigation !== navigationVersion) return;
    $('result-player').textContent = `${state.schoolName} · ${state.classNo}반 ${state.studentNo}번 · ${state.term}학기 ${unitLabel(state.term,state.attempt.unit || state.unit)}`;
    $('result-score').textContent = `${result.score} / ${result.total}`;
    $('result-first-count').textContent = `${result.firstTryCount ?? (result.score - (result.helpedCount || 0))}개`;
    $('result-hint-count').textContent = `${result.helpedCount || 0}개`;
    $('result-reveal-count').textContent = `${result.revealedCount || 0}개`;
    const ratio = result.score / result.total;
    const stars = Math.round(5 * ratio);
    $('result-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
    $('result-message').textContent = ratio === 1 ? '🌈 수학 박사! 최고예요!'
      : ratio >= .7 ? '🎉 아주 잘했어요!'
      : ratio >= .4 ? '💖 멋진 도전이에요!' : '🌱 다음에는 더 잘할 수 있어요!';
    show('result');
  } catch (e) { $('quiz-error').textContent = message(e); }
  finally { setBusy(btn, false, '저장 다시 시도하기'); }
}

async function loginTeacher() {
  const navigation = navigationVersion;
  const btn = $('login');
  $('teacher-error').textContent = '';
  setBusy(btn, true, '확인 중...');
  try {
    const schoolName=$('teacher-school').value;
    const { teacherToken,schoolName:school } = await api('teacherLogin', { schoolName,password: $('teacher-password').value });
    if (navigation !== navigationVersion) { api('teacherLogout', {teacherToken}).catch(() => {}); return; }
    state.teacherToken = teacherToken;
    $('report-school').textContent=school;
    try{localStorage.setItem('math-school-name',school);}catch(_){}
    $('teacher-password').value = '';
    show('dashboard');
    await refreshReport();
  } catch (e) { $('teacher-error').textContent = message(e); }
  finally { setBusy(btn, false, '🔐 결과 확인하기'); }
}
async function refreshReport() {
  if (!state.teacherToken) return;
  const token = state.teacherToken;
  $('dashboard-status').textContent = '⏳ 전체 기록을 불러오고 있어요...';
  $('refresh').disabled = true;
  try {
    const records = [];
    let offset = 0;
    let snapshot;
    let classes = [];
    while (true) {
      const data = await api('teacherReport', { teacherToken: token, offset, snapshot });
      snapshot = data.snapshot;
      if (state.teacherToken !== token) return;
      records.push(...data.records);
      classes = data.classes;
      if (data.nextOffset === null) break;
      offset = data.nextOffset;
      $('dashboard-status').textContent = `⏳ ${records.length}건을 불러왔어요...`;
    }
    state.records = records;
    state.classes = classes;
    rebuildClassFilter();
    rebuildUnitFilter();
    renderReport();
    $('dashboard-status').textContent = `✅ 총 ${records.length}건의 제출 기록을 불러왔어요.`;
  } catch (e) {
    $('dashboard-status').textContent = `불러오기 오류: ${message(e)}`;
  } finally { $('refresh').disabled = false; }
}
function rebuildClassFilter() {
  const sel = $('filter-class');
  const previous = sel.value;
  sel.replaceChildren();
  const all = new Option('전체 반', 'all');
  sel.appendChild(all);
  state.classes.forEach((n) => sel.appendChild(new Option(`${n}반`, String(n))));
  sel.value = [...sel.options].some((o) => o.value === previous) ? previous : 'all';
}
function filtered() {
  const cls = $('filter-class').value, term = $('filter-term').value, mode = $('filter-mode').value;
  return state.records.filter((r) =>
    (cls === 'all' || String(r.class_no) === cls) &&
    (term === 'all' || String(r.term) === term) &&
    (mode === 'all' || r.mode === mode) &&
    ($('filter-unit').value==='all' || ($('filter-unit').value==='legacy' ? (!r.unit || r.unit==='legacy') : $('filter-unit').value==='old-scope' ? r.oldScope : !r.oldScope && `${r.term}/${r.unit}`===$('filter-unit').value)));
}
function latestByStudent(records) {
  const found = new Map();
  for (const r of records) {
    const id = `${r.class_no}/${r.student_no}`;
    if (!found.has(id)) found.set(id, r);
  }
  return [...found.values()].sort((a, b) => a.class_no - b.class_no || a.student_no - b.student_no);
}
function percent(records) {
  if (!records.length) return '-';
  return `${Math.round(100 * records.reduce((s, r) => s + r.score / r.total, 0) / records.length)}%`;
}
function dateText(t) {
  return new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function wrongText(r) {
  if (!r.wrong?.length) return '없음';
  return r.wrong.map((x) => {
    if (x.hintShown && x.recovered) {
      return `${x.expression} (처음 ${x.chosen} → 힌트 후 ${x.second} 정답)`;
    }
    if (x.hintShown) {
      return `${x.expression} (처음 ${x.chosen}, 다시 ${x.second} → 정답 ${x.answer} 공개)`;
    }
    return `${x.expression} (선택 ${x.chosen}, 정답 ${x.answer})`;
  }).join(' / ');
}
function tableRow(container, values, colspan = 1) {
  const tr = document.createElement('tr');
  values.forEach((value) => {
    const td = document.createElement('td');
    td.textContent = String(value);
    if (values.length === 1) td.colSpan = colspan;
    tr.appendChild(td);
  });
  container.appendChild(tr);
}
function studentTable(id, records) {
  const body = $(id);
  body.replaceChildren();
  if (!records.length) return tableRow(body, ['해당하는 제출 기록이 없어요.'], 10);
  records.forEach((r) => tableRow(body, [
    `${r.class_no}반`, `${r.student_no}번`, `${r.term}학기`, recordUnitLabel(r),
    { add: '덧셈', sub: '뺄셈', mix: '골고루' }[r.mode] || r.mode,
    `${r.score}/${r.total}`, `${r.helped_count || 0}`, `${r.revealed_count || 0}`, dateText(r.completed_at), wrongText(r)
  ]));
}
function renderReport() {
  const rows = filtered();
  const latest = latestByStudent(rows);
  $('stat-students').textContent = `${latest.length}명`;
  $('stat-average').textContent = percent(latest);
  $('stat-attempts').textContent = `${rows.length}회`;
  studentTable('student-summary', latest);
  studentTable('all-results', rows);
  const body = $('class-summary');
  body.replaceChildren();
  const chosen = $('filter-class').value;
  const classes = state.classes.filter((n) => chosen === 'all' || String(n) === chosen);
  if (!classes.length) return tableRow(body, ['등록된 반이 없어요.'], 4);
  classes.forEach((cls) => {
    const byClass = rows.filter((r) => r.class_no === cls);
    const recent = latestByStudent(byClass);
    tableRow(body, [`${cls}반`, `${recent.length}명`, percent(recent), `${byClass.length}회`]);
  });
}
function csvCell(v) {
  let s = String(v ?? '');
  // 스프레드시트에서 수식으로 실행되는 값 방지
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCsv() {
  const rows = filtered();
  if (!rows.length) { alert('내보낼 결과가 없습니다.'); return; }
  const output = [['학교','반','번호','학기','단원','유형','맞힌문제','전체문제','처음에맞힘','힌트후맞힘','정답공개','제출시각','틀린문제/힌트기록']];
  rows.forEach((r) => output.push([r.school_name,r.class_no,r.student_no,r.term,recordUnitLabel(r),r.mode,r.score,r.total,r.first_try_count ?? (r.score-(r.helped_count||0)),r.helped_count||0,r.revealed_count||0,dateText(r.completed_at),wrongText(r)]));
  const text = '\uFEFF' + output.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.download = '수학퀴즈_결과.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function logoutTeacher() {
  const token = state.teacherToken;
  state.teacherToken = null; state.records = []; state.classes = [];
  ['student-summary', 'all-results', 'class-summary'].forEach((id) => $(id).replaceChildren());
  show('home');
  if (token) { try { await api('teacherLogout', { teacherToken: token }); } catch (_) { /* UI logged out */ } }
}

const UNIT_CATALOG = {"1":[{"id":"1","name":"1. 9까지의 수","detail":"9까지 세기 · 수의 순서 · 크기"},{"id":"2","name":"2. 여러 가지 모양","detail":"상자 모양 · 둥근기둥 모양 · 공 모양"},{"id":"3","name":"3. 덧셈과 뺄셈","detail":"한 자리 수 · 합이 9 이하인 계산","arithmetic":true},{"id":"4","name":"4. 비교하기","detail":"길이 · 높이 · 넓이 · 양 · 무게"},{"id":"5","name":"5. 50까지의 수","detail":"50까지의 수 · 10개씩 묶음 · 순서"}],"2":[{"id":"1","name":"1. 100까지의 수","detail":"60~99 · 수의 순서와 크기 · 짝수와 홀수"},{"id":"2","name":"2. 덧셈과 뺄셈(1)","detail":"세 수 계산 · 10이 되는 더하기 · 10에서 빼기 · 10 만들어 더하기","arithmetic":true},{"id":"3","name":"3. 모양과 시각","detail":"네모 · 세모 · 동그라미 · 몇 시 · 몇 시 30분"},{"id":"4","name":"4. 덧셈과 뺄셈(2)","detail":"한 자리 수끼리 받아올림 덧셈 · 십몇에서 받아내림 뺄셈","arithmetic":true},{"id":"5","name":"5. 규칙 찾기","detail":"모양 반복 · 수의 규칙"},{"id":"6","name":"6. 덧셈과 뺄셈(3)","detail":"받아올림·받아내림 없는 두 자리 수 덧셈과 뺄셈","arithmetic":true}]};
function unitLabel(term,unit) {
  if(!unit || unit==='legacy')return '이전 기록(학기 전체)';
  if(unit==='all')return '덧셈·뺄셈 전체 복습';
  return (UNIT_CATALOG[term]||[]).find(u=>u.id===String(unit))?.name || '이전 기록';
}
function recordUnitLabel(r){return unitLabel(r.term,r.unit)+(r.oldScope?' (수정 전 범위)':'');}
function selectedUnit() {return (UNIT_CATALOG[state.term]||[]).find(u=>u.id===state.unit);}
function renderUnits() {
  const host=$('unit-buttons');host.replaceChildren();
  [...UNIT_CATALOG[state.term],{id:'all',name:'덧셈·뺄셈 전체 복습',detail:'학기의 계산 단원을 모두 배운 뒤 선택해요.',arithmetic:true}].forEach(u=>{
    const button=document.createElement('button');button.type='button';button.className='unit-button';
    button.classList.toggle('active',u.id===state.unit);button.setAttribute('aria-pressed',String(u.id===state.unit));
    const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=u.name;detail.textContent=u.detail;button.append(title,detail);
    button.addEventListener('click',()=>{state.unit=u.id;renderUnits();});host.append(button);
  });
  const arithmetic=state.unit==='all'||selectedUnit()?.arithmetic;
  $('operation-field').classList.toggle('hidden',!arithmetic);
  $('unit-note').textContent='선택한 단원에서만 10문제가 나와요.';
}
function rebuildUnitFilter() {
  const select=$('filter-unit'),previous=select.value;select.replaceChildren(new Option('모든 단원','all'));
  for(const term of [1,2])for(const u of UNIT_CATALOG[term])select.append(new Option(`${term}학기 ${u.name}`,`${term}/${u.id}`));
  for(const term of [1,2])select.append(new Option(`${term}학기 계산 전체 복습`,`${term}/all`));
  select.append(new Option('수정 전 출제 범위 기록','old-scope'));
  select.append(new Option('이전 기록(단원 정보 없음)','legacy'));
  select.value=[...select.options].some(o=>o.value===previous)?previous:'all';
}
function drawVisual(q) {
  const host=$('visual');host.replaceChildren();
  const v=q.visual;
  if(!v) {
    if(state.term===1&&q.operator)host.textContent=q.operator==='+'?'🟠'.repeat(q.a)+' ➕ '+'🔵'.repeat(q.b):'🟠'.repeat(q.a-q.b)+' ⚪'.repeat(q.b);
    return;
  }
  if(v.kind==='numberGrid'){
    const table=document.createElement('table');table.setAttribute('aria-label','수 배열표');table.style.cssText='margin:12px auto;border-collapse:collapse;font-size:24px';
    for(let row=0;row<3;row++){const tr=table.insertRow();for(let col=0;col<5;col++){const td=tr.insertCell();td.textContent=row*5+col===v.missing?'□':String(v.start+row*10+col);td.style.cssText='border:2px solid #a799cd;padding:10px;background:#f3efff';}}host.append(table);return;
  }
  if(v.kind==='count'){host.textContent=v.symbol.repeat(v.count);return;}
  if(v.kind==='bundles'){
    const grouped=document.createElement('div');grouped.className='bundle-grid';
    for(let i=0;i<v.tens;i++){const b=document.createElement('span');b.className='ten-bundle';b.textContent='●●●●●\n●●●●●';b.setAttribute('aria-label','10개 묶음');grouped.append(b);}
    host.append(grouped);if(v.ones){const singles=document.createElement('div');singles.textContent='●'.repeat(v.ones);host.append(singles);}return;
  }
  const ns='http://www.w3.org/2000/svg';
  const el=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,value]of Object.entries(attrs||{}))e.setAttribute(k,String(value));if(text!==undefined)e.textContent=text;return e;};
  const svg=el('svg',{viewBox:'0 0 400 220',role:'img','aria-label':q.type==='clock'?'짧은 바늘과 긴 바늘이 있는 시계':q.story});
  host.append(svg);const colors=['#a68af3','#56bea6','#efa953','#74a9eb'];
  const text=(x,y,s,size=19)=>svg.append(el('text',{x,y,'text-anchor':'middle',fill:'#383154','font-size':size,'font-weight':750},s));
  if(v.kind==='clock') {
    svg.append(el('circle',{cx:200,cy:110,r:100,fill:'white',stroke:'#795bd3','stroke-width':5}));
    for(let n=1;n<=12;n++){const a=n*Math.PI/6;text(200+80*Math.sin(a),116-80*Math.cos(a),n,17);}
    const hand=(angle,length,color,width)=>svg.append(el('line',{x1:200,y1:110,x2:200+length*Math.sin(angle),y2:110-length*Math.cos(angle),stroke:color,'stroke-width':width,'stroke-linecap':'round'}));
    hand((v.hour%12+v.minute/60)*Math.PI/6,51,'#5f45a4',8);hand(v.minute*Math.PI/30,73,'#288d7c',5);svg.append(el('circle',{cx:200,cy:110,r:6,fill:'#383154'}));
  } else if(v.kind==='solid') {
    if(v.shape==='ball'){svg.append(el('circle',{cx:200,cy:110,r:76,fill:'#eec05e',stroke:'#9e701c','stroke-width':3}));svg.append(el('ellipse',{cx:200,cy:110,rx:30,ry:76,fill:'none',stroke:'#9e701c','stroke-width':2}));svg.append(el('ellipse',{cx:200,cy:110,rx:76,ry:24,fill:'none',stroke:'#9e701c','stroke-width':2}));}
    else if(v.shape==='cylinder'){svg.append(el('path',{d:'M 135 55 V 165 A 65 25 0 0 0 265 165 V 55',fill:'#a4dbcf',stroke:'#328471','stroke-width':3}));svg.append(el('ellipse',{cx:200,cy:55,rx:65,ry:25,fill:'#d7f0e9',stroke:'#328471','stroke-width':3}));}
    else {svg.append(el('polygon',{points:'125,75 230,75 230,175 125,175',fill:'#cbb8f3',stroke:'#795bd3','stroke-width':3}));svg.append(el('polygon',{points:'125,75 170,35 275,35 230,75',fill:'#e6dbfc',stroke:'#795bd3','stroke-width':3}));svg.append(el('polygon',{points:'230,75 275,35 275,135 230,175',fill:'#a88adf',stroke:'#795bd3','stroke-width':3}));}
  } else if(v.kind==='flatShapes'){
    v.shapes.forEach((shape,i)=>{const x=35+(i%5)*80,y=42+Math.floor(i/5)*80,color=colors[i%4];if(shape==='circle')svg.append(el('circle',{cx:x,cy:y,r:22,fill:color}));else if(shape==='triangle')svg.append(el('polygon',{points:`${x},${y-25} ${x-25},${y+22} ${x+25},${y+22}`,fill:color}));else svg.append(el('rect',{x:x-22,y:y-22,width:44,height:44,rx:2,fill:color}));});
  } else if(v.kind==='balance') {
    const low=v.heavier==='가'?1:-1;
    svg.append(el('polygon',{points:'180,190 220,190 200,105',fill:'#9a8ac1'}));svg.append(el('line',{x1:80,y1:95+low*25,x2:320,y2:95-low*25,stroke:'#705694','stroke-width':7}));
    ['가','나'].forEach((label,i)=>{const x=i?320:80,y=95+(i?-low:low)*25;svg.append(el('line',{x1:x,y1:y,x2:x,y2:y+40,stroke:'#705694','stroke-width':3}));svg.append(el('rect',{x:x-45,y:y+40,width:90,height:12,rx:6,fill:colors[i]}));svg.append(el('rect',{x:x-22,y:y+5,width:44,height:35,fill:colors[i]}));text(x,y+75,label);});
  } else if(v.kind==='comparison') {
    if(v.compare==='length')v.values.forEach((n,i)=>{text(28,40+i*48,['가','나','다','라'][i]);svg.append(el('rect',{x:55,y:23+i*48,width:n*3.1,height:23,rx:5,fill:colors[i]}));});
    else v.values.forEach((n,i)=>{const x=24+i*98;text(x+30,212,['가','나','다','라'][i]);if(v.compare==='height')svg.append(el('rect',{x,y:190-n*1.6,width:55,height:n*1.6,rx:4,fill:colors[i]}));else if(v.compare==='area')svg.append(el('rect',{x:x+3,y:145-n,width:n*.7,height:n,fill:colors[i]}));else{svg.append(el('rect',{x,y:40,width:60,height:150,rx:5,fill:'white',stroke:'#7b7191','stroke-width':2}));svg.append(el('rect',{x:x+3,y:187-n*1.4,width:54,height:n*1.4,fill:'#7ac6ed'}));}});
  }
}

$('home-logo').addEventListener('click', goHome);
$('student-entry').addEventListener('click', openStudent);
$('teacher-school').value='';
try{$('teacher-school').value=localStorage.getItem('math-school-name')||'';}catch(_){}
$('teacher-entry').addEventListener('click', () => { $('teacher-error').textContent = ''; show('teacher-login'); });
document.querySelectorAll('[data-go-home]').forEach((b) => b.addEventListener('click', goHome));
document.querySelectorAll('[data-term]').forEach((b) => b.addEventListener('click', () => setChoice('[data-term]', 'term', b.dataset.term)));
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setChoice('[data-mode]', 'mode', b.dataset.mode)));
$('start-quiz').addEventListener('click', startQuiz);
$('next-question').addEventListener('click', nextQuestion);
$('retry').addEventListener('click', startQuiz);
$('result-home').addEventListener('click', openStudent);
$('login').addEventListener('click', loginTeacher);
$('teacher-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginTeacher(); });
$('refresh').addEventListener('click', refreshReport);
$('logout').addEventListener('click', logoutTeacher);
$('download-csv').addEventListener('click', exportCsv);
['filter-class','filter-term','filter-mode','filter-unit'].forEach((id) => $(id).addEventListener('change', renderReport));


