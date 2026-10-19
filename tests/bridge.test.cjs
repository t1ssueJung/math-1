const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
test('relay accepts only the negotiated nonce, Google origin, source and request id',async()=>{
  let receive,frame;const sent=[];
  const source={postMessage:(message,origin)=>sent.push({message,origin})};
  const context=vm.createContext({URL,Uint8Array,Map,Promise,JSON,Error,crypto:crypto.webcrypto,setTimeout:(fn,ms)=>setTimeout(fn,ms).unref(),clearTimeout,
    location:{origin:'https://t1ssueJung.github.io'},
    window:{QUIZ_CONFIG:{backendUrl:'https://script.google.com/macros/s/test-deployment/exec'},addEventListener:(name,fn)=>receive=fn,removeEventListener(){}},
    document:{createElement:()=>({setAttribute(){},remove(){}}),body:{appendChild:f=>frame=f}}
  });
  const app=fs.readFileSync(__dirname+'/../app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('let relay=null;'),app.indexOf('let navigationVersion')),context);
  const pending=vm.runInContext("api('start',{schoolName:'시험초등학교'})",context);
  const url=new URL(frame.src),nonce=url.searchParams.get('nonce');
  assert.match(nonce,/^[a-f0-9]{32}$/);assert.equal(url.searchParams.get('parentOrigin'),'https://t1ssueJung.github.io');
  const origin='https://n-test-script.googleusercontent.com';
  const ready={channel:'math-school-v1',nonce,kind:'ready'};
  receive({origin:'https://evil.example',source,data:ready});
  receive({origin,source,data:{...ready,nonce:'bad'}});assert.equal(sent.length,0);
  receive({origin,source,data:ready});await new Promise(setImmediate);
  assert.equal(sent.length,1);const request=sent[0];assert.equal(request.origin,origin);
  assert.equal(JSON.parse(request.message.payload).schoolName,'시험초등학교');
  const data={channel:'math-school-v1',nonce,kind:'response',id:request.message.id,raw:'{"ok":true,"attemptId":"verified"}'};
  receive({origin,source:{},data});receive({origin:'https://evil.example',source,data});
  receive({origin,source,data:{...data,id:'wrong-id'}});receive({origin,source,data});
  assert.equal((await pending).attemptId,'verified');
});
test('bridge rejects an unapproved embedding origin and never embeds a password',()=>{
  let content,allowAll=false;
  const context=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},
    HtmlService:{XFrameOptionsMode:{ALLOWALL:'allow'},createHtmlOutput:html=>{content=html;return {setTitle(){return this;},setXFrameOptionsMode(){allowAll=true;return this;}}}}
  });
  const server=fs.readFileSync(__dirname+'/../backend/Code.gs','utf8');
  vm.runInContext(server.slice(server.indexOf('function bridgeOutput_')),context);
  context.bridgeOutput_({parentOrigin:'https://evil.example',nonce:'a'.repeat(32)});assert.ok(!allowAll);assert.ok(!content.includes('google.script.run'));
  context.bridgeOutput_({parentOrigin:'https://t1ssueJung.github.io',nonce:'b'.repeat(32)});assert.ok(allowAll);assert.ok(content.includes('event.source!==window.top'));assert.ok(!content.includes('TEACHER_PASSWORD'));
});


