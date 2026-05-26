// === DEFAULT DATA (fallback when DB is empty) ===
const DEF_CHARS=[
{id:1,name:'蝴蝶女孩',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#831843,#ec4899,#fbcfe8)',files:['png','fla']},
{id:3,name:'灰衣',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#374151,#6b7280,#d1d5db)',files:['png','fla']},
{id:34,name:'新潮妹妹',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#4c1d95,#7c3aed,#1f2937)',files:['png','fla'],imgs:['assets/新潮妹妹.png','assets/新潮妹妹动作.png']},
{id:35,name:'校服少女',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#312e81,#4338ca,#e0e7ff)',files:['png','fla']},
{id:36,name:'蓝衣警花',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#1e3a5f,#60a5fa,#1e293b)',files:['png','fla']},
{id:37,name:'银发学院少年',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#312e81,#6366f1,#c7d2fe)',files:['png','fla']},
{id:38,name:'紫发街头少年',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#1e1b4b,#7c3aed,#4b5563)',files:['png','fla']},
{id:39,name:'校服少年',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#1e3a5f,#3b82f6,#6b7280)',files:['png','fla']},
{id:40,name:'破衣幽魂',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#1c1917,#57534e,#a8a29e)',files:['png','fla']},
{id:41,name:'卷发编辫少女',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#78716c,#d6d3d1,#292524)',files:['png','fla']},
{id:42,name:'金发风衣少年',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#a16207,#fde68a,#1e293b)',files:['png','fla']},
{id:44,name:'泳装少女',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#4b5563,#818cf8,#e0e7ff)',files:['png','fla']},
{id:45,name:'新潮妹妹表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#1e1b4b,#6366f1,#c7d2fe)',files:['gif','fla'],imgs:['assets/新潮妹妹表情.gif']},
{id:46,name:'美男表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#9ca3af,#c4b5fd,#e5e7eb)',files:['gif','fla'],imgs:['assets/美男表情.gif']},
{id:47,name:'手枪',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#1f2937,#d4af37,#f5f5f4)',files:['png','fla']},
{id:48,name:'手机',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#475569,#94a3b8,#cbd5e1)',files:['png','fla']},
{id:49,name:'奶茶',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#92400e,#d4a574,#fef3c7)',files:['png','fla']},
{id:53,name:'吉他',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#1e3a5f,#e2e8f0,#f8fafc)',files:['png','fla']},
{id:50,name:'Q版魔鬼',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#1c1917,#991b1b,#292524)',files:['png','fla']},
{id:51,name:'Q版天使',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#fefce8,#eab308,#f5f5f4)',files:['png','fla']},
{id:52,name:'蓝裙美女',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#1e1b4b,#3b82f6,#f8fafc)',files:['png','fla']},
{id:54,name:'宝箱',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#1c1917,#92400e,#d97706)',files:['png','fla']},
{id:55,name:'宝箱2',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#1e3a5f,#2563eb,#38bdf8)',files:['png','fla']},
{id:56,name:'宝箱3',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#1e1b4b,#7c3aed,#a78bfa)',files:['png','fla']},
{id:57,name:'发带',isNew:true,cat:'道具栏',grad:'linear-gradient(160deg,#831843,#ec4899,#fbcfe8)',files:['png','fla']},
{id:58,name:'情侣运动装',isNew:true,cat:'人物',grad:'linear-gradient(160deg,#4c1d95,#7c3aed,#e0e7ff)',files:['png','fla']},
{id:59,name:'运动女孩单面',isNew:true,limit:true,cat:'人物',grad:'linear-gradient(160deg,#ea580c,#fb923c,#fed7aa)',files:['png','fla']},
{id:60,name:'斯文妹妹',isNew:true,limit:true,cat:'人物',grad:'linear-gradient(160deg,#0f766e,#14b8a6,#99f6e4)',files:['png','fla']},
{id:62,name:'国民小哥',isNew:true,limit:true,cat:'人物',grad:'linear-gradient(160deg,#1e40af,#3b82f6,#93c5fd)',files:['png','fla']},
{id:11,name:'紫发爱心正面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#7c3aed,#c084fc,#f9a8d4)',files:['fla','png'],imgs:['assets/紫髮愛心正面.png']},
{id:21,name:'紫发爱心侧面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#8b5cf6,#c4b5fd,#ede9fe)',files:['fla','gif'],imgs:['assets/紫髮愛心側.gif']},
{id:22,name:'紫发爱心正侧',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#6d28d9,#a78bfa,#ddd6fe)',files:['fla','gif'],imgs:['assets/紫髮愛心正側.gif']},
{id:12,name:'国民哥哥表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#0f766e,#14b8a6,#99f6e4)',files:['fla','gif'],imgs:['assets/國民哥哥表情.gif']},
{id:13,name:'彩虹表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#f43f5e,#fb923c,#facc15,#4ade80,#38bdf8,#a78bfa)',files:['fla','gif'],imgs:['assets/彩虹表情.gif']},
{id:14,name:'银发少年正面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#94a3b8,#cbd5e1,#e2e8f0)',files:['fla','png'],imgs:['assets/銀髮少年正面.png']},
{id:23,name:'银发少年正侧',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#64748b,#94a3b8,#cbd5e1)',files:['fla','png'],imgs:['assets/銀髮少年正側.png']},
{id:15,name:'眼镜学长',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#78350f,#a16207,#fbbf24)',files:['fla','gif'],imgs:['assets/眼鏡學長.gif']},
{id:16,name:'猫耳少女正面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#6b21a8,#a78bfa,#e9d5ff)',files:['fla','png'],imgs:['assets/猫耳少女正面.png']},
{id:19,name:'猫耳少女正侧',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#7c3aed,#c084fc,#ede9fe)',files:['fla','png'],imgs:['assets/猫耳少女正侧.png']},
{id:20,name:'猫耳少女侧面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#581c87,#9333ea,#d8b4fe)',files:['fla','png'],imgs:['assets/猫耳少女侧面.png']},
{id:17,name:'趣味男孩正面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#ea580c,#fb923c,#fed7aa)',files:['fla','gif'],imgs:['assets/趣味男孩正面.gif']},
{id:24,name:'趣味男孩正侧',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#c2410c,#f97316,#fdba74)',files:['gif'],imgs:['assets/趣味男孩正侧.gif']},
{id:18,name:'帅气少年正面',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#9ca3af,#d1d5db,#f3f4f6)',files:['fla','png'],imgs:['assets/帅气少年正面.png']},
{id:25,name:'帅气少年正侧',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#6b7280,#9ca3af,#d1d5db)',files:['fla','png'],imgs:['assets/帅气少年正侧.png']},
{id:26,name:'蓝发兽娘',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#1e3a5f,#2563eb,#f97316)',files:['fla','gif'],imgs:['assets/蓝发兽娘.gif']},
{id:27,name:'灰眼银发少年',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#6b7280,#9ca3af,#e5e7eb)',files:['fla','gif'],imgs:['assets/灰眼银发少年.gif']},
{id:28,name:'紫眼银发少年',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#7c3aed,#a78bfa,#e5e7eb)',files:['fla','gif'],imgs:['assets/紫眼银发少年.gif']},
{id:31,name:'黄眼表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#92400e,#d97706,#fbbf24)',files:['fla','gif'],imgs:['assets/黄眼表情.gif']},
{id:32,name:'祖红表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#881337,#e11d48,#fda4af)',files:['fla','png'],imgs:['assets/祖红表情.png']},
{id:33,name:'可爱女表情',isNew:true,cat:'表情包',grad:'linear-gradient(160deg,#7c3aed,#c084fc,#fbcfe8)',files:['fla','png'],imgs:['assets/可爱女表情.png']}
];

// === I18N: Simplified to Traditional ===
const S2T={'爱':'愛','宝':'寶','贝':'貝','备':'備','笔':'筆','边':'邊','标':'標','参':'參','产':'產','长':'長','场':'場','厂':'廠','车':'車','尘':'塵','称':'稱','迟':'遲','齿':'齒','冲':'衝','虫':'蟲','丑':'醜','处':'處','传':'傳','创':'創','纯':'純','词':'詞','从':'從','窜':'竄','达':'達','带':'帶','单':'單','当':'當','党':'黨','导':'導','灯':'燈','递':'遞','点':'點','电':'電','东':'東','动':'動','独':'獨','读':'讀','断':'斷','对':'對','队':'隊','夺':'奪','儿':'兒','尔':'爾','发':'發','飞':'飛','丰':'豐','凤':'鳳','复':'復','负':'負','该':'該','盖':'蓋','赶':'趕','个':'個','给':'給','构':'構','购':'購','顾':'顧','观':'觀','广':'廣','归':'歸','国':'國','过':'過','汉':'漢','号':'號','后':'後','华':'華','画':'畫','会':'會','机':'機','积':'積','极':'極','继':'繼','夹':'夾','价':'價','艰':'艱','歼':'殲','监':'監','坚':'堅','拣':'揀','简':'簡','见':'見','键':'鍵','讲':'講','酱':'醬','将':'將','奖':'獎','胶':'膠','阶':'階','节':'節','洁':'潔','尽':'盡','惊':'驚','竞':'競','旧':'舊','举':'舉','剧':'劇','据':'據','卷':'捲','决':'決','绝':'絕','开':'開','壳':'殼','课':'課','块':'塊','扩':'擴','来':'來','蓝':'藍','兰':'蘭','烂':'爛','劳':'勞','乐':'樂','类':'類','礼':'禮','历':'歷','丽':'麗','两':'兩','联':'聯','炼':'煉','练':'練','粮':'糧','疗':'療','猎':'獵','临':'臨','岭':'嶺','刘':'劉','龙':'龍','炉':'爐','乱':'亂','轮':'輪','罗':'羅','马':'馬','买':'買','麦':'麥','蛮':'蠻','满':'滿','们':'們','梦':'夢','庙':'廟','灭':'滅','亩':'畝','脑':'腦','难':'難','鸟':'鳥','农':'農','诺':'諾','欧':'歐','盘':'盤','庞':'龐','赔':'賠','喷':'噴','凭':'憑','苹':'蘋','齐':'齊','启':'啟','岂':'豈','气':'氣','迁':'遷','签':'簽','牵':'牽','浅':'淺','枪':'槍','墙':'牆','庆':'慶','穷':'窮','区':'區','确':'確','让':'讓','扰':'擾','认':'認','荣':'榮','伞':'傘','丧':'喪','伤':'傷','绍':'紹','设':'設','摄':'攝','审':'審','圣':'聖','胜':'勝','实':'實','识':'識','时':'時','势':'勢','适':'適','释':'釋','寿':'壽','书':'書','术':'術','树':'樹','帅':'帥','双':'雙','顺':'順','说':'說','丝':'絲','苏':'蘇','虽':'雖','岁':'歲','孙':'孫','损':'損','台':'臺','态':'態','坛':'壇','叹':'嘆','汤':'湯','体':'體','条':'條','铁':'鐵','厅':'廳','听':'聽','头':'頭','图':'圖','团':'團','托':'託','袜':'襪','万':'萬','网':'網','卫':'衛','为':'為','围':'圍','违':'違','伟':'偉','伪':'偽','温':'溫','稳':'穩','务':'務','雾':'霧','牺':'犧','习':'習','袭':'襲','系':'係','戏':'戲','虾':'蝦','咸':'鹹','贤':'賢','显':'顯','宪':'憲','县':'縣','响':'響','向':'嚮','项':'項','写':'寫','协':'協','谢':'謝','兴':'興','选':'選','悬':'懸','学':'學','寻':'尋','压':'壓','严':'嚴','盐':'鹽','验':'驗','阳':'陽','养':'養','样':'樣','药':'藥','爷':'爺','页':'頁','业':'業','医':'醫','义':'義','艺':'藝','忆':'憶','应':'應','优':'優','邮':'郵','鱼':'魚','与':'與','语':'語','郁':'鬱','誉':'譽','员':'員','园':'園','远':'遠','愿':'願','约':'約','跃':'躍','云':'雲','运':'運','杂':'雜','灾':'災','载':'載','暂':'暫','脏':'臟','凿':'鑿','择':'擇','泽':'澤','战':'戰','赵':'趙','折':'摺','这':'這','针':'針','珍':'瑧','征':'徵','争':'爭','证':'證','郑':'鄭','只':'隻','纸':'紙','志':'誌','制':'製','钟':'鐘','种':'種','众':'眾','昼':'晝','皱':'皺','朱':'硃','猪':'豬','筑':'築','庄':'莊','装':'裝','壮':'壯','状':'狀','准':'準','浊':'濁','资':'資','兹':'茲','总':'總','纵':'縱','钻':'鑽','嘴':'觜','组':'組','罪':'辠','尊':'樽'};

function s2t(s){if(!s)return s;return s.split('').map(c=>S2T[c]||c).join('');}
const MN_T={'宝箱':'寶箱','宝箱2':'寶箱2','宝箱3':'寶箱3','发带':'髮帶','情侣运动装':'情侶運動裝','蓝发兽娘':'藍髮獸娘','银发少年正面':'銀髮少年正面','银发少年正侧':'銀髮少年正側','灰眼银发少年':'灰眼銀髮少年','紫眼银发少年':'紫眼銀髮少年','紫发爱心正面':'紫髮愛心正面','紫发爱心侧面':'紫髮愛心側面','紫发爱心正侧':'紫髮愛心正側','国民哥哥表情':'國民哥哥表情','眼镜学长':'眼鏡學長','猫耳少女正面':'貓耳少女正面','猫耳少女正侧':'貓耳少女正側','猫耳少女侧面':'貓耳少女側面'};
function matName(name){return MN_T[name]||s2t(name);}
function isTw(){return localStorage.getItem('lz_lang')==='zh-TW';}
function toggleLang(){const cur=localStorage.getItem('lz_lang')||'zh-CN';localStorage.setItem('lz_lang',cur==='zh-TW'?'zh-CN':'zh-TW');location.reload();}
function applyUiLang(){
 const tw=isTw();
 const langBtn=document.getElementById('navLangBtn');
 if(langBtn) langBtn.textContent=tw?'简':'繁';
 document.querySelectorAll('button,label,h3,p,span,a,option').forEach(el=>{
 el.childNodes.forEach(ch=>{if(ch.nodeType===3&&ch.textContent.trim()){ch.textContent=s2t(ch.textContent);}});
 });
 document.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(el=>{if(el.placeholder)el.placeholder=s2t(el.placeholder);});
}

// === STATE ===
let characters=[], currentUser=null, currentCat='表情包';
let editMode=false, editingId=null, upImgs=[], upFla=null, cCur=0, cTimer=null;
let _forcePwd=false;

(function(){
 const s=localStorage.getItem('lz_cur');
 if(s) try{currentUser=JSON.parse(s);}catch(e){}
})();

function getDeviceId(){
 let did=localStorage.getItem('lz_device_id');
 if(!did){did='D'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);localStorage.setItem('lz_device_id',did);}
 return did;
}

// === MODAL ===
function openModal(id){document.getElementById(id).classList.add('show');}
function closeModal(id){document.getElementById(id).classList.remove('show');}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===e.currentTarget)m.classList.remove('show');}));

// === AUTH ===
function updateUI(){
 const btn=document.getElementById('navAuthBtn'),ap=document.getElementById('adminPanel'),at=document.getElementById('adminToolbar'),grid=document.getElementById('cardGrid');
 if(currentUser){btn.textContent=currentUser.username;btn.classList.add('logged-in');
 if(_forcePwd){grid.style.opacity='0.3';grid.style.pointerEvents='none';ap.classList.remove('show');at.classList.remove('show');}
 else{grid.style.opacity='';grid.style.pointerEvents='';
 if(currentUser.role==='admin'){ap.classList.add('show');at.classList.add('show');renderUsers();}
 else{ap.classList.remove('show');at.classList.remove('show');grid.classList.remove('admin-mode');}
 }
 }else{btn.textContent='登录';btn.classList.remove('logged-in');ap.classList.remove('show');at.classList.remove('show');grid.style.opacity='';grid.style.pointerEvents='';}
}

function onAuthClick(){
 if(currentUser){const roleNames={admin:'管理员',vip:'VIP',promo:'限时优惠',user:'普通'};const c=prompt(`当前: ${currentUser.username} (${roleNames[currentUser.role]||currentUser.role})\n\n1 修改密码\n2 退出登录`);
 if(c==='1')openModal('changePwdModal');else if(c==='2'){currentUser=null;localStorage.removeItem('lz_cur');updateUI();renderCards();}
 }else openModal('loginModal');
}

async function openBindModal(){
 if(!currentUser){openModal('loginModal');return;}
 openModal('bindModal');
 document.getElementById('bindMsg').textContent='加载...';document.getElementById('bindMsg').style.color='var(--text-light)';
 try{
 const r=await fetch('/api/me?username='+encodeURIComponent(currentUser.username));
 const d=await r.json();
 document.getElementById('bindDouyin').value=d.bindings?.douyin||'';
 document.getElementById('bindBilibili').value=d.bindings?.bilibili||'';
 document.getElementById('bindMsg').textContent='';
 }catch(e){document.getElementById('bindMsg').textContent='网络错误';document.getElementById('bindMsg').style.color='var(--red)';}
}

async function saveBindings(){
 const douyin=document.getElementById('bindDouyin').value.trim();
 const bilibili=document.getElementById('bindBilibili').value.trim();
 const msg=document.getElementById('bindMsg');
 msg.textContent='保存...';msg.style.color='var(--text-light)';
 try{
 const r=await fetch('/api/bind-accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username,douyin,bilibili})});
 const d=await r.json();
 if(!d.ok){msg.textContent=d.error;msg.style.color='var(--red)';return;}
 msg.textContent='保存成功！';msg.style.color='#10b981';
 setTimeout(()=>closeModal('bindModal'),800);
 }catch(e){msg.textContent='网络错误';msg.style.color='var(--red)';}
}

async function doLogin(){
 const u=document.getElementById('loginUser').value.trim(),p=document.getElementById('loginPass').value,msg=document.getElementById('loginMsg');
 if(!u||!p){msg.textContent='请输入用户名和密码';return;}
 msg.textContent='登录中...';msg.style.color='var(--text-light)';
 try{
 const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,deviceId:getDeviceId()})});
 const d=await r.json();
 if(!d.ok){msg.textContent=d.error;msg.style.color='var(--red)';return;}
 currentUser=d.user;
 if(d.forcePwdChange){
 _forcePwd=true;localStorage.setItem('lz_cur',JSON.stringify(d.user));closeModal('loginModal');openModal('changePwdModal');
 document.getElementById('changePwdMsg').textContent='首次登录，请修改默认密码后才能使用！';
 document.getElementById('changePwdMsg').style.color='var(--red');
 document.querySelector('#changePwdModal .modal-close').style.display='none';
 updateUI();renderCards();return;
 }
 _forcePwd=false;localStorage.setItem('lz_cur',JSON.stringify(d.user));closeModal('loginModal');updateUI();renderCards();
 }catch(e){msg.textContent='网络错误';msg.style.color='var(--red)';}
}

async function doChangePwd(){
 const o=document.getElementById('oldPwd').value,n=document.getElementById('newPwd').value,c=document.getElementById('confirmPwd').value,msg=document.getElementById('changePwdMsg');
 if(!o){msg.textContent='请输入当前密码';msg.style.color='var(--red)';return;}
 if(!n||n.length<4){msg.textContent='新密码至少4位';msg.style.color='var(--red)';return;}
 if(n!==c){msg.textContent='两次密码不一致';msg.style.color='var(--red)';return;}
 try{
 const r=await fetch('/api/changePwd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username,oldPwd:o,newPwd:n})});
 const d=await r.json();
 if(!d.ok){msg.textContent=d.error;msg.style.color='var(--red)';return;}
 _forcePwd=false;document.querySelector('#changePwdModal .modal-close').style.display='';
 msg.textContent='修改成功！';msg.style.color='#10b981';updateUI();renderCards();setTimeout(()=>closeModal('changePwdModal'),800);
 }catch(e){msg.textContent='网络错误';msg.style.color='var(--red)';}
}

// === USERS ===
let _adminUserCache=[];
async function renderUsers(){
 if(!currentUser||currentUser.role!=='admin')return;
 try{
 const r=await fetch('/api/admin/users?adminUsername='+encodeURIComponent(currentUser.username));
 const d=await r.json();
 if(!d.ok)return;
 _adminUserCache=d.users;
 const roleLabel=r=>r==='admin'?(isTw()?'管理員':'管理员'):r==='vip'?'VIP':r==='promo'?(isTw()?'限時優惠':'限时优惠'):(isTw()?'普通':'普通');
 document.getElementById('adminUserList').innerHTML=' <strong>'+(isTw()?'已有帳號：':'已有账号：')+'</strong>'+d.users.map(u=>
 `<span style="display:inline-flex;align-items:center;padding:2px 10px;margin:3px 4px;background:var(--primary-light);border-radius:12px;color:var(--primary);font-size:12px">${u.username} [${roleLabel(u.role)}] ${u.role!=='admin'?`<a href="#" onclick="event.preventDefault();toggleRole('${u.username}')">${isTw()?'切換':'切换'}</a> <a href="#" onclick="event.preventDefault();delUser('${u.username}')">×</a>`:''}</span>`).join('');
 }catch(e){}
}

async function toggleRole(name){
 if(!currentUser||currentUser.role!=='admin')return;
 try{
 const r=await fetch('/api/admin/toggleRole',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUsername:currentUser.username,targetUsername:name})});
 const d=await r.json();
 if(d.ok){renderUsers();const msg=document.getElementById('adminMsg');msg.textContent=s2t(name+' 已切换为 '+d.newRole);msg.className='admin-msg success';}
 }catch(e){}
}

async function adminAddUser(){
 const u=document.getElementById('adminNewUser').value.trim(),msg=document.getElementById('adminMsg');
 if(!u||u.length<2){msg.textContent='用户名至少2个字符';msg.className='admin-msg error';return;}
 if(!currentUser||currentUser.role!=='admin')return;
 const role=document.getElementById('adminNewRole').value||'user';
 try{
 const r=await fetch('/api/admin/addUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUsername:currentUser.username,newUsername:u,role:role})});
 const d=await r.json();
 if(!d.ok){msg.textContent=d.error;msg.className='admin-msg error';return;}
 msg.textContent=s2t('账号 "'+u+'" 创建成功！默认密码: 123456');msg.className='admin-msg success';
 document.getElementById('adminNewUser').value='';renderUsers();
 }catch(e){msg.textContent='网络错误';msg.className='admin-msg error';}
}

async function delUser(name){
 if(!confirm('确认删除账号「'+name+'」？'))return;
 if(!currentUser||currentUser.role!=='admin')return;
 try{
 const r=await fetch('/api/admin/delUser',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUsername:currentUser.username,targetUsername:name})});
 const d=await r.json();
 if(!d.ok){const msg=document.getElementById('adminMsg');msg.textContent=d.error;msg.className='admin-msg error';return;}
 renderUsers();const msg=document.getElementById('adminMsg');msg.textContent=s2t('已删除');msg.className='admin-msg success';
 }catch(e){}
}

// === PREVIEW LIGHTBOX ===
function openPreview(id){
 const c=characters.find(x=>x.id===id);if(!c)return;
 const overlay=document.getElementById('previewOverlay');
 document.getElementById('previewTitle').textContent=isTw()?matName(c.name):c.name;
 let allImgs=[];
 if(c.img)allImgs.push(c.img);
 if(c.imgs){c.imgs.forEach(im=>{if(im&&!allImgs.includes(im))allImgs.push(im);});}
 if(allImgs.length===0&&c.grad){
 document.getElementById('previewMainImg').style.display='none';
 document.getElementById('previewMainImg').parentElement.innerHTML='<div style="width:200px;height:200px;border-radius:8px;'+c.grad+';display:flex;align-items:center;justify-content:center;font-size:64px;color:rgba(255,255,255,.5)">'+c.name.charAt(0)+'</div>';
 } else if(allImgs.length>0){
 const mainImg=document.getElementById('previewMainImg');mainImg.style.display='';mainImg.src=allImgs[0];
 }
 const thumbsEl=document.getElementById('previewThumbs');
 if(allImgs.length>1){thumbsEl.innerHTML=allImgs.map((im,i)=>`<div class="preview-thumb${i===0?' active':''}" onclick="switchPreview('${im}',this)"><img src="${im}" alt=""></div>`).join('');}
 else{thumbsEl.innerHTML='';}
 const filesEl=document.getElementById('previewFiles');
 filesEl.innerHTML=(c.files||[]).map(f=>`<span class="preview-file-tag${f==='fla'?' fla':''}">.${f}</span>`).join('');
 const dlArea=document.getElementById('previewDlArea');
 if(currentUser){
 const role=currentUser.role;
 const canDl=(role==='admin'||role==='vip'||(role==='user'&&c.cat==='表情包')||(role==='promo'&&(c.cat==='限时优惠'||c.cat==='道具栏')));
 if(canDl){
 let btns='';
 if(c.fla){btns+=`<a class="preview-dl-btn fla-dl" href="${c.fla}" download>下载FLA源文件</a>`;}
 dlArea.innerHTML=btns||'<span style="color:rgba(255,255,255,.7);font-size:13px">该素材暂无FLA文件</span>';
 }else{
 const upgradeMsg=role==='user'?'您的账号仅可下载表情包素材，升级VIP可下载全部素材':'您的账号仅可下载限时优惠素材，升级VIP可下载全部素材';
 dlArea.innerHTML=`<span style="color:rgba(255,255,255,.7);font-size:13px">${upgradeMsg}</span>`;
 }
 }else{
 dlArea.innerHTML='<span style="color:rgba(255,255,255,.7);font-size:13px">登录后即可下载素材</span> <button class="preview-dl-btn" onclick="closePreview();openModal(\'loginModal\')">立即登录</button>';
 }
 overlay.classList.add('show');document.body.style.overflow='hidden';
}

function switchPreview(src,el){document.getElementById('previewMainImg').src=src;document.querySelectorAll('.preview-thumb').forEach(t=>t.classList.remove('active'));el.classList.add('active');}
function closePreview(){document.getElementById('previewOverlay').classList.remove('show');document.body.style.overflow='';}

// === RENDER CARDS ===
let currentPage=1;
const ITEMS_PER_PAGE=20;

function renderCards(){
 const grid=document.getElementById('cardGrid'),loggedIn=!!currentUser;
 const q=(document.getElementById('searchInput').value||'').trim().toLowerCase();
 const filtered=characters.filter(c=>{
 const matchCat = currentCat === '限时优惠' ? c.limit : c.cat === currentCat;
 return matchCat && (!q || c.name.toLowerCase().includes(q));
 });
 const totalPages=Math.ceil(filtered.length/ITEMS_PER_PAGE);
 if(currentPage>totalPages) currentPage=1;
 const start=(currentPage-1)*ITEMS_PER_PAGE;
 const pageItems=filtered.slice(start, start+ITEMS_PER_PAGE);
 grid.innerHTML=pageItems.map((c,i)=>`
<div class="card" style="animation-delay:${i*0.05}s">
 <div class="card-admin-actions">
  <button class="card-admin-btn edit-btn" onclick="event.stopPropagation();openEditItem(${c.id})">✎</button>
  <button class="card-admin-btn del-btn" onclick="event.stopPropagation();delItem(${c.id})">✕</button>
 </div>
 <div class="card-img" onclick="openPreview(${c.id})">
  <div class="card-badge">
   ${c.isNew?'<span class="badge badge-new">new</span>':''}
   ${c.limit?'<span class="badge badge-limit">限时</span>':''}
   <span class="badge badge-copy">版权</span>
  </div>
  ${c.img?`<img src="${c.img}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover">`
  :`<div class="card-img-inner" style="background:${c.grad||'#409EFF'}">${c.name.charAt(0)}</div>`}
  ${!loggedIn?`<div class="download-lock"><div class="download-lock-icon">🔒</div><div class="download-lock-text">登录后下载素材</div><button class="download-lock-btn" onclick="event.stopPropagation();openModal('loginModal')">立即登录</button></div>`:''}
 </div>
 <div class="card-files">${(c.files||[]).map(f=>`<span class="file-tag${f==='fla'?' fla':''}">.${f}</span>`).join('')}</div>
 <div class="card-footer"><span class="card-name">${isTw()?matName(c.name):c.name}</span><span class="card-preview" onclick="event.stopPropagation();openPreview(${c.id})">预览 ▶</span></div>
</div>`).join('');
 document.getElementById('pageTotal').textContent='共 '+filtered.length+' 条';
 renderPagination(totalPages);
}

function renderPagination(totalPages){
 const btns=document.getElementById('paginationBtns');
 if(totalPages<=1){btns.innerHTML='';return;}
 let html='';
 html+=`<button class="page-btn${currentPage===1?' disabled':''}" onclick="goPage(${currentPage-1})">‹</button>`;
 for(let i=1;i<=totalPages;i++){
 if(i===1||i===totalPages||(i>=currentPage-2&&i<=currentPage+2)){
 html+=`<button class="page-btn${i===currentPage?' active':''}" onclick="goPage(${i})">${i}</button>`;
 }else if(i===currentPage-3||i===currentPage+3){html+=`<span class="page-ellipsis">...</span>`;}
 }
 html+=`<button class="page-btn${currentPage===totalPages?' disabled':''}" onclick="goPage(${currentPage+1})">›</button>`;
 btns.innerHTML=html;
}

function goPage(p){
 const totalPages=Math.ceil(getFiltered().length/ITEMS_PER_PAGE);
 if(p<1||p>totalPages) return;currentPage=p;renderCards();
 document.getElementById('cardGrid').scrollIntoView({behavior:'smooth',block:'start'});
}

function getFiltered(){
 const q=(document.getElementById('searchInput').value||'').trim().toLowerCase();
 return characters.filter(c=>{
 const matchCat = currentCat === '限时优惠' ? c.limit : c.cat === currentCat;
 return matchCat && (!q || c.name.toLowerCase().includes(q));
 });
}

// === EDIT/ADD ===
function toggleEditMode(){editMode=!editMode;document.getElementById('cardGrid').classList.toggle('admin-mode',editMode);
 document.getElementById('editModeBtn').classList.toggle('active',editMode);document.getElementById('editModeBtn').textContent=editMode?'退出编辑':'编辑模式';}

function resetEdit(){upImgs=[];upFla=null;document.getElementById('editImgUp').value='';document.getElementById('editFla').value='';
 document.getElementById('editFlaSt').innerHTML='';renderImgPrev();}

function openAddItem(){editingId=null;resetEdit();document.getElementById('editModalTitle').textContent='新增素材';
 document.getElementById('editName').value='';document.getElementById('editCat').value=currentCat;
 document.getElementById('editFiles').value='png';document.getElementById('editIsNew').checked=true;
 document.getElementById('editLimit').checked=false;document.getElementById('editMsg').textContent='';openModal('editModal');}

function openEditItem(id){const c=characters.find(x=>x.id===id);if(!c)return;editingId=id;resetEdit();
 document.getElementById('editModalTitle').textContent='编辑素材';document.getElementById('editName').value=c.name;
 document.getElementById('editCat').value=c.cat;document.getElementById('editFiles').value=(c.files||[]).join(',');
 document.getElementById('editIsNew').checked=c.isNew;document.getElementById('editLimit').checked=!!c.limit;
 document.getElementById('editMsg').textContent='';openModal('editModal');}

function addOneImg(){
 const input=document.getElementById('editImgUp'),file=input.files[0];
 if(!file){document.getElementById('editImgCt').innerHTML='请先选择图片';return;}
 if(upImgs.length>=5){document.getElementById('editImgCt').innerHTML='已达上限5张';input.value='';return;}
 if(!document.getElementById('editName').value){const name=file.name.replace(/\.[^.]+$/,'');document.getElementById('editName').value=name;}
 const r=new FileReader();r.onload=function(e){upImgs.push({name:file.name,file,url:e.target.result});renderImgPrev();input.value='';};r.readAsDataURL(file);
}

function rmImg(i){upImgs.splice(i,1);renderImgPrev();}
function renderImgPrev(){
 document.getElementById('editImgPrev').innerHTML=upImgs.map((m,i)=>
 `<div style="position:relative;display:inline-block"><img src="${m.url}" alt="" style="max-height:70px;border-radius:4px;border:1px solid var(--border)"><button onclick="rmImg(${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:var(--red);color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer">×</button></div>`).join('');
 document.getElementById('editImgCt').textContent=upImgs.length?`已添加 ${upImgs.length}/5 张`:'';
}

document.getElementById('editFla').addEventListener('change',function(){
 const f=this.files[0],st=document.getElementById('editFlaSt');
 if(!f){st.innerHTML='';upFla=null;return;}
 if(!f.name.toLowerCase().endsWith('.fla')){st.innerHTML='请选择.fla文件';upFla=null;this.value='';return;}
 upFla=f;st.innerHTML=`<span class="fla-icon">.fla</span> ${f.name} (${(f.size/1048576).toFixed(2)}MB)`;st.className='upload-status success';
 const fi=document.getElementById('editFiles'),cur=fi.value.split(',').map(s=>s.trim()).filter(Boolean);
 if(!cur.includes('fla')){cur.push('fla');fi.value=cur.join(',');}
 const nameEl=document.getElementById('editName');if(!nameEl.value.trim()){nameEl.value=f.name.replace(/\.(fla)$/i,'');}
});

document.getElementById('editImgUp').addEventListener('change',function(){
 const f=this.files[0];if(!f) return;
 const nameEl=document.getElementById('editName');if(!nameEl.value.trim()){nameEl.value=f.name.replace(/\.[^.]+$/,'');}
});

async function doSaveItem(){
 const name=document.getElementById('editName').value.trim(),cat=document.getElementById('editCat').value;
 const filesStr=document.getElementById('editFiles').value.trim(),isNew=document.getElementById('editIsNew').checked;
 const msg=document.getElementById('editMsg');
 if(!name){msg.textContent='请输入名称';msg.style.color='var(--red)';return;}
 msg.textContent='上传中...';msg.style.color='var(--text-light)';
 const formData=new FormData();
 formData.append('username',currentUser.username);formData.append('name',name);formData.append('cat',cat);
 formData.append('files',filesStr);formData.append('isNew',isNew?'true':'false');
 formData.append('limit',document.getElementById('editLimit').checked?'true':'false');
 for(const im of upImgs){if(im.file) formData.append('images',im.file);}
 if(upFla) formData.append('fla',upFla);
 try{
 const url=editingId!==null?'/api/materials/update':'/api/materials';
 if(editingId!==null) formData.append('id',editingId);
 const r=await fetch(url,{method:'POST',body:formData});
 const d=await r.json();
 if(!d.ok){msg.textContent=d.error;msg.style.color='var(--red)';return;}
 msg.textContent=(editingId!==null?'保存':'新增')+'成功！';msg.style.color='#10b981';
 await loadMaterials();currentPage=1;renderCards();setTimeout(()=>closeModal('editModal'),600);
 }catch(e){msg.textContent='网络错误';msg.style.color='var(--red)';}
}

async function delItem(id){const c=characters.find(x=>x.id===id);if(!c)return;
 if(!confirm('确认删除「'+c.name+'」？'))return;
 try{
 const r=await fetch('/api/materials/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser.username,id:id})});
 const d=await r.json();if(!d.ok)return;await loadMaterials();currentPage=1;renderCards();
 }catch(e){}
}

// === REQUEST ===
let reqFiles=[];
function previewReqImgs(input){
 reqFiles=[];const files=Array.from(input.files),p=document.getElementById('reqPrev');
 if(files.length>5){p.innerHTML='最多5张';input.value='';return;}
 p.innerHTML='';
 for(let i=0;i<files.length;i++){const f=files[i];reqFiles.push(f);const r=new FileReader();r.onload=function(e){p.innerHTML+=`<img src="${e.target.result}" alt="">`};r.readAsDataURL(f);}
}

async function doRequest(){
 const d=document.getElementById('requestDesc').value.trim(),c=document.getElementById('requestContact').value.trim(),msg=document.getElementById('requestMsg');
 if(!d){msg.textContent='请填写描述';msg.style.color='var(--red)';return;}
 if(!c){msg.textContent='请填写联系方式';msg.style.color='var(--red)';return;}
 msg.textContent='提交中...';msg.style.color='var(--text-light)';
 try{
 const fd=new FormData();fd.append('desc',d);fd.append('contact',c);
 for(const f of reqFiles) fd.append('images',f);
 const r=await fetch('/api/requests',{method:'POST',body:fd});
 const data=await r.json();
 if(!data.ok){msg.textContent=data.error;msg.style.color='var(--red)';return;}
 msg.textContent='提交成功！我们会尽快处理。';msg.style.color='#10b981';
 reqFiles=[];document.getElementById('reqImg').value='';document.getElementById('reqPrev').innerHTML='';document.getElementById('requestDesc').value='';document.getElementById('requestContact').value='';
 setTimeout(()=>closeModal('requestModal'),1200);
 }catch(e){msg.textContent='网络错误';msg.style.color='var(--red)';}
}

// === ADMIN REQUESTS ===
let reqViewOpen=false;
async function toggleRequestView(){reqViewOpen=!reqViewOpen;document.getElementById('requestPanel').style.display=reqViewOpen?'block':'none';if(reqViewOpen) await loadRequests();}

async function loadRequests(){
 if(!currentUser||currentUser.role!=='admin')return;
 try{
 const r=await fetch('/api/requests?adminUsername='+encodeURIComponent(currentUser.username));
 const d=await r.json();if(!d.ok)return;
 const list=document.getElementById('requestList');
 if(!d.requests.length){list.innerHTML='<p style="color:var(--text-light);padding:12px">暂无需求</p>';return;}
 list.innerHTML=d.requests.map(req=>{
 const time=new Date(req.created_at).toLocaleString('zh-CN');
 const imgs=req.images&&req.images.length?req.images.map(im=>`<img src="${im}" style="max-height:80px;border-radius:4px;margin:4px" alt="">`).join(''):'';
 const statusColor=req.read?'#10b981':'#f59e0b';
 const statusText=req.read?(isTw()?'已讀':'已读'):(isTw()?'未讀':'未读');
 return `<div style="padding:12px;border-bottom:1px solid var(--border)">
 <strong>${isTw()?s2t(req.desc):req.desc}</strong> <span style="font-size:11px;color:var(--text-light)">${time}</span><br>
 ${isTw()?'聯繫方式':'联系方式'}：${req.contact} &nbsp;|&nbsp; <span style="color:${statusColor}">${statusText}</span>
 <br>${imgs}
 ${!req.read?`<button onclick="markRead(${req.id})" style="margin-top:6px;font-size:12px;padding:2px 10px;border-radius:4px;background:var(--primary);color:#fff;cursor:pointer">${isTw()?'標記已讀':'标记已读'}</button>`:''}
 </div>`;
 }).join('');
 updateReqBadge(d.requests.filter(r=>!r.read).length);
 }catch(e){}
}

async function markRead(id){
 if(!currentUser||currentUser.role!=='admin')return;
 try{await fetch('/api/requests/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUsername:currentUser.username,ids:[id]})});await loadRequests();}catch(e){}
}

function updateReqBadge(count){const badge=document.getElementById('reqBadge');if(count>0){badge.textContent=count>99?'99+':count;badge.classList.add('show');}else{badge.classList.remove('show');}}

async function checkUnreadReqs(){if(!currentUser||currentUser.role!=='admin')return;try{const r=await fetch('/api/requests/count');const d=await r.json();if(d.ok) updateReqBadge(d.count);}catch(e){}}

// === TABS ===
document.querySelectorAll('.cat-btn').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('.cat-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');
 currentCat=b.dataset.cat;currentPage=1;document.getElementById('searchInput').value='';renderCards();
}));
document.querySelectorAll('.sub-tab').forEach(b=>b.addEventListener('click',()=>{
 document.querySelectorAll('.sub-tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');
}));

// === INIT ===
async function loadMaterials(){
 try{
 const r=await fetch('/api/materials');const d=await r.json();
 if(d.ok&&d.items&&d.items.length>0){
 const serverIds=new Set(d.items.map(i=>i.id));
 const defaultNotServer=DEF_CHARS.filter(c=>!serverIds.has(c.id));
 characters=[...d.items,...defaultNotServer];
 }else{characters=DEF_CHARS;}
 }catch(e){characters=DEF_CHARS;}
}

try{const saved=localStorage.getItem('lz_cur');if(saved)currentUser=JSON.parse(saved);}catch(e){}
loadMaterials().then(()=>{updateUI();renderCards();if(currentUser&&currentUser.role==='admin')checkUnreadReqs();applyUiLang();});
