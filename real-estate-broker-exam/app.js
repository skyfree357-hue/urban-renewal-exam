let bank=[];
let selectedMode='exam';
let state={questions:[],index:0,answers:{},graded:{},marked:new Set(),started:0,mode:'exam'};
const $=selector=>document.querySelector(selector);

async function init(){
  bank=await loadBank();
  const years=[...new Set(bank.map(q=>q.exam_year))].sort((a,b)=>b-a);
  $('#year-select').innerHTML=years.map(year=>`<option value="${year}">${year} 年</option>`).join('');
  $('#year-select').value=years[0];
  $('#year-select').onchange=()=>{refreshSubjects();reloadSelectedExam()};
  $('#subject-select').onchange=()=>{updateExamTitle();reloadSelectedExam()};
  refreshSubjects();
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>selectMode(button.dataset.mode));
  loadDashboard();
}

async function loadBank(){
  const manifestResponse=await fetch('./data/index.json');
  if(manifestResponse.ok){
    const manifest=await manifestResponse.json();
    const chunks=await Promise.all((manifest.files||[]).map(async file=>{
      const response=await fetch(new URL(file,manifestResponse.url));
      if(!response.ok)throw new Error(`題庫分卷載入失敗：${file}`);
      return (await response.json()).questions||[];
    }));
    return chunks.flat();
  }
  const response=await fetch('./data/questions.json');
  if(!response.ok)throw new Error('題庫載入失敗');
  return (await response.json()).questions;
}

function selectMode(mode){
  const running=state.questions.length>0&&!$('#runner').hidden;
  if(running&&state.mode==='review'&&mode==='exam'&&Object.keys(state.graded).length){
    alert('本次作答已顯示答案與詳解，不能切回考試模式；如需考試模式，請重新開始試卷。');
    return;
  }
  selectedMode=mode;
  if(running){
    state.mode=mode;
    if(mode==='review'){
      state.questions.forEach(q=>{
        const answer=state.answers[q.id];
        if(q.question_type==='multiple_choice'&&answer&&!state.graded[q.id]){
          state.graded[q.id]={answer,isCorrect:answerIsCorrect(answer,q.official_answer)};
        }
      });
    }
  }
  document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));
  $('#mode-hint').textContent=mode==='review'
    ?'選定答案後立即判題並展開詳解；第一次作答會鎖定。'
    :'交卷前不顯示答案與詳解，可自由修改答案。';
  if(running)render();
}

function refreshSubjects(){
  const year=Number($('#year-select').value),previous=$('#subject-select').value;
  const subjects=[...new Set(bank.filter(q=>q.exam_year===year).map(q=>q.subject))];
  $('#subject-select').innerHTML=subjects.map(subject=>`<option value="${subject}">${subject}</option>`).join('');
  $('#subject-select').value=subjects.includes(previous)?previous:(subjects.includes('民法概要')?'民法概要':subjects[0]);
  updateExamTitle();
}
function updateExamTitle(){$('#subject-title').textContent=`${$('#year-select').value} 年｜${$('#subject-select').value}`}
function reloadSelectedExam(){
  if(state.questions.length)start(100,false);
}

function history(){return JSON.parse(localStorage.getItem('exam-history')||'[]')}
function loadDashboard(){
  const records=history(),today=new Date().toISOString().slice(0,10),todays=records.filter(r=>r.date===today);
  const answered=records.reduce((n,r)=>n+r.answered,0),correct=records.reduce((n,r)=>n+r.correct,0);
  const todayAnswered=todays.reduce((n,r)=>n+r.answered,0),todayCorrect=todays.reduce((n,r)=>n+r.correct,0);
  const cards=[['今日刷題',todayAnswered],['今日正確率',todayAnswered?Math.round(todayCorrect/todayAnswered*100)+'%':'0%'],['總作答題數',answered],['題庫進度',bank.length+' 題']];
  $('#dashboard').innerHTML=cards.map(x=>`<div class="card"><small>${x[0]}</small><b>${x[1]}</b></div>`).join('');
}

function start(limit=100,random=false){
  const year=Number($('#year-select').value);
  const subject=$('#subject-select').value;
  let questions=bank.filter(q=>q.exam_year===year&&q.subject===subject);
  if(random) questions=[...questions].sort(()=>Math.random()-.5);
  state={questions:questions.slice(0,limit),index:0,answers:{},graded:{},marked:new Set(),started:Date.now(),mode:selectedMode};
  $('#empty').hidden=true;$('#result').hidden=true;$('#runner').hidden=false;render();
}

function render(){
  const q=state.questions[state.index],written=q.question_type!=='multiple_choice';
  const grade=state.graded[q.id];
  const typeLabel=q.question_type==='composition'?'作文':q.question_type==='essay'?'申論題':'單選題';
  $('#meta').textContent=`第 ${state.index+1} / ${state.questions.length} 題｜${typeLabel}`;
  $('#question').textContent=q.question_text;$('#essay').hidden=!written;$('#options').hidden=written;
  if(written) $('#essay').value=state.answers[q.id]||'';
  else $('#options').innerHTML=[...'ABCD'].map(letter=>{
    const classes=['option'];
    if(state.answers[q.id]===letter)classes.push('selected');
    if(grade&&letter===grade.answer)classes.push(grade.isCorrect?'answer-correct':'answer-wrong');
    if(grade&&!grade.isCorrect&&answerIsCorrect(letter,q.official_answer))classes.push('official-correct');
    const mark=grade&&letter===grade.answer?(grade.isCorrect?'✓ 答對':'✕ 答錯'):grade&&!grade.isCorrect&&answerIsCorrect(letter,q.official_answer)?'✓ 正解':'';
    return `<button class="${classes.join(' ')}" data-answer="${letter}" ${grade?'disabled':''}><b>${letter}.</b> ${q[`option_${letter.toLowerCase()}`]||'選項資料缺漏'}${mark?`<span class="answer-mark">${mark}</span>`:''}</button>`;
  }).join('');
  const feedback=$('#instant-feedback');
  if(state.mode==='review'&&grade){
    feedback.hidden=false;
    feedback.innerHTML=`<div class="instant-result ${grade.isCorrect?'correct-result':'wrong-result'}"><strong>${grade.isCorrect?'答對了':'答錯了'}</strong><span>你的答案：${grade.answer}　官方答案：${officialAnswerLabel(q.official_answer)}</span><small class="answer-locked">答案已鎖定，請前往下一題。</small></div>${explanationHtml(q)}`;
  }else{feedback.hidden=true;feedback.innerHTML=''}
  $('#nav').innerHTML=state.questions.map((item,i)=>{
    const itemGrade=state.graded[item.id];
    const classes=[i===state.index?'current':''];
    if(itemGrade)classes.push(itemGrade.isCorrect?'nav-correct':'nav-wrong');
    else if(state.answers[item.id])classes.push('done');
    return `<button data-index="${i}" class="${classes.filter(Boolean).join(' ')}">${i+1}${state.marked.has(item.id)?'★':''}</button>`;
  }).join('');
  $('#bar').style.width=((state.index+1)/state.questions.length*100)+'%';
}

$('#options').onclick=event=>{
  const button=event.target.closest('[data-answer]');if(!button)return;
  const q=state.questions[state.index];
  if(state.mode==='review'&&state.graded[q.id])return;
  state.answers[q.id]=button.dataset.answer;
  if(state.mode==='review')state.graded[q.id]={answer:button.dataset.answer,isCorrect:answerIsCorrect(button.dataset.answer,q.official_answer)};
  render();
};
$('#essay').oninput=event=>state.answers[state.questions[state.index].id]=event.target.value;
$('#nav').onclick=event=>{const button=event.target.closest('[data-index]');if(button){state.index=Number(button.dataset.index);render()}};
$('#prev').onclick=()=>{state.index=Math.max(0,state.index-1);render()};$('#next').onclick=()=>{state.index=Math.min(state.questions.length-1,state.index+1);render()};
$('#mark').onclick=()=>{const id=state.questions[state.index].id;state.marked.has(id)?state.marked.delete(id):state.marked.add(id);render()};

function list(items){return `<ul>${(items||[]).map(x=>`<li>${x}</li>`).join('')}</ul>`}
function shown(value,fallback='尚未提供'){return value===undefined||value===null||value===''?fallback:value}
function lawChangeAlert(e){return e?.has_law_change?`<div class="law-change-alert"><strong>⚠ 現行法規已影響本題</strong><p>${shown(e.law_difference)}</p></div>`:''}
function lawReviewNotice(e){return e?.current_law_review_status==='pending'?'<div class="law-review-pending"><strong>現行法規尚待逐題核對</strong><p>目前只保留當年官方答案；在核對完成前，不代表現行法與當年規定相同。</p></div>':''}
function optionAnalysis(q,e){return `<div class="option-analysis">${[...'ABCD'].map(letter=>`<div class="option-analysis-card ${answerIsCorrect(letter,q.official_answer)?'is-answer':''}"><h5>${letter}. ${shown(q[`option_${letter.toLowerCase()}`])}</h5><p><b>這個選項的意思：</b>${shown(e[`option_${letter.toLowerCase()}_meaning`])}</p><p><b>本題為什麼${answerIsCorrect(letter,q.official_answer)?'選':'不選'}：</b>${shown(e[`option_${letter.toLowerCase()}_reason`])}</p></div>`).join('')}</div>`}
function reviewOptions(q,answer){
  if(q.question_type!=='multiple_choice')return '';
  return `<div class="review-options">${[...'ABCD'].map(letter=>{
    const official=answerIsCorrect(letter,q.official_answer);
    const classes=[official?'official-option':'',letter===answer?'user-option':''].filter(Boolean).join(' ');
    const marks=[official?'官方答案':'',letter===answer?'你的答案':''].filter(Boolean).join('／');
    return `<div class="review-option ${classes}"><b>${letter}.</b> ${shown(q[`option_${letter.toLowerCase()}`],'選項資料缺漏')}${marks?`<span>${marks}</span>`:''}</div>`;
  }).join('')}</div>`;
}
function laws(e){
  if(e.law_explanations?.length)return `<div class="law-cards">${e.law_explanations.map(item=>`<div class="law-card"><b>${shown(item.citation,'法規依據')}</b><p>${shown(item.meaning,'本條用途說明尚待補充')}</p><small>本題用途：${shown(item.use,'作為判斷本題法律效果的規範基礎')}</small></div>`).join('')}</div>`;
  return list(e.related_laws);
}
function explanationHtml(q){
  const e=q.explanation;if(!e)return '<p class="pending">本題詳解尚未建立</p>';
  if(q.question_type==='composition'){
    const c=e.composition_analysis||{};
    return `<div class="explanation"><h4>題意</h4><p>${shown(c.purpose)}</p><h4>關鍵字</h4>${list(c.keywords)}<h4>不能離題的核心</h4><p>${shown(c.must_address)}</p><h4>可採立場</h4>${list(c.positions)}<h4>文章架構</h4>${list(c.structure)}<h4>適合例子</h4>${list(c.examples)}<h4>可用名言／典故</h4>${list(c.quotes)}<h4>容易扣分處</h4>${list(c.pitfalls)}<h4>作文大綱</h4>${list(c.outline)}<h4>四段式版本</h4>${list(c.four_paragraph)}<h4>五段式版本</h4>${list(c.five_paragraph)}<h4>開頭範例</h4><p class="essay-answer">${shown(c.opening)}</p><h4>結尾範例</h4><p class="essay-answer">${shown(c.ending)}</p></div>`;
  }
  if(q.question_type==='essay')return `<div class="explanation">${lawChangeAlert(e)}${lawReviewNotice(e)}<h4>核心考點</h4><p>${e.core_concept}</p><h4>爭點</h4>${list(e.issues)}<h4>配分點</h4>${list(e.scoring_points.map(x=>`${x.point}（${x.score} 分）`))}<h4>法律依據與個別用途</h4>${laws(e)}<h4>涵攝</h4><p>${e.application_text}</p><h4>結論</h4><p>${e.conclusion_text}</p><h4>25 分考場版參考答案</h4><p class="essay-answer">${e.essay_answer_25}</p><h4>15 分鐘精簡版</h4><p class="essay-answer">${e.essay_answer_15min}</p><h4>5 分鐘最低得分版</h4><p class="essay-answer">${e.essay_answer_5min}</p><h4>關鍵得分句</h4>${list(e.key_score_sentences)}${e.has_law_change?'':`<h4>法規版本說明</h4><p>${e.law_difference}</p>`}</div>`;
  return `<div class="explanation">${lawChangeAlert(e)}${lawReviewNotice(e)}<h4>官方答案</h4><p>${e.official_answer}</p><h4>核心考點</h4><p>${e.core_concept}</p><h4>正確答案理由</h4><p>${e.correct_reason}</p><h4>A／B／C／D 各自的意思與判斷</h4>${optionAnalysis(q,e)}<h4>相關法條與個別用途</h4>${laws(e)}<h4>白話解釋</h4><p>${e.plain_law}</p><h4>記憶技巧</h4><p>${e.memory_tip}</p><h4>常見陷阱</h4>${list(e.common_traps)}${e.has_law_change?'':`<h4>法規版本說明</h4><p>${e.law_difference||'未發現差異'}</p>`}</div>`;
}

function answerIsCorrect(answer,official){
  if(official==='ALL')return true;
  return Boolean(answer)&&String(official||'').split('/').includes(answer);
}
function officialAnswerLabel(answer){return answer==='ALL'?'一律給分':answer}

$('#submit').onclick=()=>{
  const message=state.mode==='review'?'確定結束複習並查看本次成績？':'確定交卷？交卷後才會顯示官方答案與預存詳解。';
  if(!confirm(message))return;
  let correct=0,incorrect=0,unanswered=0;
  const details=state.questions.map(q=>{const answer=state.answers[q.id];if(q.question_type==='multiple_choice'){if(q.official_answer==='ALL')correct++;else if(!answer)unanswered++;else if(answerIsCorrect(answer,q.official_answer))correct++;else incorrect++}return{q,answer,isCorrect:q.question_type==='multiple_choice'?answerIsCorrect(answer,q.official_answer):null}});
  const gradable=correct+incorrect,score=gradable?Math.round(correct/gradable*100):0,records=history();records.push({date:new Date().toISOString().slice(0,10),answered:gradable,correct,score});localStorage.setItem('exam-history',JSON.stringify(records));
  $('#runner').hidden=true;$('#result').hidden=false;
  $('#result').innerHTML=`<h2>${score} 分</h2><p>答對 ${correct}｜答錯 ${incorrect}｜未作答 ${unanswered}</p>`+details.map(({q,answer,isCorrect})=>`<div class="review"><b>第 ${q.question_number} 題｜${q.question_type==='composition'?'作文':q.question_type==='essay'?'申論':'單選'}</b><p>${q.question_text}</p>${reviewOptions(q,answer)}${q.question_type==='multiple_choice'?`<p class="${isCorrect?'correct':'wrong'}">你的答案：${answer||'未作答'}　官方答案：${officialAnswerLabel(q.official_answer)}</p>`:`<p><b>你的作答：</b>${answer||'未作答'}</p>`}<button class="show-explanation">${q.question_type==='composition'?'查看作文分析':q.question_type==='essay'?'查看參考答案':'AI 詳解'}</button><div class="ai" hidden>${explanationHtml(q)}</div></div>`).join('');
  document.querySelectorAll('.show-explanation').forEach(button=>button.onclick=()=>button.nextElementSibling.hidden=!button.nextElementSibling.hidden);loadDashboard();
};

$('#start').onclick=()=>start(100,false);$('#today').onclick=()=>start(20,true);
setInterval(()=>{if(!state.started||$('#runner').hidden)return;const left=Math.max(0,5400-Math.floor((Date.now()-state.started)/1000));$('#timer').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`},1000);
init().catch(error=>{$('#empty').innerHTML=`<p class="wrong">${error.message}</p>`});
