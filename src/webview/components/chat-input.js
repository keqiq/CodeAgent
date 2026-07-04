import { appendMessage, showTypingIndicator } from "./chat-container";
import { populateDropdown, populateModels } from "./ui_utils";

let chatProviderSelect;
let chatAPIKeyBtn;
let chatModelSelect;
let sendBtn;
let promptInput;
let chatAPIKeyContainer;
let chatAPIKeyInput;
let chatSaveKeyBtn;

export function initInput(vscode) {
    chatProviderSelect = document.getElementById('chatProviderSelect');
    chatAPIKeyBtn = document.getElementById('chatAPIKeyBtn');
    chatModelSelect = document.getElementById('chatModelSelect');
    sendBtn = document.getElementById('sendBtn');
    promptInput = document.getElementById('prompt');
    chatAPIKeyContainer = document.getElementById('chatAPIKeyContainer');
    chatAPIKeyInput = document.getElementById('chatAPIKeyInput');
    chatSaveKeyBtn = document.getElementById('chatSaveKeyBtn');

    promptInput.disabled = true;

    promptInput.addEventListener('input', function() {
        this.style.height = '20px';
        this.style.height = this.scrollHeight + 'px';
        sendBtn.disabled = this.value.trim() === '' || chatModelSelect.disabled;
    });

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) sendBtn.click();
        }
    });

    sendBtn.addEventListener('click', () => {
        const text = promptInput.value;
        const provider = chatProviderSelect.value;
        const model = chatModelSelect.value;

        if (text && provider && model) {
            appendMessage({ role: 'user', content: text });
            showTypingIndicator();
            vscode.postMessage({ type: 'askAgent', provider: provider, model: model, value: text });

            promptInput.value = '';
            promptInput.style.height = '20px';
            sendBtn.disabled = true;
        }
    });

    chatProviderSelect.addEventListener('change', (e) => {
        chatAPIKeyBtn.disabled = false;
        chatModelSelect.innerHTML = '<option value="">Loading...</option>';
        chatModelSelect.disabled = true;
        sendBtn.disabled = true;
        chatAPIKeyContainer.classList.remove('visible');
        promptInput.placeholder = `Loading ${e.target.value} models...`;
        promptInput.disabled = true;
        vscode.postMessage({ type: 'fetchChatModels', provider: e.target.value });
    });

    chatAPIKeyBtn.addEventListener('click',  () => {
        const provider = chatProviderSelect.value;
        if (provider) {

            const isNowVisible = chatAPIKeyContainer.classList.toggle('visible');
            if (isNowVisible) {
                // Only update text, clear, and focus if we are opening it
                document.getElementById('chatAPIKeyLabel').innerText = `Update ${provider} API Key:`;
                chatAPIKeyInput.value = '';
                chatAPIKeyInput.focus();
            }
        }
    });

    chatSaveKeyBtn.addEventListener('click', () => {
        const key = chatAPIKeyInput.value.trim();
        const provider = chatProviderSelect.value;
        if (key && provider) {
            chatModelSelect.innerHTML = '<option value="">Verifying...</option>';
            chatAPIKeyContainer.classList.remove('visible');
            vscode.postMessage({ type: 'saveChatAPIKey', provider: provider, key: key });
        }
    });

    chatModelSelect.addEventListener('change', (e) => {
        const model = e.target.value;
        promptInput.disabled = model === '';
        promptInput.placeholder = model === '' ? 'Select model...' : `Ask ${model}...`;
        vscode.postMessage({ type: 'saveChatModel', model: e.target.value });
        sendBtn.disabled = promptInput.value.trim() === '' || model === '';
    });
}

export function populateChatProviders(providers) {
    populateDropdown(chatProviderSelect, providers);
}

export function updateChatProvider(msg) {
    if (!msg.provider) return;
    chatProviderSelect.value = msg.provider;
    chatAPIKeyBtn.disabled = false;
    promptInput.placeholder = 'Select model...';
}

export function updateChatModels(msg) {
    if (!msg.models) return;
    populateModels(chatModelSelect, msg.models, msg.choice, sendBtn);
    if (msg.choice && msg.models.includes(msg.choice)) {

        chatModelSelect.value = msg.choice;
        promptInput.disabled = false;
        promptInput.placeholder = `Ask ${msg.choice}...`;
    } else {

        promptInput.disabled = true;
        promptInput.placeholder = 'Select model...';
    }
    
    chatModelSelect.disabled = false;
    
    sendBtn.disabled = promptInput.value.trim() === '' || promptInput.disabled;
}

export function requestChatAPIKey(msg) {
    if (!msg.provider) return;
    const label = document.getElementById('chatAPIKeyLabel');

    label.innerText = `Enter ${msg.provider} API key:`;
    chatModelSelect.innerHTML = '<option value="">Waiting for key...</option>';
    chatAPIKeyContainer.classList.add('visible');
    chatAPIKeyInput.value = '';
    chatAPIKeyInput.focus();
}

