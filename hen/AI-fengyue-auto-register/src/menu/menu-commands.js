import { CONFIG } from '../constants.js';
import { gmRegisterMenuCommand } from '../gm.js';
import { ApiService } from '../services/api-service.js';
import { AutoRegister } from '../features/auto-register.js';
import { Sidebar } from '../ui/sidebar.js';
import { Toast } from '../ui/toast.js';
import { isDebugEnabled, toggleDebugEnabled } from '../utils/logger.js';

export function registerMenuCommands() {
    gmRegisterMenuCommand('🪵 切换调试日志', () => {
        const enabled = toggleDebugEnabled();
        Toast.info(`调试日志已${enabled ? '开启' : '关闭'}`);
    });

    gmRegisterMenuCommand(`🔍 调试日志状态: ${isDebugEnabled() ? 'ON' : 'OFF'}`, () => {
        Toast.info(`当前调试日志: ${isDebugEnabled() ? 'ON' : 'OFF'}`);
    });

    gmRegisterMenuCommand('⚙️ 设置 API Key', () => {
        const currentKey = ApiService.getApiKey();
        const newKey = prompt('请输入 GPTMail API Key:', currentKey);
        if (newKey !== null) {
            ApiService.setApiKey(newKey.trim() || CONFIG.DEFAULT_API_KEY);
            Toast.success('API Key 已更新');
            const input = document.querySelector('#aifengyue-api-key');
            if (input) input.value = newKey.trim() || CONFIG.DEFAULT_API_KEY;
        }
    });

    gmRegisterMenuCommand('📧 生成新邮箱', () => {
        AutoRegister.generateNewEmail();
    });

    gmRegisterMenuCommand('🚀 开始自动注册', () => {
        AutoRegister.start();
    });

    gmRegisterMenuCommand(' 获取验证码', () => {
        AutoRegister.fetchVerificationCode();
    });

    gmRegisterMenuCommand('📝 打开侧边栏', () => {
        Sidebar.open();
    });
}
