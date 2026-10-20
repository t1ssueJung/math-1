const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('crypto');
const {JSDOM}=require('jsdom');
const root=__dirname+'/../backend/';
class Sheet {
 constructor(){this.rows=[];}
 getLastRow(){return this.rows.length;}
 appendRow(r){this.rows.push([...r]);}
 setFrozenRows(){}
 deleteRow(r){this.rows.splice(r-1,1);}
 getRange(r,c,n,m){return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[r+i-1]?.[c+j-1]??'')),setValues:v=>{v.forEach((row,i)=>{this.rows[r+i-1]??=[]; row.forEach((x,j)=>this.rows[r+i-1][c+j-1]=x);});}};}
}
const sheets={},props={TEACHER_PASSWORD:'test-only'},book={getId:()=> 'local-test',getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet()};
const cache=new Map();
const cacheService={getScriptCache:()=>({get:key=>cache.get(key)||null,put:(key,value)=>cache.set(key,String(value)),remove:key=>cache.delete(key)})};
const context=vm.createContext({console,Date,Math,JSON,Number,String,Array,Set,Error,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
 SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:()=>book,flush:()=>{}},
 CacheService:cacheService,
 LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})},
 Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}
});
vm.runInContext(fs.readFileSync(root+'Code.gs','utf8'),context);
context.setup();context.setup();
const call=p=>JSON.parse(context.quizApi(typeof p === "string" ? p : JSON.stringify(p)));
const right=q=>q.answer!==undefined?q.answer:q.operator==='+'?q.a+q.b+(q.c??0):q.a-q.b-(q.c??0);
const answerSet=qs=>qs.map((q,i)=>{const a=right(q),b=q.choices.filter(x=>x!==a);return {first:i%3===0?a:b[0],second:i%3===0?null:i%3===1?a:b[1]};});
assert.equal(call({action:'teacherReport'}).ok,false);
assert.equal(call({action:'teacherLogin',password:'bad'}).ok,false);
for(const term of [1,2])for(const mode of ['add','sub','mix']){
 const start=call({action:'start',classNo:term,studentNo:1,term,mode});assert.equal(start.ok,true);assert.equal(start.questions.length,10);
 start.questions.forEach(q=>{assert.equal(new Set(q.choices).size,4);assert.ok(q.choices.includes(right(q)));});
 const done=call({action:'submit',attemptId:start.attemptId,answers:answerSet(start.questions),score:999});
 assert.deepEqual([done.score,done.firstTryCount,done.helpedCount,done.revealedCount],[7,4,3,3]);
 assert.equal(call({action:'submit',attemptId:start.attemptId,answers:[]}).score,7);
}
const before=JSON.stringify(sheets.math_attempts.rows);context.setup();assert.equal(JSON.stringify(sheets.math_attempts.rows),before);
const login=call({action:'teacherLogin',password:'test-only'});
assert.equal(call({action:'teacherReport',teacherToken:login.teacherToken}).records.length,6);
assert.ok(!JSON.stringify(sheets.math_teacher_sessions.rows).includes(login.teacherToken));
call({action:'teacherLogout',teacherToken:login.teacherToken});assert.equal(call({action:'teacherReport',teacherToken:login.teacherToken}).ok,false);
console.log('PASS: six modes, server grading, retry, sheet preservation, authentication, reports and logout');
for(const term of [1,2])for(let unit=1;unit<=(term===1?5:6);unit++)for(const mode of ['add','sub','mix'])for(let repeat=0;repeat<30;repeat++){
 const qs=context.generateQuestions_(term,mode,String(unit));
 assert.equal(qs.length,10);
 for(const q of qs){
  assert.equal(q.unit,String(unit));assert.equal(new Set(q.choices).size,4);assert.ok(q.choices.includes(right(q)));
  if(q.type==='flatCount'){const shape={ネモ:'square'};const label=q.expression.split('는')[0];const target={'네모':'square','세모':'triangle','동그라미':'circle'}[label];assert.equal(q.answer,q.visual.shapes.filter(s=>s===target).length);}
  if(q.type==='numberGrid')assert.equal(q.answer,q.visual.start+Math.floor(q.visual.missing/5)*10+q.visual.missing%5);
  if(q.type==='parity')assert.equal(q.answer%2,q.expression.startsWith('짝수')?0:1);
  if(q.type==='clock')assert.equal(q.answer,`${q.visual.hour}시${q.visual.minute?' 30분':''}`);
  if(q.operator){
   if(mode!=='mix')assert.equal(q.operator,mode==='add'?'+':'-');
   if(term===1)assert.ok(right(q)>=0&&right(q)<=9);
   if(term===2&&unit===6){assert.equal(q.c,null);if(q.operator==='+')assert.ok(q.a%10+q.b%10<10&&right(q)<100);else assert.ok(q.a%10>=q.b%10&&right(q)>=0);}
   if(term===2&&unit===2){assert.ok(right(q)>=0&&right(q)<=19);assert.ok(['threeAdd','threeSub','tenAdd','tenSub'].includes(q.type));if(q.c!==null&&right(q)>10)assert.ok(q.a+q.b===10||q.b+q.c===10);}
   if(term===2&&unit===4){if(q.operator==='+')assert.ok(q.a<10&&q.b<10&&right(q)>10);else assert.ok(q.a>10&&right(q)<10&&right(q)>=0);}
  }else{assert.ok(q.hint&&q.solution);assert.ok(!['carryAdd','borrowSub','noCarryAdd','noBorrowSub','threeAdd','threeSub'].includes(q.type));}
 }
 const g=context.grade_(qs,answerSet(qs));assert.deepEqual([g.score,g.firstTryCount,g.helpedCount,g.revealedCount],[7,4,3,3]);
}
assert.equal(call({action:'start',classNo:1,studentNo:1,term:1,mode:'mix',unit:'6'}).ok,false);
assert.equal(context.oldScope_({term:2,unit:'2',questions:'[{"a":32,"b":15}]'}),true);
assert.equal(context.oldScope_({term:2,unit:'2',questions:JSON.stringify(context.generateQuestions_(2,'mix','2'))}),false);
assert.equal(context.oldScope_({term:1,unit:'3',questions:'[]'}),false);
for(const unit of ['2','4','6']){
 const types=new Set(context.generateQuestions_(2,'mix',unit).map(q=>q.type));
 if(unit==='2')for(const type of ['threeAdd','threeSub','tenAdd','tenSub'])assert.ok(types.has(type));
 if(unit==='4')assert.deepEqual([...types].sort(),['borrowSub','carryAdd']);
 if(unit==='6')assert.deepEqual([...types].sort(),['noBorrowSub','noCarryAdd']);
}
const originalRows=JSON.stringify(sheets.math_attempts.rows.slice(1));
sheets.math_attempts.rows[0].pop();context.setup();assert.equal(sheets.math_attempts.rows[0].at(-1),'delete_batch');assert.equal(JSON.stringify(sheets.math_attempts.rows.slice(1)),originalRows);
console.log('PASS: 11 units × 3 modes × 30 quizzes (9,900 questions), boundaries, shape counts, clocks and additive schema upgrade');

// Separate two schools with the exact same class and student numbers.
const schoolRows=JSON.stringify(sheets.math_attempts.rows);
assert.equal(call({action:'start',schoolName:'',classNo:1,studentNo:1,term:1,mode:'mix'}).ok,false);
assert.equal(call({action:'start',schoolName:'=IMPORTXML()',classNo:1,studentNo:1,term:1,mode:'mix'}).ok,false);
for(const schoolName of ['대구세천초등학교','다른초등학교']){
 const start=call({action:'start',schoolName,classNo:80,studentNo:1,term:2,unit:'4',mode:'mix'});assert.ok(start.ok);
 assert.ok(call({action:'submit',attemptId:start.attemptId,answers:answerSet(start.questions)}).ok);
}
const schoolLogin=call({action:'teacherLogin',schoolName:'다른초등학교',password:'test-only'});
const schoolReport=call({action:'teacherReport',schoolName:'대구세천초등학교',teacherToken:schoolLogin.teacherToken});
assert.equal(schoolReport.schoolName,'다른초등학교');assert.equal(schoolReport.records.length,1);
assert.equal(schoolReport.records[0].school_name,'다른초등학교');assert.deepEqual(Array.from(schoolReport.classes),[80]);
const defaultLogin=call({action:'teacherLogin',schoolName:'대구 세천 초등학교',password:'test-only'});
const defaultReport=call({action:'teacherReport',teacherToken:defaultLogin.teacherToken});
assert.ok(defaultReport.records.length>1);assert.ok(defaultReport.records.every(r=>r.school_name==='대구세천초등학교'));
assert.ok(JSON.parse(schoolRows).slice(1).every((r,i)=>JSON.stringify(r)===JSON.stringify(sheets.math_attempts.rows[i+1])));
console.log('PASS: school input validation, school/class identity, legacy school fallback, session-scoped reports, unchanged prior rows');
// The school number representation used by GitHub Pages must round-trip
// through the existing Apps Script sheet backend and teacher report.
const numberedSchool='학교번호 10';
const numberedStart=call({action:'start',schoolName:numberedSchool,classNo:3,studentNo:12,term:1,unit:'3',mode:'mix'});
assert.equal(numberedStart.ok,true);
assert.equal(call({action:'submit',attemptId:numberedStart.attemptId,answers:answerSet(numberedStart.questions)}).ok,true);
const numberedLogin=call({action:'teacherLogin',schoolName:numberedSchool,password:'test-only'});
assert.equal(numberedLogin.ok,true);
const numberedReport=call({action:'teacherReport',teacherToken:numberedLogin.teacherToken});
assert.equal(numberedReport.ok,true);
assert.ok(numberedReport.records.some(r=>r.id===numberedStart.attemptId&&r.class_no===3&&r.student_no===12));
assert.equal(numberedReport.records.some(r=>r.school_name==='다른초등학교'),false);
console.log('PASS: school number 10 student save appears in matching teacher dashboard');
assert.ok(cache.size>0);
const savedNumToken=numberedLogin.teacherToken;
assert.equal(call({action:'teacherLogout',teacherToken:savedNumToken}).ok,true);
assert.equal(call({action:'teacherReport',teacherToken:savedNumToken}).ok,false);
console.log('PASS: teacher session cache speeds report and logout revokes cached token');

// Spreadsheet may contain school identifiers typed as numbers (or malformed
// values). One legacy row must not make all teachers' reports fail.
const school24='학교번호 24';
const start24=call({action:'start',schoolName:school24,classNo:5,studentNo:7,term:1,unit:'3',mode:'mix'});
assert.equal(start24.ok,true);
assert.equal(call({action:'submit',attemptId:start24.attemptId,answers:answerSet(start24.questions)}).ok,true);
const attempt24=sheets.math_attempts.rows.find(r=>r[0]===start24.attemptId);
const schoolColumn=sheets.math_attempts.rows[0].indexOf('school_name');
assert.equal(typeof attempt24[schoolColumn],'string');
attempt24[schoolColumn]=24; // Google Sheets may read an old school code as number
const schoolClassRow=sheets.math_classes.rows.find(r=>r[0]===5 && r[2]===school24);
assert.ok(schoolClassRow);
schoolClassRow[2]=24;
const oldSchoolRow=sheets.math_attempts.rows.find(r=>r[0]===numberedStart.attemptId);
const oldSchoolValue=oldSchoolRow[schoolColumn];
oldSchoolRow[schoolColumn]=true; // A malformed unrelated row must be ignored
const login24=call({action:'teacherLogin',schoolName:school24,password:'test-only'});
const report24=call({action:'teacherReport',teacherToken:login24.teacherToken});
assert.equal(report24.ok,true,report24.error);
assert.ok(report24.records.some(r=>r.id===start24.attemptId && r.class_no===5 && r.student_no===7));
assert.ok(report24.classes.includes(5));
oldSchoolRow[schoolColumn]=oldSchoolValue;
assert.equal(call({action:'start',schoolName:24,classNo:9,studentNo:9,term:1,mode:'mix'}).ok,false);
console.log('PASS: numeric school cells and malformed legacy school rows do not block reports');

// Deletion is authenticated, scoped to the session school and reversible.
const deletionSchool='삭제검증초등학교',otherDeletionSchool='삭제검증다른초등학교';
function fixtureAttempt(schoolName,studentNo,finish=true){
 const q=call({action:'start',schoolName,classNo:71,studentNo,term:2,unit:'4',mode:'mix'});assert.ok(q.ok);
 if(finish)assert.ok(call({action:'submit',attemptId:q.attemptId,answers:answerSet(q.questions)}).ok);return q;
}
const d1=fixtureAttempt(deletionSchool,5),d2=fixtureAttempt(deletionSchool,5),d3=fixtureAttempt(deletionSchool,5,false);
const keepStudent=fixtureAttempt(deletionSchool,6),keepSchool=fixtureAttempt(otherDeletionSchool,5);
const deleteLogin=call({action:'teacherLogin',schoolName:deletionSchool,password:'test-only'}),otherDeleteLogin=call({action:'teacherLogin',schoolName:otherDeletionSchool,password:'test-only'});
const deleteToken=deleteLogin.teacherToken;
for(const action of ['teacherDeletePreview','teacherDelete','teacherTrash','teacherRestore'])assert.equal(call({action}).ok,false);
assert.equal(call({action:'teacherDeletePreview',teacherToken:deleteToken,scope:'record',attemptId:keepSchool.attemptId}).ok,false);
assert.equal(call({action:'teacherDeletePreview',teacherToken:deleteToken,scope:'student',classNo:71,studentNo:0}).ok,false);
const recordPreview=call({action:'teacherDeletePreview',teacherToken:deleteToken,scope:'record',attemptId:d1.attemptId});assert.equal(recordPreview.count,1);
const originalD1=JSON.stringify(sheets.math_attempts.rows.find(r=>r[0]===d1.attemptId).slice(0,-2));
const firstDeleted=call({action:'teacherDelete',teacherToken:deleteToken,scope:'record',attemptId:d1.attemptId,previewHash:recordPreview.previewHash});assert.equal(firstDeleted.deletedCount,1);
assert.equal(JSON.stringify(sheets.math_attempts.rows.find(r=>r[0]===d1.attemptId).slice(0,-2)),originalD1);
assert.equal(call({action:'teacherReport',teacherToken:deleteToken}).records.length,2);
assert.equal(call({action:'teacherTrash',teacherToken:deleteToken}).batches[0].count,1);
assert.equal(call({action:'teacherRestore',teacherToken:otherDeleteLogin.teacherToken,batchId:firstDeleted.batchId}).ok,false);
const selector={scope:'student',classNo:71,studentNo:5};
const beforeRace=call({action:'teacherDeletePreview',teacherToken:deleteToken,...selector});assert.equal(beforeRace.count,2);assert.equal(beforeRace.inProgressCount,1);
const duringPreview=fixtureAttempt(deletionSchool,5,false);
assert.equal(call({action:'teacherDelete',teacherToken:deleteToken,...selector,previewHash:beforeRace.previewHash}).ok,false);
const confirmed=call({action:'teacherDeletePreview',teacherToken:deleteToken,...selector});assert.equal(confirmed.count,3);
const deleted=call({action:'teacherDelete',teacherToken:deleteToken,...selector,previewHash:confirmed.previewHash});assert.equal(deleted.deletedCount,3);
assert.equal(call({action:'teacherReport',teacherToken:deleteToken}).records.length,1);
assert.equal(call({action:'teacherReport',teacherToken:otherDeleteLogin.teacherToken}).records.length,1);
assert.equal(call({action:'submit',attemptId:d3.attemptId,answers:answerSet(d3.questions)}).ok,false);
assert.equal(call({action:'teacherRestore',teacherToken:deleteToken,batchId:deleted.batchId}).restoredCount,3);
assert.equal(call({action:'teacherRestore',teacherToken:deleteToken,batchId:deleted.batchId}).ok,false);
assert.equal(call({action:'teacherRestore',teacherToken:deleteToken,batchId:firstDeleted.batchId}).restoredCount,1);
assert.equal(call({action:'teacherReport',teacherToken:deleteToken}).records.length,3);
console.log('PASS: single/all-student deletion, auth and cross-school checks, exact confirmation counts, concurrent updates, retained raw rows, late-submit rejection and restore');
(async()=>{
 const html=fs.readFileSync(root+'Index.html','utf8');
 const dom=new JSDOM(html,{runScripts:'dangerously',beforeParse(w){w.scrollTo=()=>{};w.google={script:{run:{withSuccessHandler(fn){const runner={withFailureHandler(){return runner;},quizApi(p){Promise.resolve().then(()=>fn(JSON.parse(JSON.stringify(call(p)))));}};return runner;}}}};}});
 const w=dom.window,$=id=>w.document.getElementById(id);
 $('school-name').value='대구세천초등학교';$('teacher-school').value='대구세천초등학교';
 $('class-no').value='7';$('student-no').value='12';w.eval("state.unit='3'");await w.startQuiz();
 for(let i=0;i<10;i++){
  const q=w.eval('state.attempt.questions[state.index]'),r=right(q),wrong=q.choices.filter(x=>x!==r);
  if(i%3===0)w.answer(r);else {w.answer(wrong[0]);assert.equal($('hint-box').classList.contains('hidden'),false);w.answer(i%3===1?r:wrong[1]);if(i%3===2)assert.equal($('solution-box').classList.contains('hidden'),false);}
  await w.nextQuestion();
 }
 assert.equal($('result-score').textContent,'7 / 10');
 $('teacher-password').value='test-only';await w.loginTeacher();assert.equal($('dashboard').classList.contains('hidden'),false);
 $('filter-class').value='7';w.renderReport();assert.equal($('stat-average').textContent,'70%');
 let blob;w.URL.createObjectURL=b=>(blob=b,'blob:test');w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};w.exportCsv();assert.ok(blob.size>100);
 const reader=new w.FileReader();const csv=await new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsText(blob);});assert.match(csv,/단원/);assert.match(csv,/3\. 덧셈과 뺄셈/);
 // The dialog confirms all terms/units, cancel preserves rows and restore repairs statistics/CSV.
 assert.equal($('student-summary').querySelector('.danger-btn').textContent,'이 학생 기록 삭제');
 const uiSelector={scope:'student',classNo:7,studentNo:12};
 await w.openDelete(uiSelector);assert.ok($('delete-dialog').hasAttribute('open'));assert.ok($('delete-summary').textContent.includes('7반 12번'));
 w.closeDeleteDialog();assert.equal(call({action:'teacherReport',teacherToken:w.eval('state.teacherToken')}).records.some(r=>r.class_no===7),true);
 await w.openDelete(uiSelector);await w.confirmDelete();assert.equal($('stat-attempts').textContent,'0회');assert.ok(!$('delete-dialog').hasAttribute('open'));
 const trash=call({action:'teacherTrash',teacherToken:w.eval('state.teacherToken')});const batch=trash.batches.find(b=>b.classNo===7&&b.studentNo===12);assert.ok(batch);
 await w.restoreRecords(batch.batchId,$('trash-results').querySelector('button'));assert.equal($('stat-attempts').textContent,'1회');assert.equal($('stat-average').textContent,'70%');
 // Completed old-scope rows remain visible under their own filter, never the corrected unit filter.
 w.eval("state.records.push({id:'old-scope-fixture',class_no:7,student_no:12,term:2,unit:'2',mode:'mix',score:7,total:10,first_try_count:4,helped_count:3,revealed_count:3,wrong:[],completed_at:new Date().toISOString(),oldScope:true})");
 $('filter-unit').value='old-scope';w.renderReport();assert.ok($('all-results').textContent.includes('수정 전 범위'));
 $('filter-unit').value='2/2';w.renderReport();assert.ok(!$('all-results').textContent.includes('수정 전 범위'));
 $('home-logo').click();assert.equal($('home').classList.contains('hidden'),false);assert.equal($('all-results').children.length,0);
 // A delayed server response must not pull the pupil away from the home screen.
 let complete;w.google.script.run.withSuccessHandler=fn=>({withFailureHandler(){return this;},quizApi(p){complete=()=>fn(JSON.parse(JSON.stringify(call(p))));}});
 const pending=w.startQuiz();$('home-logo').click();complete();await pending;assert.equal($('home').classList.contains('hidden'),false);
 // All eleven unit screens must handle numeric and word answers, SVGs, hints, explanations and saving.
 for(const term of [1,2])for(let unit=1;unit<=(term===1?5:6);unit++){
  w.setChoice('[data-term]','term',String(term));
  assert.equal(w.eval('state.unit'),'1');w.eval(`state.unit='${unit}'`);w.renderUnits();
  $('class-no').value=String(9100+term*10+unit);$('student-no').value='1';
  w.google.script.run.withSuccessHandler=fn=>({withFailureHandler(){return this;},quizApi(p){Promise.resolve().then(()=>fn(context.quizApi(p)));}});
  await w.startQuiz();
  for(let i=0;i<10;i++){
   const q=w.eval('state.attempt.questions[state.index]'),r=right(q),wrong=q.choices.filter(x=>x!==r);
   if(i%3===0)w.answer(r);else{w.answer(wrong[0]);assert.equal($('hint-box').classList.contains('hidden'),false);assert.ok($('hint-text').textContent);w.answer(i%3===1?r:wrong[1]);if(i%3===2){assert.ok($('solution-text').textContent);assert.ok(!$('solution-text').textContent.includes('undefined'));}}
   await w.nextQuestion();
  }
  assert.equal($('result-score').textContent,'7 / 10');assert.ok($('result-player').textContent.includes(unit+'.'));
 }
 dom.window.close();console.log('PASS: actual HTML for all 11 units, word answers, visuals, hints, solutions, saving, teacher statistics, CSV, logo and delayed navigation');
})().catch(e=>{console.error(e);process.exitCode=1;});
