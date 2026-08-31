/* ===== 体重记录系统 公共 JS ===== */
const TOKEN_KEY = 'wt_token';
const USER_KEY = 'wt_user';
const UNIT_KEY = 'wt_unit';
const GUEST_KEY = 'wt_guest';
const GUEST_RECORDS_KEY = 'wt_guest_records';
const GUEST_PROFILE_KEY = 'wt_guest_profile';

// ===== 认证 =====
function getToken(){ return localStorage.getItem(TOKEN_KEY); }
function setToken(t){ localStorage.setItem(TOKEN_KEY, t); }
function getUser(){ try{ return JSON.parse(localStorage.getItem(USER_KEY)); }catch(e){ return null; } }
function setUser(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearAuth(){ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

// ===== 游客模式 =====
function isGuest(){ return localStorage.getItem(GUEST_KEY) === '1'; }
function setGuest(){ localStorage.setItem(GUEST_KEY, '1'); }
function clearGuest(){ localStorage.removeItem(GUEST_KEY); }
function getGuestRecords(){ try{ return JSON.parse(localStorage.getItem(GUEST_RECORDS_KEY))||[]; }catch(e){ return []; } }
function setGuestRecords(r){ localStorage.setItem(GUEST_RECORDS_KEY, JSON.stringify(r)); }
function getGuestProfile(){ try{ return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY))||{id:0,username:'guest',nickname:'游客'}; }catch(e){ return {id:0,username:'guest',nickname:'游客'}; } }
function setGuestProfile(p){ localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(p)); }

function requireAuth(){
  if(!getToken() && !isGuest()){ location.href = 'index.html'; return false; }
  return true;
}

// ===== 游客模式本地 API =====
async function guestApi(path, opts={}){
  const method = (opts.method||'GET').toUpperCase();
  const qIdx = path.indexOf('?');
  const route = qIdx>=0 ? path.slice(0,qIdx) : path;
  const params = qIdx>=0 ? new URLSearchParams(path.slice(qIdx+1)) : new URLSearchParams();

  // GET /api/auth/me
  if(route==='/auth/me' && method==='GET'){
    return getGuestProfile();
  }
  // PUT /api/auth/profile
  if(route==='/auth/profile' && method==='PUT'){
    const body = JSON.parse(opts.body||'{}');
    const p = {...getGuestProfile(), ...body, id:0, username:'guest'};
    setGuestProfile(p);
    setUser(p);
    return p;
  }
  // GET /api/weights?month=
  if(route==='/weights' && method==='GET'){
    const month = params.get('month')||'';
    return getGuestRecords().filter(r=>r.record_date.startsWith(month));
  }
  // GET /api/weights/range?start=&end=
  if(route==='/weights/range' && method==='GET'){
    const start = params.get('start')||'', end = params.get('end')||'';
    return getGuestRecords().filter(r=>r.record_date>=start && r.record_date<=end);
  }
  // POST /api/weights
  if(route==='/weights' && method==='POST'){
    const body = JSON.parse(opts.body||'{}');
    const records = getGuestRecords();
    const idx = records.findIndex(r=>r.record_date===body.record_date && r.period===body.period);
    if(idx>=0){
      records[idx] = {...records[idx], weight:body.weight, note:body.note||null};
    }else{
      records.push({id:Date.now(), record_date:body.record_date, period:body.period, weight:body.weight, note:body.note||null});
    }
    setGuestRecords(records);
    return records.find(r=>r.record_date===body.record_date && r.period===body.period);
  }
  // DELETE /api/weights/:id
  if(route.startsWith('/weights/') && method==='DELETE'){
    const id = parseInt(route.split('/')[2]);
    setGuestRecords(getGuestRecords().filter(r=>r.id!==id));
    return {ok:true};
  }
  // GET /api/stats/summary?month=
  if(route==='/stats/summary' && method==='GET'){
    const month = params.get('month')||'';
    const recs = getGuestRecords().filter(r=>r.record_date.startsWith(month));
    const days = new Set(recs.map(r=>r.record_date)).size;
    const weights = recs.map(r=>parseFloat(r.weight));
    return {
      days,
      count: recs.length,
      avg: weights.length? +(weights.reduce((a,b)=>a+b,0)/weights.length).toFixed(2) : null,
      min: weights.length? Math.min(...weights) : null,
      max: weights.length? Math.max(...weights) : null,
    };
  }
  // GET /api/weights/export（游客模式返回记录数组，由前端生成CSV）
  if(route==='/weights/export' && method==='GET'){
    return getGuestRecords().sort((a,b)=>a.record_date.localeCompare(b.record_date)||a.period.localeCompare(b.period));
  }
  // POST /api/weights/import（游客模式直接解析存入localStorage）
  if(route==='/weights/import' && method==='POST'){
    const body = JSON.parse(opts.body||'{}');
    const csv = body.csv||'';
    const lines = csv.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2) throw new Error('CSV内容为空');
    let startIdx = lines[0].toLowerCase().includes('日期')||lines[0].toLowerCase().includes('date')?1:0;
    let imported=0,updated=0,skipped=0,errors=[];
    const records = getGuestRecords();
    function parseLine(line){
      const result=[]; let cur='', inQ=false;
      for(let i=0;i<line.length;i++){
        const ch=line[i];
        if(ch==='"'){ if(inQ&&line[i+1]==='"'){cur+='"';i++;} else inQ=!inQ; }
        else if(ch===','&&!inQ){ result.push(cur); cur=''; }
        else cur+=ch;
      }
      result.push(cur); return result;
    }
    for(let i=startIdx;i<lines.length;i++){
      const parts=parseLine(lines[i]);
      if(parts.length<3){skipped++;continue;}
      let [date,period,weight,note]=parts;
      date=date.trim().replace(/\//g,'-');
      if(!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)){errors.push(`第${i+1}行:日期格式错误`);skipped++;continue;}
      const d=new Date(date); if(isNaN(d.getTime())){errors.push(`第${i+1}行:无效日期`);skipped++;continue;}
      date=d.toISOString().slice(0,10);
      period=period.trim().toLowerCase();
      if(['早','morning','am','m','早上','早晨'].includes(period))period='morning';
      else if(['晚','evening','pm','e','晚上','傍晚','夜'].includes(period))period='evening';
      else period='morning';
      weight=parseFloat(weight);
      if(isNaN(weight)||weight<=0||weight>500){errors.push(`第${i+1}行:体重无效`);skipped++;continue;}
      note=(note||'').trim()||null;
      const idx=records.findIndex(r=>r.record_date===date&&r.period===period);
      if(idx>=0){records[idx]={...records[idx],weight,note};updated++;}
      else{records.push({id:Date.now()+i,record_date:date,period,weight,note});imported++;}
    }
    setGuestRecords(records);
    return {imported,updated,skipped,total:imported+updated,errors:errors.slice(0,10)};
  }
  return [];
}

// ===== API 封装 =====
async function api(path, opts={}){
  if(isGuest()){
    return guestApi(path, opts);
  }
  const token = getToken();
  const headers = {'Content-Type':'application/json', ...(opts.headers||{})};
  if(token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {...opts, headers});
  if(res.status === 401){ clearAuth(); location.href='index.html'; throw new Error('未登录'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ===== 单位 =====
function getUnit(){ return localStorage.getItem(UNIT_KEY) || 'kg'; }
function setUnit(u){ localStorage.setItem(UNIT_KEY, u); }
function fmtWeight(kg){
  if(kg == null) return '--';
  const u = getUnit();
  if(u === 'jin') return (kg * 2).toFixed(1) + '斤';
  return kg.toFixed(1) + 'kg';
}
function fmtWeightNum(kg){
  if(kg == null) return '--';
  const u = getUnit();
  if(u === 'jin') return (kg * 2).toFixed(1);
  return kg.toFixed(1);
}
function toKg(val){
  const u = getUnit();
  if(u === 'jin') return val / 2;
  return val;
}

// ===== 计算 =====
function calcBMI(weightKg, heightCm){
  if(!weightKg || !heightCm) return null;
  const h = heightCm / 100;
  return weightKg / (h * h);
}
function calcBodyFat(bmi, age, gender){
  if(!bmi || !age) return null;
  const g = gender === 'female' ? 0 : 1;
  return 1.20 * bmi + 0.23 * age - 10.8 * g - 5.4;
}
function bmiCategory(bmi){
  if(!bmi) return {text:'--', color:''};
  if(bmi < 18.5) return {text:'偏瘦', color:'var(--text2)'};
  if(bmi < 24) return {text:'正常', color:'var(--down)'};
  if(bmi < 28) return {text:'偏胖', color:'var(--warn)'};
  return {text:'肥胖', color:'var(--up)'};
}

// ===== 日期工具 =====
function fmtDate(d){
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtDateCN(d){
  return `${d.getMonth()+1}月${d.getDate()}日`;
}
function periodLabel(p){ return p === 'morning' ? '早' : '晚'; }

// ===== Toast =====
function showToast(msg, duration=2000){
  const old = document.querySelector('.toast');
  if(old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), duration);
}

// ===== 底部导航 =====
function renderTabbar(active){
  const tabs = [
    {key:'calendar', icon:'📅', label:'日历', href:'calendar.html'},
    {key:'chart', icon:'📈', label:'曲线', href:'chart.html'},
    {key:'history', icon:'📋', label:'历史', href:'history.html'},
    {key:'profile', icon:'👤', label:'我的', href:'profile.html'},
  ];
  const bar = document.createElement('div');
  bar.className = 'tabbar';
  bar.innerHTML = tabs.map(t =>
    `<a href="${t.href}" class="${t.key===active?'active':''}"><span class="icon">${t.icon}</span>${t.label}</a>`
  ).join('');
  document.body.appendChild(bar);
}

// ===== 顶部用户信息 =====
function renderTopbar(title){
  const user = getUser();
  const g = isGuest();
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `
    <h1>${title}</h1>
    <div style="display:flex;align-items:center;gap:10px">
      <span class="user">${g?'游客':(user? (user.nickname||user.username) : '')}</span>
      <button class="logout" onclick="doLogout()">退出</button>
    </div>`;
  document.querySelector('.wrap').prepend(bar);
}
function doLogout(){
  if(confirm('确定退出？')){ clearAuth(); clearGuest(); location.href='index.html'; }
}
