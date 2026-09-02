-- 分镜抽帧 Foley 音效（与 BGM 独立）
ALTER TABLE episodes ADD COLUMN foley_events_json TEXT;
ALTER TABLE episodes ADD COLUMN foley_status TEXT;
ALTER TABLE episodes ADD COLUMN foley_error TEXT;
ALTER TABLE episodes ADD COLUMN foley_video_url TEXT;
ALTER TABLE episodes ADD COLUMN foley_task_id INTEGER;
