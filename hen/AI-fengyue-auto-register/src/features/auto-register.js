import { RuntimeMethods } from './auto-register/runtime-methods.js';
import { FormMethods } from './auto-register/form-methods.js';
import { SiteApiMethods } from './auto-register/site-api-methods.js';
import { ConversationMethods } from './auto-register/conversation-methods.js';
import { ModelConfigMethods } from './auto-register/model-config-methods.js';
import { ChatMessagesMethods } from './auto-register/chat-messages-methods.js';
import { FlowMethods } from './auto-register/flow-methods.js';

export const AutoRegister = {
    registrationStartTime: null,
    switchingAccount: false,
    accountPointPollTimer: null,
    accountPointPollAppId: '',
    accountPointPollIntervalMs: 0,
    accountPointPollInFlight: false,
    accountPointExhaustedTriggered: false,
    accountPointIndicatorEl: null,
    ...RuntimeMethods,
    ...FormMethods,
    ...SiteApiMethods,
    ...ConversationMethods,
    ...ModelConfigMethods,
    ...ChatMessagesMethods,
    ...FlowMethods,
};
