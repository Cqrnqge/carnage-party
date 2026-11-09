param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Continue'
$root = (Split-Path -Parent $PSScriptRoot).TrimEnd('\', '/')
$ports = @(3001, 3101, 5173) + @(32456..32463)
$targets = @{}

function Write-Line([string]$text, [string]$color = 'Gray') {
  if ($Quiet) { return }
  Write-Host $text -ForegroundColor $color
}

Write-Line "[Серверы] Папка проекта: $root" 'DarkGray'
Write-Line "[Серверы] Ищу node-процессы проекта и занятые порты..." 'DarkGray'

# 1. Процессы node, запущенные из папки проекта: сервер, Vite и dev-скрипты.
try {
  $nodeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop
  foreach ($process in $nodeProcesses) {
    $commandLine = [string]$process.CommandLine
    if (-not $commandLine) { continue }
    $fromProject = $commandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    if (-not $fromProject) { continue }
    $isServer =
      $commandLine -match 'server[\\/]standalone\.cjs' -or
      $commandLine -match 'server[\\/]app\.cjs' -or
      $commandLine -match 'scripts[\\/]dev\.cjs' -or
      $commandLine -match 'vite(\.js)?["'']?\s'
    if ($isServer) {
      $targets[[int]$process.ProcessId] = 'node'
    }
  }
} catch {
  Write-Line "[Серверы] Не удалось прочитать список процессов: $($_.Exception.Message)" 'Yellow'
}

# 2. Всё, что слушает порты проекта и является node.exe этого проекта.
try {
  $connections = Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $ports -contains [int]$_.LocalPort }
  foreach ($connection in $connections) {
    $processId = [int]$connection.OwningProcess
    if ($targets.ContainsKey($processId)) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $commandLine = [string]$process.CommandLine
    $fromProject = $commandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    # Сервер часто запускают из папки проекта относительным путём:
    # "node.exe" server/standalone.cjs. Такой процесс узнаём по имени
    # скрипта, но только на закреплённых за проектом портах.
    $knownServer =
      $commandLine -match 'server[\\/]standalone\.cjs' -or
      $commandLine -match 'server[\\/]app\.cjs' -or
      $commandLine -match 'scripts[\\/]dev\.cjs'
    if ($process.Name -ieq 'node.exe' -and ($fromProject -or $knownServer)) {
      $targets[$processId] = 'node'
    } else {
      Write-Line "[Серверы] Порт $($connection.LocalPort) занят другим процессом: $($process.Name) (PID $processId) — пропускаю." 'DarkYellow'
    }
  }
} catch {
  Write-Line "[Серверы] Не удалось проверить порты: $($_.Exception.Message)" 'Yellow'
}

if ($targets.Count -eq 0) {
  Write-Line "[Серверы] Запущенных серверов проекта не найдено." 'Green'
  exit 0
}

$stopped = 0
foreach ($processId in ($targets.Keys | Sort-Object)) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  try {
    Write-Line "[Серверы] Останавливаю $($process.ProcessName) (PID $processId)..." 'Yellow'
    Stop-Process -Id $processId -Force -ErrorAction Stop
    $stopped += 1
  } catch {
    Write-Line "[Серверы] Не удалось остановить PID ${processId}: $($_.Exception.Message)" 'Red'
  }
}

Start-Sleep -Milliseconds 700

$remaining = @()
try {
  $remaining = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $ports -contains [int]$_.LocalPort } |
    Select-Object -ExpandProperty LocalPort -Unique
} catch {}

if ($remaining.Count -gt 0) {
  Write-Line "[Серверы] Готово. Остановлено процессов: $stopped." 'Green'
  Write-Line "[Серверы] Порты, которые всё ещё слушают другие программы: $($remaining -join ', ')." 'DarkYellow'
} else {
  Write-Line "[Серверы] Готово. Остановлено процессов: $stopped. Порты проекта свободны." 'Green'
}
exit 0
