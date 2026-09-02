-- 整集 BGM / 音效：库表 + 成片旁路（不覆盖原合成 video_url）
CREATE TABLE IF NOT EXISTS music_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER,
  episode_id INTEGER,
  storyboard_id INTEGER,
  provider TEXT DEFAULT '',
  model TEXT DEFAULT '',
  prompt TEXT,
  description TEXT,
  title TEXT,
  audio_url TEXT,
  local_path TEXT,
  cover_url TEXT,
  duration REAL,
  kind TEXT DEFAULT 'bgm',
  task_id TEXT,
  batch_id TEXT,
  status TEXT DEFAULT 'pending',
  error_msg TEXT,
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT,
  deleted_at TEXT
);

ALTER TABLE episodes ADD COLUMN bgm_local_path TEXT;
ALTER TABLE episodes ADD COLUMN bgm_music_id INTEGER;
ALTER TABLE episodes ADD COLUMN sfx_local_path TEXT;
ALTER TABLE episodes ADD COLUMN sfx_music_id INTEGER;
ALTER TABLE episodes ADD COLUMN bgm_video_url TEXT;
