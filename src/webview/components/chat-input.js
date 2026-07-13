import { appendMessage, showTypingIndicator } from "./chat-container";
import { populateDropdown, populateModels } from "./ui_utils";
import { CustomDropdown } from './custom-dropdown';
    
let vscode;

let sendBtn;
let promptInput;

let currentChatProvider = '';
let currentChatModel = '';

let providerDropdown, modelDropdown, effortDropdown;

export function initInput(vscodeAPI) {
    vscode = vscodeAPI;
    sendBtn = document.getElementById('sendBtn');
    promptInput = document.getElementById('prompt');

    providerDropdown = new CustomDropdown('providerDropdown', 'Provider', (val) => {
        vscodeAPI.postMessage({ type: 'saveChatProvider', provider: val });
    });

    modelDropdown = new CustomDropdown('modelDropdown', 'Model', (val) => {
        if (currentChatProvider) {
            vscodeAPI.postMessage({ type: 'saveChatModel', provider: currentChatProvider, model: val });
        }
    });

    effortDropdown = new CustomDropdown('effortDropdown', 'Effort', (val) => {

        if (currentChatProvider && currentChatModel) {
            vscodeAPI.postMessage({ 
                type: 'saveChatEffort', 
                provider: currentChatProvider, 
                model: currentChatModel, 
                effort: val 
            });
        }
    });

    promptInput.disabled = true;
    
    promptInput.addEventListener('input', function() {
        this.style.height = '20px';
        this.style.height = this.scrollHeight + 'px';
        sendBtn.disabled = this.value.trim() === '' || modelDropdown.trigger.disabled;;
    });
    
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) sendBtn.click();
        }
    });
    
    sendBtn.addEventListener('click', () => {
        const text = promptInput.value;
        const effort = effortDropdown.value ? effortDropdown.value.toLowerCase() : '';

        if (text && currentChatProvider && currentChatModel) {
            appendMessage({ role: 'user', content: text });
            showTypingIndicator();
            vscodeAPI.postMessage({ 
                type: 'askAgent', 
                provider: currentChatProvider, 
                model: currentChatModel, 
                effort: effort, 
                value: text
            });
            
            promptInput.value = '';
            promptInput.style.height = '20px';
            sendBtn.disabled = true;
        }
    });
    
}

export function populateChatProviders(providers) {
    if (providers) providerDropdown.setOptions(providers);
}

export function populateChatModels(msg) {
    if (msg.models) modelDropdown.setOptions(msg.models);
}

export function setChatModelsLoading(msg) {

    if (!msg.provider) return;

    sendBtn.disabled = true;
    currentChatModel = '';

    // Set model dropdown to a visual loading state
    modelDropdown.setOptions([]); // Clears existing options
    modelDropdown.textSpan.textContent = 'Loading...'; 
    modelDropdown.setDisabled(true);
    
    promptInput.placeholder = `Loading ${msg.provider} models...`;
    promptInput.disabled = true;
    
    clearEffortSelect();

}

export function updateChatProvider(msg) {
    if (!msg.provider || msg.provider === currentChatProvider) return;
    
    // Update the custom dropdown without triggering the onChange callback
    providerDropdown.selectValue(msg.provider, false);
    currentChatProvider = msg.provider;
    
    setChatModelsLoading(msg);
    
    vscode.postMessage({ type: 'fetchChatModels', provider: msg.provider });
}

export function updateChatModel(msg) {
    if (msg.model) {
        if (msg.model === currentChatModel) return;

        // Update the custom dropdown without triggering the onChange callback
        modelDropdown.selectValue(msg.model, false);
        currentChatModel = msg.model;
        
        promptInput.disabled = false;
        promptInput.placeholder = `Ask ${msg.model}...`;
        
        vscode.postMessage({ type: 'fetchChatModelInfo', model: msg.model });
    } else {
        promptInput.disabled = true;
        promptInput.placeholder = 'Select model...';
        // Reset the text back to the default placeholder if no model is selected
        modelDropdown.textSpan.textContent = modelDropdown.placeholder; 
    }
    
    modelDropdown.setDisabled(false);
    
    sendBtn.disabled = promptInput.value.trim() === '' || promptInput.disabled;
}

export function requestChatAPIKey(msg) {
    if (!msg.provider) return;
    promptInput.placeholder = `Waiting for ${msg.provider} API Key...`;
}

export function updateChatModelInfo(msg) {
    if (msg.reason && msg.efforts && msg.efforts.length > 0) {
        const effortContainer = document.getElementById('effortDropdown');
        const effortDivider = document.getElementById('effortDivider');
        
        const formattedEfforts = msg.efforts.map(e => e.charAt(0).toUpperCase() + e.slice(1));
        
        // Format the default value if it exists
        let defaultEffort = '';
        if (msg.defaultEffort) {
            defaultEffort = msg.defaultEffort.charAt(0).toUpperCase() + msg.defaultEffort.slice(1);
        }

        // Populate and enable the custom dropdown
        effortDropdown.setOptions(formattedEfforts, defaultEffort);
        effortDropdown.setDisabled(false);

        // Unhide both the dropdown and the divider
        if (effortContainer) effortContainer.classList.remove('hidden');
        if (effortDivider) effortDivider.classList.remove('hidden');
        
    } else {
        clearEffortSelect();
    }
}

function clearEffortSelect() {
    const effortContainer = document.getElementById('effortDropdown');
    const effortDivider = document.getElementById('effortDivider');

    // Reset and disable the custom dropdown
    effortDropdown.setOptions([]);
    effortDropdown.setDisabled(true);
    effortDropdown.textSpan.textContent = 'Effort';

    // Hide both elements
    if (effortContainer) effortContainer.classList.add('hidden');
    if (effortDivider) effortDivider.classList.add('hidden');
}
