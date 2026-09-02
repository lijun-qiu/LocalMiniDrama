-- 本集绑定跨集道具/场景（与 episode_characters 同模式；资产仍归原集，本集可显示与选用）
CREATE TABLE IF NOT EXISTS episode_props (
  episode_id INTEGER NOT NULL,
  prop_id INTEGER NOT NULL,
  PRIMARY KEY (episode_id, prop_id)
);

CREATE TABLE IF NOT EXISTS episode_scenes (
  episode_id INTEGER NOT NULL,
  scene_id INTEGER NOT NULL,
  PRIMARY KEY (episode_id, scene_id)
);
