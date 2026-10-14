import {CONFIG} from './config.js';
import {questions,getOptions} from './questions.js';
const app=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=null,activeTab='status',timer=null,overview=null,page=0;
const $=id=>document.getElementById(id);
function message(text){const el=$('note');if(el)el.textContent=text;}
async function call(action,data={}){
  const res=await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/admin-api`,{
    method:'POST',headers:{apikey:CONFIG.SUPABASE_ANON_KEY,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({action,...data}),cache:'no-store'
  });
  const result=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(result.error||'요청을 완료하지 못했습니다.');
  return result;
}
$('login').addEventListener('click',async()=>{
  try{
    if(!CONFIG.SUPABASE_URL||CONFIG.SUPABASE_URL.includes('YOUR_PROJECT'))throw Error('Supabase 연결 설정을 먼저 완료하세요.');
    const res=await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`,{
      method:'POST',headers:{apikey:CONFIG.SUPABASE_ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email:$('email').value.trim(),password:$('password').value})
    });
    const data=await res.json();if(!res.ok||!data.access_token)throw Error('관리자 계정 또는 비밀번호가 올바르지 않습니다.');
    token=data.access_token;
    document.body.querySelector('.shell')?.classList.add('admin-shell');
    await showDashboard();
  }catch(e){message(e.message);}
});
function nav(){return `<div class="admin-tabs" role="tablist" aria-label="관리자 메뉴">
  <button type="button" class="admin-tab" role="tab" data-tab="status" aria-selected="${activeTab==='status'}">실시간 마감현황</button>
  <button type="button" class="admin-tab" role="tab" data-tab="responses" aria-selected="${activeTab==='responses'}">응답 데이터 관리</button>
  <button type="button" class="admin-tab" role="tab" data-tab="downloads" aria-selected="${activeTab==='downloads'}">Excel 다운로드</button>
  <button type="button" class="admin-tab" role="tab" data-tab="operations" aria-selected="${activeTab==='operations'}">운영·추첨</button>
  </div>`;}
function quotaRow(name,item){
  const n=Number(item.count)||0,limit=Number(item.limit)||0,full=!!item.full;
  const percent=limit?Math.min(100,Math.round(n/limit*100)):0;
  return `<div class="quota-row"><div class="quota-head"><strong>${esc(name)} ${full?'<span style="color:#b42318">· 마감</span>':''}</strong><span class="quota-count">${n.toLocaleString()} / ${limit.toLocaleString()}명</span></div>
   <div class="quota-track" role="progressbar" aria-label="${esc(name)} 응답률" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="${limit}"><div class="quota-fill ${full?'full':''}" style="width:${percent}%"></div></div>
   <div class="quota-hint">${percent}% 완료 · 잔여 ${Math.max(0,limit-n)}명</div></div>`;
}
function renderStatus(d){
  const genders=d.quotas.genders,ages=d.quotas.ages;
  const allAge=ages.reduce((a,x)=>a+Number(x.limit||0),0);
  const allGender=genders.reduce((a,x)=>a+Number(x.limit||0),0);
  const maxTotal=Math.min(allAge,allGender);
  return `<div class="admin-metrics"><div class="admin-metric"><small>전체 유효 응답</small><strong>${d.total.toLocaleString()}명</strong><small>최대 ${maxTotal.toLocaleString()}명 / 잔여 ${Math.max(0,maxTotal-d.total)}명</small></div>
  <div class="admin-metric"><small>조사 운영 상태</small><strong>${d.quotas.open?'진행 중':'마감'}</strong><small>최종 제출 완료 기준</small></div>
  <div class="admin-metric"><small>이벤트 참여 동의</small><strong>${d.events.toLocaleString()}명</strong><small>중복 번호는 추첨에서 제외</small></div>
  <div class="admin-metric"><small>이벤트 당첨</small><strong>${d.selected.toLocaleString()}명</strong><small>최대 100명 추첨</small></div></div>
  <div class="admin-controls"><button type="button" class="btn secondary" id="refresh">지금 새로고침</button><span class="admin-status" id="updated" aria-live="polite">20초 간격으로 자동 갱신</span></div>
  <h2>성별 참여 인원</h2><div class="quota-group">${genders.map((item,i)=>quotaRow(questions[1].options[i],item)).join('')}</div>
  <h2>연령별 참여 인원</h2><div class="quota-group">${ages.map((item,i)=>quotaRow(questions[2].options[i],item)).join('')}</div>
  <p class="admin-hint">연령별 상한 총합은 ${allAge}명, 성별 상한 총합은 ${allGender}명입니다. 실제 전체 접수 가능 인원은 두 할당 조건을 모두 충족해야 하므로 응답 분포에 따라 ${maxTotal}명보다 일찍 종료될 수 있습니다.</p>`;
}
function renderDownloads(){return `<h2>통계·응답 자료 다운로드</h2><p class="admin-hint">기본 Excel 파일은 개인정보를 제외한 유효 완료 응답 자료입니다. LABEL 시트는 DATA와 동일한 행과 열 구조의 문자형 응답값입니다.</p>
<div class="admin-controls"><button type="button" class="btn" id="export">Excel 다운로드 (DATA · LABEL · CODE)</button><button type="button" class="btn secondary" id="eventExport">이벤트 연락처 CSV</button></div>
<p class="admin-hint">이벤트 연락처는 개인정보입니다. 별도 관리하고 쿠폰 발송 완료 후 정해진 기한 내 파기하세요.</p>`;}
function renderOperations(d){return `<h2>조사 운영·이벤트 추첨</h2><p>현재 조사 상태: <strong>${d.quotas.open?'진행 중':'마감'}</strong></p>
<div class="admin-controls"><button type="button" class="btn secondary" id="toggle">${d.quotas.open?'설문 마감':'설문 재개'}</button>
<button type="button" class="btn secondary" id="draw">이벤트 무작위 추첨 100명 (마감 후 1회)</button></div>
<p class="admin-hint">이미 추첨한 경우 같은 조사를 다시 추첨하지 않습니다. 응답 무효화로 정원에 변동이 생기면 당첨자 상태와 행사 운영 기준을 함께 검토하세요.</p>`;}
function renderResponses(){return `<h2>응답 데이터 관리</h2><p class="admin-hint">유효 응답과 무효 응답을 함께 조회합니다. 설문 원문 답변은 Excel 다운로드에서 확인할 수 있습니다. 무효 처리한 응답은 정원 집계에서 제외됩니다.</p>
<div class="admin-controls"><button class="btn secondary" id="loadResponses">목록 새로고침</button></div>
<div id="responseList" aria-live="polite">응답 목록을 불러오는 중입니다.</div>
<h3>응답 무효 처리</h3><label for="target">응답 ID</label><input class="phone" id="target" placeholder="응답 ID (UUID)">
<label for="reason">무효 처리 사유</label><input class="phone" id="reason" placeholder="무효 처리 사유를 입력하세요">
<div class="admin-controls"><button class="btn secondary" id="invalidate">해당 응답 무효 처리</button></div>`;}
async function showDashboard(){
  try{overview=await call('dashboard');}catch(e){app.innerHTML=`<h1>관리자 접근 실패</h1><p>${esc(e.message)}</p><p><a href="admin.html">로그인으로 돌아가기</a></p>`;return;}
  app.innerHTML=`<div class="admin-top"><div><h1>설문 관리자</h1><p class="admin-hint">2026년 연제구민 디지털 시민성 진단 및 실태조사</p></div><button class="small-button" id="logout">로그아웃</button></div>
   ${nav()}<div id="panel"></div><div id="note" role="status" aria-live="polite"></div>`;
  $('logout').onclick=()=>{token=null;clearInterval(timer);window.location.href='admin.html';};
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  await switchTab(activeTab);
  if(timer)clearInterval(timer);
  timer=setInterval(async()=>{if(activeTab!=='status'||document.hidden||!token)return;try{overview=await call('dashboard');$('panel').innerHTML=renderStatus(overview);bindPanel();const marker=$('updated');if(marker)marker.textContent='자동 업데이트 · '+new Date().toLocaleTimeString('ko-KR');}catch(e){message('자동 갱신 실패: '+e.message);}},20000);
}
async function switchTab(tab){activeTab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  if(tab==='status'){$('panel').innerHTML=renderStatus(overview);bindPanel();}
  if(tab==='downloads'){$('panel').innerHTML=renderDownloads();bindPanel();}
  if(tab==='operations'){$('panel').innerHTML=renderOperations(overview);bindPanel();}
  if(tab==='responses'){$('panel').innerHTML=renderResponses();bindPanel();await loadResponses(0);}
  message('');
}
function bindPanel(){
  if($('refresh'))$('refresh').onclick=async()=>{try{overview=await call('dashboard');$('panel').innerHTML=renderStatus(overview);bindPanel();$('updated').textContent='마지막 업데이트 · '+new Date().toLocaleTimeString('ko-KR');}catch(e){message(e.message);}};
  if($('loadResponses'))$('loadResponses').onclick=()=>loadResponses(0);
  if($('invalidate'))$('invalidate').onclick=invalidate;
  if($('export'))$('export').onclick=exportExcel;
  if($('eventExport'))$('eventExport').onclick=exportEvents;
  if($('toggle'))$('toggle').onclick=async()=>{if(!confirm('조사 상태를 변경할까요?'))return;try{await call('set_open',{open:!overview.quotas.open});await showDashboard();}catch(e){message(e.message);}};
  if($('draw'))$('draw').onclick=async()=>{if(!confirm('마감 후 단 한 번 추첨합니다. 진행할까요?'))return;try{const x=await call('draw');if(!x.ok)throw Error(x.message);await showDashboard();message(`추첨 완료: 후보 ${x.candidates}명 중 당첨 ${x.winners}명`);}catch(e){message(e.message);}};
}
async function loadResponses(index){
  page=index;const area=$('responseList');if(!area)return;area.textContent='불러오는 중...';
  try{
    const result=await call('responses',{offset:page*50,limit:50});
    const data=result.rows||[];
    const rows=data.map(r=>{const a=r.answers||{};
      const gender=questions[1].options[Number(a.q2)-1]||'—';
      const age=questions[2].options[Number(a.q3)-1]||'—';
      const date=new Date(r.submitted_at).toLocaleString('ko-KR');
      return `<tr><td><button type="button" class="small-button copy-id" data-id="${esc(r.id)}" title="응답 ID 복사">ID 복사</button></td><td>${esc(date)}</td><td>${esc(gender)}</td><td>${esc(age)}</td><td>${r.status==='valid'?'유효':'무효'}</td><td>${esc(r.invalid_reason||'—')}</td></tr>`;
    }).join('');
    area.innerHTML=`<p class="admin-hint">총 ${Number(result.total||0).toLocaleString()}건 (유효·무효 포함), 최신순 · 50건씩 표시</p>
      <div class="data-scroll"><table class="data-table"><thead><tr><th>응답 ID</th><th>제출 일시</th><th>성별</th><th>연령</th><th>상태</th><th>무효 사유</th></tr></thead><tbody>${rows||'<tr><td colspan="6">응답 자료가 없습니다.</td></tr>'}</tbody></table></div>
      <div class="admin-controls"><button class="small-button" id="prevPage" ${page===0?'disabled':''}>이전 50건</button><span class="admin-hint">${page+1}페이지</span><button class="small-button" id="nextPage" ${((page+1)*50>=result.total)?'disabled':''}>다음 50건</button></div>`;
    $('prevPage').onclick=()=>loadResponses(page-1);$('nextPage').onclick=()=>loadResponses(page+1);
    document.querySelectorAll('.copy-id').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.id);message('응답 ID를 복사했습니다. 무효 처리 입력란에 붙여넣으세요.');}catch{message('클립보드 복사에 실패했습니다.');}});
  }catch(e){area.textContent='응답 목록 조회 오류: '+e.message;}
}
async function invalidate(){const id=$('target').value.trim(),reason=$('reason').value.trim();if(!id||reason.length<2)return message('응답 ID와 2자 이상의 사유를 입력하세요.');if(!confirm('해당 응답을 무효 처리할까요? 되돌리기 기능은 없습니다.'))return;
  try{const x=await call('invalidate',{id,reason});if(!x.ok)throw Error('유효 상태인 해당 응답을 찾을 수 없습니다.');overview=await call('dashboard');await loadResponses(page);message('무효 처리했습니다. 정원 수치에도 반영되었습니다.');}catch(e){message(e.message);}}
async function exportExcel(){try{
  message('Excel 파일을 생성하는 중입니다.');const x=await call('export');
  const lib=await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');const wb=lib.utils.book_new();
  const data=x.rows.map(r=>{const obj={ID:r.id,SUBMIT_AT:r.submitted_at};for(let i=1;i<=28;i++)obj['Q'+i]=r.answers['q'+i];return obj;});
  const labels=x.rows.map(r=>{const obj={ID:r.id,SUBMIT_AT:r.submitted_at};for(const q of questions){const v=r.answers['q'+q.id];obj['Q'+q.id]=getOptions(q)[v-1]??'';}return obj;});
  const codes=[];for(const q of questions)getOptions(q).forEach((label,i)=>codes.push({변수명:'Q'+q.id,문항번호:q.id,문항내용:q.text,코드:i+1,응답문구:label}));
  for(const [name,arr] of [['DATA',data],['LABEL',labels],['CODE',codes]]){const sheet=lib.utils.json_to_sheet(arr.length?arr:(name==='CODE'?codes:[{ID:'',SUBMIT_AT:''}]));lib.utils.book_append_sheet(wb,sheet,name);}
  lib.writeFile(wb,'연제구_디지털시민성_설문응답_'+new Date().toLocaleDateString('sv-SE').replaceAll('-','')+'.xlsx');message('Excel 다운로드가 시작되었습니다.');
}catch(e){message('Excel 다운로드 오류: '+e.message);}}
async function exportEvents(){try{
  const x=await call('events');const cols=['응답ID','휴대전화번호','동의일시','추첨당첨'];
  const quote=s=>'"'+String(s??'').replaceAll('"','""')+'"';
  const csv='\uFEFF'+[cols,...x.rows.map(r=>[r.response_id,r.phone,r.created_at,r.selected?'당첨':'미당첨'])].map(row=>row.map(quote).join(',')).join('\r\n');
  const objectUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=objectUrl;a.download='이벤트_참여자_개인정보_관리용.csv';a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);message('개인정보 포함 파일입니다. 취급에 주의하세요.');
}catch(e){message(e.message);}}
