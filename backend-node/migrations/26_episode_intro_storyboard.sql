-- 每集独立片头分镜：与正文 1..N 隔离，合成时可前置拼入成片
ALTER TABLE storyboards ADD COLUMN is_intro INTEGER DEFAULT 0;
