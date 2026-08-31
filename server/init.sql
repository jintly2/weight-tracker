-- 体重记录追踪系统 数据库初始化
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50),
  signature VARCHAR(200),
  gender VARCHAR(10) DEFAULT 'male',
  age INTEGER,
  height NUMERIC(5,2),
  initial_weight NUMERIC(6,2),
  target_weight NUMERIC(6,2),
  unit VARCHAR(10) DEFAULT 'kg',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weight_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  period VARCHAR(10) NOT NULL DEFAULT 'morning',
  weight NUMERIC(6,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, record_date, period)
);

CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_records(user_id, record_date);
