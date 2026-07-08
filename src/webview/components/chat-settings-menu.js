export class SettingsMenu {
    constructor(vscodeAPI) {
        this.vscode = vscodeAPI;
        this.currentProvider = '';
        this.container = document.getElementById('settingsMenuContainer');
        this.toggleBtn = document.getElementById('chatSettingsToggleBtn');
        this.dropdownList = document.getElementById('settingsDropdownList');
        
        this.menuAllModels = document.getElementById('menuAllModelsToggle');
        this.menuStateful = document.getElementById('menuStatefulToggle');
        this.menuAPIKeyBtn = document.getElementById('menuAPIKeyBtn');
        
        this.inlineAPIKeyContainer = document.getElementById('inlineAPIKeyContainer');
        this.apiKeyInput = document.getElementById('chatAPIKeyInput');
        this.saveKeyBtn = document.getElementById('chatSaveKeyBtn');

        this.maxTurnsInput = document.getElementById('maxTurnsInput');
        this.maxTurnsMinus = document.getElementById('maxTurnsMinus');
        this.maxTurnsPlus = document.getElementById('maxTurnsPlus');

        this.initListeners();
    }

    initListeners() {
        // toggle menu
        this.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.dropdownList.classList.toggle('hidden');
            this.inlineAPIKeyContainer.classList.add('hidden');
        });

        // close menu when clicking off
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) this.dropdownList.classList.add('hidden');
        });

        this.menuAllModels.addEventListener('click', () => {
            if (this.menuAllModels.classList.contains('disabled')) return;
            const isActive = this.menuAllModels.classList.toggle('active');

            this.vscode.postMessage({ type: 'setShowAllModels', showAll: isActive });
        });

        this.menuStateful.addEventListener('click', () => {
            if (this.menuStateful.classList.contains('disabled')) return;
            const isActive = this.menuStateful.classList.toggle('active');

            this.vscode.postMessage({ type: 'setStateManagement', stateful: isActive });
        });

        this.menuAPIKeyBtn.addEventListener('click', () => {
            if (this.menuAPIKeyBtn.classList.contains('disabled')) return;
            const isHidden = this.inlineAPIKeyContainer.classList.toggle('hidden');
            if (!isHidden) this.apiKeyInput.focus();
        });

        this.saveKeyBtn.addEventListener('click', () => {
            const key = this.apiKeyInput.value.trim();
            if (key && this.currentProvider) {
                this.dropdownList.classList.add('hidden');
                this.inlineAPIKeyContainer.classList.add('hidden');
                this.apiKeyInput.value = '';

                this.vscode.postMessage({ type: 'saveChatAPIKey', provider: this.currentProvider, key: key });
            }
        });

        this.maxTurnsMinus.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop menu from closing
            let val = parseInt(this.maxTurnsInput.value, 10) || 0;
            if (val > 0) {
                this.maxTurnsInput.value = val - 1;
                this.notifyMaxTurnsChange();
            }
        });

        this.maxTurnsPlus.addEventListener('click', (e) => {
            e.stopPropagation(); // Stop menu from closing
            let val = parseInt(this.maxTurnsInput.value, 10) || 0;
            this.maxTurnsInput.value = val + 1;
            this.notifyMaxTurnsChange();
        });

        // Handle user typing manually into the input
        this.maxTurnsInput.addEventListener('change', () => {
            let val = parseInt(this.maxTurnsInput.value, 10);
            // If they typed text or a negative number, reset to 0
            if (isNaN(val) || val < 0) {
                this.maxTurnsInput.value = 0;
            }
            this.notifyMaxTurnsChange();
        });

        // Prevent menu from closing when clicking inside the input
        this.maxTurnsInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    setProvider(msg) {
        const provider = msg.provider;
        this.currentProvider = provider;
        this.menuAPIKeyBtn.classList.remove('disabled');
        this.menuAPIKeyBtn.innerHTML = `Set ${provider} API Key`;
        this.menuStatefulDesc = this.menuStateful.querySelector('.menu-item-desc');

        const stateManagementSupport = msg.stateful;
        if (!stateManagementSupport) {
            this.menuStateful.classList.remove('active');
            this.menuStateful.classList.add('disabled');
            this.menuStatefulDesc.textContent = `Not supported by ${msg.provider}.`;
            this.menuStateful.style.opacity = '0.5';
        } 
        else {
            this.menuStateful.classList.remove('disabled');
            this.menuStatefulDesc.textContent = "Server-side context management.";
            this.menuStateful.style.opacity = '';
        }
    }

    notifyMaxTurnsChange() {
        this.vscode.postMessage({ type: 'updateTurnLimit', limit: this.maxTurnsInput.value });
    }

    restoreSettings(msg) {
        if (msg.showAll !== undefined) {
            if (msg.showAll) this.menuAllModels.classList.add('active');
            else this.menuAllModels.classList.remove('active');
        }

        if (msg.stateful !== undefined) {
            if (msg.stateful) this.menuStateful.classList.add('active');
            else this.menuStateful.classList.remove('active');
        }

        if (msg.turnLimit !== undefined) this.maxTurnsInput.value = msg.turnLimit;
    }

    showChatAPIKeyInput(msg) {
        const provider = msg.provider || this.currentProvider;

        this.dropdownList.classList.remove('hidden');
        this.inlineAPIKeyContainer.classList.remove('hidden');
        
        this.apiKeyInput.value = '';
        this.apiKeyInput.placeholder = `Enter ${provider} API Key...`;
        
        this.apiKeyInput.focus();
    }


}