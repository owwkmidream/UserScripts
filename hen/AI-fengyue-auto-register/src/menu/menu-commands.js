import { CONFIG } from '../constants.js';
import { gmRegisterMenuCommand } from '../gm.js';
import { ApiService } from '../services/api-service.js';
import { AutoRegister } from '../features/auto-register.js';
import { Sidebar } from '../ui/sidebar.js';
import { Toast } from '../ui/toast.js';

export function registerMenuCommands() {
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
