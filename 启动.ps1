<#
.SYNOPSIS
  Invoice Manager 一键启动脚本
.DESCRIPTION
  同时启动后端 (uvicorn) 和前端 (Vite)，在同一终端显示彩色日志，
  方便调试时同时查看前后端输出。按 Ctrl+C 一键停止全部服务。
#>
param(
    [int]$BackendPort = 18080,
    [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Invoice Manager — 开发服务器"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

# ── 颜色标记 ──
$cBackend = "Green"
$cFrontend = "Cyan"
$cSystem  = "Yellow"
$cError   = "Red"
$cBanner  = "Blue"
$cSuccess = "Green"

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor $cBanner
Write-Host "        Invoice Manager — 开发服务器（一键启动）"                    -ForegroundColor $cBanner
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor $cBanner
Write-Host ""
Write-Host "  后端:  http://localhost:$BackendPort"       -ForegroundColor $cBackend
Write-Host "  前端:  http://localhost:$FrontendPort"      -ForegroundColor $cFrontend
Write-Host "  API:   http://localhost:$BackendPort/docs"  -ForegroundColor $cSystem
Write-Host ""
Write-Host "  [后端] 绿色  [前端] 青色  [系统] 黄色"     -ForegroundColor $cSystem
Write-Host "  按 Ctrl+C 一键停止全部服务"                -ForegroundColor $cSystem
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor $cBanner
Write-Host ""

# ── 检测 Python ──
function Find-Python {
    $candidates = @(
        (Join-Path $backendDir ".venv\Scripts\python.exe"),
        (Join-Path $backendDir "venv\Scripts\python.exe"),
        (Join-Path $root ".venv\Scripts\python.exe"),
        (Join-Path $root "venv\Scripts\python.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            Write-Host "[系统] 使用虚拟环境: $c" -ForegroundColor $cSystem
            return $c
        }
    }
    Write-Host "[系统] 未找到虚拟环境，使用系统 python" -ForegroundColor $cSystem
    return "python"
}

$pythonCmd = Find-Python

# ── 检查后端依赖 ──
Write-Host "[系统] 检查后端环境..." -ForegroundColor $cSystem
$uvicornCheck = & $pythonCmd -c "import uvicorn; print(uvicorn.__file__)" 2>$null
if (-not $uvicornCheck) {
    Write-Host "[系统] uvicorn 未安装，正在安装后端依赖..." -ForegroundColor $cSystem
    & $pythonCmd -m pip install -r (Join-Path $backendDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 后端依赖安装失败，请手动执行 pip install" -ForegroundColor $cError
        Read-Host "按回车键退出"
        exit 1
    }
}

# ── 检查前端依赖 ──
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "[系统] 安装前端依赖 (npm install)..." -ForegroundColor $cSystem
    Push-Location $frontendDir
    npm install
    Pop-Location
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] npm install 失败" -ForegroundColor $cError
        Read-Host "按回车键退出"
        exit 1
    }
}

# ── 创建临时文件用于捕获输出 ──
$beOut = New-TemporaryFile
$feOut = New-TemporaryFile

Write-Host "[系统] 启动后端 (uvicorn, 端口 $BackendPort)..." -ForegroundColor $cSystem
Write-Host "[系统] 启动前端 (Vite, 端口 $FrontendPort)..." -ForegroundColor $cSystem
Write-Host "[系统] ══════════════════════════════════════════" -ForegroundColor $cSystem
Write-Host ""

# ── 启动后端 ──
$beProc = Start-Process -FilePath $pythonCmd `
    -ArgumentList "-u -m uvicorn app.main:app --host 0.0.0.0 --port $BackendPort --reload" `
    -WorkingDirectory $backendDir `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardOutput $beOut `
    -RedirectStandardError $beOut

# ── 启动前端 ──
$feProc = Start-Process -FilePath "npm" `
    -ArgumentList "run dev -- --port $FrontendPort" `
    -WorkingDirectory $frontendDir `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardOutput $feOut `
    -RedirectStandardError $feOut

# ── Ctrl+C 清理 ──
$stopFlag = $false
$null = Register-EngineEvent -SourceIdentifier ([System.Management.Automation.PsEngineEvent]::Exiting) -Action { $global:stopFlag = $true }
[Console]::TreatControlCAsInput = $false
try { [Console]::CancelKeyPress += { $script:stopFlag = $true } } catch {}

# ── 轮询输出 ──
$bePos = 0
$fePos = 0
$beDone = $false
$feDone = $false

while (-not $stopFlag -and (-not $beDone -or -not $feDone)) {
    # 读取后端输出
    if (-not $beDone) {
        try {
            if (Test-Path $beOut) {
                $lines = Get-Content $beOut -ErrorAction SilentlyContinue
                if ($lines) {
                    for ($i = $bePos; $i -lt $lines.Count; $i++) {
                        Write-Host "[后端] $($lines[$i])" -ForegroundColor $cBackend
                    }
                    $bePos = $lines.Count
                }
            }
            if ($beProc.HasExited) { $beDone = $true }
        } catch {}
    }

    # 读取前端输出
    if (-not $feDone) {
        try {
            if (Test-Path $feOut) {
                $lines = Get-Content $feOut -ErrorAction SilentlyContinue
                if ($lines) {
                    for ($i = $fePos; $i -lt $lines.Count; $i++) {
                        Write-Host "[前端] $($lines[$i])" -ForegroundColor $cFrontend
                    }
                    $fePos = $lines.Count
                }
            }
            if ($feProc.HasExited) { $feDone = $true }
        } catch {}
    }

    Start-Sleep -Milliseconds 150

    # 如果调用者已经按下 Ctrl+C
    if ($stopFlag) { break }
}

# ── 停止服务 ──
Write-Host ""
Write-Host "[系统] 正在停止服务..." -ForegroundColor $cSystem

if (-not $beProc.HasExited) {
    Stop-Process -Id $beProc.Id -Force -ErrorAction SilentlyContinue
    # uvicorn 子进程也需要清理
    Get-Process -Id $beProc.Id -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if (-not $feProc.HasExited) {
    Stop-Process -Id $feProc.Id -Force -ErrorAction SilentlyContinue
}

# 清理临时文件
Remove-Item $beOut -ErrorAction SilentlyContinue
Remove-Item $feOut -ErrorAction SilentlyContinue

Write-Host "[系统] 全部服务已停止。" -ForegroundColor $cSystem
Write-Host ""
