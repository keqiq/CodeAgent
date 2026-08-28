export class CustomDropdown {
    public container: HTMLElement;
    public trigger: HTMLButtonElement;
    public list: HTMLElement;
    public textSpan: HTMLElement;
    public placeholder: string;
    public value: string;

    private onChange?: (value: string) => void;

    constructor(target: HTMLElement | string, placeholder: string, onChangeCallBack?: (value: string) => void, root: ParentNode = document) {
        if (typeof target === 'string') {
            const el = root.querySelector(target) as HTMLElement;
            if (!el) throw new Error(`CustomDropdown target not found: ${target}`);
            this.container = el;
        } else {
            this.container = target;
        }

        this.trigger = this.container.querySelector('.dropdown-trigger') as HTMLButtonElement;
        this.list = this.container.querySelector('.dropdown-list') as HTMLElement;
        this.textSpan = this.trigger.querySelector('.selected-text') as HTMLElement;

        this.placeholder = placeholder;
        this.onChange = onChangeCallBack;
        this.value = '';

        this.initListeners();
    }

    private initListeners(): void {
        // Toggle list on click
        this.trigger.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close dropdown when clicking off
        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.container.contains(e.target)) {
                this.list.classList.add('hidden');
            }
        });
    }

    // Fill dropdown with entries
    public setOptions(optionsArray: string[], defaultVal: string = ''): void {
        this.list.innerHTML = '';

        if (!optionsArray || optionsArray.length === 0) return;

        optionsArray.forEach((val: string) => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.textContent = val;
            item.dataset.value = val;

            item.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                this.selectValue(val);
            });

            this.list.appendChild(item);
        });

        // Set default value if provided
        if (defaultVal) this.selectValue(defaultVal, false);
        else {
            this.textSpan.textContent = this.placeholder;
            this.value = '';
        }
    }

    public selectValue(val: string, triggerEvent: boolean = true): void {
        this.value = val;
        this.textSpan.textContent = val;
        this.list.classList.add('hidden');

        // Highlight selected value
        Array.from(this.list.children).forEach((child: Element) => {
            const htmlChild = child as HTMLElement;
            htmlChild.classList.toggle('selected', htmlChild.dataset.value === val);
        });

        if (triggerEvent && this.onChange) this.onChange(val);
    }

    public setDisabled(disabled: boolean): void {
        this.trigger.disabled = disabled;
        if (disabled) this.list.classList.add('hidden');
    }

    public close(): void {
        this.list.classList.add('hidden');
    }

    public toggle(): void {
        if (this.trigger.disabled) return;

        document.querySelectorAll('.custom-dropdown .dropdown-list:not(.hidden)').forEach((el: Element) => {
            if (el !== this.list) el.classList.add('hidden');
        });

        this.list.classList.toggle('hidden');
    }
}