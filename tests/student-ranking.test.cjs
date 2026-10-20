const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');

const root=__dirname+'/../';
const app=fs.readFileSync(root+'app.js','utf8');
const html=fs.readFileSync(root+'index.html','utf8');
const start=app.indexOf('function studentAverages(');
const end=app.indexOf('function percent(records)',start);
assert.ok(start>0 && end>start,'student ranking helpers must exist');

const dom=new JSDOM(html);
const doc=dom.window.document;
const tableRow=(body,values,colSpan=1)=>{
  const tr=doc.createElement('tr');
  values.forEach(value=>{
    const td=doc.createElement('td');
    td.textContent=String(value);
    if(values.length===1)td.colSpan=colSpan;
    tr.appendChild(td);
  });
  body.appendChild(tr);
};
const context=vm.createContext({
  document:doc, Option:dom.window.Option,
  $:id=>doc.getElementById(id),
  tableRow, dateText:t=>t, wrongText:r=>r.wrong?.join(' / ')||'없음',
  recordUnitLabel:r=>'단원'+r.unit,
});
vm.runInContext(app.slice(start,end),context);
const r=(c,n,score,date,extra={})=>({
  class_no:c,student_no:n,score,total:10,first_try_count:score,
  helped_count:0,revealed_count:10-score,term:1,unit:'3',
  mode:'mix',completed_at:date,wrong:[],...extra
});
const records=[
  r(1,1,9,'2026-10-20T10:00:00Z'),
  r(1,2,8,'2026-10-20T09:00:00Z',{helped_count:3}),
  r(2,1,8,'2026-10-20T08:00:00Z'),
  r(1,1,1,'2026-10-19T10:00:00Z'),
  r(3,1,2,'2026-10-19T08:00:00Z')
];
const groups=context.studentAverages(records);
assert.deepEqual(groups.map(g=>g.key),['1/2','2/1','1/1','3/1']);
assert.deepEqual(groups.map(g=>g.rank),[1,1,3,4]);
assert.equal(groups.find(g=>g.key==='1/1').attempts,2);
assert.equal(groups.find(g=>g.key==='1/1').rate,.5);
assert.equal(groups.find(g=>g.key==='1/1').latest.score,9);
context.renderStudentRanking(records);
assert.equal(doc.querySelectorAll('#ranking-body tr').length,4);
assert.match(doc.getElementById('ranking-body').textContent,/1위/);
assert.equal(doc.querySelectorAll('#student-choose option').length,5);
// Ranking button opens the student's consolidated quiz history.
doc.querySelector('#ranking-body tr:nth-child(3) button').click();
assert.equal(doc.getElementById('student-choose').value,'1/1');
assert.equal(doc.querySelectorAll('#student-detail-body tr').length,2);
assert.match(doc.getElementById('student-detail-summary').textContent,/총 2회 응시/);
// Rebuilding the ranking preserves the current student selection.
context.renderStudentRanking(records);
assert.equal(doc.getElementById('student-choose').value,'1/1');
context.renderStudentRanking(records.filter(x=>x.student_no!==1));
assert.equal(doc.getElementById('student-choose').value,'');
assert.equal(doc.getElementById('student-detail').classList.contains('hidden'),true);
console.log('PASS: ranked student averages, equal ranks and grouped attempt history');
