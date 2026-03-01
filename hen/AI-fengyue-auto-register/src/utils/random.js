export function randomString(length, charset = 'abcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

export function generateUsername() {
    const prefixes = ['user', 'ai', 'cat', 'test', 'demo', 'new', 'cool', 'pro', 'dev', 'fan'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return prefix + randomString(6, 'abcdefghijklmnopqrstuvwxyz0123456789');
}

export function generatePassword() {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    let password = randomString(4, letters) + randomString(4, digits);
    password = password.split('').sort(() => Math.random() - 0.5).join('');
    return password;
}

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
