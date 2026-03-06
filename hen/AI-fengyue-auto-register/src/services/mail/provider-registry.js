import { GPTMailProvider } from './providers/gptmail-provider.js';

export const MAIL_PROVIDERS = [
    GPTMailProvider,
];

export function getMailProviderById(providerId) {
    return MAIL_PROVIDERS.find((provider) => provider.id === providerId) || null;
}
