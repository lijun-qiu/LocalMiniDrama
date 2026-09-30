# LocalMiniDrama Workflow Agent Contract

Agent **must** treat `WorkflowPlan` as the sole orchestration source. Do not hardcode step order.

## Endpoints

| Method | Path | Role |
|--------|------|------|
| POST | `/api/v1/dramas/{id}/workflow-plan` | Read plan (REST = agent body) |
| POST | `/api/v1/dramas/{id}/workflow-execute` | Run `next_action` when automatable |
| PUT | `/api/v1/dramas/{id}/workflow-modes` | Set `content_mode` × `generation_mode` |
| GET/POST | `/api/v1/episodes/{id}/script-review*` | step1 prepare / content / confirm |
| GET/POST | `/api/v1/episodes/{id}/video-units*` | reference_video final units |

## Modes (no ad)

`narration|drama` × `storyboard|reference_video`

## Loop

```
while true:
  plan = POST workflow-plan { episode, narration_delivery? }
  if plan.next_action.type in (export done path after success, none with blockers): break
  if plan.next_action.type == wait_for_task: poll tasks; continue
  if plan.next_action.type == choose_narration_delivery:
    re-call plan with narration_delivery chosen; continue
  result = POST workflow-execute { episode, narration_delivery }
  if result.ok == false and result.detail.ui:
    call the UI REST endpoints listed / implied by detail; continue
```

## next_action → REST map

| action | Automated execute | Manual / UI REST |
|--------|-------------------|------------------|
| collect_project_input | hint | create/update drama + episode script |
| analyze_assets | props+scenes extract | `POST .../characters/extract` |
| prepare_step1 | yes | also `POST .../script-review/prepare` |
| confirm_step1 | yes | `POST .../script-review/confirm` |
| generate_script | yes (storyboard task **or** video_units) | |
| generate_asset_sheets | hint | character/scene/prop image gen |
| generate_storyboards | hint | batch storyboard images |
| choose_narration_delivery | pass in plan body | |
| generate_videos | hint | batch video gen |
| export | yes (`finalizeEpisode`) | |
| wait_for_task | poll | `GET /tasks/:id` |

## Three axes

Never collapse `steps[].state`, `steps[].artifacts`, and `steps[].tasks` into one badge.
