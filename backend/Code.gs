// 스프레드시트 → 확장 프로그램 → Apps Script의 Code.gs에 전체 붙여넣기
// 비밀번호는 프로젝트 설정 → 스크립트 속성의 TEACHER_PASSWORD에만 입력합니다.
const TABLES_ = {
  math_classes: ['class_no','created_at','school_name'],
  math_attempts: ['id','class_no','student_no','term','mode','questions','answers','score','total','first_try_count','helped_count','revealed_count','wrong','created_at','completed_at','unit','school_name','deleted_at','delete_batch'],
  math_teacher_sessions: ['token_hash','expires_at','school_name']
};
const LEGACY_SCHOOL_='대구세천초등학교';
function schoolName_(value){
  if(typeof value!=='string')throw new Error('학교 이름을 입력해 주세요.');
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if(!/^[\p{L}\p{N} .()·-]{2,60}$/u.test(name))throw new Error('학교의 정식 이름을 2~60자로 입력해 주세요.');
  return name;
}
// 스프레드시트에 저장된 학교 식별자는 예전 입력 형식 때문에 숫자 등으로
// 읽힐 수 있습니다. 새 학생 입력의 엄격한 검증(schoolName_)과 달리,
// 기존 데이터 비교는 한 행이 잘못되어도 전체 교사 조회가 중단되지 않아야 합니다.
function schoolKey_(value){
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? '학교번호'+value : '';
  }
  if (typeof value !== 'string') return '';
  const name=value.normalize('NFKC').trim().replace(/\s+/g,' ');
  if (/^[1-9][0-9]*$/.test(name)) return '학교번호'+name;
  if (!/^[\p{L}\p{N} .()·-]{2,60}$/u.test(name)) return '';
  return name.replace(/\s/g,'').toLowerCase();
}
function legacySchool_(){return PropertiesService.getScriptProperties().getProperty('LEGACY_SCHOOL_NAME')||LEGACY_SCHOOL_;}
function doGet(e) {
  if(e && e.parameter && e.parameter.bridge==='1')return bridgeOutput_(e.parameter);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('반짝반짝 수학 탐험대')
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}
// 편집기에서 처음 한 번 실행합니다. 기존 기록을 삭제하거나 반환하지 않습니다.
function setup() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    let book;
    if (props.getProperty('SPREADSHEET_ID')) book = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
    else {
      book = SpreadsheetApp.getActiveSpreadsheet();
      if (!book) throw new Error('구글 스프레드시트의 확장 프로그램에서 이 프로젝트를 열어 주세요.');
      props.setProperty('SPREADSHEET_ID',book.getId());
    }
    Object.keys(TABLES_).forEach(name => {
      let sheet = book.getSheetByName(name);
      if (!sheet) sheet = book.insertSheet(name);
      if (!sheet.getLastRow()) { sheet.appendRow(TABLES_[name]); sheet.setFrozenRows(1); }
      validateSheet_(sheet,name);
    });
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
function validateSheet_(sheet,name) {
  if(!sheet)throw new Error(name+' 시트를 찾을 수 없습니다.');
  const expected=TABLES_[name],current=sheet.getRange(1,1,1,expected.length).getValues()[0];
  const length=current.findIndex(v=>v==='');
  if(length>0 && JSON.stringify(current.slice(0,length))===JSON.stringify(expected.slice(0,length)) && current.slice(length).every(v=>v===''))
    sheet.getRange(1,length+1,1,expected.length-length).setValues([expected.slice(length)]);
  if(JSON.stringify(sheet.getRange(1,1,1,expected.length).getValues()[0])!==JSON.stringify(expected))
    throw new Error(name+' 시트의 열 구성이 다릅니다. 기존 시트를 삭제하지 말고 확인해 주세요.');
}
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('선생님이 Apps Script 편집기에서 setup 함수를 먼저 실행해 주세요.');
  return SpreadsheetApp.openById(id);
}
function sheet_(book,name) { const s=book.getSheetByName(name); validateSheet_(s,name); return s; }
function rows_(sheet,name) {
  if (sheet.getLastRow()<2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,TABLES_[name].length).getValues().map((values,i) => {
    const r={_row:i+2}; TABLES_[name].forEach((key,j)=>r[key]=values[j]); return r;
  });
}
function write_(sheet,name,record,row) {
  const values=TABLES_[name].map(key=>record[key] === undefined || record[key] === null ? '' : record[key]);
  sheet.getRange(row || sheet.getLastRow()+1,1,1,values.length).setValues([values]);
}
// 응시 제출 시 문제·답안이 들어 있는 모든 행을 읽지 않고 ID 열만 검색합니다.
function attemptById_(sheet,id) {
  const last=sheet.getLastRow();
  if(last<2)return null;
  const ids=sheet.getRange(2,1,last-1,1).getValues();
  const index=ids.findIndex(values=>values[0]===id);
  if(index<0)return null;
  const row=index+2,values=sheet.getRange(row,1,1,TABLES_.math_attempts.length).getValues()[0];
  const record={_row:row};
  TABLES_.math_attempts.forEach((key,i)=>record[key]=values[i]);
  return record;
}
// 조회에는 채점 답안(G열)이 필요하지 않으므로 이 큰 열을 읽지 않습니다.
function reportRows_(sheet) {
  const n=sheet.getLastRow()-1;
  if(n<1)return [];
  const before=sheet.getRange(2,1,n,6).getValues();
  const after=sheet.getRange(2,8,n,12).getValues();
  return before.map((left,i)=>{
    const values=left.concat([''],after[i]),record={_row:i+2};
    TABLES_.math_attempts.forEach((key,j)=>record[key]=values[j]);
    return record;
  });
}
function teacherSession_(sheet,token) {
  const key='math-session-'+hash_(token);
  // 캐시는 최대 1시간만 저장하며 시트의 8시간 만료 시간보다 짧습니다.
  if(typeof CacheService!=='undefined'){
    const cached=CacheService.getScriptCache().get(key);
    if(cached)return {school_name:cached,cacheKey:key,_row:null};
  }
  const last=sheet.getLastRow();
  if(last<2)return null;
  const hashes=sheet.getRange(2,1,last-1,1).getValues();
  const index=hashes.findIndex(v=>v[0]===hash_(token));
  if(index<0)return null;
  const values=sheet.getRange(index+2,1,1,3).getValues()[0];
  const remaining=Date.parse(values[1])-Date.now();
  if(!(remaining>0))return null;
  if(typeof CacheService!=='undefined')CacheService.getScriptCache().put(key,String(values[2]||legacySchool_()),Math.min(3600,Math.floor(remaining/1000)));
  return {school_name:values[2],cacheKey:key,_row:index+2};
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8)
    .map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
}
function positive_(n) { return Number.isInteger(n) && n>0 && n<=2147483647; }
function summary_(r) {
  return {score:Number(r.score),total:Number(r.total),firstTryCount:Number(r.first_try_count),helpedCount:Number(r.helped_count),revealedCount:Number(r.revealed_count)};
}
// 공개 원격 호출은 이 함수만 사용합니다. 점수는 서버의 저장 문제로 다시 계산합니다.
function quizApi(request) {
  try {
    const payload = typeof request === 'string' ? JSON.parse(request) : request;
    return JSON.stringify(quizApi_(payload));
  } catch (e) {
    return JSON.stringify({ok:false,error:'요청 내용을 확인해 주세요.'});
  }
}
function quizApi_(p) {
  const action=p && p.action;
  // 조회는 변경 작업과 병렬로 처리해 교사 조회가 학생 시작·제출을 막지 않습니다.
  const needLock=!['teacherReport','teacherTrash','teacherDeletePreview'].includes(action);
  const lock=needLock?LockService.getScriptLock():null;
  if (needLock && !lock.tryLock(20000)) return {ok:false,error:'다른 친구의 기록을 저장 중이에요. 잠시 후 다시 눌러 주세요.'};
  try {
    if (!p || typeof p!=='object' || JSON.stringify(p).length>20000) throw new Error('요청 내용을 확인해 주세요.');
    const props=PropertiesService.getScriptProperties(), book=book_();
    let result={};
    switch(p.action) {
      case 'start': {
        if (!positive_(p.classNo)||!positive_(p.studentNo)||![1,2].includes(p.term)||!['add','sub','mix'].includes(p.mode)) throw new Error('반, 번호, 학기와 유형을 확인해 주세요.');
        const unit=p.unit===undefined?'all':String(p.unit);
        const info=unitInfo_(p.term,unit);
        if(!info)throw new Error('학기에 맞는 단원을 선택해 주세요.');
        const mode=info.arithmetic?p.mode:'mix';
        const school=schoolName_(p.schoolName===undefined?legacySchool_():p.schoolName);
        const classes=sheet_(book,'math_classes');
        if (!rows_(classes,'math_classes').some(r=>Number(r.class_no)===p.classNo&&schoolKey_(r.school_name||legacySchool_())===schoolKey_(school))) write_(classes,'math_classes',{school_name:school,class_no:p.classNo,created_at:new Date().toISOString()});
        const questions=generateQuestions_(p.term,mode,unit), id=Utilities.getUuid();
        write_(sheet_(book,'math_attempts'),'math_attempts',{id,school_name:school,class_no:p.classNo,student_no:p.studentNo,term:p.term,mode,unit,questions:JSON.stringify(questions),total:10,created_at:new Date().toISOString()});
        result={attemptId:id,questions,unit,unitLabel:info.name,schoolName:school}; break;
      }
      case 'submit': {
        if(typeof p.attemptId!=='string'||!/^[0-9a-f-]{36}$/i.test(p.attemptId)) throw new Error('응시 번호를 확인해 주세요.');
        const sheet=sheet_(book,'math_attempts');
        const r=attemptById_(sheet,p.attemptId);
        if (!r) throw new Error('응시 기록을 찾을 수 없어요.');
        if(r.deleted_at)throw new Error('선생님이 삭제한 응시 기록입니다. 처음 화면에서 다시 시작해 주세요.');
        if (r.completed_at) {result=summary_(r);break;}
        const g=grade_(JSON.parse(r.questions),p.answers);
        Object.assign(r,{answers:JSON.stringify(p.answers),score:g.score,first_try_count:g.firstTryCount,helped_count:g.helpedCount,revealed_count:g.revealedCount,wrong:JSON.stringify(g.wrong),completed_at:new Date().toISOString()});
        write_(sheet,'math_attempts',r,r._row); result=summary_(r);break;
      }
      case 'teacherLogin': {
        const password=props.getProperty('TEACHER_PASSWORD');
        if (!password) throw new Error('프로젝트 설정 → 스크립트 속성에 TEACHER_PASSWORD를 등록해 주세요.');
        if (typeof p.password!=='string'||hash_(password)!==hash_(p.password)) throw new Error('비밀번호가 맞지 않습니다.');
        const school=schoolName_(p.schoolName===undefined?legacySchool_():p.schoolName);
        const sheet=sheet_(book,'math_teacher_sessions');
        // 로그인 때 과거 세션을 모두 읽고 한 행씩 삭제하지 않아 로그인 속도를 높입니다.
        const token=Utilities.getUuid()+Utilities.getUuid();
        write_(sheet,'math_teacher_sessions',{school_name:school,token_hash:hash_(token),expires_at:new Date(Date.now()+8*3600000).toISOString()});
        if(typeof CacheService!=='undefined')CacheService.getScriptCache().put('math-session-'+hash_(token),school,3600);
        result={teacherToken:token,schoolName:school};break;
      }
      case 'teacherDeletePreview':
      case 'teacherDelete':
      case 'teacherTrash':
      case 'teacherRestore':
      case 'teacherReport':
      case 'teacherLogout': {
        if(typeof p.teacherToken!=='string'||p.teacherToken.length!==72) throw new Error('선생님 비밀번호로 다시 로그인해 주세요.');
        const sheet=sheet_(book,'math_teacher_sessions');
        const session=teacherSession_(sheet,p.teacherToken);
        if(!session) throw new Error('로그인 시간이 지났어요. 다시 로그인해 주세요.');
        const school=session.school_name||legacySchool_();
        if(p.action==='teacherLogout') {
          if(typeof CacheService!=='undefined')CacheService.getScriptCache().remove(session.cacheKey);
          // 캐시 조회만으로 행 번호를 얻을 수 없으므로 실제 해시 열에서 찾아 삭제합니다.
          const last=sheet.getLastRow();
          if(last>=2){
            const hashes=sheet.getRange(2,1,last-1,1).getValues();
            const index=hashes.findIndex(v=>v[0]===hash_(p.teacherToken));
            if(index>=0)sheet.deleteRow(index+2);
          }
          break;
        }
        const attemptSheet=sheet_(book,'math_attempts');
        const schoolRows=rows_(attemptSheet,'math_attempts').filter(r=>schoolKey_(r.school_name||legacySchool_())===schoolKey_(school));
        if(p.action==='teacherDeletePreview'||p.action==='teacherDelete'){
          const targets=deleteTargets_(schoolRows,p);
          const previewHash=hash_(JSON.stringify(targets.map(r=>[r.id,r.completed_at||'']).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))));
          const completed=targets.filter(r=>r.completed_at).length;
          if(p.action==='teacherDeletePreview'){
            result={schoolName:school,classNo:Number(targets[0].class_no),studentNo:Number(targets[0].student_no),count:targets.length,completedCount:completed,inProgressCount:targets.length-completed,previewHash};break;
          }
          if(typeof p.previewHash!=='string'||p.previewHash!==previewHash)throw new Error('기록이 바뀌었습니다. 다시 삭제할 내용을 확인해 주세요.');
          const batch=Utilities.getUuid(),now=new Date().toISOString();
          targets.forEach(r=>attemptSheet.getRange(r._row,TABLES_.math_attempts.indexOf('deleted_at')+1,1,2).setValues([[now,batch]]));
          result={deletedCount:targets.length,batchId:batch};break;
        }
        if(p.action==='teacherTrash'){
          const groups=new Map();
          schoolRows.filter(r=>r.deleted_at&&r.delete_batch).forEach(r=>{
            let group=groups.get(r.delete_batch);
            if(!group){group={batchId:String(r.delete_batch),schoolName:school,classNo:Number(r.class_no),studentNo:Number(r.student_no),count:0,deletedAt:String(r.deleted_at)};groups.set(r.delete_batch,group);}
            group.count++;
          });
          result={batches:[...groups.values()].sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt)||a.batchId.localeCompare(b.batchId))};break;
        }
        if(p.action==='teacherRestore'){
          if(typeof p.batchId!=='string'||!/^[0-9a-f-]{36}$/i.test(p.batchId))throw new Error('복구할 기록을 확인해 주세요.');
          const targets=schoolRows.filter(r=>r.deleted_at&&r.delete_batch===p.batchId);
          if(!targets.length)throw new Error('이미 복구되었거나 복구할 기록을 찾을 수 없습니다.');
          targets.forEach(r=>attemptSheet.getRange(r._row,TABLES_.math_attempts.indexOf('deleted_at')+1,1,2).setValues([['','']]));
          result={restoredCount:targets.length};break;
        }
        const offset=p.offset===undefined?0:p.offset;
        if(!Number.isSafeInteger(offset)||offset<0) throw new Error('조회 위치를 확인해 주세요.');
        // 응시 시작 행의 상한을 고정해 조회 도중 새 응시가 끼어들지 않게 합니다.
        const attempts=sheet_(book,'math_attempts');
        const snapshot=p.snapshot || {lastRow:attempts.getLastRow(),at:new Date().toISOString()};
        if(!Number.isInteger(snapshot.lastRow)||snapshot.lastRow<1||!Number.isFinite(Date.parse(snapshot.at))) throw new Error('조회 기준을 확인해 주세요.');
        const all=reportRows_(attempts).filter(r=>schoolKey_(r.school_name||legacySchool_())===schoolKey_(school)&&!r.deleted_at&&r._row<=snapshot.lastRow&&r.completed_at&&String(r.completed_at)<=snapshot.at)
          .sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at))||String(b.id).localeCompare(String(a.id)));
        const records=all.slice(offset,offset+500).map(r=>({id:r.id,school_name:r.school_name||legacySchool_(),class_no:Number(r.class_no),student_no:Number(r.student_no),term:Number(r.term),mode:r.mode,unit:r.unit||'legacy',oldScope:oldScope_(r),score:Number(r.score),total:Number(r.total),first_try_count:Number(r.first_try_count),helped_count:Number(r.helped_count),revealed_count:Number(r.revealed_count),wrong:JSON.parse(r.wrong||'[]'),completed_at:String(r.completed_at)}));
        result={schoolName:school,records,classes:[...new Set(rows_(sheet_(book,'math_classes'),'math_classes').filter(r=>schoolKey_(r.school_name||legacySchool_())===schoolKey_(school)).map(r=>Number(r.class_no)))].sort((a,b)=>a-b),nextOffset:offset+500<all.length?offset+500:null,snapshot}; break;
      }
      default: throw new Error('알 수 없는 요청입니다.');
    }
    if(needLock)SpreadsheetApp.flush();
    return Object.assign({ok:true},result);
  } catch(e) { return {ok:false,error:e.message||'저장하지 못했어요. 다시 시도해 주세요.'}; }
  finally {if(needLock)lock.releaseLock();}
}

const rand_ = (min        , max        ) => min + Math.floor(Math.random() * (max - min + 1));
const shuffle_ =    (items     )      => {
  for (let i = items.length - 1; i > 0; i--) { const j = rand_(0, i); [items[i], items[j]] = [items[j], items[i]]; }
  return items;
};
const correctAnswer_ = (q          ) => q.answer !== undefined ? q.answer : q.operator === '+' ? q.a + q.b + (q.c ?? 0) : q.a - q.b - (q.c ?? 0);
function legacyGenerateQuestions_(term        , mode        )             {
  const operators = mode === 'mix' ? shuffle_(Array(5).fill('+').concat(Array(5).fill('-'))) : Array(10).fill(mode === 'add' ? '+' : '-');
  return operators.map((operator, i) => {
    let a        , b        , c                = null, type        ;
    if (term === 1) {
      if (operator === '+') { a = rand_(0, 9); b = rand_(0, 9 - a); type = 'smallAdd'; }
      else { a = rand_(1, 9); b = rand_(0, a); type = 'smallSub'; }
    } else {
      const kind = i % 4;
      if (kind === 0) {
        if (operator === '+') { a = rand_(1, 9); b = 10 - a; type = 'tenAdd'; }
        else { a = 10; b = rand_(0, 10); type = 'tenSub'; }
      } else if (kind === 1) {
        if (operator === '+') { a = rand_(2, 9); b = rand_(11 - a, 9); type = 'carryAdd'; }
        else { a = rand_(11, 18); b = rand_(a - 9, 9); type = 'borrowSub'; }
      } else if (kind === 2) {
        if (operator === '+') { a = rand_(1, 7) * 10 + rand_(0, 9); b = rand_(0, 9 - a % 10); type = 'noCarryAdd'; }
        else { a = rand_(1, 9) * 10 + rand_(0, 9); b = rand_(0, a % 10); type = 'noBorrowSub'; }
      } else {
        if (operator === '+') { a = rand_(1, 7); b = rand_(1, 9 - a); c = rand_(0, 10 - a - b); type = 'threeAdd'; }
        else { a = rand_(3, 10); b = rand_(1, a - 1); c = rand_(0, a - b); type = 'threeSub'; }
      }
    }
    const q           = { a, b, c, operator, type, expression: `${a} ${operator} ${b}${c === null ? '' : ` ${operator} ${c}`} = ?`, story: operator === '+' ? '수를 모두 모으면 얼마일까요?' : '수를 빼면 얼마가 남을까요?', choices: [] };
    const correct = correctAnswer_(q), choices = new Set([correct]);
    while (choices.size < 4) choices.add(rand_(Math.max(0, correct - 4), correct + 4));
    q.choices = shuffle_([...choices]);
    return q;
  });
}
function grade_(questions            , answers       ) {
  if (!Array.isArray(answers) || answers.length !== questions.length) throw new Error('모든 문제를 풀어 주세요.');
  let firstTryCount = 0, helpedCount = 0, revealedCount = 0;
  const wrong        = [];
  questions.forEach((q, i) => {
    const entry = answers[i], correct = correctAnswer_(q);
    if (!entry || !q.choices.includes(entry.first)) throw new Error('선택한 답을 확인해 주세요.');
    if (entry.first === correct) {
      if (entry.second !== null) throw new Error('답안 형식이 올바르지 않아요.');
      firstTryCount++;
    } else {
      if (!q.choices.includes(entry.second) || entry.second === entry.first) throw new Error('힌트를 보고 다른 답을 골라 주세요.');
      const recovered = entry.second === correct;
      if (recovered) helpedCount++; else revealedCount++;
      wrong.push({ expression: q.expression, chosen: entry.first, second: entry.second, answer: correct, hintShown: true, recovered });
    }
  });
  return { score: firstTryCount + helpedCount, total: questions.length, firstTryCount, helpedCount, revealedCount, wrong };
}

// 단원별 출제 범위. 'all'은 해당 학기의 덧셈·뺄셈 전체 복습입니다.
const UNITS_ = {
  1: [
    {id:'1',name:'1. 9까지의 수',detail:'9까지 세기 · 수의 순서 · 크기'},
    {id:'2',name:'2. 여러 가지 모양',detail:'상자 모양 · 둥근기둥 모양 · 공 모양'},
    {id:'3',name:'3. 덧셈과 뺄셈',detail:'한 자리 수 · 합이 9 이하인 계산',arithmetic:true},
    {id:'4',name:'4. 비교하기',detail:'길이 · 높이 · 넓이 · 양 · 무게'},
    {id:'5',name:'5. 50까지의 수',detail:'50까지의 수 · 10개씩 묶음 · 순서'}
  ],
  2: [
    {id:'1',name:'1. 100까지의 수',detail:'60~99 · 수의 순서와 크기 · 짝수와 홀수'},
    {id:'2',name:'2. 덧셈과 뺄셈(1)',detail:'세 수 계산 · 10이 되는 더하기 · 10에서 빼기 · 10 만들어 더하기',arithmetic:true},
    {id:'3',name:'3. 모양과 시각',detail:'네모 · 세모 · 동그라미 · 몇 시 · 몇 시 30분'},
    {id:'4',name:'4. 덧셈과 뺄셈(2)',detail:'한 자리 수끼리 받아올림 덧셈 · 십몇에서 받아내림 뺄셈',arithmetic:true},
    {id:'5',name:'5. 규칙 찾기',detail:'모양 반복 · 수의 규칙'},
    {id:'6',name:'6. 덧셈과 뺄셈(3)',detail:'받아올림·받아내림 없는 두 자리 수 덧셈과 뺄셈',arithmetic:true}
  ]
};
function unitInfo_(term,unit) {
  if(unit==='all') return {id:'all',name:'덧셈·뺄셈 전체 복습',arithmetic:true};
  return (UNITS_[term]||[]).find(u=>u.id===String(unit));
}
function numericQuestion_(type,expression,story,answer,hint,solution,visual,min=0,max=104) {
  const choices=new Set([answer]);
  const low=Math.max(min,answer-4),high=Math.min(max,Math.max(answer+4,low+3));
  while(choices.size<4) choices.add(rand_(low,high));
  return {type,expression,story,answer,hint,solution,visual:visual||null,choices:shuffle_([...choices])};
}
function wordQuestion_(type,expression,story,answer,choices,hint,solution,visual) {
  return {type,expression,story,answer,choices:shuffle_([...choices]),hint,solution,visual:visual||null};
}
function numberQuestion_(term,unit,index) {
  const max=term===1&&unit==='1'?9:term===1?50:100;
  if(term===2&&index%6===4){
    const even=rand_(0,1)===0,answer=rand_(1,49)*2+(even?0:1),choices=new Set([answer]);
    while(choices.size<4)choices.add(rand_(1,49)*2+(even?1:0));
    return {type:'parity',expression:even?'짝수를 골라요.':'홀수를 골라요.',story:'둘씩 짝을 지어 생각해 보세요.',answer,choices:shuffle_([...choices]),hint:'둘씩 짝을 지어 남는 것이 없으면 짝수, 하나 남으면 홀수예요.',solution:`${answer}은(는) 둘씩 짝을 지으면 ${even?'남는 것이 없으므로 짝수':'하나 남으므로 홀수'}예요.`};
  }
  if(term===2&&index%6===5){
    const n=rand_(6,9)*10,labels=['예순(육십)','일흔(칠십)','여든(팔십)','아흔(구십)'];
    return wordQuestion_('numberReading',`${n}을 어떻게 읽을까요?`,'수를 읽어 보세요.',labels[n/10-6],labels,'10개씩 묶음이 몇 개인지 생각해 보세요.',`${n}은(는) 10개씩 묶음 ${n/10}개이고, ${labels[n/10-6]}이라고 읽어요.`);
  }
  const kind=index%4;
  if(max===9&&kind===0) {
    const count=rand_(1,9),symbols=['🍎','⭐','🌼','🍓'];
    return numericQuestion_('count','모두 몇 개일까요?','하나씩 짚어 가며 세어 보세요.',count,
      '맨 왼쪽부터 하나씩 짚으며 하나, 둘, 셋 하고 세어 보세요.',
      `그림을 하나씩 세면 모두 ${count}개예요.`,{kind:'count',count,symbol:symbols[rand_(0,3)]},1,9);
  }
  if(kind===1) {
    const n=rand_(2,max-1);
    return numericQuestion_('sequence',`${n-1}, □, ${n+1}`,'빈칸에 들어갈 수를 골라요.',n,
      '수를 하나씩 크게 하며 차례대로 읽어 보세요.',`${n-1} 다음은 ${n}, 그다음은 ${n+1}이에요.`,null,1,max);
  }
  if(max>9&&kind===0) {
    const n=rand_(10,max),tens=Math.floor(n/10),ones=n%10;
    return numericQuestion_('bundles','모두 얼마일까요?',`10개씩 묶음 ${tens}개와 낱개 ${ones}개가 있어요.`,n,
      '큰 묶음은 하나가 10이에요. 묶음을 먼저 세고 낱개를 이어 세어 보세요.',
      `묶음 ${tens}개는 ${tens*10}이에요. 낱개 ${ones}개를 이어 세면 ${n}이에요.`,{kind:'bundles',tens,ones},1,max);
  }
  if(kind===2) {
    const choices=new Set();while(choices.size<4)choices.add(rand_(1,max));
    const values=[...choices],largest=rand_(0,1)===1,answer=largest?Math.max(...values):Math.min(...values);
    return {type:'compareNumbers',expression:largest?'가장 큰 수는?':'가장 작은 수는?',story:'네 수를 비교해 보세요.',answer,choices:shuffle_(values),
      hint:max===9?'하나부터 차례로 세어 보세요. 나중에 세는 수가 더 커요.':'10개씩 묶음 수를 먼저 비교하고, 같으면 낱개 수를 비교해요.',
      solution:`작은 수부터 놓으면 ${[...values].sort((a,b)=>a-b).join(', ')}이에요. ${largest?'가장 큰':'가장 작은'} 수는 ${answer}이에요.`};
  }
  const n=rand_(max===9?2:1,max-1),after=rand_(0,1)===1,answer=after?n+1:n-1;
  return numericQuestion_('beforeAfter',`${n} 바로 ${after?'뒤':'앞'}의 수는?`,'수의 순서를 생각해 보세요.',answer,
    after?'수를 세며 바로 다음에 말하는 수를 생각해 보세요.':'수를 거꾸로 세며 바로 앞의 수를 생각해 보세요.',
    `${n-1}, ${n}, ${n+1} 순서예요. ${n} 바로 ${after?'뒤':'앞'}의 수는 ${answer}이에요.`,null,max===9?1:0,max);
}
function solidQuestion_() {
  const kind=['box','cylinder','ball'][rand_(0,2)];
  const info={box:{name:'상자 모양',right:['책','지우개','과자 상자','주사위'],wrong:['축구공','구슬','음료수 캔'],hint:'평평한 면과 뾰족한 모서리가 있는지 살펴보세요.'},
    cylinder:{name:'둥근기둥 모양',right:['음료수 캔','휴지 심','원기둥 블록'],wrong:['주사위','축구공','책'],hint:'위와 아래가 둥글고 옆면이 굽어 있는지 살펴보세요.'},
    ball:{name:'공 모양',right:['축구공','구슬','농구공'],wrong:['주사위','책','음료수 캔'],hint:'어느 쪽으로도 둥글게 굴러가는 모양을 찾아보세요.'}}[kind];
  const answer=info.right[rand_(0,info.right.length-1)];
  return wordQuestion_('solid','같은 모양의 물건은?','그림의 모양과 닮은 물건을 골라요.',answer,[answer,...info.wrong],info.hint,
    `그림은 ${info.name}이에요. ${answer}도 ${info.name}과 닮았어요.`,{kind:'solid',shape:kind});
}
function comparisonQuestion_(index) {
  if(index%5===4) {
    const heavier=rand_(0,1)===0?'가':'나';
    return wordQuestion_('weight','더 무거운 물건은?','저울의 내려간 쪽을 살펴보세요.',heavier,['가','나','무게가 같아요','알 수 없어요'],
      '저울에서는 더 무거운 물건을 올린 쪽이 아래로 내려가요.',`저울에서 ${heavier} 쪽이 더 내려가 있어요. 그래서 ${heavier}가 더 무거워요.`,{kind:'balance',heavier});
  }
  const kind=['length','height','area','amount'][index%5],values=shuffle_([35,55,75,95]),largest=rand_(0,1)===1;
  const names=['가','나','다','라'],target=largest?Math.max(...values):Math.min(...values),answer=names[values.indexOf(target)];
  const phrases={length:['가장 긴 것은?','가장 짧은 것은?','막대의 왼쪽 끝을 맞추고 오른쪽 끝을 비교해요.'],height:['가장 높은 것은?','가장 낮은 것은?','아래쪽을 맞추고 꼭대기의 높이를 비교해요.'],area:['가장 넓은 것은?','가장 좁은 것은?','가로와 세로를 살펴보고 차지한 자리를 비교해요.'],amount:['물이 가장 많은 컵은?','물이 가장 적은 컵은?','크기가 같은 컵에서 물의 높이를 비교해요.']}[kind];
  return wordQuestion_('comparison',phrases[largest?0:1],'가, 나, 다, 라를 비교해 보세요.',answer,names,phrases[2],
    `${phrases[2]} 이 기준으로 네 그림을 비교하면 정답은 ‘${answer}’예요.`,{kind:'comparison',compare:kind,values});
}
function shapeTimeQuestion_(index) {
  if(index%4===2){
    const triangle=rand_(0,1)===0,answer=triangle?'세모':'네모',count=triangle?3:4;
    return wordQuestion_('shapeProperty','어떤 모양일까요?',`곧은 선 ${count}개로 둘러싸여 있고, 뾰족한 곳이 ${count}개 있어요.`,answer,['네모','세모','동그라미','공 모양'],'모양의 곧은 선과 뾰족한 곳을 하나씩 세어 보세요.',`곧은 선 ${count}개와 뾰족한 곳 ${count}개가 있는 모양은 ${answer}예요.`);
  }
  if(index%2===0) {
    const shapes=['square','triangle','circle'],shape=shapes[rand_(0,2)],counts=shuffle_([1,2,3,4]);
    const labels={square:'네모',triangle:'세모',circle:'동그라미'},answer=counts[shapes.indexOf(shape)];
    const symbols=shuffle_(shapes.flatMap((s,i)=>Array(counts[i]).fill(s)));
    return numericQuestion_('flatCount',`${labels[shape]}는 몇 개일까요?`,'찾는 모양만 하나씩 세어 보세요.',answer,
      `${labels[shape]}와 다른 모양을 구별하고, 같은 모양만 짚어 세어 보세요.`,`${labels[shape]} 모양만 골라 세면 ${answer}개예요.`,{kind:'flatShapes',shapes:symbols},0,7);
  }
  const hour=rand_(1,12),minute=rand_(0,1)*30,answer=`${hour}시${minute?' 30분':''}`;
  const choices=new Set([answer,`${hour}시${minute?'':' 30분'}`]);
  while(choices.size<4)choices.add(`${rand_(1,12)}시${rand_(0,1)?' 30분':''}`);
  return wordQuestion_('clock','몇 시일까요?','짧은 바늘과 긴 바늘을 살펴보세요.',answer,[...choices],
    '짧은 바늘로 시를 읽어요. 긴 바늘이 12에 있으면 몇 시, 6에 있으면 몇 시 30분이에요.',
    `긴 바늘이 ${minute?'6':'12'}을 가리켜요. 짧은 바늘은 ${minute?`${hour}와 ${hour===12?1:hour+1} 사이`:`${hour}`}에 있어요. 그래서 ${answer}예요.`,{kind:'clock',hour,minute});
}
function patternQuestion_(index) {
  if(index%3===2){
    const start=rand_(0,7)*10+1,missing=rand_(0,14),answer=start+Math.floor(missing/5)*10+missing%5;
    return numericQuestion_('numberGrid','수 배열표의 빈칸은?','가로와 세로로 수가 어떻게 바뀌는지 살펴보세요.',answer,'오른쪽으로 한 칸 가면 1, 아래로 한 칸 가면 10이 커져요.',`오른쪽으로 1씩, 아래로 10씩 커지는 규칙이에요. 빈칸의 수는 ${answer}예요.`,{kind:'numberGrid',start,missing},1,99);
  }
  if(index%2===0) {
    const pool=shuffle_(['●','▲','■','★']),len=rand_(2,3),pattern=pool.slice(0,len),position=rand_(4,7),answer=pattern[position%len];
    return wordQuestion_('pattern',Array.from({length:position},(_,i)=>pattern[i%len]).join('  ')+'  □','빈칸에 이어질 모양을 골라요.',answer,['●','▲','■','★'],
      '처음부터 같은 순서로 되풀이되는 모양 묶음을 찾아보세요.',`${pattern.join(' → ')} 순서가 되풀이돼요. 다음 모양은 ${answer}예요.`);
  }
  const step=[1,2,5,10][rand_(0,3)],descending=rand_(0,1)===1,start=descending?rand_(4*step,100):rand_(1,100-4*step),delta=descending?-step:step;
  const seq=Array.from({length:4},(_,i)=>start+i*delta),answer=start+4*delta;
  return numericQuestion_('numberPattern',seq.join(', ')+', □','수가 어떻게 바뀌는지 살펴보세요.',answer,
    '바로 옆의 수끼리 비교하고, 같은 만큼 커지는지 작아지는지 생각해 보세요.',
    `${step}씩 ${descending?'작아지는':'커지는'} 규칙이에요. ${seq[3]} 다음은 ${answer}이에요.`,null,0,100);
}
function arithmeticQuestion_(term,unit,operator,index) {
  let a,b,c=null,type,hint='',solution='';
  if(term===1) {
    a=operator==='+'?rand_(0,9):rand_(1,9);b=rand_(0,operator==='+'?9-a:a);type=operator==='+'?'smallAdd':'smallSub';
  } else if(unit==='2') {
    if(operator==='+'){
      if(index%3===0){a=rand_(1,6);b=rand_(1,8-a);c=rand_(1,9-a-b);type='threeAdd';}
      else if(index%3===1){a=rand_(1,9);b=10-a;type='tenAdd';}
      else {a=rand_(1,9);b=10-a;c=rand_(1,9);if(index%2)[a,c]=[c,a];type='threeAdd';
        const pair=a+b===10?`${a} + ${b}`:`${b} + ${c}`,remaining=a+b===10?c:a;
        hint='먼저 더해서 10이 되는 두 수를 찾아보세요.';solution=`① ${pair} = 10이에요. ② 남은 ${remaining}을(를) 더하면 10 + ${remaining} = ${10+remaining}이에요.`;}
    }else{
      if(index%2===0){a=rand_(3,9);b=rand_(1,a-2);c=rand_(1,a-b);type='threeSub';}
      else{a=10;b=rand_(1,9);type='tenSub';}
    }
  } else if(unit==='4') {
    if(operator==='+'){
      a=rand_(2,9);b=rand_(11-a,9);type='carryAdd';const part=10-a;
      hint='앞의 수에 얼마를 더하면 10이 될까요? 뒤의 수를 가르세요.';
      solution=`① ${b}을(를) ${part}와 ${b-part}(으)로 가르세요. ② ${a} + ${part} = 10이에요. ③ 10 + ${b-part} = ${a+b}이에요.`;
    }else{
      a=rand_(11,18);b=rand_(a-9,9);type='borrowSub';const part=a-10;
      hint='십몇을 10과 낱개로 가르고, 10에서 먼저 빼 보세요.';
      solution=`① ${a}을(를) 10과 ${part}(으)로 가르세요. ② 10 - ${b} = ${10-b}이에요. ③ ${10-b} + ${part} = ${a-b}이에요.`;
    }
  } else {
    const tens=rand_(1,8),ones=rand_(0,8);a=tens*10+ones;
    if(operator==='+') {b=index%3===0?rand_(1,9-ones):rand_(1,9-tens)*10+rand_(0,9-ones);type='noCarryAdd';}
    else {b=index%3===0?rand_(0,ones):rand_(1,tens)*10+rand_(0,ones);type='noBorrowSub';}
  }
  const answer=operator==='+'?a+b+(c||0):a-b-(c||0);
  const q=numericQuestion_(type,`${a} ${operator} ${b}${c===null?'':` ${operator} ${c}`} = ?`,operator==='+'?'수를 모두 모으면 얼마일까요?':'수를 빼면 얼마가 남을까요?',answer,hint,solution,null,0,99);
  return Object.assign(q,{a,b,c,operator});
}
function generateQuestions_(term,mode,unit='all') {
  const info=unitInfo_(term,unit);if(!info)throw new Error('학기에 맞는 단원을 선택해 주세요.');
  if(unit==='all')return legacyGenerateQuestions_(term,mode);
  const operators=mode==='mix'?shuffle_(Array(5).fill('+').concat(Array(5).fill('-'))):Array(10).fill(mode==='add'?'+':'-');
  const used={'+':0,'-':0};
  return Array.from({length:10},(_,i)=>{
    let q;
    if(info.arithmetic)q=arithmeticQuestion_(term,unit,operators[i],used[operators[i]]++);
    else if(term===1&&unit==='2')q=solidQuestion_();
    else if(term===1&&unit==='4')q=comparisonQuestion_(i);
    else if(term===2&&unit==='3')q=shapeTimeQuestion_(i);
    else if(term===2&&unit==='5')q=patternQuestion_(i);
    else q=numberQuestion_(term,unit,i);
    q.unit=unit;q.curriculumVersion='2022-20261019';return q;
  });
}

// Older completed attempts remain untouched; only their report label is clarified.
function oldScope_(r){
  if(Number(r.term)!==2||!['2','4','6'].includes(String(r.unit)))return false;
  try{return !JSON.parse(r.questions||'[]')[0]?.curriculumVersion;}catch(e){return true;}
}

// The bridge has no controls and accepts messages only from the configured Pages origin.
function bridgeOutput_(p){
  const origin=String(p.parentOrigin||''),nonce=String(p.nonce||'');
  const configured=PropertiesService.getScriptProperties().getProperty('PAGES_ORIGINS')||'https://t1ssueJung.github.io,http://127.0.0.1:4173';
  const allowed=configured.split(',').map(v=>v.trim().toLowerCase());
  if(!allowed.includes(origin.toLowerCase())||!/^https?:\/\/[a-z0-9.:-]+$/i.test(origin)||!/^[a-f0-9]{32}$/.test(nonce))
    return HtmlService.createHtmlOutput('허용되지 않은 연결입니다.');
  const script=`(function(){
    'use strict';
    const origin=${JSON.stringify(origin)},nonce=${JSON.stringify(nonce)};
    const send=data=>window.top.postMessage(Object.assign({channel:'math-school-v1',nonce},data),origin);
    window.addEventListener('message',event=>{
      const m=event.data;
      if(event.source!==window.top||event.origin!==origin||!m||m.channel!=='math-school-v1'||m.nonce!==nonce||m.kind!=='request'||typeof m.id!=='string'||m.id.length>80||typeof m.payload!=='string'||m.payload.length>20000)return;
      google.script.run.withSuccessHandler(raw=>send({kind:'response',id:m.id,raw}))
        .withFailureHandler(()=>send({kind:'response',id:m.id,raw:JSON.stringify({ok:false,error:'기록 서버에 연결하지 못했어요. 다시 시도해 주세요.'})})).quizApi(m.payload);
    });
    send({kind:'ready'});
  })();`;
  return HtmlService.createHtmlOutput('<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><script>'+script+'</script></body></html>')
    .setTitle('수학 학습 기록 연결').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Targets are derived from the authenticated school, never a browser-supplied school name.
function deleteTargets_(schoolRows,p){
  let targets;
  if(p.scope==='record'){
    if(typeof p.attemptId!=='string'||!/^[0-9a-f-]{36}$/i.test(p.attemptId))throw new Error('삭제할 응시 기록을 확인해 주세요.');
    targets=schoolRows.filter(r=>!r.deleted_at&&r.id===p.attemptId);
  }else if(p.scope==='student'){
    if(!positive_(p.classNo)||!positive_(p.studentNo))throw new Error('삭제할 학생의 반과 번호를 확인해 주세요.');
    targets=schoolRows.filter(r=>!r.deleted_at&&Number(r.class_no)===p.classNo&&Number(r.student_no)===p.studentNo);
  }else throw new Error('삭제할 범위를 확인해 주세요.');
  if(!targets.length)throw new Error('삭제할 기록이 없습니다. 새로고침 후 확인해 주세요.');
  return targets;
}
