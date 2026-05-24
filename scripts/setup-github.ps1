param(
  [string]$RepoUrl = "https://github.com/lucasporfz/teste.git",
  [string]$UserName = "lucasporfz",
  [string]$UserEmail = "lucasporfz@users.noreply.github.com"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
Remove-Item Env:GIT_DIR -ErrorAction SilentlyContinue
Remove-Item Env:GIT_WORK_TREE -ErrorAction SilentlyContinue

Write-Host "Checking Git repository..."
git config --global --add safe.directory $Root
git -C $Root rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  git -C $Root init -b main
}

Write-Host "Configuring Git identity..."
git -C $Root config --local user.name $UserName
git -C $Root config --local user.email $UserEmail

Write-Host "Configuring origin..."
if (git -C $Root remote get-url origin 2>$null) {
  git -C $Root remote set-url origin $RepoUrl
} else {
  git -C $Root remote add origin $RepoUrl
}

Write-Host "Checking GitHub CLI authentication..."
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh auth status
} else {
  Write-Warning "GitHub CLI (gh) was not found in PATH. Install it or add it to PATH before pushing."
}

Write-Host "Checking remote history..."
git -C $Root ls-remote --heads origin

Write-Host "Staging files..."
git -C $Root add .

Write-Host "Creating commit..."
git -C $Root commit -m "Prepare simulator project automation"

Write-Host "Pushing to origin/main..."
git -C $Root push -u origin main

Write-Host "Done."
