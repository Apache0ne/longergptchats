// ============================================================
// LongerGPTChats — Content Script
// Sliding-window DOM virtualization for ChatGPT conversations
// ============================================================

(() => {
  'use strict';

  const SELECTORS = {
    messageTurn: 'article[data-testid^="conversation-turn-"]',
  };

  const DEFAULTS = {
    enabled: true,
    visibleCount: 50,
    batchSize: 20,
  };

  const TOP_CONTINUATION_TRIGGER_PX = 24;
  const TOP_CONTINUATION_ANCHOR_PX = 340;
  const RECENT_UP_SCROLL_MS = 250;

  // ----- State -----
  let settings = { ...DEFAULTS };
  let scrollContainer = null;
  let messageWrapper = null;
  let mutationObserver = null;
  let topSentinel = null;
  let bottomSentinel = null;
  let topObserver = null;
  let bottomObserver = null;
  let debounceTimer = null;
  let currentUrl = location.href;
  let isInitialized = false;
  let isRevealing = false;
  let contextAlive = true;
  let keepLoadedOverride = false;
  let onlyShowKeptMode = false;
  let keptMessageIds = new Set();
  let counterControls = null;
  let counterBadge = null; // Header counter badge element
  let keepShownButton = null;
  let onlyKeptButton = null;
  let clearKeptButton = null;
  let keepLoadedButton = null;
  let trackedScrollContainer = null;
  let lastTrackedScrollTop = 0;
  let lastUpScrollAt = 0;

  // Sliding window: tracks which slice of messages is currently visible
  let windowStart = -1; // index of first visible message
  let windowEnd = -1;   // index of last visible message

  function isVirtualizationActive() {
    return settings.enabled && !keepLoadedOverride;
  }

  function hasRecentUpScrollIntent() {
    return Date.now() - lastUpScrollAt <= RECENT_UP_SCROLL_MS;
  }

  // =================================================================
  // Settings
  // =================================================================

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        if (chrome?.storage?.sync) {
          chrome.storage.sync.get(DEFAULTS, (result) => {
            if (chrome.runtime.lastError) {
              console.warn('[LongerGPTChats] Storage error:', chrome.runtime.lastError.message);
              resolve(settings);
              return;
            }
            settings = { ...DEFAULTS, ...result };
            // Clamp batchSize to visibleCount
            if (settings.batchSize > settings.visibleCount && settings.visibleCount > 0) {
              settings.batchSize = settings.visibleCount;
            }
            resolve(settings);
          });
        } else {
          resolve(settings);
        }
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
          contextAlive = false;
          console.warn('[LongerGPTChats] Extension was reloaded — please refresh this page (F5)');
        } else {
          console.warn('[LongerGPTChats] Could not load settings:', e.message);
        }
        resolve(settings);
      }
    });
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key in settings) settings[key] = newValue;
      }
      // Clamp batchSize
      if (settings.batchSize > settings.visibleCount && settings.visibleCount > 0) {
        settings.batchSize = settings.visibleCount;
      }
      if (!settings.enabled) {
        keepLoadedOverride = false;
        onlyShowKeptMode = false;
      }
      if (isVirtualizationActive()) {
        resetWindow();
      } else {
        revealAll();
      }
    });
  }

  if (chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'settingsUpdated') {
        Object.assign(settings, msg.settings);
        if (settings.batchSize > settings.visibleCount && settings.visibleCount > 0) {
          settings.batchSize = settings.visibleCount;
        }
        if (!settings.enabled) {
          keepLoadedOverride = false;
          onlyShowKeptMode = false;
        }
        if (isVirtualizationActive()) {
          resetWindow();
        } else {
          revealAll();
        }
      }
    });
  }

  // =================================================================
  // Core sliding window
  // =================================================================

  function getAllMessages() {
    if (!messageWrapper) return [];
    return Array.from(messageWrapper.querySelectorAll(SELECTORS.messageTurn));
  }

  function getMessageKey(msg, index) {
    if (!msg) return '';
    if (msg.dataset.lgcMsgKey) return msg.dataset.lgcMsgKey;

    const testId = msg.getAttribute('data-testid');
    const key = testId ? `tid:${testId}` : `idx:${index}`;
    msg.dataset.lgcMsgKey = key;
    return key;
  }

  function clearKeptMessages() {
    if (keptMessageIds.size === 0) return;

    keptMessageIds.clear();

    if (isVirtualizationActive()) {
      applyWindow();
    } else {
      updateCounter();
    }
  }

  function keepCurrentWindowMessages() {
    const messages = getAllMessages();
    if (messages.length === 0) return;

    let start = Math.max(0, windowStart);
    let end = Math.min(messages.length - 1, windowEnd);

    if (start > end) {
      start = 0;
      end = messages.length - 1;
    }

    for (let i = start; i <= end; i++) {
      const msg = messages[i];
      keptMessageIds.add(getMessageKey(msg, i));
    }

    if (isVirtualizationActive()) {
      applyWindow(messages);
    } else {
      updateCounter(messages);
    }
  }

  /** Reset the window to show the last N messages (initial state) */
  function resetWindow() {
    if (!isVirtualizationActive() || !messageWrapper) return;

    requestAnimationFrame(() => {
      const messages = getAllMessages();
      const total = messages.length;
      if (total === 0) return;

      const count = settings.visibleCount;

      // Window sits at the end of the conversation
      windowStart = Math.max(0, total - count);
      windowEnd = total - 1;

      applyWindow(messages);
    });
  }

  /** Apply the current window — show [windowStart..windowEnd], hide everything else */
  function applyWindow(messages) {
    if (!isVirtualizationActive()) {
      revealAll();
      return;
    }

    if (!messages) messages = getAllMessages();
    const total = messages.length;
    if (total === 0) return;

    for (let i = 0; i < total; i++) {
      const msg = messages[i];
      const key = getMessageKey(msg, i);
      const inWindow = i >= windowStart && i <= windowEnd;
      const isKept = keptMessageIds.has(key);
      const shouldBeVisible = onlyShowKeptMode ? isKept : (inWindow || isKept);

      if (shouldBeVisible) {
        if (msg.style.display === 'none') {
          msg.style.display = '';
          delete msg.dataset.lgcHidden;
        }
      } else {
        if (msg.style.display !== 'none') {
          msg.style.display = 'none';
          msg.dataset.lgcHidden = 'true';
        }
      }
    }

    setupSentinels(messages);
    updateCounter(messages);
  }

  // =================================================================
  // Header counter badge (shows viewing range next to model name)
  // =================================================================

  function createCounterBadge() {
    const badge = document.createElement('span');
    badge.id = 'lgc-counter-badge';
    badge.className = 'lgc-counter-badge';
    badge.setAttribute('aria-label', 'Message viewing range');
    return badge;
  }

  function createKeepLoadedButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lgc-keep-loaded-btn';
    btn.className = 'lgc-header-btn lgc-keep-loaded-btn';
    btn.title = 'Temporarily keep all loaded messages visible in this chat tab';
    btn.addEventListener('click', toggleKeepLoadedOverride);
    return btn;
  }

  function createKeepShownButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lgc-keep-shown-btn';
    btn.className = 'lgc-header-btn lgc-keep-shown-btn';
    btn.title = 'Keep the currently shown message range visible while you browse elsewhere';
    btn.textContent = 'Keep shown';
    btn.addEventListener('click', keepCurrentWindowMessages);
    return btn;
  }

  function createOnlyKeptButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lgc-only-kept-btn';
    btn.className = 'lgc-header-btn lgc-only-kept-btn';
    btn.title = 'Only show kept messages plus the current visible range';
    btn.addEventListener('click', toggleOnlyShowKeptMode);
    return btn;
  }

  function createClearKeptButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lgc-clear-kept-btn';
    btn.className = 'lgc-header-btn lgc-clear-kept-btn';
    btn.title = 'Unselect all kept messages/ranges';
    btn.textContent = 'Unselect all kept';
    btn.addEventListener('click', clearKeptMessages);
    return btn;
  }

  function ensureCounterControls() {
    if (
      counterControls &&
      counterBadge &&
      keepShownButton &&
      onlyKeptButton &&
      clearKeptButton &&
      keepLoadedButton
    ) return;

    counterControls = document.createElement('span');
    counterControls.id = 'lgc-counter-controls';
    counterControls.className = 'lgc-counter-controls';

    counterBadge = createCounterBadge();
    keepShownButton = createKeepShownButton();
    onlyKeptButton = createOnlyKeptButton();
    clearKeptButton = createClearKeptButton();
    keepLoadedButton = createKeepLoadedButton();

    counterControls.append(
      counterBadge,
      keepShownButton,
      onlyKeptButton,
      clearKeptButton,
      keepLoadedButton
    );
  }

  function updateKeepLoadedButton() {
    if (!keepLoadedButton) return;

    const active = !!keepLoadedOverride;
    keepLoadedButton.textContent = active ? 'Use paging' : 'Keep loaded';
    keepLoadedButton.dataset.active = active ? 'true' : 'false';
    keepLoadedButton.setAttribute('aria-pressed', String(active));
  }

  function updateKeepShownButton() {
    if (!keepShownButton) return;
    keepShownButton.textContent = keptMessageIds.size > 0 ? `Keep shown (${keptMessageIds.size})` : 'Keep shown';
  }

  function updateOnlyKeptButton() {
    if (!onlyKeptButton) return;

    const active = !!onlyShowKeptMode;
    onlyKeptButton.textContent = 'Only kept';
    onlyKeptButton.dataset.active = active ? 'true' : 'false';
    onlyKeptButton.setAttribute('aria-pressed', String(active));
  }

  function updateClearKeptButton() {
    if (!clearKeptButton) return;
    clearKeptButton.disabled = keptMessageIds.size === 0;
  }

  function ensureModelButtonStack(modelBtn) {
    if (!modelBtn?.parentElement) return null;

    const currentParent = modelBtn.parentElement;
    if (currentParent.classList?.contains('lgc-model-stack')) {
      return currentParent;
    }

    const stack = document.createElement('span');
    stack.className = 'lgc-model-stack';
    currentParent.insertBefore(stack, modelBtn);
    stack.appendChild(modelBtn);
    return stack;
  }

  function toggleKeepLoadedOverride() {
    keepLoadedOverride = !keepLoadedOverride;

    if (keepLoadedOverride) {
      onlyShowKeptMode = false;
      revealAll();
      return;
    }

    resetWindow();
  }

  function toggleOnlyShowKeptMode() {
    if (!settings.enabled) return;

    if (keepLoadedOverride) {
      keepLoadedOverride = false;
    }

    onlyShowKeptMode = !onlyShowKeptMode;

    if (isVirtualizationActive()) {
      applyWindow();
    } else {
      revealAll();
    }
  }

  function updateCounter(messages) {
    if (!messages) messages = getAllMessages();
    const total = messages.length;

    if (!settings.enabled || total === 0) {
      removeCounter();
      return;
    }

    const showingFullRange = windowStart === 0 && windowEnd === total - 1;
    const hasPinnedMessages = keptMessageIds.size > 0;
    if (!keepLoadedOverride && !onlyShowKeptMode && !hasPinnedMessages && showingFullRange) {
      removeCounter();
      return;
    }

    ensureCounterControls();
    updateKeepShownButton();
    updateOnlyKeptButton();
    updateClearKeptButton();
    updateKeepLoadedButton();

    if (keepLoadedOverride) {
      counterBadge.textContent = `All loaded (${total})`;
    } else if (onlyShowKeptMode) {
      counterBadge.textContent = `Only kept (${keptMessageIds.size}) / ${total}`;
    } else {
      // Show 1-indexed range
      const from = windowStart + 1;
      const to = Math.min(windowEnd + 1, total);
      counterBadge.textContent = hasPinnedMessages
        ? `${from}-${to} / ${total} | kept ${keptMessageIds.size}`
        : `${from}-${to} / ${total}`;
    }

    // Inject directly under the model picker (same left anchor)
    const modelBtn = document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    const anchor = ensureModelButtonStack(modelBtn);
    if (
      anchor &&
      (counterControls.parentElement !== anchor ||
        counterControls.previousElementSibling !== modelBtn)
    ) {
      modelBtn.insertAdjacentElement('afterend', counterControls);
    }
  }

  function removeCounter() {
    if (counterControls?.parentElement) counterControls.remove();
    counterControls = null;
    counterBadge = null;
    keepShownButton = null;
    onlyKeptButton = null;
    clearKeptButton = null;
    keepLoadedButton = null;
  }

  /** Scroll UP — slide window towards older messages */
  function slideUp() {
    if (isRevealing || !messageWrapper || !isVirtualizationActive() || onlyShowKeptMode) return;
    const messages = getAllMessages();
    const total = messages.length;
    if (total === 0 || windowStart <= 0) return;

    isRevealing = true;

    const batch = Math.min(settings.batchSize || 1, windowStart);
    const scrollTop = scrollContainer.scrollTop;
    const scrollHeight = scrollContainer.scrollHeight;
    const preserveTopMomentum =
      scrollTop <= TOP_CONTINUATION_TRIGGER_PX && hasRecentUpScrollIntent();

    // Shift window up
    windowStart -= batch;
    windowEnd -= batch;

    // Clamp
    windowStart = Math.max(0, windowStart);
    windowEnd = Math.min(total - 1, windowStart + settings.visibleCount - 1);

    requestAnimationFrame(() => {
      applyWindow(messages);

      // Restore scroll position after older messages appear at top
      requestAnimationFrame(() => {
        const newScrollHeight = scrollContainer.scrollHeight;
        const heightDiff = newScrollHeight - scrollHeight;
        const restoredScrollTop = scrollTop + heightDiff;

        // Keep the viewport near the top when the user is actively scrolling upward,
        // so additional upward scrolling continues smoothly instead of pausing.
        scrollContainer.scrollTop = preserveTopMomentum
          ? Math.min(restoredScrollTop, TOP_CONTINUATION_ANCHOR_PX)
          : restoredScrollTop;

        const shouldContinueSlidingUp =
          preserveTopMomentum &&
          windowStart > 0 &&
          scrollContainer.scrollTop <= 300;

        requestAnimationFrame(() => {
          isRevealing = false;
          if (shouldContinueSlidingUp && hasRecentUpScrollIntent()) {
            slideUp();
          }
        });
      });
    });
  }

  /** Scroll DOWN — slide window towards newer messages */
  function slideDown() {
    if (isRevealing || !messageWrapper || !isVirtualizationActive() || onlyShowKeptMode) return;
    const messages = getAllMessages();
    const total = messages.length;
    if (total === 0 || windowEnd >= total - 1) return;

    isRevealing = true;

    const batch = Math.min(settings.batchSize || 1, total - 1 - windowEnd);

    // Shift window down
    windowStart += batch;
    windowEnd += batch;

    // Clamp
    windowEnd = Math.min(total - 1, windowEnd);
    windowStart = Math.max(0, windowEnd - settings.visibleCount + 1);

    requestAnimationFrame(() => {
      applyWindow(messages);

      requestAnimationFrame(() => { isRevealing = false; });
    });
  }

  function revealAll() {
    if (!messageWrapper) return;
    requestAnimationFrame(() => {
      const messages = getAllMessages();
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        msg.style.display = '';
        delete msg.dataset.lgcHidden;
      }
      teardownSentinels();
      windowStart = 0;
      windowEnd = messages.length - 1;
      updateCounter(messages);
    });
  }

  // =================================================================
  // Two sentinels — top and bottom of visible window
  // =================================================================

  function setupSentinels(messages) {
    if (!messageWrapper || !scrollContainer) return;
    if (!isVirtualizationActive() || onlyShowKeptMode) {
      teardownSentinels();
      return;
    }
    if (!messages) messages = getAllMessages();
    const total = messages.length;

    // --- Top sentinel (scroll up to load older) ---
    if (windowStart > 0) {
      if (!topSentinel) {
        topSentinel = document.createElement('div');
        topSentinel.className = 'lgc-sentinel lgc-sentinel-top';
        topSentinel.setAttribute('aria-hidden', 'true');
      }
      const firstVisible = messages[windowStart];
      if (firstVisible && topSentinel.nextElementSibling !== firstVisible) {
        firstVisible.parentElement.insertBefore(topSentinel, firstVisible);
      }
      if (topObserver) topObserver.disconnect();
      topObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !isRevealing) slideUp();
        },
        { root: scrollContainer, rootMargin: '300px 0px 0px 0px', threshold: 0 }
      );
      topObserver.observe(topSentinel);
    } else {
      teardownTopSentinel();
    }

    // --- Bottom sentinel (scroll down to load newer) ---
    if (windowEnd < total - 1) {
      if (!bottomSentinel) {
        bottomSentinel = document.createElement('div');
        bottomSentinel.className = 'lgc-sentinel lgc-sentinel-bottom';
        bottomSentinel.setAttribute('aria-hidden', 'true');
      }
      const lastVisible = messages[windowEnd];
      if (lastVisible && bottomSentinel.previousElementSibling !== lastVisible) {
        lastVisible.parentElement.insertBefore(bottomSentinel, lastVisible.nextSibling);
      }
      if (bottomObserver) bottomObserver.disconnect();
      bottomObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && !isRevealing) slideDown();
        },
        { root: scrollContainer, rootMargin: '0px 0px 300px 0px', threshold: 0 }
      );
      bottomObserver.observe(bottomSentinel);
    } else {
      teardownBottomSentinel();
    }
  }

  function teardownTopSentinel() {
    if (topObserver) { topObserver.disconnect(); topObserver = null; }
    if (topSentinel?.parentElement) topSentinel.remove();
    topSentinel = null;
  }

  function teardownBottomSentinel() {
    if (bottomObserver) { bottomObserver.disconnect(); bottomObserver = null; }
    if (bottomSentinel?.parentElement) bottomSentinel.remove();
    bottomSentinel = null;
  }

  function teardownSentinels() {
    teardownTopSentinel();
    teardownBottomSentinel();
  }

  // =================================================================
  // MutationObserver — watch for new messages
  // =================================================================

  function startObserving() {
    if (mutationObserver) mutationObserver.disconnect();

    mutationObserver = new MutationObserver((mutations) => {
      let hasNewArticle = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.matches?.(SELECTORS.messageTurn) ||
                node.querySelector?.(SELECTORS.messageTurn)
              ) {
                hasNewArticle = true;
                break;
              }
            }
          }
        }
        if (hasNewArticle) break;
      }

      if (hasNewArticle) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const messages = getAllMessages();
          if (!isVirtualizationActive()) {
            revealAll();
            return;
          }

          if (onlyShowKeptMode) {
            applyWindow(messages);
            return;
          }

          // Keep showing the newest messages when a new one arrives
          const total = messages.length;
          windowEnd = total - 1;
          windowStart = Math.max(0, total - settings.visibleCount);
          applyWindow(messages);
        }, 300);
      }
    });

    if (messageWrapper) {
      mutationObserver.observe(messageWrapper, { childList: true, subtree: true });
    }
  }

  // =================================================================
  // Navigation detection
  // =================================================================

  function watchNavigation() {
    setInterval(() => {
      if (!contextAlive) return;
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        cleanup();
        setTimeout(() => init(), 800);
      }
    }, 500);

    const main = document.querySelector('main');
    if (main) {
      const navObserver = new MutationObserver(() => {
        if (!contextAlive) { navObserver.disconnect(); return; }
        if (messageWrapper && !document.contains(messageWrapper)) {
          cleanup();
          setTimeout(() => init(), 500);
        }
      });
      navObserver.observe(main, { childList: true, subtree: true });
    }
  }

  // =================================================================
  // Init & cleanup
  // =================================================================

  function handleScrollContainerScroll() {
    if (!trackedScrollContainer) return;

    const nextScrollTop = trackedScrollContainer.scrollTop;
    if (nextScrollTop < lastTrackedScrollTop) {
      lastUpScrollAt = Date.now();
    }
    lastTrackedScrollTop = nextScrollTop;
  }

  function attachScrollTracking(container) {
    if (!container) return;
    if (trackedScrollContainer === container) return;

    if (trackedScrollContainer) {
      trackedScrollContainer.removeEventListener('scroll', handleScrollContainerScroll);
    }

    trackedScrollContainer = container;
    lastTrackedScrollTop = container.scrollTop;
    container.addEventListener('scroll', handleScrollContainerScroll, { passive: true });
  }

  function detachScrollTracking() {
    if (!trackedScrollContainer) return;

    trackedScrollContainer.removeEventListener('scroll', handleScrollContainerScroll);
    trackedScrollContainer = null;
    lastTrackedScrollTop = 0;
    lastUpScrollAt = 0;
  }

  function findElements() {
    const firstArticle = document.querySelector(SELECTORS.messageTurn);
    if (!firstArticle) {
      const thread = document.querySelector('#thread');
      if (thread) {
        messageWrapper = thread;
        scrollContainer = findScrollableParent(thread);
        if (scrollContainer) attachScrollTracking(scrollContainer);
        return !!scrollContainer;
      }
      return false;
    }
    messageWrapper = firstArticle.parentElement;
    scrollContainer = findScrollableParent(firstArticle);
    if (scrollContainer) attachScrollTracking(scrollContainer);
    return !!(messageWrapper && scrollContainer);
  }

  function findScrollableParent(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        node.scrollHeight > node.clientHeight
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function cleanup() {
    if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
    teardownSentinels();
    removeCounter();
    detachScrollTracking();
    clearTimeout(debounceTimer);
    keepLoadedOverride = false;
    onlyShowKeptMode = false;
    keptMessageIds = new Set();
    scrollContainer = null;
    messageWrapper = null;
    isInitialized = false;
    isRevealing = false;
    windowStart = -1;
    windowEnd = -1;
  }

  async function init() {
    if (isInitialized || !contextAlive) return;
    await loadSettings();

    let attempts = 0;
    const maxAttempts = 20;

    const tryInit = () => {
      attempts++;
      if (findElements()) {
        isInitialized = true;
        if (settings.enabled) {
          resetWindow();
        }
        startObserving();
        console.log(
          `[LongerGPTChats] Initialized — ${getAllMessages().length} messages, window: ${settings.visibleCount}, batch: ${settings.batchSize}`
        );
      } else if (attempts < maxAttempts) {
        setTimeout(tryInit, 500);
      } else {
        console.log('[LongerGPTChats] Could not find chat container after retries');
      }
    };

    tryInit();
  }

  // =================================================================
  // Boot
  // =================================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); watchNavigation(); });
  } else {
    init();
    watchNavigation();
  }
})();
