/* ===== 体重记录系统 公共 JS ===== */
const TOKEN_KEY = 'wt_token';
const USER_KEY = 'wt_user';
const UNIT_KEY = 'wt_unit';

// ===== 认证 =====
function getToken(){ return localStorage.getItem(TOKEN_KEY); }
function setToken(t){ localStorage.setItem(TOKEN_KEY, t); }
function getUser(){ try{ return JSON.parse(localStorage.getItem(USER_KEY)); }catch(e){ return null; } }
function setUser(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearAuth(){ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function requireAuth(){
  if(!getToken()){ location.href = 'index.html'; return false; }
  return true;
}

// ===== API 封装 =====
async function api(path, opts={}){
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
// 显示体重：根据单位转换（数据库存 kg）
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
// 输入值转 kg（用户输入的可能是斤）
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
// Deurenberg 公式估算体脂率
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
  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `
    <h1>${title}</h1>
    <div style="display:flex;align-items:center;gap:10px">
      <span class="user">${user? (user.nickname||user.username) : ''}</span>
      <button class="logout" onclick="doLogout()">退出</button>
    </div>`;
  document.querySelector('.wrap').prepend(bar);
}
function doLogout(){
  if(confirm('确定退出登录？')){ clearAuth(); location.href='index.html'; }
}
