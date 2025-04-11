// Global variables for API configuration
let apiEndpoint = '';
let apiKey = '';
let model = '';
let activeControllers = new Map(); // Track active requests

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
    await loadApiSettings();
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
function createPrompt(model, selectedText, context, metadata) {
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

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
        return true;
    } else if (request.action === 'explainWord') {
        const { selectedText, context, metadata, requestId } = request;

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

                // Create prompt for API
                const prompt = createPrompt(apiSettings.model, selectedText, context, metadata);
                console.log('Background: created prompt', JSON.stringify(prompt, null, 2));
                
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
