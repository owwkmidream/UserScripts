import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'rolldown';

const meta = readFileSync(new URL('./src/meta.user.js', import.meta.url), 'utf8').trimEnd();
const inputFile = fileURLToPath(new URL('./src/index.js', import.meta.url));
const outputFile = fileURLToPath(new URL('../B站活动页任务助手.user.js', import.meta.url));

export default defineConfig({
    input: inputFile,
    treeshake: false,
    output: {
        file: outputFile,
        format: 'iife',
        name: 'EraTaskAssistant',
        sourcemap: false,
        banner: `${meta}\n`,
    },
});
