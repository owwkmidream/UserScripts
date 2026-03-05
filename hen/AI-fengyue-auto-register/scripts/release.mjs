import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const META_PATH = new URL('../src/meta.user.js', import.meta.url);
const OUTPUT_PATH = new URL('../../AI fengyue auto register.user.js', import.meta.url);
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

function printHelp() {
    console.log([
        'Usage:',
        '  pnpm run release',
        '  pnpm run release -- --bump patch|minor|major',
        '  pnpm run release -- --version X.Y.Z',
        '  pnpm run release -- --no-git',
        '  pnpm run release -- --dry-run',
        '',
        'Options:',
        '  --bump <type>    版本递增类型，默认 patch',
        '  --version <ver>  直接指定目标版本（X.Y.Z）',
        '  --no-build       仅更新版本，不执行构建',
        '  --no-git         跳过 git commit/push',
        '  --no-push        commit 但不 push',
        '  --allow-dirty    允许在非干净工作区执行（默认禁止）',
        '  --dry-run        仅预览，不写文件不构建',
        '  --help           显示帮助',
    ].join('\n'));
}

function parseArgs(argv) {
    const options = {
        bump: 'patch',
        version: '',
        noBuild: false,
        noGit: false,
        noPush: false,
        allowDirty: false,
        dryRun: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--') {
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--no-build') {
            options.noBuild = true;
            continue;
        }
        if (arg === '--no-git') {
            options.noGit = true;
            continue;
        }
        if (arg === '--no-push') {
            options.noPush = true;
            continue;
        }
        if (arg === '--allow-dirty') {
            options.allowDirty = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--bump') {
            const value = argv[i + 1] || '';
            i += 1;
            options.bump = value;
            continue;
        }
        if (arg === '--version') {
            const value = argv[i + 1] || '';
            i += 1;
            options.version = value;
            continue;
        }
        throw new Error(`未知参数: ${arg}`);
    }
    return options;
}

function parseSemver(version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`版本号格式无效: ${version}（要求 X.Y.Z）`);
    }
    return version.split('.').map((item) => Number.parseInt(item, 10));
}

function bumpVersion(version, bump) {
    const [major, minor, patch] = parseSemver(version);
    if (bump === 'major') return `${major + 1}.0.0`;
    if (bump === 'minor') return `${major}.${minor + 1}.0`;
    if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
    throw new Error(`--bump 仅支持 patch|minor|major，收到: ${bump}`);
}

function resolveNextVersion(currentVersion, options) {
    if (options.version && options.bump !== 'patch') {
        throw new Error('--version 与 --bump 不能同时使用');
    }
    if (options.version) {
        parseSemver(options.version);
        return options.version;
    }
    return bumpVersion(currentVersion, options.bump || 'patch');
}

function updateMetaVersion(text, nextVersion) {
    const lines = text.split('\n');
    let found = false;
    const nextLines = lines.map((line) => {
        const match = line.match(/^(\s*\/\/\s*@version\s+)(\S+)(\s*)$/);
        if (!match) return line;
        found = true;
        return `${match[1]}${nextVersion}${match[3] || ''}`;
    });
    if (!found) {
        throw new Error('src/meta.user.js 未找到 @version 行');
    }
    return nextLines.join('\n');
}

function runBuild() {
    const npmExecPath = process.env.npm_execpath;
    const isNpmExecPathUsable = typeof npmExecPath === 'string' && npmExecPath.length > 0;
    const command = isNpmExecPathUsable
        ? process.execPath
        : (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
    const args = isNpmExecPathUsable
        ? [npmExecPath, 'run', 'build']
        : ['run', 'build'];

    const result = spawnSync(command, args, {
        stdio: 'inherit',
        env: {
            ...process.env,
            OPEN_USERSCRIPT_SKIP: '1',
        },
    });
    if (result.error) {
        throw new Error(`构建进程启动失败: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const signalSuffix = result.signal ? `，signal: ${result.signal}` : '';
        throw new Error(`构建失败，退出码: ${result.status}${signalSuffix}`);
    }
}

function runGit(args, options = {}) {
    const result = spawnSync('git', args, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        ...options,
    });
    if (result.error) {
        throw new Error(`git ${args.join(' ')} 执行失败: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const stdout = String(result.stdout || '').trim();
        const stderr = String(result.stderr || '').trim();
        const details = [stdout, stderr].filter(Boolean).join('\n');
        throw new Error(`git ${args.join(' ')} 失败（退出码 ${result.status}）${details ? `\n${details}` : ''}`);
    }
    return result;
}

function ensureCleanWorktree() {
    const result = runGit(['status', '--porcelain']);
    const output = String(result.stdout || '').trim();
    if (output) {
        throw new Error('工作区不干净，请先提交或清理后再执行 release（或使用 --allow-dirty）');
    }
}

function commitAndPush(nextVersion, options) {
    const statusResult = runGit(['status', '--porcelain']);
    const statusOutput = String(statusResult.stdout || '').trim();
    if (!statusOutput) {
        console.log('[release] 没有可提交改动，跳过 commit/push');
        return;
    }

    runGit(['add', '-A']);
    runGit(['commit', '-m', `chore: release v${nextVersion}`, '-m', 'Index: N/A（索引无变更）'], {
        stdio: 'inherit',
    });
    console.log('[release] 已完成 git commit');

    if (options.noPush) {
        console.log('[release] --no-push：跳过 push');
        return;
    }

    const branchResult = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = String(branchResult.stdout || '').trim();
    if (!branch || branch === 'HEAD') {
        throw new Error('当前不在分支上，无法自动 push');
    }
    runGit(['push', 'origin', branch], { stdio: 'inherit' });
    console.log(`[release] 已推送 origin/${branch}`);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    if (!options.allowDirty && !options.dryRun) {
        ensureCleanWorktree();
    }

    const metaText = readFileSync(META_PATH, 'utf8');
    const versionMatch = metaText.match(/^\s*\/\/\s*@version\s+(\S+)\s*$/m);
    if (!versionMatch) {
        throw new Error('src/meta.user.js 未找到当前版本号');
    }

    const currentVersion = versionMatch[1];
    const nextVersion = resolveNextVersion(currentVersion, options);
    const changed = currentVersion !== nextVersion;

    console.log(`[release] 当前版本: ${currentVersion}`);
    console.log(`[release] 目标版本: ${nextVersion}`);

    const nextMetaText = changed ? updateMetaVersion(metaText, nextVersion) : metaText;

    if (!changed) {
        console.log('[release] 版本号未变化，跳过写入');
    } else if (options.dryRun) {
        console.log('[release] dry-run 模式：跳过写入版本号');
    } else {
        writeFileSync(META_PATH, nextMetaText, 'utf8');
        console.log('[release] 已更新 src/meta.user.js');
    }

    if (options.noBuild) {
        console.log('[release] --no-build：跳过构建');
        return;
    }
    if (options.dryRun) {
        console.log('[release] dry-run 模式：跳过构建');
        return;
    }

    try {
        runBuild();
    } catch (error) {
        if (changed) {
            // 构建失败时还原版本文件，避免“版本已改但产物未成功更新”的半完成状态
            writeFileSync(META_PATH, metaText, 'utf8');
            console.log('[release] 构建失败，已回滚 src/meta.user.js');
        }
        throw error;
    }
    if (!existsSync(OUTPUT_PATH)) {
        throw new Error('构建完成但未找到 userscript 产物文件');
    }
    console.log('[release] 构建成功，产物已更新');

    if (options.noGit) {
        console.log('[release] --no-git：跳过 commit/push');
        return;
    }
    commitAndPush(nextVersion, options);
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[release] ${message}`);
    process.exit(1);
}
