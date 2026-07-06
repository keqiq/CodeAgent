import { appendMessage, showTypingIndicator } from "./chat-container";
import { populateDropdown, populateModels } from "./ui_utils";

let vscode;

let chatProviderSelect;
let chatAPIKeyBtn;
let chatModelSelect;
let sendBtn;
let promptInput;
let chatAPIKeyContainer;
let chatAPIKeyInput;
let chatSaveKeyBtn;

let chatSettingsToggleBtn;
let chatSettingsPanel;
let statefulToggle;
let effortSelect;
let showAllModelsToggle;

let currentChatProvider = '';
let currentChatModel = '';

export function initInput(vscodeAPI) {
    vscode = vscodeAPI;
    chatProviderSelect = document.getElementById('chatProviderSelect');
    chatAPIKeyBtn = document.getElementById('chatAPIKeyBtn');
    chatModelSelect = document.getElementById('chatModelSelect');
    sendBtn = document.getElementById('sendBtn');
    promptInput = document.getElementById('prompt');
    chatAPIKeyContainer = document.getElementById('chatAPIKeyContainer');
    chatAPIKeyInput = document.getElementById('chatAPIKeyInput');
    chatSaveKeyBtn = document.getElementById('chatSaveKeyBtn');

    chatSettingsToggleBtn = document.getElementById('chatSettingsToggleBtn');
    chatSettingsPanel = document.getElementById('chatSettingsPanel');
    effortSelect = document.getElementById('effortSelect');
    showAllModelsToggle = document.getElementById('showAllModelsToggle');
    statefulToggle = document.getElementById('serverStateToggle');

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
        const effort = effortSelect.value;

        if (text && provider && model) {
            appendMessage({ role: 'user', content: text });
            showTypingIndicator();
            vscodeAPI.postMessage({ type: 'askAgent', provider: provider, model: model, effort: effort, value: text});
            
            promptInput.value = '';
            promptInput.style.height = '20px';
            sendBtn.disabled = true;
        }
    });
    
    chatProviderSelect.addEventListener('change', (e) => {
        const provider = e.target.value;
        vscodeAPI.postMessage({ type: 'saveChatProvider', provider: provider });
    });

    chatModelSelect.addEventListener('change', (e) => {
        const model = e.target.value;
        if (currentChatProvider) {
            vscodeAPI.postMessage({ type: 'saveChatModel', provider: currentChatProvider, model: model });
        }
    });

    effortSelect.addEventListener('change', (e) => {
        const effort = e.target.value;

        if (currentChatProvider && currentChatModel) {
            vscodeAPI.postMessage({ 
                type: 'saveChatEffort', 
                provider: currentChatProvider, 
                model: currentChatModel, 
                effort: effort 
            });
        }
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
            vscodeAPI.postMessage({ type: 'saveChatAPIKey', provider: provider, key: key });
        }
    });

    chatSettingsToggleBtn.addEventListener('click', () => {
        chatSettingsPanel.classList.toggle('hidden');
    });

    showAllModelsToggle.addEventListener('change', (e) => {
        vscodeAPI.postMessage({ type: 'toggleShowAllModels', showAll: e.target.checked });
    });
}

export function populateChatProviders(providers) {
    if (providers) populateDropdown(chatProviderSelect, providers, 'Providers...');
}

export function updateChatProvider(msg) {
    if (!msg.provider || msg.provider === currentChatProvider) return;
    chatProviderSelect.value = msg.provider;
    currentChatProvider = msg.provider;
    promptInput.placeholder = 'Select model...';
    chatAPIKeyBtn.disabled = false;
    chatModelSelect.innerHTML = '<option value="">Loading...</option>';
    chatModelSelect.disabled = true;
    sendBtn.disabled = true;
    chatAPIKeyContainer.classList.remove('visible');
    promptInput.placeholder = `Loading ${msg.provider} models...`;
    promptInput.disabled = true;
    clearEffortSelect();
    vscode.postMessage({ type: 'fetchChatModels', provider: msg.provider });

}
export function populateChatModels(msg) {
    if (msg.models) populateDropdown(chatModelSelect, msg.models, 'Models...');
}

export function updateChatModel(msg) {
    if (msg.model) {

        if (msg.model === currentChatModel) return;

        chatModelSelect.value = msg.model;
        currentChatModel = msg.model;
        promptInput.disabled = false;
        promptInput.placeholder = `Ask ${msg.model}...`;
        vscode.postMessage({ type: 'fetchChatModelInfo', model: msg.model });
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

export function updateChatModelInfo(msg) {
    if (msg.reason) {
        effortSelect.innerHTML = '';

        if (msg.efforts) {
            msg.efforts.forEach(effort => {
                const option = document.createElement('option');
                option.value = effort;

                const formattedText = effort.charAt(0).toUpperCase() + effort.slice(1);
                option.textContent = `Effort: ${formattedText}`;

                effortSelect.appendChild(option);
            });
        }
        
        if (msg.defaultEffort) effortSelect.value = msg.defaultEffort;

        effortSelect.classList.remove('hidden');
        effortSelect.disabled = false;
    } 
    else clearEffortSelect();
}

function clearEffortSelect() {
        effortSelect.classList.add('hidden');
        effortSelect.disabled = true;
        effortSelect.innerHTML = '';
        effortSelect.value = 'none';
}