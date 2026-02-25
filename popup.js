// ============================================================
// LongerGPTChats — Popup Script
// ============================================================

const DEFAULTS = {
    enabled: true,
    visibleCount: 50,
    batchSize: 20,
};

const $ = (sel) => document.querySelector(sel);

const enabledToggle = $('#enabledToggle');
const visibleCountInput = $('#visibleCount');
const batchSizeInput = $('#batchSize');
const saveBtn = $('#saveBtn');
const statusText = $('#statusText');

// ----- Load saved settings -----

chrome.storage.sync.get(DEFAULTS, (result) => {
    enabledToggle.checked = result.enabled;
    visibleCountInput.value = result.visibleCount;
    batchSizeInput.value = result.batchSize;
    updateStatusText(result.enabled);
});

// ----- Toggle status text -----

enabledToggle.addEventListener('change', () => {
    updateStatusText(enabledToggle.checked);
});

function updateStatusText(enabled) {
    statusText.textContent = enabled ? 'Active' : 'Paused';
    statusText.style.color = enabled
        ? 'rgba(129, 140, 248, 0.8)'
        : 'rgba(255, 255, 255, 0.3)';
}

// ----- Stepper buttons -----

document.querySelectorAll('.step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        const step = parseInt(btn.dataset.step, 10);
        const min = parseInt(target.min, 10);
        const max = parseInt(target.max, 10);
        let val = parseInt(target.value, 10) + step;
        val = Math.max(min, Math.min(max, val));
        target.value = val;
    });
});

// ----- Save -----

saveBtn.addEventListener('click', () => {
    const visibleCount = clamp(parseInt(visibleCountInput.value, 10), 0, 200);
    let batchSize = clamp(parseInt(batchSizeInput.value, 10), 0, 100);

    // Batch size can't exceed visible count
    if (visibleCount > 0 && batchSize > visibleCount) {
        batchSize = visibleCount;
    }

    const newSettings = {
        enabled: enabledToggle.checked,
        visibleCount,
        batchSize,
    };

    // Ensure inputs reflect clamped values
    visibleCountInput.value = newSettings.visibleCount;
    batchSizeInput.value = newSettings.batchSize;

    chrome.storage.sync.set(newSettings, () => {
        // Also send message directly to content script for immediate effect
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'settingsUpdated',
                    settings: newSettings,
                }).catch(() => {
                    // Tab might not have content script loaded — that's fine
                });
            }
        });

        // Show saved feedback
        saveBtn.classList.add('saved');
        setTimeout(() => saveBtn.classList.remove('saved'), 1500);
    });
});

function clamp(val, min, max) {
    if (isNaN(val)) return min;
    return Math.max(min, Math.min(max, val));
}
