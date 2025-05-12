// Import Fuse.js library
try {
  importScripts('lib/fuse.min.js');
} catch (e) {
  console.error('Failed to load fuse.min.js:', e);
}

// Global variables for API configuration
let apiEndpoint = '';
let apiKey = '';
let model = '';
let activeControllers = new Map(); // Track active requests
let copiedTexts = [];
const MAX_COPIED_TEXTS = 100;

// Load API settings
function loadApiSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['apiEndpoint', 'apiKey', 'model'], function(result) {
            apiEndpoint = result.apiEndpoint || '';
            apiKey = result.apiKey || '';
            model = result.model || '';
            resolve();
        });
    });
}

// Initialize context menu and load settings
chrome.runtime.onInstalled.addListener(async () => {
    console.log('onInstalled event fired.'); // Add log inside onInstalled
    await loadApiSettings();
    // Load copied texts from storage on startup
    chrome.storage.local.get(['copiedTexts'], (result) => {
      if (result.copiedTexts) {
        copiedTexts = result.copiedTexts;
        console.log('Loaded copied texts from storage on install/update:', copiedTexts);
      }
    });
    // Remove existing menu items
    chrome.contextMenus.removeAll(() => {
        // Create new menu item
        chrome.contextMenus.create({
            id: 'explainWord',
            title: 'Explain "%s"',
            contexts: ['selection']
        });
    });
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'API_SETTINGS_UPDATED') {
        apiSettings = {
            endpoint: message.data.apiEndpoint,
            apiKey: message.data.apiKey,
            model: message.data.model
        };
        // Save to storage
        chrome.storage.sync.set({
            endpoint: message.data.apiEndpoint,
            apiKey: message.data.apiKey,
            model: message.data.model
        });
    } else if (message.type === 'API_SETTINGS_RESET') {
        apiSettings = {
            endpoint: '',
            apiKey: '',
            model: ''
        };
        // Clear from storage
        chrome.storage.sync.remove(['endpoint', 'apiKey', 'model']);
    }
});

// Merged onMessage listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background: onMessage listener triggered.');
  console.log('Background: received message', request);

  if (request.action === 'storeCopiedText') {
    if (request.text) {
      // Add to the beginning and keep unique items
      copiedTexts = [request.text, ...copiedTexts.filter(t => t !== request.text)];
      // Limit to MAX_COPIED_TEXTS
      if (copiedTexts.length > MAX_COPIED_TEXTS) {
        copiedTexts = copiedTexts.slice(0, MAX_COPIED_TEXTS);
      }
      // Persist to storage (optional, but good for persistence across sessions)
      chrome.storage.local.set({ copiedTexts });
      console.log('Stored copied text:', request.text, 'All copied texts:', copiedTexts);
    }
    sendResponse({ success: true });
    return true; // Indicates asynchronous response
  } else if (request.action === 'getCopiedTexts') {
    // Retrieve from storage if available, otherwise use in-memory
    chrome.storage.local.get(['copiedTexts'], (result) => {
      const texts = result.copiedTexts || copiedTexts;
      sendResponse({ success: true, data: texts });
    });
    return true; // Indicates asynchronous response
  } else if (request.action === 'getBookmarks') {
    const query = request.query || '';
    chrome.bookmarks.search(query, (bookmarks) => {
      if (chrome.runtime.lastError) {
        console.error("Error searching bookmarks:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      // Filter out folders and map to a consistent format
      const filteredBookmarks = bookmarks.filter(bm => bm.url).map(bm => ({ title: bm.title, url: bm.url }));
      sendResponse({ success: true, data: filteredBookmarks });
    });
    return true; // Indicates asynchronous response
  } else if (request.action === 'getHistory') {
    const query = request.query || '';
    chrome.history.search({ text: query, maxResults: 50 }, (historyItems) => {
      if (chrome.runtime.lastError) {
        console.error("Error searching history:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ success: true, data: historyItems.map(item => ({ title: item.title, url: item.url })) });
    });
    return true; // Indicates asynchronous response
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'explainWord' && info.selectionText) {
        // Send message to content script
        chrome.tabs.sendMessage(tab.id, {
            action: 'showExplanation',
            data: {
                selectedText: info.selectionText
            }
        });
    }
});

// Load settings from storage
let apiSettings = {
    endpoint: '',
    apiKey: '',
    model: ''
};

// Load settings from storage
chrome.storage.sync.get(['endpoint', 'apiKey'], (result) => {
    apiSettings = {
        endpoint: result.endpoint || '',
        apiKey: result.apiKey || '',
        model: result.model || ''
    };
});

// Create prompt for API
function createPrompt(model, selectedText, contextData) { // Updated signature
    // Extract context and metadata from the 'currentPage' source
    const currentPageSource = contextData.sources.find(s => s.type === 'currentPage');
    const context = currentPageSource ? currentPageSource.context : "";
    const metadata = currentPageSource ? currentPageSource.metadata : { title: "N/A", url: "N/A" };

    return {
        model: model,
        messages: [
            {
                role: "system",
                content: `你是一个专业的语言解释助手。请根据给定的上下文和你的知识，解释用户选中的词语或短语。

你的回复应该包含以下部分：
1. 如果是英文词语或短句，先给出准确的中文翻译
2. 根据上下文详细解释该词语或短句的具体含义
3. 推荐2-3个相关的学习资源（如词典、论文、文章等），优先选择权威性强的资源

请使用 Markdown 格式回复，保持清晰的结构和易读性。回复时使用以下格式：

## 翻译（仅当词语为英文时）
[中文翻译]

## 含义解释
[详细解释内容]

## 推荐资源
- [资源1标题](链接1)
- [资源2标题](链接2)`
            },
            {
                role: "user",
                content: `需要解释的词语："${selectedText}"

上下文："${context}"

页面标题：${metadata.title}

请提供详细的解释和相关资源。`
            }
        ],
        temperature: 0.7, // 提高创造性
        max_tokens: 1000,
        top_p: 1,
        frequency_penalty: 0.2, // 增加表达多样性
        presence_penalty: 0.1,
        "stream": true
    };
}

// Create prompt for Search API
function createSearchPrompt(model, searchTerm, contextData) { // Updated signature, contextData might be used later
    // Currently, the prompt only uses searchTerm. Context from contextData is available if needed.
    const allContextInfo = contextData.sources.map(s => {
        if (s.type === 'currentPage') {
            // Include context and metadata title/url for currentPage
            const metadataInfo = s.metadata ? ` (Title: ${s.metadata.title}, URL: ${s.metadata.url})` : '';
            return `${s.context}${metadataInfo}`;
        } else {
            // Include URLs for other types
            return `${s.urls?.join(', ') || 'N/A'}`;
        }
    }).join('\n');
    return {
        model: model,
        messages: [
            {
                role: "system",
                content: `你是一个智能搜索和解释助手。请分析用户输入的内容：

1.  **如果输入是一个问题**：请使用你的知识库直接回答该问题，并提供2-3个相关的、权威的学习资源链接（例如：官方文档、知名教程网站、相关论文）。
2.  **如果输入是一个词语或短语**：请解释该词语或短语的含义，并提供2-3个相关的、权威的学习资源链接。

请始终使用 Markdown 格式回复，保持清晰的结构和易读性。回复时，根据输入类型使用以下格式之一(不需要显示使用了那种格式):

**格式一：回答问题**
[对问题的直接回答]

## 推荐资源
- [资源1标题](链接1)
- [资源2标题](链接2)

**格式二：解释词语/短语**

## 含义解释
[词语或短语的详细解释]

## 推荐资源
- [资源1标题](链接1)
- [资源2标题](链接2)`
            },
            {
                role: "user",
                content: `请处理以下输入："${searchTerm}"

上下文："${allContextInfo}"

请根据内容判断是问题还是词语/短语，并按要求提供回答/解释和推荐资源。`
            }
        ],
        temperature: 0.5, // 稍微降低创造性，更侧重准确回答/解释
        max_tokens: 1000,
        top_p: 1,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        "stream": true
    };
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background: onMessage listener triggered.'); // Add log at the beginning of the listener
    console.log('Background: received message', request);

    if (request.action === 'cancelRequest') {
        const { requestId } = request;
        console.log('Deleting controller with ID:', requestId);
        const controller = activeControllers.get(requestId);
        if (controller) {
            controller.abort();
            activeControllers.delete(requestId);
            console.log(`Cancelled request ${requestId}`);
        }
        return true; // Indicate asynchronous response
    } else if (request.action === 'searchBookmarks') {
        const { query } = request;
        console.log('Background: Received searchBookmarks request with query:', query);

        // Function to flatten the bookmark tree
        const flattenBookmarks = (nodes) => {
            let bookmarks = [];
            for (const node of nodes) {
                if (node.url && node.title) { // It's a bookmark
                    bookmarks.push({ title: node.title, url: node.url });
                } else if (node.children) { // It's a folder
                    bookmarks = bookmarks.concat(flattenBookmarks(node.children));
                }
            }
            return bookmarks;
        };

        chrome.bookmarks.getTree((bookmarkTreeNodes) => {
            console.log('Background: Bookmark tree nodes:', bookmarkTreeNodes); 
            const allBookmarks = flattenBookmarks(bookmarkTreeNodes);
            let filteredUrls = [];
            console.log('Background: All bookmarks:', allBookmarks);

            if (typeof Fuse === 'undefined') {
                console.error('Fuse.js is not loaded. Falling back to simple includes search.');
                // Fallback to simple search if Fuse.js is not loaded
                filteredUrls = allBookmarks
                    .filter(bookmark => bookmark.title.toLowerCase().includes(query.toLowerCase()))
                    .map(bookmark => bookmark.url);
            } else {
                // Use Fuse.js for fuzzy search
                const fuseOptions = {
                    includeScore: true,
                    threshold: 0.4, // Adjust threshold for desired fuzziness (0.0 = exact, 1.0 = match anything)
                    keys: ['title']
                };
                const fuse = new Fuse(allBookmarks, fuseOptions);
                const results = fuse.search(query);
                console.log('Background: Fuse.js search results:', results);
                // Extract URLs from Fuse results (item property holds the original object)
                filteredUrls = results.map(result => result.item.url);
            }

            console.log('Background: Filtered bookmark URLs:', filteredUrls);
            sendResponse({ success: true, data: filteredUrls });
        });

        return true; // Indicate asynchronous response
    } else if (request.action === 'searchHistory') {
        const { query } = request;
        chrome.history.search({ text: query, maxResults: 10 }, (results) => { // Limit results for performance
            console.log('Background: search history: ', results);
            const urls = results.map(item => item.url);
            sendResponse({ success: true, data: urls });
        });
        return true; // Indicate asynchronous response
    } else if (request.action === 'explainWord' || request.action === 'search') {
        const { selectedText, context, requestId } = request;

        const handleExplanation = async () => {
            let timeoutId;
            let controller;

            try {
                // Get API settings from storage
                const result = await chrome.storage.sync.get(['apiEndpoint', 'apiKey', 'model']);
                const apiSettings = {
                    endpoint: result.apiEndpoint,
                    apiKey: result.apiKey,
                    model: result.model
                };

                // Check if API settings are configured
                if (!apiSettings.endpoint || !apiSettings.apiKey || !apiSettings.model) {
                    console.warn('Background: API settings not configured', {
                        hasEndpoint: !!apiSettings.endpoint,
                        hasApiKey: !!apiSettings.apiKey,
                        hasModel:!!apiSettings.model
                    });
                    sendResponse({
                        success: false,
                        error: '请先配置API设置',
                        data: null
                    });
                    return;
                }

                prompt = "";
                if (request.action === 'search') {
                    // Create prompt for Search API
                    prompt = createSearchPrompt(apiSettings.model, selectedText, context);
                } else {
                    // Create prompt for explain API
                    prompt = createPrompt(apiSettings.model, selectedText, context);
                }
                console.log('Background: created prompt', prompt);
                
                // Setup request with timeout
                controller = new AbortController();
                console.log('Setting controller with ID:', requestId);
                activeControllers.set(requestId, controller);
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        controller.abort();
                        reject(new Error('请求超时'));
                    }, 30000); // 30 seconds timeout
                });

                // Send API request
                const fetchPromise = fetch(apiSettings.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiSettings.apiKey}`
                    },
                    body: JSON.stringify(prompt),
                    signal: controller.signal
                });

                // Wait for either response or timeout
                const response = await Promise.race([fetchPromise, timeoutPromise]);

                // Clear timeout since we got a response
                clearTimeout(timeoutId);

                // Check response status
                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error('API请求失败:', {
                        status: response.status,
                        statusText: response.statusText,
                        url: apiSettings.endpoint,
                        headers: response.headers,
                        body: errorBody,
                        requestBody: JSON.stringify(prompt, null, 2)
                    });
                    throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                }

                // 设置流式响应标志
                const isStreaming = response.headers.get('content-type')?.includes('text/event-stream');
                console.log('Is streaming response:', isStreaming);

                if (isStreaming) {
                    // 初始化流式响应
                    sendResponse({
                        success: true,
                        error: null,
                        data: {
                            isStreaming: true,
                            word: selectedText,
                            markdown: ''
                        }
                    });

                    // 读取流式响应
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();

                    try {
                        while (true) {
                            const {done, value} = await reader.read();
                            if (done) break;

                            const chunk = decoder.decode(value, {stream: true});
                            console.log('Received chunk:', chunk);

                            // 发送流式更新
                            chrome.tabs.sendMessage(sender.tab.id, {
                                action: 'streamUpdate',
                                data: {
                                    chunk: chunk
                                }
                            });
                        }

                        // 发送完成信号
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: 'streamUpdate',
                            data: {
                                isDone: true
                            }
                        });
                    } catch (e) {
                        console.log('Error reading stream:', e);
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: 'streamUpdate',
                            error: '读取响应流失败: ' + e.message
                        });
                    }
                } else {
                    // 非流式响应
                    const data = await response.json();
                    console.log('Response data:', data);

                    console.group('Background: Process Response');
                    console.log('Raw API response:', data);

                    // Get the response content with null checks
                    const content = {
                        word: selectedText,
                        markdown: data?.choices?.[0]?.message?.content?.trim() || ''
                    };
                    console.log('Response content:', content);
                    console.groupEnd();

                    sendResponse({
                        success: true,
                        error: null,
                        data: content
                    });
                }
            } catch (error) {
                console.error('Background: error handling explanation', {
                    error: error,
                    stack: error.stack,
                    apiSettings: apiSettings,
                    requestDetails: {
                        endpoint: apiSettings.endpoint,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiSettings.apiKey}`
                        },
                    }
                });
                clearTimeout(timeoutId);

                let errorMessage = '请求处理失败';
                if (error.name === 'AbortError' || error.message === '请求超时') {
                    errorMessage = '请求超时';
                } else if (error.message.includes('HTTP error')) {
                    errorMessage = `服务器响应错误 (${error.message})`;
                } else if (error.message.includes('JSON')) {
                    errorMessage = '响应数据格式错误';
                } else if (error.message.includes('NetworkError')) {
                    errorMessage = '网络连接失败';
                } else if (error.message.includes('Failed to fetch')) {
                    errorMessage = '无法连接到API服务器';
                }

                sendResponse({
                    success: false,
                    error: errorMessage,
                    data: null,
                    originalError: error.message,
                    errorType: error.name,
                    stackTrace: error.stack
                });
            } finally {
                // Clean up
                if (timeoutId) clearTimeout(timeoutId);
                if (controller) {
                    controller.abort();
                    activeControllers.delete(requestId);
                }
            }
        };

        handleExplanation().catch(error => {
            console.error('Unhandled error in handleExplanation:', error);
            sendResponse({
                success: false,
                error: '未知错误',
                data: null,
                originalError: typeof error !== 'undefined' ? error.message : '未定义变量' // For debugging
            });
        });
        return true; // Keep message channel open
    }

    return true; // Keep message channel open for async response
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-search-popup") {
    // Query the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        console.log(`[Background] Sending toggleSearchPopup to tab ${tabs[0].id}`);
        // Send a message to the content script in the active tab
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggleSearchPopup" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending message to content script:", chrome.runtime.lastError.message);
            // Handle error, maybe the content script hasn't loaded yet
          } else {
            console.log("Message sent to content script:", response);
          }
        });
      } else {
        console.error("Could not get active tab ID.");
      }
    });
  }
});

// ... existing code ...
