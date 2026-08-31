require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3004;
const JWT_SECRET = process.env.JWT_SECRET || 'weight-tracker-dev-secret';

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// PostgreSQL 连接池
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// JWT 认证中间件
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// ===== 认证接口 =====
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  try {
    const exist = await pool.query('SELECT id FROM users WHERE username=$1', [username]);
    if (exist.rows.length) return res.status(400).json({ error: '用户名已存在' });
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username,password_hash,nickname) VALUES ($1,$2,$3) RETURNING id,username,nickname',
      [username, hash, username]
    );
    const user = r.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  try {
    const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    if (!r.rows.length) return res.status(400).json({ error: '用户名或密码错误' });
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: '用户名或密码错误' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash, ...safe } = user;
    res.json({ token, user: safe });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '登录失败' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT id,username,nickname,signature,gender,age,height,initial_weight,target_weight,unit,created_at FROM users WHERE id=$1', [req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: '用户不存在' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

app.put('/api/auth/profile', auth, async (req, res) => {
  const { nickname, signature, gender, age, height, initial_weight, target_weight, unit } = req.body;
  try {
    const r = await pool.query(
      `UPDATE users SET nickname=COALESCE($1,nickname), signature=COALESCE($2,signature),
        gender=COALESCE($3,gender), age=COALESCE($4,age), height=COALESCE($5,height),
        initial_weight=COALESCE($6,initial_weight), target_weight=COALESCE($7,target_weight),
        unit=COALESCE($8,unit) WHERE id=$9
        RETURNING id,username,nickname,signature,gender,age,height,initial_weight,target_weight,unit`,
      [nickname, signature, gender, age, height, initial_weight, target_weight, unit, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '更新失败' });
  }
});

// ===== 体重记录接口 =====
// 获取某月记录
app.get('/api/weights', auth, async (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!month) return res.status(400).json({ error: '缺少月份参数' });
  try {
    const r = await pool.query(
      `SELECT id, TO_CHAR(record_date, 'YYYY-MM-DD') as record_date, period, weight, note, created_at
       FROM weight_records WHERE user_id=$1 AND to_char(record_date,'YYYY-MM')=$2
       ORDER BY record_date, period`,
      [req.user.id, month]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取时间范围记录（曲线用）
app.get('/api/weights/range', auth, async (req, res) => {
  const { start, end } = req.query;
  try {
    const r = await pool.query(
      `SELECT id, TO_CHAR(record_date, 'YYYY-MM-DD') as record_date, period, weight, note FROM weight_records
       WHERE user_id=$1 AND record_date>=$2 AND record_date<=$3 ORDER BY record_date, period`,
      [req.user.id, start, end]
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

// 添加/更新记录（同一天同一时段，存在则更新）
app.post('/api/weights', auth, async (req, res) => {
  const { record_date, period, weight, note } = req.body;
  if (!record_date || !period || !weight) return res.status(400).json({ error: '日期、时段、体重不能为空' });
  if (!['morning', 'evening'].includes(period)) return res.status(400).json({ error: '时段只能是 morning 或 evening' });
  try {
    const r = await pool.query(
      `INSERT INTO weight_records (user_id, record_date, period, weight, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, record_date, period)
       DO UPDATE SET weight=EXCLUDED.weight, note=EXCLUDED.note
       RETURNING id, TO_CHAR(record_date, 'YYYY-MM-DD') as record_date, period, weight, note`,
      [req.user.id, record_date, period, weight, note]
    );
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存失败' });
  }
});

// 删除记录
app.delete('/api/weights/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM weight_records WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 导出所有记录为 CSV
app.get('/api/weights/export', auth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT TO_CHAR(record_date, \'YYYY-MM-DD\') as record_date, period, weight, note FROM weight_records WHERE user_id=$1 ORDER BY record_date, period',
      [req.user.id]
    );
    const rows = [['日期', '时段', '体重(kg)', '备注']];
    r.rows.forEach(row => {
      rows.push([
        row.record_date,
        row.period === 'morning' ? '早' : '晚',
        row.weight,
        (row.note || '').replace(/"/g, '""')
      ]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="weight_records_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: '导出失败' });
  }
});

// 从 CSV 导入记录
app.post('/api/weights/import', auth, async (req, res) => {
  const { csv } = req.body;
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: '缺少CSV数据' });
  try {
    const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV内容为空或只有表头' });
    // 检测表头行（第一行如果包含"日期"或"date"则跳过）
    let startIdx = 0;
    const first = lines[0].toLowerCase();
    if (first.includes('日期') || first.includes('date') || first.includes('体重') || first.includes('weight')) {
      startIdx = 1;
    }
    let imported = 0, updated = 0, skipped = 0, errors = [];
    for (let i = startIdx; i < lines.length; i++) {
      const parts = parseCSVLine(lines[i]);
      if (parts.length < 3) { skipped++; continue; }
      let [date, period, weight, note] = parts;
      date = date.trim().replace(/\//g, '-');
      // 验证日期
      if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
        errors.push(`第${i+1}行: 日期格式错误 "${date}"`);
        skipped++;
        continue;
      }
      // 规范化日期
      const d = new Date(date);
      if (isNaN(d.getTime())) { errors.push(`第${i+1}行: 无效日期 "${date}"`); skipped++; continue; }
      date = d.toISOString().slice(0, 10);
      // 时段
      period = period.trim().toLowerCase();
      if (['早', 'morning', 'am', 'm', '早上', '早晨'].includes(period)) period = 'morning';
      else if (['晚', 'evening', 'pm', 'e', '晚上', '傍晚', '夜'].includes(period)) period = 'evening';
      else { period = 'morning'; } // 默认早间
      // 体重
      weight = parseFloat(weight);
      if (isNaN(weight) || weight <= 0 || weight > 500) {
        errors.push(`第${i+1}行: 体重无效 "${parts[2]}"`);
        skipped++;
        continue;
      }
      note = (note || '').trim() || null;
      // UPSERT
      const exist = await pool.query(
        'SELECT id FROM weight_records WHERE user_id=$1 AND record_date=$2 AND period=$3',
        [req.user.id, date, period]
      );
      if (exist.rows.length) {
        await pool.query(
          'UPDATE weight_records SET weight=$1, note=$2 WHERE id=$3',
          [weight, note, exist.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          'INSERT INTO weight_records (user_id, record_date, period, weight, note) VALUES ($1,$2,$3,$4,$5)',
          [req.user.id, date, period, weight, note]
        );
        imported++;
      }
    }
    res.json({ imported, updated, skipped, total: imported + updated, errors: errors.slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: '导入失败: ' + e.message });
  }
});

// 解析单行CSV（处理引号内的逗号）
function parseCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// 月度汇总统计
app.get('/api/stats/summary', auth, async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: '缺少月份参数' });
  try {
    const r = await pool.query(
      `SELECT
        COUNT(DISTINCT record_date) as days,
        COUNT(*) as records,
        MIN(weight) as min_weight,
        MAX(weight) as max_weight,
        AVG(weight) as avg_weight
       FROM weight_records WHERE user_id=$1 AND to_char(record_date,'YYYY-MM')=$2`,
      [req.user.id, month]
    );
    // 月初体重（当月第一条早间记录）和月末体重（当月最后一条晚间记录）
    const first = await pool.query(
      `SELECT weight FROM weight_records WHERE user_id=$1 AND to_char(record_date,'YYYY-MM')=$2 ORDER BY record_date, period LIMIT 1`,
      [req.user.id, month]
    );
    const last = await pool.query(
      `SELECT weight FROM weight_records WHERE user_id=$1 AND to_char(record_date,'YYYY-MM')=$2 ORDER BY record_date DESC, period DESC LIMIT 1`,
      [req.user.id, month]
    );
    const s = r.rows[0];
    res.json({
      days: parseInt(s.days) || 0,
      records: parseInt(s.records) || 0,
      min: s.min_weight ? parseFloat(s.min_weight) : null,
      max: s.max_weight ? parseFloat(s.max_weight) : null,
      avg: s.avg_weight ? parseFloat(s.avg_weight) : null,
      first: first.rows.length ? parseFloat(first.rows[0].weight) : null,
      last: last.rows.length ? parseFloat(last.rows[0].weight) : null,
      change: (first.rows.length && last.rows.length) ? parseFloat(last.rows[0].weight) - parseFloat(first.rows[0].weight) : null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '统计失败' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Weight tracker running on port ${PORT}`));
