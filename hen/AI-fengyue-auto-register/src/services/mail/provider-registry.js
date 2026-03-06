import { GPTMailProvider } from './providers/gptmail-provider.js';
import { EmailnatorProvider } from './providers/emailnator-provider.js';

export const MAIL_PROVIDERS = [
    GPTMailProvider,
    EmailnatorProvider,
];

export function getMailProviderById(providerId) {
    return MAIL_PROVIDERS.find((provider) => provider.id === providerId) || null;
}
