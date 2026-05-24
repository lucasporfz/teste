import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

const issues = [];
const gitVersion = run('git', ['--version']);
if (!gitVersion) issues.push('Git não encontrado no PATH.');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const safeDirArgs = ['-c', `safe.directory=${projectRoot}`];
const insideGit = run('git', [...safeDirArgs, 'rev-parse', '--is-inside-work-tree']) === 'true';
if (!insideGit) issues.push('Esta pasta ainda não é um repositório Git. Rode: git init');

const userName = run('git', ['config', '--global', '--get', 'user.name']);
const userEmail = run('git', ['config', '--global', '--get', 'user.email']);
if (!userName) issues.push('Git user.name global não configurado.');
if (!userEmail) issues.push('Git user.email global não configurado.');

const origin = run('git', [...safeDirArgs, 'remote', 'get-url', 'origin']);
if (insideGit && !origin) issues.push('Remote origin ainda não configurado.');

const ghVersion = run('gh', ['--version']);
if (!ghVersion) issues.push('GitHub CLI (gh) não encontrado. Instale e rode: gh auth login');
else {
  const ghStatus = run('gh', ['auth', 'status']);
  if (!ghStatus) issues.push('GitHub CLI instalado, mas autenticação não confirmada.');
}

if (issues.length) {
  console.log('Git/GitHub setup pendente:');
  for (const issue of issues) console.log(`- ${issue}`);
} else {
  console.log('Git/GitHub setup OK.');
}
