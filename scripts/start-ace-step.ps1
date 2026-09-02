# 启动 ACE-Step REST API（默认 http://127.0.0.1:8001）
# 用法：.\scripts\start-ace-step.ps1
# 与 ComfyUI / 大型 Ollama 同卡时请先释放显存

$ErrorActionPreference = "Stop"
$AceRoot = if ($env:ACE_STEP_ROOT) { $env:ACE_STEP_ROOT } else { "C:\my\ace-step\ACE-Step-1.5" }
$HostAddr = if ($env:ACE_STEP_HOST) { $env:ACE_STEP_HOST } else { "127.0.0.1" }
$Port = if ($env:ACE_STEP_PORT) { $env:ACE_STEP_PORT } else { "8001" }
$Uv = if ($env:UV_EXE) { $env:UV_EXE } elseif (Test-Path "C:\project\hermes\bin\uv.exe") { "C:\project\hermes\bin\uv.exe" } else { "uv" }
$Python = Join-Path $AceRoot ".venv\Scripts\python.exe"
$ApiScript = Join-Path $AceRoot "acestep\api_server.py"

if (-not (Test-Path $ApiScript)) {
  Write-Host "未找到 ACE-Step：$AceRoot"
  Write-Host "请先安装 ACE-Step-1.5 到上述目录，或设置环境变量 ACE_STEP_ROOT"
  exit 1
}

$emb = Join-Path $AceRoot "checkpoints\Qwen3-Embedding-0.6B\model.safetensors"
$dit = Join-Path $AceRoot "checkpoints\acestep-v15-turbo\model.safetensors"
if (-not (Test-Path $dit) -or -not (Test-Path $emb)) {
  Write-Host "checkpoints 不完整，请确认 ACE-Step 权重已下载"
  exit 1
}

if (-not $env:HF_ENDPOINT) { $env:HF_ENDPOINT = "https://hf-mirror.com" }
$env:ACESTEP_INIT_LLM = if ($env:ACESTEP_INIT_LLM) { $env:ACESTEP_INIT_LLM } else { "auto" }
$env:CHECK_UPDATE = "false"

Write-Host "==> ACE-Step API: http://${HostAddr}:${Port}"
Write-Host "==> 根目录: $AceRoot"
Write-Host "==> 文档: http://${HostAddr}:${Port}/docs"
Write-Host "==> 首次请求会自动 /v1/init（约 2～3 分钟），后端也会自动初始化"
Write-Host "==> 按 Ctrl+C 停止"
Write-Host "==> 提示: 16GB 显存建议生成 BGM 前先释放 Comfy/Flux 显存"

Set-Location $AceRoot
$argsList = @($ApiScript, "--host", $HostAddr, "--port", $Port, "--download-source", "modelscope")
if (Test-Path $Python) {
  & $Python @argsList
} else {
  & $Uv run python @argsList
}
