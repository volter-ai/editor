// Task ownership lives beside Git's worktree metadata, outside disposable checkouts.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function canonical(target) {
  const absolute = resolve(target);
  return existsSync(absolute)
    ? realpathSync(absolute)
    : join(canonical(dirname(absolute)), basename(absolute));
}
function location(repo, target) {
  const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const path = canonical(target);
  const id = createHash('sha256').update(path).digest('hex');
  return { path, file: join(common, 'task-worktrees', `${id}.json`), id };
}
function write(file, record) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  renameSync(tmp, file);
}
function locked(repo, target, action) {
  const loc = location(repo, target);
  mkdirSync(dirname(loc.file), { recursive: true });
  // A crashed writer's lock is retained for explicit owner recovery, never stolen by age.
  const lock = `${loc.file}.lock`;
  mkdirSync(lock);
  try {
    return action(loc);
  } finally {
    rmSync(lock, { recursive: true });
  }
}
function read(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
function registered(repo, path) {
  return git(repo, ['worktree', 'list', '--porcelain', '-z'])
    .split('\0')
    .includes(`worktree ${path}`);
}
function generationFile(repo, path) {
  if (canonical(git(path, ['rev-parse', '--show-toplevel'])) !== path)
    throw new Error('Path is not the registered worktree root.');
  if (
    git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']) !==
    git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  )
    throw new Error('Worktree belongs to a different repository.');
  return join(git(path, ['rev-parse', '--absolute-git-dir']), 'task-generation');
}
function markGeneration(repo, path, record) {
  const file = generationFile(repo, path);
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== record.generation)
      throw new Error('Worktree generation differs from creation intent.');
  } else {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, record.generation, { flag: 'wx' });
      linkSync(temporary, file); // Exclusive publication of complete bytes only.
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
function verifyGeneration(repo, path, record) {
  if (readFileSync(generationFile(repo, path), 'utf8') !== record.generation)
    throw new Error('Worktree generation changed; old completion cannot remove it.');
}
function preserve(repo, ref, head) {
  try {
    git(repo, ['update-ref', ref, head, '']);
  } catch (error) {
    if (git(repo, ['rev-parse', '--verify', ref]) !== head) throw error;
  }
}
export function registerTaskWorktree(repo, target, owner, branch) {
  if (!owner?.trim()) throw new Error('A task owner is required.');
  locked(repo, target, ({ path, file }) => {
    if (existsSync(path) || registered(repo, path))
      throw new Error(`Worktree destination already exists: ${path}`);
    const previous = read(file);
    if (previous && previous.state !== 'finished')
      throw new Error(
        'An earlier task still owns this path; inspect its retained creation/removal receipt.',
      );
    write(file, {
      version: 1,
      generation: randomUUID(),
      root: path,
      owner,
      branch,
      createdAt: new Date().toISOString(),
      state: 'creating',
    });
  });
}
export function markTaskWorktreeCreated(repo, target) {
  locked(repo, target, ({ path, file }) => {
    const record = read(file);
    if (record?.state !== 'creating' || !registered(repo, path))
      throw new Error('No matching worktree creation intent.');
    markGeneration(repo, path, record);
    write(file, { ...record, state: 'active' });
  });
}
function removePreserved(repo, path, file, record) {
  if (!existsSync(path)) {
    if (registered(repo, path))
      throw new Error('Checkout is missing but Git still registers it; inspect before recovering.');
  } else {
    verifyGeneration(repo, path, record);
    if (git(path, ['status', '--porcelain']) !== '')
      throw new Error('Worktree has uncommitted or untracked work.');
    if (git(path, ['rev-parse', 'HEAD']) !== record.preservedCommit)
      throw new Error('HEAD changed after completion; retain this worktree for review.');
    git(repo, ['worktree', 'remove', path]);
  }
  write(file, { ...record, state: 'finished', finishedAt: new Date().toISOString() });
}
export function finishTaskWorktree(
  repo,
  target,
  { owner, mergedInto, consumersRetired = false } = {},
) {
  locked(repo, target, ({ path, file, id }) => {
    if (path === canonical(git(repo, ['rev-parse', '--show-toplevel'])))
      throw new Error('Run finish from another checkout.');
    if (!consumersRetired)
      throw new Error('Retire the task’s editor, terminals and other consumers before finishing.');
    const record = read(file);
    if (record?.root !== path || record.owner !== owner)
      throw new Error('This worktree belongs to a different task or is unregistered.');
    if (record.state === 'finished' && !existsSync(path) && !registered(repo, path)) return;
    if (record.state === 'removing') return removePreserved(repo, path, file, record);
    if (record.state !== 'active')
      throw new Error('Worktree creation did not finish; inspect the retained intent.');
    if (!mergedInto)
      throw new Error(
        'Specify the ref that preserves the completed task (--merged-into origin/main).',
      );
    verifyGeneration(repo, path, record);
    if (git(path, ['status', '--porcelain']) !== '')
      throw new Error('Worktree has uncommitted or untracked work.');
    const head = git(path, ['rev-parse', 'HEAD']);
    const preserved = git(repo, ['rev-parse', '--verify', `${mergedInto}^{commit}`]);
    git(repo, ['merge-base', '--is-ancestor', head, preserved]);
    const ref = `refs/task-worktrees/${id}/${record.generation}`;
    preserve(repo, ref, head);
    const removing = {
      ...record,
      state: 'removing',
      preservedRef: ref,
      preservedCommit: head,
      mergedInto: preserved,
      consumersRetiredAt: new Date().toISOString(),
    };
    write(file, removing);
    removePreserved(repo, path, file, removing);
  });
}
export function removeArchivedWorktree(repo, target) {
  locked(repo, target, ({ path, file, id }) => {
    // The existing explicit archive caller checks current tree, live sessions and dirtiness.
    const previous = read(file);
    if (previous && !['active', 'removing', 'adopting'].includes(previous.state))
      throw new Error('Task creation or an older generation needs review before archive.');
    const record = previous ?? {
      version: 1,
      generation: randomUUID(),
      root: path,
      owner: 'explicit-archive',
      state: 'adopting',
    };
    if (!previous) write(file, record);
    if (record.state === 'adopting') markGeneration(repo, path, record);
    verifyGeneration(repo, path, record);
    if (record.state === 'removing') return removePreserved(repo, path, file, record);
    const head = git(path, ['rev-parse', 'HEAD']);
    const ref = `refs/task-worktrees/${id}/${record.generation}`;
    preserve(repo, ref, head);
    const removing = {
      ...record,
      state: 'removing',
      preservedRef: ref,
      preservedCommit: head,
      consumersRetiredAt: new Date().toISOString(),
    };
    write(file, removing);
    removePreserved(repo, path, file, removing);
  });
}
