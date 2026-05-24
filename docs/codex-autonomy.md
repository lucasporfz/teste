# Codex Autonomy Requirements

For Codex to commit and push without manual steps, the environment running Codex must satisfy all of these:

1. The Codex process can write to `.git`.
2. The Codex process has valid GitHub authentication.
3. The Codex process can reach `github.com:443`.
4. The repo has a configured `origin`.
5. Validation can run before commit.

Run:

```powershell
.\scripts\codex-autonomy-check.cmd
```

Current known blockers in the desktop sandbox:

- Codex runs as `DESKTOP-BIAGRH5\CodexSandboxOffline`.
- `.git/index.lock` cannot be created by that user.
- `gh auth status` sees an invalid token for that user/process.
- TCP to `github.com:443` fails from the sandbox.

Until those are fixed at the environment level, Codex can edit files and prepare commits, but it cannot complete `git add`, `git commit`, or `git push` by itself.

Preferred fix:

- Open this project in a Codex environment where the same user owns `.git`.
- Authenticate GitHub inside that same environment using `gh auth login`.
- Allow outbound HTTPS to `github.com` and `api.github.com`.

Fallback:

- Use the local PowerShell as user `Lucas` for `git add`, `commit`, and `push`.
