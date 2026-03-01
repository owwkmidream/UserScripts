export const CONFIG = {
    API_BASE: 'https://mail.chatgpt.org.uk/api',
    DEFAULT_API_KEY: 'gpt-test',
    STORAGE_KEYS: {
        API_KEY: 'gptmail_api_key',
        CURRENT_EMAIL: 'current_temp_email',
        GENERATED_PASSWORD: 'generated_password',
        GENERATED_USERNAME: 'generated_username',
        REGISTRATION_START_TIME: 'registration_start_time',
        API_USAGE_COUNT: 'api_usage_count',
        API_USAGE_RESET_DATE: 'api_usage_reset_date',
        LOG_DEBUG_ENABLED: 'aifengyue_log_debug_enabled',
        MODEL_SORT_ENABLED: 'aifengyue_model_sort_enabled',
    },
    API_QUOTA_LIMIT: 1000,
    VERIFICATION_CODE_PATTERNS: [
        /验证码[：:]\s*(\d{4,8})/,
        /code[：:]\s*(\d{4,8})/i,
        /(\d{4,8})\s*(?:是|为)?(?:您的)?验证码/,
        /Your (?:verification )?code is[：:\s]*(\d{4,8})/i,
        /完成注册[：:]\s*(\d{4,8})/,
        /registration[：:\s]*(\d{4,8})/i,
    ],
};

export const SIDEBAR_INITIAL_STATE = {
    email: '',
    username: '',
    password: '',
    status: 'idle',
    statusMessage: '等待操作...',
    pollCount: 0,
    verificationCode: '',
};
