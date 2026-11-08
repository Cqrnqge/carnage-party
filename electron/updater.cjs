'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const USER_AGENT = 'Carnage-Party-Updater';

function safeFileName(value) {
  const base = path.basename(String(value || '')).trim();
  if (!base || base.length > 180) return '';
  if (!/^[a-zA-Z0-9._ -]+$/.test(base)) return '';
  if (!/\.(exe|zip|apk|msi)$/i.test(base)) return '';
  return base;
}

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl, redirectsLeft) => {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch {
        reject(new Error('Некорректная ссылка на обновление'));
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error('Неподдерживаемый протокол'));
        return;
      }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(
        parsed,
        { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error('Слишком много перенаправлений'));
              return;
            }
            request(new URL(res.headers.location, currentUrl).toString(), redirectsLeft - 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(new Error(`Сервер вернул ${status}`));
            return;
          }

          const total = Number(res.headers['content-length']) || 0;
          let received = 0;
          const stream = fs.createWriteStream(destination);
          res.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress(received, total);
          });
          res.on('error', reject);
          stream.on('error', reject);
          stream.on('finish', () => {
            stream.close(() => resolve({ size: received, total }));
          });
          res.pipe(stream);
        }
      );
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error('Таймаут загрузки')));
    };
    request(url, 5);
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const file = path.join(
      require('os').tmpdir(),
      `carnage-update-${process.pid}-${Date.now()}.ps1`
    );
    fs.writeFileSync(file, `\uFEFF${script}`, 'utf8');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      reject(new Error('Не удалось распаковать архив обновления'));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      try {
        fs.unlinkSync(file);
      } catch {}
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell завершился с кодом ${code}`));
    });
  });
}

async function extractZip(zipPath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destination)} -Force`,
  ].join('\r\n');
  await runPowerShell(script);
}

function findPortableExe(directory) {
  const entries = fs.readdirSync(directory).filter((name) =>
    /^Carnage-Party-Portable-[\d.]+\.exe$/i.test(name)
  );
  if (!entries.length) return '';
  entries.sort((a, b) => {
    const av = (a.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
    const bv = (b.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
    for (let i = 0; i < 3; i += 1) {
      if ((av[i] || 0) !== (bv[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
    }
    return 0;
  });
  return entries[0];
}

// Готовит фоновый скрипт: дожидается выхода приложения, копирует новые файлы
// поверх portable-папки, убирает старый exe и запускает новый.
function preparePortableUpdate({ zipPath, processId, oldExe }) {
  const staging = path.join(path.dirname(zipPath), `portable-${Date.now()}`);
  return extractZip(zipPath, staging).then(() => {
    const newExe = findPortableExe(staging);
    if (!newExe) throw new Error('В архиве не найден portable exe');
    const target = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
    const scriptPath = path.join(
      require('os').tmpdir(),
      `carnage-portable-update-${Date.now()}.ps1`
    );
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$pidToWait = ${Number(processId) || 0}`,
      `$target = ${psQuote(target)}`,
      `$staging = ${psQuote(staging)}`,
      `$newExe = ${psQuote(newExe)}`,
      `$oldExe = ${psQuote(oldExe || '')}`,
      'try {',
      '  $deadline = (Get-Date).AddSeconds(120)',
      '  while ((Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 500 }',
      '  Start-Sleep -Milliseconds 800',
      '  $copied = $false',
      '  for ($i = 0; $i -lt 30 -and -not $copied; $i++) {',
      '    try {',
      '      Copy-Item -Path (Join-Path $staging "*") -Destination $target -Recurse -Force -ErrorAction Stop',
      '      $copied = $true',
      '    } catch { Start-Sleep -Milliseconds 700 }',
      '  }',
      '  if (-not $copied) { throw "Не удалось заменить файлы" }',
      '  if ($oldExe -and $oldExe -ne $newExe) {',
      '    for ($i = 0; $i -lt 15; $i++) {',
      '      Remove-Item (Join-Path $target $oldExe) -Force -ErrorAction SilentlyContinue',
      '      if (-not (Test-Path (Join-Path $target $oldExe))) { break }',
      '      Start-Sleep -Milliseconds 500',
      '    }',
      '  }',
      '  Start-Process -FilePath (Join-Path $target $newExe) -WorkingDirectory $target',
      '} catch {',
      "  Add-Content -Path (Join-Path $env:TEMP 'carnage-update-error.log') -Value ((Get-Date).ToString() + ' ' + $_.Exception.Message)",
      '}',
      'Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue',
      'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    ].join('\r\n');
    fs.writeFileSync(scriptPath, `\uFEFF${script}`, 'utf8');
    return { scriptPath, newExe, staging, target };
  });
}

// Готовит фоновый скрипт установки Setup: ждёт выхода приложения, запускает
// тихую переустановку поверх текущей версии и открывает приложение снова.
function prepareInstalledUpdate({ installerPath, processId }) {
  const scriptPath = path.join(
    require('os').tmpdir(),
    `carnage-install-update-${Date.now()}.ps1`
  );
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$pidToWait = ${Number(processId) || 0}`,
    `$installer = ${psQuote(installerPath)}`,
    'try {',
    '  $deadline = (Get-Date).AddSeconds(120)',
    '  while ((Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 400 }',
    '  Start-Sleep -Milliseconds 900',
    "  Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait",
    '  Start-Sleep -Milliseconds 1500',
    '  $appExe = $null',
    "  $uninstallRoot = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
    '  if (Test-Path $uninstallRoot) {',
    '    foreach ($key in Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue) {',
    '      $info = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue',
    "      if ($info.DisplayName -eq 'Carnage Party') {",
    '        $icon = [string]$info.DisplayIcon',
    '        if ($icon) {',
    "          $iconPath = ($icon -split ',')[0].Trim('\"')",
    '          if (Test-Path $iconPath) { $appExe = $iconPath }',
    '        }',
    '        if (-not $appExe -and $info.InstallLocation) {',
    "          $candidate = Join-Path $info.InstallLocation 'Carnage Party.exe'",
    '          if (Test-Path $candidate) { $appExe = $candidate }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  if (-not $appExe) {',
    "    foreach ($candidate in @((Join-Path $env:LOCALAPPDATA 'Programs\\Carnage Party\\Carnage Party.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\\carnage-party\\Carnage Party.exe'))) {",
    '      if (Test-Path $candidate) { $appExe = $candidate; break }',
    '    }',
    '  }',
    '  if ($appExe) { Start-Process -FilePath $appExe }',
    '} catch {',
    "  Add-Content -Path (Join-Path $env:TEMP 'carnage-update-error.log') -Value ((Get-Date).ToString() + ' ' + $_.Exception.Message)",
    '}',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  ].join('\r\n');
  fs.writeFileSync(scriptPath, `\uFEFF${script}`, 'utf8');
  return scriptPath;
}

// Запускает фоновый скрипт вне дерева процессов Electron. На Windows
// приложение может находиться в job object, который завершает дочерние
// процессы при выходе, поэтому процесс создаётся через WMI. Если WMI
// недоступен, используется обычный detached-запуск.
function launchUpdaterScript(scriptPath) {
  const commandLine = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"`;
  const script = [
    `$commandLine = ${psQuote(commandLine)}`,
    '$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine }',
    'if ($created.ReturnValue -ne 0) { throw "Win32_Process.Create: $($created.ReturnValue)" }',
  ].join('\r\n');
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, encoding: 'utf8' }
    );
    return true;
  } catch {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    child.unref();
    return false;
  }
}

module.exports = {
  downloadFile,
  extractZip,
  findPortableExe,
  launchUpdaterScript,
  prepareInstalledUpdate,
  preparePortableUpdate,
  safeFileName,
};
