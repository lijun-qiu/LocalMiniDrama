-- 整段解说旁白配音（一次 IndexTTS 合成，再按分镜剪切）
ALTER TABLE episodes ADD COLUMN full_narration_audio_local_path TEXT;
