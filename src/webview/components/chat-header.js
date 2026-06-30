import { clearChatUI } from "./chat-container";
import { populateDropdown, populateModels } from "./ui_utils";

let clearChatBtn;
let clearConfirmContainer;
let cancelClearBtn;
let confirmClearBtn;

let embedProviderSelect;
let embedModelSelect;
let embedAPIKeyBtn;
let embedAPIKeyContainer;
let embedAPIKeyLabel;
let embedAPIKeyInput;
let embedSaveKeyBtn;

let indexToggle;
let indexWorkspaceBtn;
let indexStatus;
let indexBtn;
let indexPanel;
let indexDot;

export function initHeader(vscode) {
    clearChatBtn = document.getElementById('clearChatBtn');
    clearConfirmContainer = document.getElementById('clearConfirmContainer');
    cancelClearBtn = document.getElementById('cancelClearBtn');
    confirmClearBtn = document.getElementById('confirmClearBtn');

    embedProviderSelect = document.getElementById('embedProviderSelect');
    embedModelSelect = document.getElementById('embedModelSelect');
    embedAPIKeyBtn = document.getElementById('embedAPIKeyBtn');
    embedAPIKeyContainer = document.getElementById('embedAPIKeyContainer');
    embedAPIKeyLabel = document.getElementById('embedAPIKeyLabel');
    embedAPIKeyInput = document.getElementById('embedAPIKeyInput');
    embedSaveKeyBtn = document.getElementById('embedSaveKeyBtn');

    indexToggle = document.getElementById('indexToggle');
    indexWorkspaceBtn = document.getElementById('indexWorkspaceBtn');
    indexStatus = document.getElementById('indexStatus');
    indexBtn = document.getElementById('indexBtn');
    indexPanel = document.getElementById('indexPanel');
    indexDot = document.getElementById('indexDot');

    indexBtn.addEventListener('click', () => {
        indexPanel.classList.toggle('visible');
        clearConfirmContainer.classList.remove('visible');
    });

    indexToggle.addEventListener('change', (e) => {
        const enabled = e.target.checked;

        if (!enabled) {
            embedProviderSelect.value = "";
            embedModelSelect.innerHTML = '<option value="">Models...</option>';
            embedAPIKeyInput.value = "";

            embedProviderSelect.disabled = true;
            embedModelSelect.disabled = true;
            embedAPIKeyBtn.disabled = true;
            indexWorkspaceBtn.disabled = true;

            embedAPIKeyContainer.classList.remove('visible');
            indexStatus.textContent = 'Disabled';
            indexDot.className = 'status-dot disabled';
        }
        else {
            embedProviderSelect.disabled = false;
            indexStatus.textContent = 'Select Provider';
            indexDot.className = 'status-dot warning';
        }

        vscode.postMessage({ type: 'setIndexEnabled', enabled });
    });

    // Embed model provider selection
    // Call to fetch models when selection changes
    embedProviderSelect.addEventListener('change', (e) => {
        const provider = e.target.value;

        embedAPIKeyBtn.disabled = false;
        embedModelSelect.innerHTML = '<option value="">Loading...</option>';
        embedModelSelect.disabled = true;
        indexWorkspaceBtn.disabled = true;
        embedAPIKeyContainer.classList.remove('visible');
        indexStatus.textContent = 'Loading models...';
        indexDot.className = 'status-dot warning';

        vscode.postMessage({ type: 'fetchEmbedModels', provider: provider });
    });

    // Input for embedding provider API key
    embedAPIKeyBtn.addEventListener('click', () => {
        const provider = embedProviderSelect.value;

        if (provider) {
            embedAPIKeyLabel.innerText = `Update ${provider} embedding API key:`;
            embedAPIKeyInput.value = '';
            embedAPIKeyContainer.classList.add('visible');
            embedAPIKeyInput.focus();
        }
    });

    // Update embedding provider API key
    embedSaveKeyBtn.addEventListener('click', () => {
        const key = embedAPIKeyInput.value.trim();
        const provider = embedProviderSelect.value;

        if (key && provider) {
            embedAPIKeyContainer.classList.remove('visible');
            indexStatus.textContent = 'Verifying key...';

            vscode.postMessage({ type: 'saveEmbedAPIKey', provider: provider, key: key });
        }
    });

    // Update embedding model preference and enable index workspace button
    embedModelSelect.addEventListener('change', (e) => {
        const model = e.target.value;
        indexWorkspaceBtn.disabled = model === '';
        if (model !== '') indexStatus.textContent = 'Ready';

        vscode.postMessage({ type: 'saveEmbedModel', model: model });
    });

    indexWorkspaceBtn.addEventListener('click', () => {
        const provider = embedProviderSelect.value;
        const model = embedModelSelect.value;

        if (provider && model) {
            indexWorkspaceBtn.disabled = true;
            indexStatus.textContent = 'Indexing...';
            indexDot.className = 'status-dot spinning';

            embedProviderSelect.disabled = true;
            embedModelSelect.disabled = true;

            vscode.postMessage({ type: 'indexWorkspace', provider: provider, model: model });
        }
    });

    clearChatBtn.addEventListener('click', () => {
        clearConfirmContainer.classList.toggle('visible');
        indexPanel.classList.remove('visible');
    });

    cancelClearBtn.addEventListener('click', () => {
        clearConfirmContainer.classList.remove('visible');
    });

    confirmClearBtn.addEventListener('click', () => {
        clearConfirmContainer.classList.remove('visible');
        clearChatUI();

        vscode.postMessage({ type: 'clearChat' });
    });
}

export function populateEmbedProviders(providers) {
    populateDropdown(embedProviderSelect, providers);
}  

export function updateEmbedModels(msg) {
    if(!msg.models || msg.models.length < 1) return;
    populateModels(embedModelSelect, msg.models, msg.choice, indexWorkspaceBtn);
    embedAPIKeyContainer.classList.remove('visible');
    indexStatus.textContent = embedModelSelect.value === '' ? 'Select Model' : 'Ready';
}

export function updateEmbedProvider(msg) {
    if (!msg.provider) return;
    embedProviderSelect.value = msg.provider;
    embedAPIKeyBtn.disabled = false;
}

export function restoreIndexState(msg) {
    // 1. Set the toggle state
    const enabled = !!msg.enabled;
    indexToggle.checked = enabled;

    // 2. If disabled, aggressively lock down the UI (just like the toggle listener)
    if (!enabled) {
        embedProviderSelect.value = "";
        embedModelSelect.innerHTML = '<option value="">Models...</option>';
        embedProviderSelect.disabled = true;
        embedModelSelect.disabled = true;
        embedAPIKeyBtn.disabled = true;
        indexWorkspaceBtn.disabled = true;
        embedAPIKeyContainer.classList.remove('visible');

        indexStatus.textContent = 'Disabled';
        indexDot.className = 'status-dot disabled';
        return; // Stop execution here
    }

    // 3. If enabled, unlock the base provider dropdown
    embedProviderSelect.disabled = false;

    // 4. Restore the provider if one was saved
    if (msg.provider) {
        embedProviderSelect.value = msg.provider;
        embedAPIKeyBtn.disabled = false;
    }

    // 5. Restore models if the backend fetched them successfully
    if (msg.models && msg.models.length > 0) {
        updateEmbedModels(msg); 
    } else {
        // Lock the model dropdown if no models came back
        embedModelSelect.disabled = true;
        indexWorkspaceBtn.disabled = true;
    }

    // 6. Handle missing/invalid API Keys
    if (msg.needsAPIKey) {
        requestEmbedAPIKey(msg); // This function already handles the warning dot & text
        return; 
    }

    // 7. Finally, apply the explicit status text and dot color from the backend
    indexStatus.textContent = msg.status || 'Unknown State';

    if (msg.status === 'Ready') {
        indexDot.className = 'status-dot ready'; // Green
    } else if (msg.status === 'Not Indexed' || msg.status === 'Select Provider') {
        indexDot.className = 'status-dot warning'; // Yellow
    } else {
        indexDot.className = 'status-dot disabled'; // Grey
    }
}

export function requestEmbedAPIKey(msg) {
    embedAPIKeyLabel.innerText = `Enter ${msg.provider} embedding API key`;
    embedAPIKeyInput.value = '';
    embedAPIKeyContainer.classList.add('visible');
    indexPanel.classList.add('visible');
    indexStatus.textContent = 'API key required';
    indexDot.className = 'status-dot warning';

    embedAPIKeyInput.focus();
}

export function updateIndexStatus(msg) {
    indexStatus.textContent = msg.error ? msg.error : msg.status;

    if (msg.done) {
        indexDot.className = 'status-dot ready';
        embedProviderSelect.disabled = false;
        embedModelSelect.disabled = false;
        indexWorkspaceBtn.disabled = false;
    }
    else if (msg.error) {
        indexDot.className = 'status-dot error';
        embedProviderSelect.disabled = false;
        embedModelSelect.disabled = false;
        indexWorkspaceBtn.disabled = false;
    }
    else {
        indexDot.className = 'status-dot spinning';
        embedProviderSelect.disabled = true;
        embedModelSelect.disabled = true;
        indexWorkspaceBtn.disabled = true;
    }
}



