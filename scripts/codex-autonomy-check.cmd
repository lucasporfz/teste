@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul

echo === Codex Git/GitHub autonomy check ===
echo Project: %CD%
echo.

echo [1/5] User
whoami
echo.

echo [2/5] Git worktree
git status --short --branch
if errorlevel 1 (
  echo FAIL: Git status failed.
  popd >nul
  exit /b 1
)
echo.

echo [3/5] Git write access
git update-index --refresh >nul 2>nul
if errorlevel 1 (
  echo FAIL: Git cannot write/update its index. Check .git ownership/ACL for the Codex user.
  popd >nul
  exit /b 1
)
echo OK: Git index is writable.
echo.

echo [4/5] GitHub CLI auth
where gh >nul 2>nul
if errorlevel 1 (
  echo FAIL: gh is not in PATH.
  popd >nul
  exit /b 1
)
gh auth status
if errorlevel 1 (
  echo FAIL: gh auth is not valid for this user/process.
  popd >nul
  exit /b 1
)
echo.

echo [5/5] GitHub network
git ls-remote --heads origin >nul
if errorlevel 1 (
  echo FAIL: Cannot reach origin. Check network access to github.com:443.
  popd >nul
  exit /b 1
)
echo OK: origin is reachable.
echo.

echo SUCCESS: Codex can commit and push from this environment.
popd >nul
