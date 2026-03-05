import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const META_PATH = new URL('../src/meta.user.js', import.meta.url);
const OUTPUT_PATH = new URL('../../AI fengyue auto register.user.js', import.meta.url);

function printHelp() {
    console.log([
        'Usage:',
        '  pnpm run release',
        '  pnpm run release -- --bump patch|minor|major',
        '  pnpm run release -- --version X.Y.Z',
        '  pnpm run release -- --dry-run',
        '',
        'Options:',
        '  --bump <type>    版本递增类型，默认 patch',
        '  --version <ver>  直接指定目标版本（X.Y.Z）',
        '  --no-build       仅更新版本，不执行构建',
        '  --dry-run        仅预览，不写文件不构建',
        '  --help           显示帮助',
    ].join('\n'));
}

function parseArgs(argv) {
    const options = {
        bump: 'patch',
        version: '',
        noBuild: false,
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

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
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
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[release] ${message}`);
    process.exit(1);
}
