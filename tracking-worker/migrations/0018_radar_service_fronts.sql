CREATE TABLE radar_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO radar_companies (id,name,icon_code) VALUES
('GSA-HOC','GSA HOC','GH'),('GSA-INFRA','GSA INFRA','GI'),('DR','DR','DR'),
('CIVIL-MASTER','CIVIL MASTER','CM'),('APIA','APIA','AP'),('ATERPA','ATERPA','AT'),
('SOMAFEL','SOMAFEL','SO'),('EMPA','EMPA','EM');

CREATE TABLE radar_users (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES radar_companies(id),
  login TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('fico_admin','fico_inspector','company_admin','front_manager','viewer')),
  phone TEXT,
  password_salt TEXT,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO radar_users (id,company_id,login,name,role) VALUES
('radar-user-thyago',NULL,'THYAGO','Thyago Viégas','fico_admin');

CREATE TABLE radar_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES radar_users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_radar_sessions_expiry ON radar_sessions(expires_at);

CREATE TABLE radar_people (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES radar_companies(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manager','safety_technician','subcontractor')),
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE radar_disciplines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO radar_disciplines (id,name) VALUES
('TERRAPLENAGEM','Terraplenagem'),('DRENAGEM','Drenagem'),('OAC','Obras de arte correntes'),
('OAE','Obras de arte especiais'),('PAVIMENTACAO','Pavimentação e acessos'),('VIA-PERMANENTE','Via permanente'),
('ELETRICA','Elétrica'),('SINALIZACAO','Sinalização'),('MEIO-AMBIENTE','Meio ambiente'),
('TOPOGRAFIA','Topografia'),('MANUTENCAO','Manutenção'),('APOIO-LOGISTICA','Apoio e logística'),
('SEGURANCA-TRABALHO','Segurança do trabalho'),('OUTRA','Outra');

CREATE TABLE radar_activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  approved INTEGER NOT NULL DEFAULT 1,
  suggested_by_user TEXT REFERENCES radar_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO radar_activities (id,name) VALUES
('ESCAVACAO','Escavação'),('ATERRO','Execução de aterro'),('DRENAGEM','Execução de drenagem'),
('CONCRETAGEM','Concretagem'),('ICAMENTO','Içamento de cargas'),('MONTAGEM','Montagem de estruturas'),
('MANUTENCAO','Manutenção'),('TOPOGRAFIA','Levantamento topográfico'),('LIMPEZA','Limpeza e conservação'),
('TRANSPORTE','Transporte de materiais'),('SINALIZACAO','Implantação de sinalização');

CREATE TABLE radar_risks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO radar_risks (id,name) VALUES
('ALTURA','Trabalho em altura'),('ELETRICIDADE','Eletricidade'),('CARGAS','Movimentação de cargas'),
('MAQUINAS','Máquinas e equipamentos'),('VEICULOS','Veículos automotores'),('ESCAVACAO','Escavação'),
('CONFINADO','Espaço confinado'),('VIA','Trabalho sobre ou próximo à via'),('ATROPELAMENTO','Atropelamento'),
('QUEDA-MATERIAIS','Queda de materiais'),('QUIMICOS','Produtos químicos'),('EXPLOSIVOS','Detonação e explosivos'),
('ICAMENTO','Içamento'),('TRABALHO-QUENTE','Trabalho a quente'),('REDE-ELETRICA','Interferência com rede elétrica'),
('AGUA','Trabalho sobre água'),('ANIMAIS','Animais peçonhentos');

CREATE TABLE radar_fronts (
  id TEXT PRIMARY KEY,
  sequence_number INTEGER NOT NULL,
  permanent_code TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES radar_companies(id),
  subcontractor TEXT,
  manager_name TEXT NOT NULL,
  manager_phone TEXT NOT NULL,
  safety_technician TEXT,
  inspector_user_id TEXT REFERENCES radar_users(id),
  discipline_id TEXT NOT NULL REFERENCES radar_disciplines(id),
  activity_id TEXT REFERENCES radar_activities(id),
  activity_name TEXT NOT NULL,
  description TEXT,
  workforce_count INTEGER NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','moderate','high','critical')),
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','active','paused','awaiting_definition','closed','cancelled','not_located','stopped')) DEFAULT 'scheduled',
  created_by_user TEXT NOT NULL REFERENCES radar_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_user TEXT REFERENCES radar_users(id),
  updated_at TEXT,
  closed_by_user TEXT REFERENCES radar_users(id),
  closed_at TEXT,
  close_note TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  revision_token TEXT NOT NULL
);
CREATE INDEX idx_radar_fronts_time ON radar_fronts(planned_start,planned_end,status);
CREATE INDEX idx_radar_fronts_company ON radar_fronts(company_id,planned_start);

CREATE TABLE radar_front_segments (
  id TEXT PRIMARY KEY,
  front_id TEXT NOT NULL REFERENCES radar_fronts(id) ON DELETE CASCADE,
  sequence_order INTEGER NOT NULL,
  km_start REAL NOT NULL,
  km_end REAL NOT NULL
);
CREATE INDEX idx_radar_segments_range ON radar_front_segments(km_start,km_end);

CREATE TABLE radar_front_equipment (
  id TEXT PRIMARY KEY,
  front_id TEXT NOT NULL REFERENCES radar_fronts(id) ON DELETE CASCADE,
  equipment_type TEXT NOT NULL,
  quantity INTEGER NOT NULL
);

CREATE TABLE radar_front_risks (
  front_id TEXT NOT NULL REFERENCES radar_fronts(id) ON DELETE CASCADE,
  risk_id TEXT NOT NULL REFERENCES radar_risks(id),
  PRIMARY KEY(front_id,risk_id)
);

CREATE TABLE radar_front_events (
  id TEXT PRIMARY KEY,
  front_id TEXT NOT NULL REFERENCES radar_fronts(id),
  event_type TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES radar_users(id),
  occurred_at TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX idx_radar_events_front_time ON radar_front_events(front_id,occurred_at DESC);

CREATE TABLE radar_checkins (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  front_id TEXT NOT NULL REFERENCES radar_fronts(id),
  inspector_user_id TEXT NOT NULL REFERENCES radar_users(id),
  result TEXT NOT NULL CHECK (result IN ('conforming','divergence','not_located','not_started','different_activity','stopped')),
  captured_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_m REAL,
  distance_to_front_m REAL,
  outside_tolerance INTEGER NOT NULL DEFAULT 0,
  distance_justification TEXT,
  found_workforce INTEGER,
  found_equipment_json TEXT,
  found_risks_json TEXT,
  comment TEXT,
  corrections_json TEXT
);
CREATE INDEX idx_radar_checkins_front_time ON radar_checkins(front_id,captured_at DESC);

CREATE TABLE radar_daily_reports (
  report_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
