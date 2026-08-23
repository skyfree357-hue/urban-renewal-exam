let bank=[];
let lawLibrary=[];
let glossary=[];
const LAW_BOOKMARK_STORAGE_KEY='realEstateLawBookmarksV1';
const lawArticleWindows=new Map();
let lawBookmarks=loadLawBookmarks();
let cloudHistory=null;
let lawResumeTarget=null;
let lawJumpTarget=null;
let lawReturnState=null;
let lawTermLookup=new Map();
let lawTermPattern=null;
let pinnedLawTerm=null;
let selectedMode='exam';
let state={questions:[],index:0,answers:{},graded:{},revealed:new Set(),marked:new Set(),started:0,mode:'exam'};
const $=selector=>document.querySelector(selector);

window.addEventListener('study-cloud-ready',event=>{
  cloudHistory=event.detail.history||[];
  lawBookmarks=event.detail.bookmarks||{};
  renderLawLibrary();loadDashboard();
  restoreCloudDraft(event.detail.draft);
});
window.addEventListener('study-cloud-signed-out',()=>{
  cloudHistory=null;lawBookmarks=loadLawBookmarks();renderLawLibrary();loadDashboard();
});

async function init(){
  [bank,lawLibrary,glossary]=await Promise.all([loadBank(),loadJson('./data/law_library.json?v=20260823-5','laws'),loadJson('./data/glossary.json?v=20260823-3','terms')]);
  buildLawTermLookup();
  setupLawTermTooltip();
  const years=[...new Set(bank.map(q=>q.exam_year))].sort((a,b)=>b-a);
  $('#year-select').innerHTML=years.map(year=>`<option value="${year}">${year} 年</option>`).join('');
  $('#year-select').value=years[0];
  $('#year-select').onchange=()=>{refreshSubjects();reloadSelectedExam()};
  $('#subject-select').onchange=()=>{updateExamTitle();reloadSelectedExam()};
  refreshSubjects();
  document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>selectMode(button.dataset.mode));
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>showStudyView(button.dataset.view));
  setupLibraries();
  loadDashboard();
}

async function loadJson(url,key){
  const response=await fetch(url);
  if(!response.ok)return [];
  return (await response.json())[key]||[];
}

function showStudyView(view){
  document.querySelectorAll('.study-view').forEach(section=>section.hidden=section.id!==`${view}-view`);
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
  if(view==='laws')renderLawLibrary();
  if(view==='terms')renderGlossary();
  window.scrollTo({top:0,behavior:'smooth'});
}

function setupLibraries(){
  const lawSubjects=[...new Set(lawLibrary.flatMap(law=>law.subjects||[]))];
  $('#law-subject').innerHTML='<option value="">全部科目</option>'+lawSubjects.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  $('#law-category').innerHTML='<option value="">全部類型</option><option value="__essay__">申論題出現過</option>'+[...new Set(lawLibrary.map(x=>x.category))].map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  $('#term-subject').innerHTML='<option value="">全部科目</option>'+[...new Set(glossary.map(x=>x.subject))].map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  $('#term-category').innerHTML='<option value="">全部類型</option>';
  ['law-subject','law-category'].forEach(id=>$('#'+id).addEventListener('change',()=>{lawJumpTarget=null;renderLawLibrary()}));
  $('#law-search').addEventListener('input',()=>{lawJumpTarget=null;renderLawLibrary()});
  $('#back-to-question').onclick=returnToQuestion;
  $('#exam-view').addEventListener('click',event=>{const button=event.target.closest('[data-open-law]');if(button)openLawLibraryFromQuestion(button)});
  $('#term-subject').onchange=()=>{refreshTermCategories();renderGlossary()};
  $('#term-category').onchange=renderGlossary;
  $('#term-search').oninput=renderGlossary;
  $('#law-list').onclick=event=>{
    const bookmarkCheckbox=event.target.closest('[data-law-bookmark-check]');
    if(bookmarkCheckbox){
      event.stopPropagation();
      setLawBookmarkSelection(bookmarkCheckbox.dataset.bookmarkLaw,bookmarkCheckbox.dataset.bookmarkArticle,bookmarkCheckbox.checked);
      return;
    }
    const resumeButton=event.target.closest('[data-law-resume]');
    if(resumeButton){event.preventDefault();event.stopPropagation();resumeLawBookmark(resumeButton.dataset.lawResume);return}
    const button=event.target.closest('[data-law-more]');if(!button)return;
    const name=button.dataset.lawMore,current=lawArticleWindows.get(name)||{articleNo:null,count:30};
    lawArticleWindows.set(name,{...current,count:current.count+50});renderLawLibrary();
    requestAnimationFrame(()=>document.querySelector(`.law-group[data-law-name="${CSS.escape(name)}"]`)?.setAttribute('open',''));
  };
  refreshTermCategories();
  renderLawLibrary();renderGlossary();
}

function refreshTermCategories(){
  const subject=$('#term-subject').value,previous=$('#term-category').value;
  const categories=[...new Set(glossary.filter(x=>!subject||x.subject===subject).map(x=>x.category))];
  $('#term-category').innerHTML='<option value="">全部類型</option><option value="__essay__">申論題出現過</option>'+categories.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  $('#term-category').value=previous==='__essay__'||categories.includes(previous)?previous:'';
}

function renderLawLibrary(){
  hideLawTermTooltip(true);
  const subject=$('#law-subject').value,category=$('#law-category').value,query=$('#law-search').value.trim().toLowerCase();
  const essayOnly=category==='__essay__';
  const filtered=lawLibrary.map(law=>{
    if(lawJumpTarget&&law.law_name!==lawJumpTarget.lawName)return null;
    if(subject&&!(law.subjects||[]).includes(subject))return null;
    if(category&&!essayOnly&&law.category!==category)return null;
    const nameMatch=!query||`${law.law_name} ${law.category}`.toLowerCase().includes(query);
    const articles=sortLawArticles((law.articles||[]).filter(a=>(!lawJumpTarget||String(a.article_no)===lawJumpTarget.articleNo)&&(!essayOnly||a.essay_question_count>0)&&(nameMatch||`${a.article_no} ${a.content} ${a.plain_explanation}`.toLowerCase().includes(query))),essayOnly);
    const displayCount=essayOnly?articles.reduce((n,a)=>n+a.essay_question_count,0):law.question_count;
    return articles.length?{...law,articles,displayCount}:null;
  }).filter(Boolean).sort((a,b)=>b.displayCount-a.displayCount||a.law_name.localeCompare(b.law_name,'zh-Hant'));
  const articleTotal=filtered.reduce((n,x)=>n+x.articles.length,0),hitTotal=filtered.reduce((n,x)=>n+x.displayCount,0);
  $('#law-summary').textContent=essayOnly?`${filtered.length} 部法規｜${articleTotal} 條｜申論題命中 ${hitTotal} 次`:`${filtered.length} 部法規｜${articleTotal.toLocaleString()} 條｜${hitTotal} 次考題命中`;
  if(!filtered.length){$('#law-list').innerHTML='<div class="empty-library">找不到符合條件的法條</div>';return}
  $('#law-list').innerHTML=filtered.map((law,index)=>{
    const windowState=lawArticleWindows.get(law.law_name)||{articleNo:null,count:30};
    const foundIndex=windowState.articleNo?law.articles.findIndex(article=>String(article.article_no)===String(windowState.articleNo)):-1;
    const startIndex=foundIndex>=0?foundIndex:0,limit=query?law.articles.length:windowState.count;
    const shownArticles=law.articles.slice(startIndex,startIndex+limit),remaining=Math.max(0,law.articles.length-startIndex-shownArticles.length);
    const bookmark=lawBookmarks[law.law_name],resumeLabel=bookmark?`🔖 接續第 ${bookmark.articleNo} 條`:'🔖 尚未設定';
    const shouldOpen=index===0||lawResumeTarget===law.law_name;
    return `<details class="law-group" data-law-name="${escapeHtml(law.law_name)}" ${shouldOpen?'open':''}><summary><div class="law-title"><b>${escapeHtml(law.law_name)}</b><span class="category-badge">${escapeHtml(law.category)}</span><span class="count-badge ${law.displayCount?'':'zero'}">${essayOnly?`申論命中 ${law.displayCount} 次`:law.question_count?`歷屆命中 ${law.question_count} 次`:'尚未出題'}</span></div><div class="law-summary-actions"><span class="law-source">${essayOnly?`申論涉及 ${law.articles.length} 條`:`共 ${law.article_count} 條`}｜展開閱讀</span><button type="button" class="law-bookmark" data-law-resume="${escapeHtml(law.law_name)}" aria-label="${escapeHtml(law.law_name)}${escapeHtml(resumeLabel)}" ${bookmark?'':'disabled'}>${escapeHtml(resumeLabel)}</button></div></summary><div class="article-list">${shownArticles.map(article=>renderLawArticle(article,law,essayOnly,bookmark)).join('')}${remaining?`<button type="button" class="load-more" data-law-more="${escapeHtml(law.law_name)}">再顯示 ${Math.min(50,remaining)} 條</button>`:''}<p class="law-source">官方來源：<a href="${escapeHtml(law.source_url)}" target="_blank" rel="noreferrer">全國法規資料庫</a></p></div></details>`;
  }).join('');
}

function renderLawArticle(article,law,essayOnly,bookmark){
  const isBookmarked=String(bookmark?.articleNo||'')===String(article.article_no);
  return `<section class="article-item" data-bookmark-law="${escapeHtml(law.law_name)}" data-bookmark-article="${escapeHtml(article.article_no)}"><div class="article-heading"><h4>第 ${escapeHtml(article.article_no)} 條 <span class="count-badge ${article.question_count?'':'zero'}">${essayOnly?`申論命中 ${article.essay_question_count} 題`:article.question_count?`命中 ${article.question_count} 題`:'未出題'}</span></h4><label class="article-bookmark-check"><input type="checkbox" data-law-bookmark-check data-bookmark-law="${escapeHtml(law.law_name)}" data-bookmark-article="${escapeHtml(article.article_no)}" ${isBookmarked?'checked':''}> 設為書籤</label></div><p class="official-text">${lawTermMarkup(article.content)}</p>${articleExplanationDetails(article)}</section>`;
}

function loadLawBookmarks(){
  try{return JSON.parse(localStorage.getItem(LAW_BOOKMARK_STORAGE_KEY)||'{}')||{}}catch{return {}}
}

function setLawBookmarkSelection(lawName,articleNo,checked){
  if(!lawName||!articleNo)return;
  if(checked)lawBookmarks[lawName]={articleNo,updatedAt:new Date().toISOString()};
  else if(String(lawBookmarks[lawName]?.articleNo||'')===String(articleNo))delete lawBookmarks[lawName];
  if(window.studyCloud?.isSignedIn())window.studyCloud.saveBookmarks(lawBookmarks);
  else try{localStorage.setItem(LAW_BOOKMARK_STORAGE_KEY,JSON.stringify(lawBookmarks))}catch{}
  const button=document.querySelector(`[data-law-resume="${CSS.escape(lawName)}"]`);
  const saved=lawBookmarks[lawName]?.articleNo;
  if(button){button.textContent=saved?`🔖 接續第 ${saved} 條`:'🔖 尚未設定';button.disabled=!saved;button.setAttribute('aria-label',saved?`${lawName}接續第 ${saved} 條`:`${lawName}尚未設定書籤`)}
  document.querySelectorAll(`[data-law-bookmark-check][data-bookmark-law="${CSS.escape(lawName)}"]`).forEach(input=>{input.checked=String(input.dataset.bookmarkArticle)===String(saved||'')});
}

function resumeLawBookmark(lawName){
  const articleNo=lawBookmarks[lawName]?.articleNo||null;
  if(!articleNo)return;
  lawArticleWindows.set(lawName,{articleNo,count:51});lawResumeTarget=lawName;renderLawLibrary();lawResumeTarget=null;
  requestAnimationFrame(()=>{
    const group=document.querySelector(`.law-group[data-law-name="${CSS.escape(lawName)}"]`);group?.setAttribute('open','');
    const target=articleNo?group?.querySelector(`[data-bookmark-article="${CSS.escape(String(articleNo))}"]`):group?.querySelector('[data-bookmark-article]');
    (target||group)?.scrollIntoView({behavior:'smooth',block:'start'});
  });
}

function articleExplanationDetails(article){
  const importance=['高','中','低'].includes(article.exam_importance)?article.exam_importance:'低';
  const title=article.analysis_type==='law_significance'?'法條意義':'理解與判斷';
  const angles=(article.exam_angles||[]).length?`<div class="exam-angle-list"><b>歷屆考法</b><ul>${article.exam_angles.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`:'';
  return `<details class="plain-details"><summary><span class="analysis-summary">應試拆解 <em class="importance-badge importance-${importance}">考試重要度：${importance}</em></span><span class="toggle-label">展開閱讀</span></summary><div class="plain-box"><b class="analysis-title">${title}</b><div>${escapeHtml(article.plain_explanation)}</div>${angles}</div></details>`;
}

function sortLawArticles(articles,essayOnly){
  return [...articles].sort((a,b)=>(essayOnly?b.essay_question_count-a.essay_question_count:b.question_count-a.question_count)||String(a.article_no).localeCompare(String(b.article_no),'zh-Hant',{numeric:true}));
}

function renderGlossary(){
  const subject=$('#term-subject').value,category=$('#term-category').value,query=$('#term-search').value.trim().toLowerCase();
  const essayOnly=category==='__essay__';
  const filtered=glossary.filter(x=>(!subject||x.subject===subject)&&(!category||(essayOnly?x.essay_question_count>0:x.category===category))&&(!query||`${x.term} ${x.plain_explanation} ${x.exam_tip}`.toLowerCase().includes(query))).sort((a,b)=>(essayOnly?b.essay_question_count-a.essay_question_count:b.question_count-a.question_count)||a.term.localeCompare(b.term,'zh-Hant'));
  $('#term-summary').textContent=essayOnly?`${filtered.length} 個名詞｜依申論題命中題數排序`:`${filtered.length} 個名詞｜依歷屆命中題數排序`;
  $('#term-list').innerHTML=filtered.length?filtered.map(term=>{const years=essayOnly?(term.essay_years||[]):term.years;return `<article class="term-card"><header><h3>${escapeHtml(term.term)}</h3><span class="count-badge ${(essayOnly?term.essay_question_count:term.question_count)?'':'zero'}">${essayOnly?`申論出現於 ${term.essay_question_count} 題`:term.question_count?`出現於 ${term.question_count} 題`:'補充觀念'}</span></header><div class="term-meta"><span>${escapeHtml(term.subject)}</span><span>・</span><span>${escapeHtml(term.category)}</span>${years.length?`<span>・</span><span>${years.join('、')} 年</span>`:''}</div><p>${escapeHtml(term.plain_explanation)}</p><p class="exam-tip"><b>考題怎麼判斷：</b>${escapeHtml(term.exam_tip)}</p></article>`}).join(''):'<div class="empty-library">找不到符合條件的專有名詞</div>';
}

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}

function buildLawTermLookup(){
  lawTermLookup=new Map();
  glossary.forEach(term=>{
    const existing=lawTermLookup.get(term.term);
    if(!existing||term.question_count>existing.question_count)lawTermLookup.set(term.term,term);
  });
  const words=[...lawTermLookup.keys()].filter(word=>word.length>=2).sort((a,b)=>b.length-a.length);
  lawTermPattern=words.length?new RegExp(words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'gu'):null;
}

function lawTermMarkup(value){
  const text=String(value??'');
  if(!lawTermPattern)return escapeHtml(text);
  lawTermPattern.lastIndex=0;
  let html='',last=0,match;
  while((match=lawTermPattern.exec(text))!==null){
    html+=escapeHtml(text.slice(last,match.index));
    html+=`<button type="button" class="law-term" data-law-term="${escapeHtml(match[0])}" aria-expanded="false" aria-describedby="law-term-tooltip">${escapeHtml(match[0])}</button>`;
    last=match.index+match[0].length;
  }
  return html+escapeHtml(text.slice(last));
}

function setupLawTermTooltip(){
  if($('#law-term-tooltip'))return;
  const tooltip=document.createElement('div');
  tooltip.id='law-term-tooltip';tooltip.className='law-term-tooltip';tooltip.role='tooltip';tooltip.hidden=true;
  tooltip.innerHTML='<strong></strong><p></p><small></small>';
  document.body.appendChild(tooltip);
  document.addEventListener('mouseover',event=>{const term=event.target.closest?.('.law-term');if(term&&!pinnedLawTerm)showLawTermTooltip(term)});
  document.addEventListener('mouseout',event=>{const term=event.target.closest?.('.law-term');if(term&&!term.contains(event.relatedTarget)&&!pinnedLawTerm)hideLawTermTooltip()});
  document.addEventListener('focusin',event=>{const term=event.target.closest?.('.law-term');if(term&&!pinnedLawTerm)showLawTermTooltip(term)});
  document.addEventListener('focusout',event=>{const term=event.target.closest?.('.law-term');if(term&&!pinnedLawTerm)hideLawTermTooltip()});
  document.addEventListener('click',event=>{
    const term=event.target.closest?.('.law-term');
    if(term){event.preventDefault();pinnedLawTerm===term?hideLawTermTooltip(true):showLawTermTooltip(term,true);return}
    if(pinnedLawTerm)hideLawTermTooltip(true);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideLawTermTooltip(true)});
  window.addEventListener('resize',()=>pinnedLawTerm?positionLawTermTooltip(pinnedLawTerm):hideLawTermTooltip());
  window.addEventListener('scroll',()=>pinnedLawTerm?positionLawTermTooltip(pinnedLawTerm):hideLawTermTooltip(),true);
}

function showLawTermTooltip(element,pin=false){
  const term=lawTermLookup.get(element.dataset.lawTerm);if(!term)return;
  if(pinnedLawTerm&&pinnedLawTerm!==element)pinnedLawTerm.setAttribute('aria-expanded','false');
  pinnedLawTerm=pin?element:null;
  document.querySelectorAll('.law-term[aria-expanded="true"]').forEach(item=>item.setAttribute('aria-expanded','false'));
  element.setAttribute('aria-expanded','true');
  const tooltip=$('#law-term-tooltip');
  tooltip.querySelector('strong').textContent=term.term;
  tooltip.querySelector('p').textContent=term.plain_explanation;
  tooltip.querySelector('small').textContent=`考題判斷：${term.exam_tip}`;
  tooltip.hidden=false;positionLawTermTooltip(element);
}

function positionLawTermTooltip(element){
  const tooltip=$('#law-term-tooltip');if(!tooltip||tooltip.hidden||!element?.isConnected)return;
  const anchor=element.getBoundingClientRect(),box=tooltip.getBoundingClientRect(),gap=10,edge=12;
  const left=Math.max(edge,Math.min(anchor.left,window.innerWidth-box.width-edge));
  let top=anchor.top-box.height-gap;
  if(top<edge)top=Math.min(window.innerHeight-box.height-edge,anchor.bottom+gap);
  tooltip.style.left=`${left}px`;tooltip.style.top=`${Math.max(edge,top)}px`;
}

function hideLawTermTooltip(force=false){
  if(pinnedLawTerm&&!force)return;
  document.querySelectorAll('.law-term[aria-expanded="true"]').forEach(item=>item.setAttribute('aria-expanded','false'));
  pinnedLawTerm=null;const tooltip=$('#law-term-tooltip');if(tooltip)tooltip.hidden=true;
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

function history(){
  if(Array.isArray(cloudHistory))return cloudHistory;
  try{return JSON.parse(localStorage.getItem('exam-history')||'[]')}catch{return []}
}
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
  state={questions:questions.slice(0,limit),index:0,answers:{},graded:{},revealed:new Set(),marked:new Set(),started:Date.now(),mode:selectedMode};
  $('#empty').hidden=true;$('#result').hidden=true;$('#runner').hidden=false;render();scheduleDraftSave();
}

function draftSnapshot(){
  if(!state.questions.length||$('#runner').hidden)return null;
  return {questionIds:state.questions.map(q=>q.id),index:state.index,answers:state.answers,graded:state.graded,revealed:[...state.revealed],marked:[...state.marked],started:state.started,mode:state.mode,examYear:state.questions[0]?.exam_year,subject:state.questions[0]?.subject};
}

function scheduleDraftSave(){
  const draft=draftSnapshot();if(draft&&window.studyCloud?.isSignedIn())window.studyCloud.saveDraft(draft);
}

function restoreCloudDraft(draft){
  if(!draft?.questionIds?.length||state.questions.length)return;
  const questions=draft.questionIds.map(id=>bank.find(q=>String(q.id)===String(id))).filter(Boolean);
  if(!questions.length||!confirm(`找到一份未完成的${draft.subject||''}試卷（已作答 ${Object.keys(draft.answers||{}).length} 題），要接著作答嗎？`))return;
  selectedMode=draft.mode==='review'?'review':'exam';
  state={questions,index:Math.min(Number(draft.index)||0,questions.length-1),answers:draft.answers||{},graded:draft.graded||{},revealed:new Set(draft.revealed||[]),marked:new Set(draft.marked||[]),started:Number(draft.started)||Date.now(),mode:selectedMode};
  document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===selectedMode));
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
  const referenceButton=$('#show-reference');
  referenceButton.hidden=!(state.mode==='review'&&q.question_type==='essay');
  referenceButton.textContent=state.revealed.has(q.id)?'收合申論題參考答案':'查看申論題參考答案';
  const feedback=$('#instant-feedback');
  if(state.mode==='review'&&grade){
    feedback.hidden=false;
    feedback.innerHTML=`<div class="instant-result ${grade.isCorrect?'correct-result':'wrong-result'}"><strong>${grade.isCorrect?'答對了':'答錯了'}</strong><span>你的答案：${grade.answer}　官方答案：${officialAnswerLabel(q.official_answer)}</span><small class="answer-locked">答案已鎖定，請前往下一題。</small></div>${explanationHtml(q)}`;
  }else if(state.mode==='review'&&q.question_type==='essay'&&state.revealed.has(q.id)){
    feedback.hidden=false;
    feedback.innerHTML=explanationHtml(q);
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
  render();scheduleDraftSave();
};
$('#essay').oninput=event=>{state.answers[state.questions[state.index].id]=event.target.value;scheduleDraftSave()};
$('#show-reference').onclick=()=>{
  const q=state.questions[state.index];
  if(state.mode!=='review'||q.question_type!=='essay')return;
  state.revealed.has(q.id)?state.revealed.delete(q.id):state.revealed.add(q.id);
  render();
};
$('#nav').onclick=event=>{const button=event.target.closest('[data-index]');if(button){state.index=Number(button.dataset.index);render();scheduleDraftSave()}};
$('#prev').onclick=()=>{state.index=Math.max(0,state.index-1);render();scheduleDraftSave()};$('#next').onclick=()=>{state.index=Math.min(state.questions.length-1,state.index+1);render();scheduleDraftSave()};
$('#mark').onclick=()=>{const id=state.questions[state.index].id;state.marked.has(id)?state.marked.delete(id):state.marked.add(id);render();scheduleDraftSave()};

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
function citationArticleNumbers(citation){
  const text=String(citation||'').replace(/\s+/g,'').replace(/，/g,'、'),numbers=new Set();
  const addRange=(start,end)=>{const a=Number(start),b=Number(end);if(Number.isInteger(a)&&Number.isInteger(b)&&b>=a&&b-a<=50)for(let n=a;n<=b;n++)numbers.add(String(n))};
  for(const match of text.matchAll(/第(\d+)條至第?(\d+)條/g))addRange(match[1],match[2]);
  for(const match of text.matchAll(/第([0-9、,至\-]+)條(?:之(\d+))?/g)){
    const raw=match[1];
    if(match[2]){numbers.add(`${raw}-${match[2]}`);continue}
    for(const part of raw.split(/[、,]/)){
      const range=part.match(/^(\d+)至(\d+)$/);if(range)addRange(range[1],range[2]);
      else if(/^\d+(?:-\d+)?$/.test(part))numbers.add(part);
    }
  }
  return [...numbers];
}

function citedOfficialArticles(citation){
  const compact=String(citation||'').replace(/\s+/g,'');
  const aliases={'估價技術規則':'不動產估價技術規則'};
  const aliasName=Object.entries(aliases).find(([alias])=>compact.includes(alias))?.[1];
  const law=lawLibrary.find(item=>item.law_name===aliasName)||[...lawLibrary].sort((a,b)=>b.law_name.length-a.law_name.length).find(item=>compact.includes(item.law_name.replace(/\s+/g,'')));
  if(!law)return null;
  const wanted=citationArticleNumbers(citation),byNumber=new Map((law.articles||[]).map(article=>[String(article.article_no).replace(/之/g,'-'),article]));
  const articles=wanted.map(number=>byNumber.get(number.replace(/之/g,'-'))).filter(Boolean);
  return articles.length?{law,articles}:null;
}

function openLawLibraryFromQuestion(button){
  lawReturnState={scrollY:window.scrollY};
  lawJumpTarget={lawName:button.dataset.openLaw,articleNo:button.dataset.articleNo};
  $('#law-subject').value='';$('#law-category').value='';$('#law-search').value='';
  $('#back-to-question').hidden=false;
  showStudyView('laws');
}

function returnToQuestion(){
  const scrollY=lawReturnState?.scrollY||0;
  lawJumpTarget=null;lawReturnState=null;$('#back-to-question').hidden=true;
  showStudyView('exam');
  requestAnimationFrame(()=>window.scrollTo({top:scrollY,behavior:'auto'}));
}

function completeLawReference(citation,sourceUrl){
  const result=citedOfficialArticles(citation);
  if(!result)return sourceUrl?`<p class="law-source-missing">這項依據尚未收錄在完整法條庫，請直接<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">到官方法規來源核對</a>。</p>`:'';
  return `<details class="question-law-details"><summary>查看引用的完整法條與應試拆解 <span>展開閱讀</span></summary><div class="question-law-articles">${result.articles.map(article=>`<section><b>${escapeHtml(result.law.law_name)}第 ${escapeHtml(article.article_no)} 條</b><p class="official-text">${lawTermMarkup(article.content)}</p><details class="question-law-plain"><summary>應試拆解 <span>展開閱讀</span></summary><p>${escapeHtml(article.plain_explanation)}</p></details><button type="button" class="open-law-library" data-open-law="${escapeHtml(result.law.law_name)}" data-article-no="${escapeHtml(article.article_no)}">到「完整法條」閱讀</button></section>`).join('')}<a href="${escapeHtml(result.law.source_url)}" target="_blank" rel="noreferrer">到全國法規資料庫核對</a></div></details>`;
}

function laws(e){
  if(e.law_explanations?.length)return `<div class="law-cards">${e.law_explanations.map(item=>`<div class="law-card"><b>${shown(item.citation,'法規依據')}</b><p><strong>本題相關規則：</strong>${shown(item.meaning,'本題相關部分說明尚待補充')}</p><small>本題用途：${shown(item.use,'作為判斷本題法律效果的規範基礎')}</small>${completeLawReference(item.citation,e.current_law_source_url)}</div>`).join('')}</div>`;
  return list(e.related_laws);
}
function explanationHtml(q){
  const e=q.explanation;if(!e)return '<p class="pending">本題詳解尚未建立</p>';
  if(q.question_type==='composition'){
    const c=e.composition_analysis||{};
    return `<div class="explanation"><h4>題意</h4><p>${shown(c.purpose)}</p><h4>關鍵字</h4>${list(c.keywords)}<h4>不能離題的核心</h4><p>${shown(c.must_address)}</p><h4>可採立場</h4>${list(c.positions)}<h4>文章架構</h4>${list(c.structure)}<h4>適合例子</h4>${list(c.examples)}<h4>可用名言／典故</h4>${list(c.quotes)}<h4>容易扣分處</h4>${list(c.pitfalls)}<h4>作文大綱</h4>${list(c.outline)}<h4>四段式版本</h4>${list(c.four_paragraph)}<h4>五段式版本</h4>${list(c.five_paragraph)}<h4>開頭範例</h4><p class="essay-answer">${shown(c.opening)}</p><h4>結尾範例</h4><p class="essay-answer">${shown(c.ending)}</p></div>`;
  }
  if(q.question_type==='essay')return `<div class="explanation">${lawChangeAlert(e)}${lawReviewNotice(e)}<h4>核心考點</h4><p>${e.core_concept}</p><h4>爭點</h4>${list(e.issues)}<h4>配分點</h4>${list(e.scoring_points.map(x=>`${x.point}（${x.score} 分）`))}<h4>法律依據與個別用途</h4>${laws(e)}<h4>涵攝</h4><p>${e.application_text}</p><h4>結論</h4><p>${e.conclusion_text}</p><h4>25 分考場版參考答案</h4><p class="essay-answer">${e.essay_answer_25}</p><h4>15 分鐘精簡版</h4><p class="essay-answer">${e.essay_answer_15min}</p><h4>5 分鐘最低得分版</h4><p class="essay-answer">${e.essay_answer_5min}</p><h4>關鍵得分句</h4>${list(e.key_score_sentences)}${e.has_law_change?'':`<h4>法規版本說明</h4><p>${e.law_difference}</p>`}</div>`;
  return `<div class="explanation">${lawChangeAlert(e)}${lawReviewNotice(e)}<h4>官方答案</h4><p>${e.official_answer}</p><h4>核心考點</h4><p>${e.core_concept}</p><h4>正確答案理由</h4><p>${e.correct_reason}</p><h4>A／B／C／D 各自的意思與判斷</h4>${optionAnalysis(q,e)}<h4>相關法條與個別用途</h4>${laws(e)}<h4>本題判斷白話整理</h4><p>${e.plain_law}</p><h4>記憶技巧</h4><p>${e.memory_tip}</p><h4>常見陷阱</h4>${list(e.common_traps)}${e.has_law_change?'':`<h4>法規版本說明</h4><p>${e.law_difference||'未發現差異'}</p>`}</div>`;
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
  const gradable=correct+incorrect,score=gradable?Math.round(correct/gradable*100):0,records=history();
  const attempt={date:new Date().toISOString().slice(0,10),answered:gradable,correct,incorrect,unanswered,score,examYear:state.questions[0]?.exam_year,subject:state.questions[0]?.subject,mode:state.mode,durationSeconds:Math.max(0,Math.round((Date.now()-state.started)/1000)),responses:details.map(({q,answer,isCorrect})=>({questionId:q.id,questionNumber:q.question_number,questionType:q.question_type,answer:answer||null,isCorrect}))};
  records.push(attempt);
  if(window.studyCloud?.isSignedIn()){window.studyCloud.saveAttempt(attempt);window.studyCloud.clearDraft()}else localStorage.setItem('exam-history',JSON.stringify(records));
  $('#runner').hidden=true;$('#result').hidden=false;
  $('#result').innerHTML=`<h2>${score} 分</h2><p>答對 ${correct}｜答錯 ${incorrect}｜未作答 ${unanswered}</p>`+details.map(({q,answer,isCorrect})=>`<div class="review"><b>第 ${q.question_number} 題｜${q.question_type==='composition'?'作文':q.question_type==='essay'?'申論':'單選'}</b><p>${q.question_text}</p>${reviewOptions(q,answer)}${q.question_type==='multiple_choice'?`<p class="${isCorrect?'correct':'wrong'}">你的答案：${answer||'未作答'}　官方答案：${officialAnswerLabel(q.official_answer)}</p>`:`<p><b>你的作答：</b>${answer||'未作答'}</p>`}<button class="show-explanation">${q.question_type==='composition'?'查看作文分析':q.question_type==='essay'?'查看參考答案':'AI 詳解'}</button><div class="ai" hidden>${explanationHtml(q)}</div></div>`).join('');
  document.querySelectorAll('.show-explanation').forEach(button=>button.onclick=()=>button.nextElementSibling.hidden=!button.nextElementSibling.hidden);loadDashboard();
};

$('#start').onclick=()=>start(100,false);$('#today').onclick=()=>start(20,true);
setInterval(()=>{if(!state.started||$('#runner').hidden)return;const left=Math.max(0,5400-Math.floor((Date.now()-state.started)/1000));$('#timer').textContent=`${String(Math.floor(left/60)).padStart(2,'0')}:${String(left%60).padStart(2,'0')}`},1000);
init().catch(error=>{$('#empty').innerHTML=`<p class="wrong">${error.message}</p>`});
