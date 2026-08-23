import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,GoogleAuthProvider,onAuthStateChanged,signInWithPopup,signOut} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {addDoc,collection,deleteDoc,doc,getDoc,getDocs,serverTimestamp,setDoc} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {getFirestore} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig={
  apiKey:'AIzaSyDG37p4JYM-SUZ2brI-_Piy9O9SzFkLlN0',
  authDomain:'real-estate-broker-exam-357.firebaseapp.com',
  projectId:'real-estate-broker-exam-357',
  storageBucket:'real-estate-broker-exam-357.firebasestorage.app',
  messagingSenderId:'131205779305',
  appId:'1:131205779305:web:177f38972415e596f837f8'
};

const app=initializeApp(firebaseConfig,'real-estate-broker-exam');
const auth=getAuth(app),db=getFirestore(app),provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});
let currentUser=null,bookmarkTimer=null,draftTimer=null;

const $=selector=>document.querySelector(selector);
const localBookmarks=()=>{try{return JSON.parse(localStorage.getItem('realEstateLawBookmarksV1')||'{}')||{}}catch{return {}}};
const localHistory=()=>{try{return JSON.parse(localStorage.getItem('exam-history')||'[]')||[]}catch{return []}};
const deviceId=()=>{let id=localStorage.getItem('study-device-id');if(!id){id=crypto.randomUUID();localStorage.setItem('study-device-id',id)}return id};
const userDoc=(...segments)=>doc(db,'users',currentUser.uid,...segments);

function setAccountUi(status,message){
  $('#account-title').textContent=status;
  $('#account-message').textContent=message;
  $('#google-login').hidden=Boolean(currentUser);
  $('#google-logout').hidden=!currentUser;
}

function mergeBookmarks(remote,local){
  const merged={...remote};
  Object.entries(local).forEach(([law,item])=>{
    const remoteItem=merged[law]||{},remoteTime=Date.parse(remoteItem.updatedAt||0),localTime=Date.parse(item?.updatedAt||0);
    const latest=localTime>=remoteTime?item:remoteItem,reviewArticles={...(remoteItem.reviewArticles||{})};
    Object.entries(item?.reviewArticles||{}).forEach(([articleNo,record])=>{
      const remoteRecord=reviewArticles[articleNo],remoteRecordTime=Date.parse(remoteRecord?.updatedAt||0),localRecordTime=Date.parse(record?.updatedAt||0);
      if(!remoteRecord||localRecordTime>=remoteRecordTime)reviewArticles[articleNo]=record;
    });
    merged[law]={...latest,reviewArticles};
  });
  return merged;
}

async function migrateLocalData(remoteBookmarks){
  const bookmarks=localBookmarks(),records=localHistory();
  if(!Object.keys(bookmarks).length&&!records.length)return {bookmarks:remoteBookmarks,importedRecords:[]};
  if(!confirm('這台瀏覽器已有書籤或考試紀錄。要合併到你的 Google 帳號嗎？\n\n合併成功後會移除本機舊資料，避免共用電腦殘留個人紀錄。'))return {bookmarks:remoteBookmarks,importedRecords:[]};
  const merged=mergeBookmarks(remoteBookmarks,bookmarks),id=deviceId();
  if(Object.keys(merged).length)await setDoc(userDoc('study','bookmarks'),{items:merged,updatedAt:serverTimestamp()},{merge:true});
  await Promise.all(records.map((record,index)=>setDoc(userDoc('attempts',`legacy-${id}-${index}`),{...record,source:'local-migration',createdAt:serverTimestamp()})));
  localStorage.removeItem('realEstateLawBookmarksV1');
  localStorage.removeItem('exam-history');
  return {bookmarks:merged,importedRecords:records};
}

async function loadUserData(){
  const [bookmarkSnap,attemptSnaps,draftSnap]=await Promise.all([
    getDoc(userDoc('study','bookmarks')),
    getDocs(collection(db,'users',currentUser.uid,'attempts')),
    getDoc(userDoc('study','currentExam'))
  ]);
  const remoteBookmarks=bookmarkSnap.data()?.items||{};
  const migration=await migrateLocalData(remoteBookmarks);
  const bookmarks=migration.bookmarks;
  const history=[...attemptSnaps.docs.map(item=>item.data()),...migration.importedRecords].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  window.dispatchEvent(new CustomEvent('study-cloud-ready',{detail:{bookmarks,history,draft:draftSnap.data()||null}}));
}

async function login(){
  setAccountUi('正在登入…','Google登入由Firebase安全處理，本站不會取得你的Google密碼。');
  try{await signInWithPopup(auth,provider)}catch(error){
    console.error('Google sign-in failed',error);
    setAccountUi('登入未完成','請允許彈出式登入視窗後再試一次；未登入仍可正常刷題。');
  }
}

async function logout(){
  await signOut(auth);
}

function saveBookmarks(items){
  if(!currentUser)return Promise.resolve(false);
  clearTimeout(bookmarkTimer);
  return new Promise(resolve=>{bookmarkTimer=setTimeout(async()=>{
    try{await setDoc(userDoc('study','bookmarks'),{items,updatedAt:serverTimestamp()},{merge:true});resolve(true)}
    catch(error){console.error('Bookmark sync failed',error);setAccountUi('同步暫時失敗','資料仍保留在目前畫面，請確認網路後再試。');resolve(false)}
  },250)});
}

async function saveAttempt(attempt){
  if(!currentUser)return false;
  try{await addDoc(collection(db,'users',currentUser.uid,'attempts'),{...attempt,createdAt:serverTimestamp()});return true}
  catch(error){console.error('Attempt sync failed',error);setAccountUi('成績同步失敗','請保持此頁開啟並確認網路連線。');return false}
}

function saveDraft(draft){
  if(!currentUser)return;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(()=>setDoc(userDoc('study','currentExam'),{...draft,updatedAt:serverTimestamp()}).catch(error=>console.error('Draft sync failed',error)),900);
}

async function clearDraft(){
  if(!currentUser)return;
  clearTimeout(draftTimer);
  try{await deleteDoc(userDoc('study','currentExam'))}catch(error){console.error('Draft clear failed',error)}
}

window.studyCloud={isSignedIn:()=>Boolean(currentUser),saveBookmarks,saveAttempt,saveDraft,clearDraft};
$('#google-login').addEventListener('click',login);
$('#google-logout').addEventListener('click',logout);

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){
    setAccountUi('登入後自動保存','使用 Google 帳號登入，可自動同步考試紀錄、錯題、作答進度與法條書籤。');
    window.dispatchEvent(new CustomEvent('study-cloud-signed-out'));
    return;
  }
  setAccountUi(`${user.displayName||'使用者'}，已安全登入`,'正在讀取你的私人學習紀錄…');
  try{
    await loadUserData();
    setAccountUi(`${user.displayName||'使用者'}，同步中`,'考試紀錄、錯題、進度與法條書籤會自動保存。');
  }catch(error){
    console.error('Cloud data load failed',error);
    setAccountUi('登入成功，但資料尚未同步','雲端權限或網路尚未就緒；未同步前請不要關閉本頁。');
  }
});
