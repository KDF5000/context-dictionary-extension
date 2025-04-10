document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    const settingsPanel = document.getElementById('settings-panel');
    const aboutPanel = document.getElementById('about-panel');
    const apiSettingsBtn = document.getElementById('api-settings');
    const aboutBtn = document.getElementById('about');
    const backButtons = document.querySelectorAll('.back-button');

    // API settings related elements
    const apiEndpointInput = document.getElementById('api-endpoint');
    const apiKeyInput = document.getElementById('api-key');
    const modelSelect = document.getElementById('model');
    const customModelInput = document.getElementById('custom-model');
    const saveApiSettingsBtn = document.getElementById('save-api-settings');
    const resetApiSettingsBtn = document.getElementById('reset-api-settings');

    // Load saved API settings
    loadApiSettings();
    
    // Handle model select change
    modelSelect.addEventListener('change', () => {
        if (modelSelect.value === 'custom') {
            customModelInput.classList.remove('hidden');
            if (customModelInput.dataset.value) {
                customModelInput.value = customModelInput.dataset.value;
            }
        } else {
            customModelInput.classList.add('hidden');
        }
    });

    // API settings button click event
    apiSettingsBtn.addEventListener('click', () => {
        showPanel(settingsPanel);
    });

    // About button click event
    aboutBtn.addEventListener('click', () => {
        showPanel(aboutPanel);
    });

    // Back button click event
    backButtons.forEach(button => {
        button.addEventListener('click', () => {
            hidePanel(button.closest('.panel'));
        });
    });

    // Save API settings
    saveApiSettingsBtn.addEventListener('click', () => {
        const apiEndpoint = apiEndpointInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        const modelSelect = document.getElementById('model');
        const customModelInput = document.getElementById('custom-model');
        let model = modelSelect.value === 'custom' 
            ? customModelInput.value.trim() 
            : modelSelect.value;

        if (!apiEndpoint || !apiKey || !model) {
            showToast('Please enter API endpoint and key and model');
            return;
        }

        // Save to Chrome storage
        chrome.storage.sync.set({
            apiEndpoint: apiEndpoint,
            apiKey: apiKey,
            model: model
        }, () => {
            if (chrome.runtime.lastError) {
                showToast('Save failed: ' + chrome.runtime.lastError.message);
                return;
            }

            // Notify background script to update settings
            chrome.runtime.sendMessage({
                type: 'API_SETTINGS_UPDATED',
                data: { apiEndpoint, apiKey, model }
            });

            showToast('API settings saved');
            setTimeout(() => hidePanel(settingsPanel), 1000);
        });
    });

    // Reset API settings
    resetApiSettingsBtn.addEventListener('click', () => {
        apiEndpointInput.value = '';
        apiKeyInput.value = '';
        showToast('API settings reset, please enter new settings');

        // Clear stored settings
        chrome.storage.sync.remove(['apiEndpoint', 'apiKey'], () => {
            if (chrome.runtime.lastError) {
                showToast('Reset failed: ' + chrome.runtime.lastError.message);
                return;
            }

            // Notify background script that settings are reset
            chrome.runtime.sendMessage({
                type: 'API_SETTINGS_RESET'
            });
        });
    });
});

// Load API settings
function loadApiSettings() {
    chrome.storage.sync.get(['apiEndpoint', 'apiKey', 'model'], function(result) {
        const apiEndpointInput = document.getElementById('api-endpoint');
        const apiKeyInput = document.getElementById('api-key');
        const modelSelect = document.getElementById('model');
        const customModelInput = document.getElementById('custom-model');
        
        if (result.apiEndpoint) {
            apiEndpointInput.value = result.apiEndpoint;
        }
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
        }
        if (result.model) {
            // Check if model is one of the default options
            if ([...modelSelect.options].some(opt => opt.value === result.model)) {
                modelSelect.value = result.model;
            } else {
                modelSelect.value = 'custom';
                customModelInput.classList.remove('hidden');
                customModelInput.value = result.model;
                customModelInput.dataset.value = result.model;
            }
        }
    });
}

// Show panel
function showPanel(panel) {
    panel.classList.remove('hidden');
    // Use setTimeout to ensure transition animation works properly
    setTimeout(() => panel.classList.add('active'), 10);
}

// Hide panel
function hidePanel(panel) {
    panel.classList.remove('active');
    setTimeout(() => panel.classList.add('hidden'), 300);
}

// Show toast message
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2000);
}
