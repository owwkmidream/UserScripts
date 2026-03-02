import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const shouldSkip = process.env.OPEN_USERSCRIPT_SKIP === '1' || process.env.CI === 'true';
const mode = process.argv[2] || 'launcher';
const host = '127.0.0.1';

const thisScriptPath = fileURLToPath(import.meta.url);
const userscriptPath = fileURLToPath(new URL('../../B站活动页任务助手.user.js', import.meta.url));

function spawnDetached(command, args) {
    const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
}

function openUrlInDefaultBrowser(url) {
    if (process.platform === 'win32') {
        // Use HTTP URL to avoid ".js" file association/open-with behavior.
        spawnDetached('cmd', ['/c', 'start', '', url]);
        return;
    }
    if (process.platform === 'darwin') {
        spawnDetached('open', [url]);
        return;
    }
    spawnDetached('xdg-open', [url]);
}

if (shouldSkip) {
    console.log('[postbuild] skip opening userscript file');
    process.exit(0);
}

if (mode === 'launcher') {
    spawnDetached(process.execPath, [thisScriptPath, 'server']);
    console.log('[postbuild] userscript bridge launched');
    process.exit(0);
}

if (mode === 'server') {
    let closeTimer = null;
    const source = readFileSync(userscriptPath);

    const server = createServer((req, res) => {
        if (req.url === '/userscript.user.js') {
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(source);

            if (closeTimer) {
                clearTimeout(closeTimer);
            }
            closeTimer = setTimeout(() => {
                server.close(() => process.exit(0));
            }, 2000);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
    });

    server.listen(0, host, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        const url = `http://${host}:${port}/userscript.user.js`;
        openUrlInDefaultBrowser(url);
        console.log(`[postbuild] opened in default browser via local bridge: ${url}`);
    });

    setTimeout(() => {
        server.close(() => process.exit(0));
    }, 120000);
}
