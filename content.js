let popup = null;
let selectedText = '';
let contextText = '';

// Create popup HTML
function createPopup() {
    const popup = document.createElement('div');
    popup.id = 'context-dict-popup';
    popup.className = 'context-dict-extension';
    // 添加 Material Icons 字体
    if (!document.querySelector('link[href*="material-icons"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
        document.head.appendChild(link);
        
        // 确保字体加载完成
        const style = document.createElement('style');
        style.textContent = `
            @import url('https://fonts.googleapis.com/icon?family=Material+Icons');
            .material-icons {
                font-family: 'Material Icons';
                font-weight: normal;
                font-style: normal;
                font-size: 24px;
                line-height: 1;
                letter-spacing: normal;
                text-transform: none;
                display: inline-block;
                white-space: nowrap;
                word-wrap: normal;
                direction: ltr;
                -webkit-font-feature-settings: 'liga';
                -webkit-font-smoothing: antialiased;
            }
        `;
        document.head.appendChild(style);
    }

    popup.innerHTML = `
        <div class="loading-section">
            <div class="loading-spinner"></div>
            <div class="loading-content">
                <p class="loading-text">正在查询中...</p>
            </div>
        </div>
        <div class="content-section" style="display: none;">
            <div class="popup-header">
                <div class="word-info">
                    <h3 class="word-text"></h3>
                </div>
                <button class="close-btn" title="关闭">
                    <i class="material-icons">close</i>
                </button>
            </div>
            <div class="popup-body">
                <div class="markdown-content"></div>
            </div>
        </div>
    `;
    return popup;
}

// Get surrounding context
function getSurroundingContext(selectedText) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return '';

    const range = selection.getRangeAt(0);
    const paragraph = range.commonAncestorContainer.parentElement;
    
    // Get the full paragraph text
    let context = paragraph.textContent.trim();
    
    // If the paragraph is too long, get a window around the selected text
    if (context.length > 1000) {
        const selectionStart = context.indexOf(selectedText);
        if (selectionStart !== -1) {
            const contextStart = Math.max(0, selectionStart - 200);
            const contextEnd = Math.min(context.length, selectionStart + selectedText.length + 200);
            context = context.substring(contextStart, contextEnd);
        }
    }

    return context;
}

// Get page metadata
function getPageMetadata() {
    return {
        title: document.title,
        url: window.location.href,
        language: document.documentElement.lang || 'en'
    };
}

// Show loading popup
function showLoadingPopup(selectedText) {
    let popup = document.getElementById('context-dict-popup');
    if (!popup) {
        popup = createPopup();
        document.body.appendChild(popup);
        setupPopupEventListeners(popup);
        
        // Add close button event listener
        const closeBtn = popup.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                // Send cancel request message to background
                chrome.runtime.sendMessage({
                    action: 'cancelRequest',
                    requestId: window.currentRequestId
                });
                // Clear any existing selections
                if (window.getSelection) {
                    window.getSelection().removeAllRanges();
                }
                // Remove popup completely
                popup.remove();
                popup = null;
            });
        }
    }
    
    // Store request ID for cancellation
    window.currentRequestId = Date.now().toString();

    // Get context and metadata
    const context = getSurroundingContext(selectedText);
    const metadata = getPageMetadata();

    // console.log('Content script: preparing to send message', {
    //     selectedText,
    //     context: context.substring(0, 100) + '...',
    //     metadata
    // });

    // Position popup near selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        positionPopup(popup, rect);
    } else {
        // Fallback position in the center of the viewport
        const rect = {
            left: window.innerWidth / 2,
            top: window.innerHeight / 2,
            width: 0,
            height: 0
        };
        positionPopup(popup, rect);
    }

    // Reset and show popup
    popup.querySelector('.loading-section').style.display = 'block';
    popup.querySelector('.content-section').style.display = 'none';
    const spinner = popup.querySelector('.loading-spinner');
    if (spinner) {
        spinner.style.display = 'block';
    }
    const loadingText = popup.querySelector('.loading-text');
    if (loadingText) {
        loadingText.textContent = '正在查询中...';
        loadingText.style.color = '';
    }
    popup.classList.add('show');

    // 显示加载状态
    showLoading();
    
    // Send message to background script to make API request
    chrome.runtime.sendMessage({
        action: 'explainWord',
        selectedText,
        context,
        metadata,
        requestId: window.currentRequestId
    }, async response => {
        // console.group('Content script: API Response');
        // console.log('Full response:', response);
        // console.log('Response type:', typeof response);
        if (response) {
            // console.log('Success:', response.success);
            // console.log('Error:', response.error);
            // console.log('Message:', response.message);
            // console.log('Data:', response.data);
            if (response.data) {
                // console.log('Data type:', typeof response.data);
                // console.log('Data keys:', Object.keys(response.data));
                // Handle streaming response
                if (response.data.isStreaming) {
                    setupStreamingResponse(popup, response.data);
                    return;
                }
            }
        }
        // console.groupEnd();

        if (!response) {
            // console.info('Content script: no response from background');
            showErrorInPopup(popup, '与后台脚本通信失败');
            return;
        }
        if (!response.success) {
            // console.info('Content script: error from background:', response.error);
            showErrorInPopup(popup, response.error || '请求处理失败');
            return;
        }
        showContentPopup(response.data);
    });
}

// Load marked.js from lib directory
function loadMarked() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('lib/marked.min.js');
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Setup streaming response handler
function setupStreamingResponse(popup, initialData) {
    let accumulatedContent = initialData.markdown || '';
    
    // Show initial content
    updateStreamingContent(popup, {
        word: initialData.word,
        markdown: accumulatedContent
    });
    
    // Listen for streaming updates
    chrome.runtime.onMessage.addListener(function streamingListener(request) {
        // console.group('处理流式更新');
        // console.log('收到请求:', request);
        
        if (request.action === 'streamUpdate' && request.data) {
            try {
                const chunk = request.data.chunk;
                // console.log('原始数据块:', chunk);
                if (!chunk) {
                    // console.log('数据块为空，跳过处理');
                    // console.groupEnd();
                    return;
                }
                
                // 处理 SSE 格式的数据
                const lines = chunk.split('\n');
                // console.log('分割后的行数:', lines.length);
                // console.log('分割后的行:', lines);
                
                for (const line of lines) {
                    // console.log('处理行:', line);
                    if (line.startsWith('data: ')) {
                        try {
                            if (line.trim() === 'data: [DONE]') {
                                // console.log('收到 DONE 标记，结束处理');
                                continue;
                            }

                            const jsonStr = line.substring(6); // 移除 'data: ' 前缀
                            // console.log('移除前缀后的JSON字符串:', jsonStr);

                            
                            const jsonData = JSON.parse(jsonStr);
                            // console.log('解析后的JSON数据:', jsonData);
                            
                            // 从 choices[0].delta 获取内容
                            const delta = jsonData.choices?.[0]?.delta;
                            
                            // 分别处理思考过程和回答内容
                            if (delta) {
                                if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                                    // console.log('发现思考过程:', delta.reasoning_content);
                                    if (!accumulatedContent.includes('<!-- reasoning-start -->')) {
                                        accumulatedContent += '\n<!-- reasoning-start -->\n';
                                    }
                                    accumulatedContent += delta.reasoning_content;
                                } else if (delta.content !== undefined && delta.content !== null) {
                                    // console.log('发现回答内容:', delta.content);
                                    if (accumulatedContent.includes('<!-- reasoning-start -->') && 
                                        !accumulatedContent.includes('<!-- reasoning-end -->')) {
                                        accumulatedContent += '\n<!-- reasoning-end -->\n';
                                    }
                                    accumulatedContent += delta.content;
                                }
                                
                                if ((delta.reasoning_content !== undefined && delta.reasoning_content !== null) || 
                                    (delta.content !== undefined && delta.content !== null)) {
                                    updateStreamingContent(popup, {
                                        word: initialData.word,
                                        markdown: accumulatedContent
                                    });
                                } else {
                                    // console.log('未找到有效的内容字段 delta:', delta);
                                }
                            }
                        } catch (e) {
                            console.error('解析数据块失败:', e);
                            console.error('问题行:', line);
                            console.error('完整错误:', e.stack);
                            continue; // 继续处理下一行
                        }
                    }
                    //  else {
                        // console.log('行不是以data:开头，跳过:', line);
                    // }
                }
            } catch (e) {
                console.error('处理流式数据失败:', e);
                showErrorInPopup(popup, '处理响应数据失败: ' + e.message);
            }
            
            if (request.data.isDone) {
                chrome.runtime.onMessage.removeListener(streamingListener);
            }
        }
    });
}

// Update streaming content incrementally
function updateStreamingContent(popup, data) {
    try {
        // Get popup element
        if (!popup) {
            popup = document.getElementById('context-dict-popup');
            if (!popup) return;
        }

        // Update word text if needed
        const wordText = popup.querySelector('.word-text');
        if (wordText && data.word) {
            wordText.textContent = data.word;
        }

        // Update markdown content
        const markdownContent = popup.querySelector('.markdown-content');
        if (!markdownContent) return;
        
        // Calculate dynamic height
        const contentHeight = markdownContent.scrollHeight;
        const windowHeight = window.innerHeight;
        const maxHeight = Math.min(windowHeight * 0.8, contentHeight + 100); // 100px padding
        popup.style.maxHeight = `${maxHeight}px`;

        // Store current scroll position and check if we're at the bottom
        const isAtBottom = markdownContent.scrollHeight - markdownContent.scrollTop <= markdownContent.clientHeight + 50;

        // Render markdown using marked.js
        const htmlContent = marked.parse(data.markdown);
        markdownContent.innerHTML = htmlContent;

        // Process reasoning section
        const reasoningStart = markdownContent.innerHTML.indexOf('<!-- reasoning-start -->');
        const reasoningEnd = markdownContent.innerHTML.indexOf('<!-- reasoning-end -->');
        
        if (reasoningStart !== -1) {
            // Extract reasoning content
            const beforeReasoning = markdownContent.innerHTML.substring(0, reasoningStart);
            let reasoningContent = markdownContent.innerHTML.substring(
                reasoningStart,
                reasoningEnd !== -1 ? reasoningEnd + '<!-- reasoning-end -->'.length : undefined
            );
            const afterReasoning = reasoningEnd !== -1 ? 
                markdownContent.innerHTML.substring(reasoningEnd + '<!-- reasoning-end -->'.length) : '';

            // Replace HTML comments with div and add toggle button
            reasoningContent = reasoningContent
                .replace('<!-- reasoning-start -->', '<div class="reasoning-section"><button class="toggle-reasoning" aria-label="切换思考过程显示"></button>')
                .replace('<!-- reasoning-end -->', '</div>');

            // Update content
            markdownContent.innerHTML = beforeReasoning + reasoningContent + afterReasoning;

            // Add click handler to toggle reasoning section
            const reasoningSection = markdownContent.querySelector('.reasoning-section');
            const toggleButton = reasoningSection?.querySelector('.toggle-reasoning');
            
            if (toggleButton) {
                toggleButton.addEventListener('click', function(e) {
                    e.stopPropagation(); // 阻止事件冒泡
                    const section = this.closest('.reasoning-section');
                    if (section) {
                        section.classList.toggle('collapsed');
                    }
                });
            }
        }

        // Auto-scroll to bottom if we were already at the bottom
        if (isAtBottom) {
            // 使用 scrollIntoView 实现平滑滚动
            const lastElement = markdownContent.lastElementChild;
            if (lastElement) {
                lastElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'end',
                    inline: 'nearest'
                });
            } else {
                // 如果没有元素，使用原始方式
                requestAnimationFrame(() => {
                    markdownContent.scrollTop = markdownContent.scrollHeight;
                });
            }
        }
        
        // Update popup position after content changes
        requestAnimationFrame(() => {
            updatePopupPosition(popup);
        });

        // Add target="_blank" to all links
        const links = markdownContent.getElementsByTagName('a');
        for (let i = 0; i < links.length; i++) {
            links[i].target = '_blank';
            links[i].rel = 'noopener noreferrer';
        }

        // Show content section if hidden
        popup.querySelector('.loading-section').style.display = 'none';
        popup.querySelector('.content-section').style.display = 'block';
    } catch (error) {
        console.error('Error updating streaming content:', error);
    }
}

// Show content popup
async function showContentPopup(data) {
    console.group('Content script: Content Data Validation');
    console.log('Received data:', data);

    // Validate data
    if (!data || typeof data !== 'object' || !data.word || !data.markdown) {
        console.error('Content script: invalid data', {
            data: data,
            type: typeof data,
            isArray: Array.isArray(data),
            hasWord: data?.word,
            hasMarkdown: data?.markdown
        });
        console.groupEnd();
        const popup = document.getElementById('context-dict-popup');
        if (popup) {
            showErrorInPopup(popup, '接收到无效数据');
        }
        return;
    }

    try {
        // Get popup element
        const popup = document.getElementById('context-dict-popup');
        if (!popup) {
            throw new Error('Popup element not found');
        }

        // Update word text
        const wordText = popup.querySelector('.word-text');
        if (wordText) {
            wordText.textContent = data.word;
        }

        // Update markdown content
        const markdownContent = popup.querySelector('.markdown-content');
        if (!markdownContent) {
            throw new Error('找不到内容容器');
        }

        // 监听弹窗内容变化
        if (window._popupResizeObserver) {
            window._popupResizeObserver.disconnect();
        }
        window._popupResizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => updatePopupPosition(popup));
        });
        window._popupResizeObserver.observe(markdownContent);

        try {
            // Render markdown using marked.js
            const htmlContent = marked.parse(data.markdown);
            markdownContent.innerHTML = htmlContent;

            // Add target="_blank" to all links
            const links = markdownContent.getElementsByTagName('a');
            for (let i = 0; i < links.length; i++) {
                links[i].target = '_blank';
                links[i].rel = 'noopener noreferrer';
            }
        } catch (error) {
            console.error('Error rendering markdown:', error);
            throw new Error('渲染内容失败');
        }

        // Hide loading and show content
        popup.querySelector('.loading-section').style.display = 'none';
        popup.querySelector('.content-section').style.display = 'block';

        // Add click event listeners
        setupPopupEventListeners(popup);

        // 添加滚动事件监听
        window._popupScrollHandler = () => {
            if (popup && popup.style.display !== 'none') {
                requestAnimationFrame(() => updatePopupPosition(popup));
            }
        };

        // 添加滚动和调整大小的事件监听器
        window.addEventListener('scroll', window._popupScrollHandler, { passive: true });
        window.addEventListener('resize', window._popupScrollHandler, { passive: true });

        console.log('Content updated successfully');
        console.groupEnd();
    } catch (error) {
        console.error('Content script: error updating popup content', error);
        const popup = document.getElementById('context-dict-popup');
        if (popup) {
            showErrorInPopup(popup, error.message || '更新内容时出错');
        }
        console.groupEnd();
    }
}

// 存储最后一次选择的位置
let lastSelectionRect = null;

// Position popup relative to selection
function positionPopup(popup, rect) {
    if (!popup) return;
    
    // 设置弹窗宽度为视口宽度的90%，最大不超过1000px
    const viewportWidth = window.innerWidth;
    const popupWidth = Math.min(1000, viewportWidth * 0.9);
    popup.style.width = `${popupWidth}px`;
    popup.style.maxWidth = 'none';
    
    // 设置弹窗高度为视口高度的70%，最大不超过600px
    const viewportHeight = window.innerHeight;
    const popupHeight = Math.min(600, viewportHeight * 0.7);
    popup.style.maxHeight = `${popupHeight}px`;
    
    // 使用固定位置居中显示
    popup.style.position = 'fixed';
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    popup.style.zIndex = '999999';
}

// 更新弹窗位置
function updatePopupPosition(popup) {
    if (!popup) return;
    
    // 确保弹窗始终居中
    popup.style.position = 'fixed';
    popup.style.left = '50%';
    popup.style.top = '50%';
    popup.style.transform = 'translate(-50%, -50%)';
    
    // 设置合适的滚动行为
    const contentHeight = popup.scrollHeight;
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.min(600, viewportHeight * 0.7);
    
    if (contentHeight > maxHeight) {
        popup.style.overflowY = 'auto';
        popup.style.paddingRight = '12px';
    } else {
        popup.style.overflowY = 'visible';
        popup.style.paddingRight = '20px';
    }
}

// Setup popup event listeners
function setupPopupEventListeners(popup) {
    // Add click event listener to close button
    popup.querySelector('.close-btn').addEventListener('click', () => {
        popup.classList.remove('show');
    });

    // Add click event listener to close popup when clicking outside
    document.addEventListener('click', function closePopup(e) {
        if (!popup.contains(e.target)) {
            popup.classList.remove('show');
            document.removeEventListener('click', closePopup);
        }
    });
}

// Hide popup
function hidePopup() {
    const popup = document.getElementById('context-dict-popup');
    if (popup) {
        // 移除滚动事件监听器
        if (window._popupScrollHandler) {
            window.removeEventListener('scroll', window._popupScrollHandler);
            window.removeEventListener('resize', window._popupScrollHandler);
            window._popupScrollHandler = null;
        }

        // 恢复原始选择状态
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
        }

        // 移除内容变化监听器
        if (window._popupResizeObserver) {
            window._popupResizeObserver.disconnect();
            window._popupResizeObserver = null;
        }

        // 重置选中文本位置
        lastSelectionRect = null;

        popup.classList.remove('show');
        // Reset popup state
        setTimeout(() => {
            if (!popup.classList.contains('show')) {
                popup.querySelector('.loading-section').style.display = 'none';
                popup.querySelector('.content-section').style.display = 'none';
                const spinner = popup.querySelector('.loading-spinner');
                if (spinner) {
                    spinner.style.display = 'block';
                }
                const loadingText = popup.querySelector('.loading-text');
                if (loadingText) {
                    loadingText.textContent = '正在查询中...';
                    loadingText.style.color = '';
                }

                // 重置选中文本位置
                lastSelectionRect = null;
                popup.remove();
            }
        }, 300); // Wait for fade out animation
    }
}

// Get context text of selected text
function getContextText(selectedText) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return '';

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const paragraph = container.nodeType === Node.TEXT_NODE ? 
        container.parentNode : 
        container;

    return paragraph.textContent.trim();
}

// Mock API response data
function getMockData(word, context) {
    return {
        word,
        contextMeaning: `在当前上下文中，"${word}"的含义是：一个特定的术语或概念，它在文本"${context.substring(0, 100)}..."中被讨论。`,
        examples: [
            '这是一个使用该词的示例句子。',
            '另一个展示如何正确使用它的例子。',
            '在不同上下文中的第三个例子。'
        ],
        resources: [
            {
                title: '词典定义',
                url: `https://www.zdic.net/hans/${word}`,
                icon: 'menu_book'
            },
            {
                title: '使用示例',
                url: `https://www.linguee.com/chinese-english/search?source=auto&query=${word}`,
                icon: 'format_quote'
            },
            {
                title: '相关词汇',
                url: `https://www.thesaurus.com/browse/${word}`,
                icon: 'account_tree'
            }
        ]
    };
}

// Show loading state
function showLoading() {
    const popup = document.getElementById('context-dict-popup');
    if (!popup) return;

    popup.querySelector('.content-section').style.display = 'none';
    popup.querySelector('.loading-section').style.display = 'block';
}

// Show error in popup
function showErrorInPopup(popup, message) {
    if (!popup || !popup.classList.contains('show')) return;

    const loadingSection = popup.querySelector('.loading-section');
    const spinner = loadingSection.querySelector('.loading-spinner');
    const loadingText = loadingSection.querySelector('.loading-text');

    // Hide spinner and show error message
    if (spinner) {
        spinner.style.display = 'none';
    }
    if (loadingText) {
        loadingText.textContent = message;
        loadingText.style.color = '#ff4444';
    }

    // Hide popup after delay
    setTimeout(() => {
        if (popup && popup.classList.contains('show')) {
            hidePopup();
        }
    }, 2000);
}

// Initialize extension
async function initializeExtension() {
    console.log('Initializing extension...');

    // Preload marked.js
    try {
        await loadMarked();
        console.log('marked.js preloaded successfully');
    } catch (error) {
        console.error('Failed to preload marked.js:', error);
    }

    // Add styles
    const styles = document.createElement('style');
    styles.textContent = `
        .context-dict-extension {
            position: fixed;
            z-index: 9999;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #333;
            padding: 16px;
            margin: 8px;
        }

        .context-dict-extension .popup-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            border-bottom: 1px solid #eee;
            padding-bottom: 12px;
        }

        .context-dict-extension .word-text {
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            color: #1a73e8;
        }

        .context-dict-extension .close-btn {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .context-dict-extension .close-btn:hover {
            color: #333;
        }

        .context-dict-extension .markdown-content {
            line-height: 2.0;
            color: #444;
            padding: 20px;
            margin-bottom: 24px;
            font-size: 15px;
        }

        .context-dict-extension .markdown-content p {
            margin: 16px 0;
            line-height: 2.0;
        }

        .context-dict-extension .markdown-content ul,
        .context-dict-extension .markdown-content ol {
            padding-left: 28px;
            margin: 12px 0;
        }

        .context-dict-extension .markdown-content li {
            margin: 8px 0;
            line-height: 1.9;
        }

        .context-dict-extension .markdown-content h1,
        .context-dict-extension .markdown-content h2,
        .context-dict-extension .markdown-content h3 {
            margin: 24px 0 12px;
            color: #1a73e8;
            font-weight: 600;
        }

        .context-dict-extension .markdown-content h1 { font-size: 18px; }
        .context-dict-extension .markdown-content h2 { font-size: 16px; }
        .context-dict-extension .markdown-content h3 { font-size: 14px; }

        .context-dict-extension .markdown-content p {
            margin: 12px 0;
            line-height: 1.8;
        }

        .context-dict-extension .markdown-content ul,
        .context-dict-extension .markdown-content ol {
            padding-left: 24px;
            margin: 8px 0;
        }

        .context-dict-extension .markdown-content li {
            margin: 4px 0;
        }

        .context-dict-extension .markdown-content a {
            color: #1a73e8;
            text-decoration: none;
        }

        .context-dict-extension .markdown-content a:hover {
            text-decoration: underline;
        }

        .context-dict-extension .markdown-content code {
            background: #f5f5f5;
            padding: 2px 4px;
            border-radius: 4px;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 13px;
        }

        .context-dict-extension .markdown-content blockquote {
            margin: 8px 0;
            padding: 8px 16px;
            border-left: 4px solid #1a73e8;
            background: #f8f9fa;
        }

        .context-dict-extension .loading-section {
            text-align: center;
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
        }

        .context-dict-extension .loading-spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #1a73e8;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            animation: spin 1s linear infinite;
        }

        .context-dict-extension .loading-content {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .context-dict-extension .loading-text {
            font-size: 16px;
            font-weight: 500;
            color: #1a73e8;
            margin: 0;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .context-dict-extension .error-section {
            text-align: center;
            padding: 24px;
            color: #d32f2f;
        }
    `;
    document.head.appendChild(styles);

    // Add material icons
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    console.log('Extension initialized');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (!request || !request.action) return;

    try {
        switch (request.action) {
            case 'showExplanation':
                if (request.data && request.data.selectedText) {
                    showLoadingPopup(request.data.selectedText);
                }
                break;
            case 'showContent':
                if (request.data) {
                    showContentPopup(request.data);
                }
                break;
            case 'showError':
                if (request.error) {
                    showErrorInPopup(document.getElementById('context-dict-popup'), request.error);
                }
                break;
            default:
                // console.info('Content script: unknown action received', request.action);
                break;
        }
    } catch (error) {
        console.info('Content script: error handling message', error);
        const popup = document.getElementById('context-dict-popup');
        if (popup) {
            showErrorInPopup(popup, '处理消息时出错');
        }
    }
});

// Hide popup when clicking outside
document.addEventListener('mousedown', function(e) {
    const popup = document.getElementById('context-dict-popup')
    if (popup && !popup.contains(e.target)) {
        chrome.runtime.sendMessage({
            action: 'cancelRequest',
            requestId: window.currentRequestId
        });
        hidePopup();
    }
});

// Initialize extension when DOM is ready
document.addEventListener('DOMContentLoaded', initializeExtension);

// 替换原有的response.json()处理
async function handleResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // 处理完整的事件
        while (buffer.includes('\n')) {
            const lineEnd = buffer.indexOf('\n');
            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);
            
            if (line.startsWith('data: ')) {
                try {
                    const jsonData = JSON.parse(line.slice(6));
                    // 在这里处理每个数据块
                    appendToPopup(jsonData.content);
                } catch (e) {
                    showErrorInPopup('数据解析错误: ' + e.message);
                }
            }
        }
    }
}

function appendToPopup(content) {
    const popup = document.getElementById('context-dict-popup');
    if (!popup) return;

    const markdownContent = popup.querySelector('.markdown-content');
    if (!markdownContent) return;

    markdownContent.innerHTML += content;
}
