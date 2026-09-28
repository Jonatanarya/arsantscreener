param(
  [switch]$FrontendOnly
)

$ErrorActionPreference = 'Stop'
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $rootDir 'server'
$webDir = Join-Path $rootDir 'web'
$logsDir = Join-Path $rootDir 'logs'
$goBinDir = Join-Path ${env:ProgramFiles} 'Go\bin'

if (Test-Path -LiteralPath (Join-Path $goBinDir 'go.exe')) {
  $env:Path = "$goBinDir;$env:Path"
}

function Require-Command([string]$Name, [string]$Message) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw $Message
  }
}

Require-Command 'npm' 'Node.js belum tersedia. Instal Node.js LTS, lalu jalankan skrip ini kembali.'

if (-not $FrontendOnly) {
  Require-Command 'go' 'Go belum tersedia. Instal Go, tutup PowerShell, lalu jalankan skrip ini kembali.'
  if (-not (Test-Path -LiteralPath (Join-Path $serverDir '.env'))) {
    throw 'Buat server/.env dari server/.env.example, lalu isi koneksi database MySQL sebelum menjalankan backend.'
  }
}

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

if (-not $FrontendOnly) {
  $backendOut = Join-Path $logsDir 'backend.out.log'
  $backendErr = Join-Path $logsDir 'backend.err.log'
  Start-Process -FilePath 'go' -ArgumentList @('run', './cmd/server') -WorkingDirectory $serverDir -WindowStyle Hidden -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
  Write-Host 'Backend Arsant Screener dijalankan pada http://127.0.0.1:4000'
}

$frontendOut = Join-Path $logsDir 'frontend.out.log'
$frontendErr = Join-Path $logsDir 'frontend.err.log'
Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1') -WorkingDirectory $webDir -WindowStyle Hidden -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr

Write-Host 'Arsant Screener siap di http://127.0.0.1:5173'
Write-Host 'Log tersedia di folder logs.'
