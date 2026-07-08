export class CustomDropdown {
    constructor(containerId, placeholder, onChangeCallback) {
        this.container = document.getElementById(containerId);
        this.trigger = this.container.querySelector('.dropdown-trigger');
        this.list = this.container.querySelector('.dropdown-list');
        this.textSpan = this.trigger.querySelector('.selected-text');
        this.placeholder = placeholder;
        this.onChange = onChangeCallback;
        this.value = '';

        // Toggle list on click
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevents document click from immediately closing it
            if (!this.trigger.disabled) {
                // Close others first
                document.querySelectorAll('.dropdown-list:not(.hidden)').forEach(el => {
                    if (el !== this.list) el.classList.add('hidden');
                });
                this.list.classList.toggle('hidden');
            }
        });

        // Close if clicking anywhere else on the screen
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.list.classList.add('hidden');
            }
        });
    }

    // Pass an array of strings
    setOptions(optionsArray, defaultVal = '') {
        this.list.innerHTML = ''; 
        
        if (!optionsArray || optionsArray.length === 0) return;

        optionsArray.forEach(val => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.textContent = val;
            item.dataset.value = val;

            item.addEventListener('click', () => {
                this.selectValue(val);
            });

            this.list.appendChild(item);
        });

        if (defaultVal) {
            this.selectValue(defaultVal, false); 
        } else {
            this.textSpan.textContent = this.placeholder;
            this.value = '';
        }
    }

    selectValue(val, triggerEvent = true) {
        this.value = val;
        this.textSpan.textContent = val;
        this.list.classList.add('hidden');
        
        // Highlight active item visually
        Array.from(this.list.children).forEach(child => {
            child.classList.toggle('selected', child.dataset.value === val);
        });

        if (triggerEvent && this.onChange) this.onChange(val);
    }

    setDisabled(disabled) {
        this.trigger.disabled = disabled;
        if (disabled) this.list.classList.add('hidden');
    }
}