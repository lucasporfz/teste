@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul
set "GIT_DIR="
set "GIT_WORK_TREE="

set "REPO_URL=https://github.com/lucasporfz/teste.git"
set "USER_NAME=lucasporfz"
set "USER_EMAIL=lucasporfz@users.noreply.github.com"

echo Checking Git repository...
git config --global --add safe.directory "%CD%"
if errorlevel 1 exit /b 1
git -C "%CD%" rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  git -C "%CD%" init -b main
  if errorlevel 1 exit /b 1
)

echo Configuring Git identity...
git -C "%CD%" config --local user.name "%USER_NAME%"
if errorlevel 1 exit /b 1
git -C "%CD%" config --local user.email "%USER_EMAIL%"
if errorlevel 1 exit /b 1

echo Configuring origin...
git -C "%CD%" remote get-url origin >nul 2>nul
if errorlevel 1 (
  git -C "%CD%" remote add origin "%REPO_URL%"
) else (
  git -C "%CD%" remote set-url origin "%REPO_URL%"
)
if errorlevel 1 exit /b 1

echo Checking GitHub CLI authentication...
where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI ^(gh^) was not found in PATH.
  echo Install GitHub CLI or open a new terminal after installing it.
  exit /b 1
)
gh auth status
if errorlevel 1 exit /b 1

echo Checking remote history...
git -C "%CD%" ls-remote --heads origin
if errorlevel 1 exit /b 1

echo Staging files...
git -C "%CD%" add .
if errorlevel 1 exit /b 1

echo Creating commit...
git -C "%CD%" commit -m "Prepare simulator project automation"
if errorlevel 1 exit /b 1

echo Pushing to origin/main...
git -C "%CD%" push -u origin main
if errorlevel 1 exit /b 1

echo Done.
popd >nul
