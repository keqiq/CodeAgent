import { TokenCategoryUsage, TokenUsage } from "../../contextManager";
import { WebviewApi } from "../frontend";

export class ContextWindow {
    private contextContainer: HTMLElement;
    private contextToggleBtn: HTMLElement;
    private contextFillBar: HTMLElement;
    private contextTextLabel: HTMLElement;
    private contextDropdown: HTMLElement;

    private pieChart: HTMLElement;
    private legUser: HTMLElement;
    private legAssistant: HTMLElement;
    private legSystem: HTMLElement;
    private legTools: HTMLElement;
    
    private maxContext: number | undefined = undefined;
    private currentTokens: number = 0;
    private categorizedUsage: TokenCategoryUsage | null = null;

    constructor(private vscodeAPI: WebviewApi) {
        this.contextContainer = document.getElementById('contextWindowContainer') as HTMLElement;
        this.contextToggleBtn = document.getElementById('contextWindowToggleBtn') as HTMLElement;
        this.contextFillBar = document.getElementById('contextBarFill') as HTMLElement;
        this.contextTextLabel = document.getElementById('contextBarText') as HTMLElement;
        this.contextDropdown = document.getElementById('contextWindowDropdown') as HTMLElement;

        this.pieChart = document.getElementById('contextPieChart') as HTMLElement;
        this.legUser = document.getElementById('legUser') as HTMLElement;
        this.legAssistant = document.getElementById('legAssistant') as HTMLElement;
        this.legSystem = document.getElementById('legSystem') as HTMLElement;
        this.legTools = document.getElementById('legTools') as HTMLElement;

        this.initListeners();
    }

    private initListeners() {

        this.contextToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.contextDropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!this.contextContainer.contains(e.target as Node)) {
                this.contextDropdown.classList.add('hidden');
            }
        });
    }

    public updateContextWindow(maxContext: number | undefined): void {
        this.maxContext = maxContext;
        this.render();
    }

    public updateTokenUsage(usage: TokenCategoryUsage) {
        this.currentTokens = usage.totalTokens || 0;
        this.categorizedUsage = usage;
        this.render();
    }

    public clearTokenUsage() {
        this.currentTokens = 0;
        this.categorizedUsage = null;
        this.render();
    }

    private render(): void {
        const formatNum = (num: number) => num >= 1000 ? `${(num / 1000).toFixed(1).replace('.0', '')}k` : num.toString();

        // Render main progress bar
        if (!this.maxContext) {
            // If we don't have a max context limit, just show current usage with a "?"
            this.contextFillBar.style.width = '0%';
            this.contextFillBar.style.backgroundColor = 'var(--vscode-progressBar-background)';
            this.contextTextLabel.textContent = `${formatNum(this.currentTokens)} / ?`;
        } else {
            const percent = Math.min((this.currentTokens / this.maxContext) * 100, 100);
            this.contextFillBar.style.width = `${percent}%`;
            this.contextTextLabel.textContent = `${formatNum(this.currentTokens)} / ${formatNum(this.maxContext)}`;

            if (percent > 90) this.contextFillBar.style.backgroundColor = 'var(--vscode-errorForeground)';
            else if (percent > 75) this.contextFillBar.style.backgroundColor = 'var(--vscode-charts-orange)';
            else this.contextFillBar.style.backgroundColor = 'var(--vscode-progressBar-background)';
        }

        // Render pie chart
        if (this.categorizedUsage && this.categorizedUsage.totalTokens > 0) {
            const cu = this.categorizedUsage;
            const total = cu.totalTokens;
            const toolsTotal = cu.toolCallTokens + cu.toolResultTokens;

            // Update Legend Text
            this.legUser.textContent = formatNum(cu.userTokens);
            this.legAssistant.textContent = formatNum(cu.assistantTokens);
            this.legSystem.textContent = formatNum(cu.systemTokens);
            this.legTools.textContent = formatNum(toolsTotal);

            // Calculate CSS Conic Gradient Percentages
            const pUser = (cu.userTokens / total) * 100;
            const pAssistant = (cu.assistantTokens / total) * 100;
            const pSystem = (cu.systemTokens / total) * 100;
            const pTools = (toolsTotal / total) * 100;

            let currentStop = 0;
            
            // Build gradient string mapping to the CSS variables
            const gradientParts = [];

            if (pUser > 0) {
                gradientParts.push(`var(--vscode-charts-blue, #3794ff) ${currentStop}% ${currentStop + pUser}%`);
                currentStop += pUser;
            }
            if (pAssistant > 0) {
                gradientParts.push(`var(--vscode-charts-purple, #b180d7) ${currentStop}% ${currentStop + pAssistant}%`);
                currentStop += pAssistant;
            }
            if (pSystem > 0) {
                gradientParts.push(`var(--vscode-charts-green, #89d185) ${currentStop}% ${currentStop + pSystem}%`);
                currentStop += pSystem;
            }
            if (pTools > 0) {
                gradientParts.push(`var(--vscode-charts-orange, #d18616) ${currentStop}% 100%`);
            }

            this.pieChart.style.background = `conic-gradient(${gradientParts.join(', ')})`;
        } else {
            // Empty State
            this.legUser.textContent = '0';
            this.legAssistant.textContent = '0';
            this.legSystem.textContent = '0';
            this.legTools.textContent = '0';
            this.pieChart.style.background = 'var(--vscode-editorWidget-background)';
        }
    }
}