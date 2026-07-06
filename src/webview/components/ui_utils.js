export function populateDropdown(selectElement, items, defaultText) {
    selectElement.innerHTML = `<option value="" disabled selected>${defaultText}</option>`;

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        selectElement.appendChild(option);
    });
}

export function populateModels(selectElement, models, choice, button, defaultText = "Models...") {
    populateDropdown(selectElement, models, defaultText);

    selectElement.disabled = false;
    if (choice) selectElement.value = choice;
    button.disabled = selectElement.value === '';
}
