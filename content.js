let popup = null;

// Listen for copy events
document.addEventListener('copy', () => {
  const selectedText = window.getSelection().toString().trim();
  if (selectedText) {
    chrome.runtime.sendMessage({ action: 'storeCopiedText', text: selectedText });
  }
});
let selectedText = "";
let contextText = "";

// Create popup HTML
function createPopup() {
  const popup = document.createElement("div");
  popup.id = "context-dict-popup";
  popup.className = "context-dict-extension";
  // 添加 Material Icons 字体
  if (!document.querySelector('link[href*="material-icons"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/icon?family=Material+Icons";
    document.head.appendChild(link);

    // 确保字体加载完成
    const style = document.createElement("style");
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
  if (!selection.rangeCount) return "";

  const range = selection.getRangeAt(0);
  const paragraph = range.commonAncestorContainer.parentElement;

  // Get the full paragraph text
  let context = paragraph.textContent.trim();

  // If the paragraph is too long, get a window around the selected text
  if (context.length > 1000) {
    const selectionStart = context.indexOf(selectedText);
    if (selectionStart !== -1) {
      const contextStart = Math.max(0, selectionStart - 200);
      const contextEnd = Math.min(
        context.length,
        selectionStart + selectedText.length + 200
      );
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
    language: document.documentElement.lang || "en",
  };
}

// Helper function to get context from the current page
function getContextFromCurrentPage(selectedText) {
  // Reuse existing functions
  const context = getSurroundingContext(selectedText);
  const metadata = getPageMetadata();
  return {
    type: 'currentPage',
    context: context,
    metadata: metadata
  };
}

// Placeholder for getting context from bookmarks (requires background script)
async function getContextFromBookmarks(selectedText) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "searchBookmarks", query: selectedText },
      (response) => {
        resolve({
          type: 'bookmarks',
          urls: response && response.success ? response.data : []
        });
      }
    );
  });
}

// Placeholder for getting context from history (requires background script)
async function getContextFromHistory(selectedText) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: "searchHistory", query: selectedText },
      (response) => {
        resolve({
          type: 'history',
          urls: response && response.success ? response.data : []
        });
      }
    );
  });
}

// Show loading popup
async function showLoadingPopup(selectedText, type = "explain") { // Make async to handle potential awaits
  let popup = document.getElementById("context-dict-popup");
  if (!popup) {
    popup = createPopup();
    document.body.appendChild(popup);
    setupPopupEventListeners(popup);

    // Add close button event listener
    const closeBtn = popup.querySelector(".close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        // Send cancel request message to background
        chrome.runtime.sendMessage({
          action: "cancelRequest",
          requestId: window.currentRequestId,
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

  // Position popup near selection
  positionPopup(popup);
  // Reset and show popup
  popup.querySelector(".loading-section").style.display = "block";
  popup.querySelector(".content-section").style.display = "none";
  const spinner = popup.querySelector(".loading-spinner");
  if (spinner) {
    spinner.style.display = "block";
  }
  const loadingText = popup.querySelector(".loading-text");
  if (loadingText) {
    loadingText.textContent = "正在查询中...";
    loadingText.style.color = "";
  }
  popup.classList.add("show");

  // 显示加载状态
  showLoading();
  // Store request ID for cancellation
  window.currentRequestId = Date.now().toString();

  let contextData = {
    sources: [] // To store context from different sources for search
  };
  let action = "explainWord";

  if (type === "explain") {
      contextData.sources.push(getContextFromCurrentPage(selectedText));
  } else if (type === "search") {
    action = "search";
    // Get context based on selected context types (assuming selectedContexts is accessible)
    console.log('Search initiated with selected contexts:', selectedContexts);
    const contextPromises = [];
    if (selectedContexts && selectedContexts.length > 0) {
        selectedContexts.forEach(ctx => {
            if (ctx.id === 'currentPage') {
                // Directly get current page context (synchronous)
                contextData.sources.push(getContextFromCurrentPage(selectedText));
            } else if (ctx.id === 'bookmarks') {
                // Add promise for bookmark search
                contextPromises.push(getContextFromBookmarks(selectedText));
            } else if (ctx.id === 'history') {
                // Add promise for history search
                contextPromises.push(getContextFromHistory(selectedText));
            } else {
                // Handle unknown context type
                console.warn(`Unknown context type: ${ctx.id}`);
            }
            // Add more context types here if needed
        });
    }

    // Wait for all async context retrievals to complete
    if (contextPromises.length > 0) {
        const results = await Promise.all(contextPromises);
        contextData.sources = contextData.sources.concat(results);
    }
    console.log('Aggregated context for search:', contextData);
  }

  console.log('Content script: preparing to send message', {
      action,
      selectedText,
      context: contextData // Send aggregated context
  });

  // Send message to background script to make API request
  chrome.runtime.sendMessage(
    {
      action: action,
      selectedText,
      context: contextData, // Send the modified context object
      requestId: window.currentRequestId,
    },
    async (response) => {
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
        showErrorInPopup(popup, "与后台脚本通信失败");
        return;
      }
      if (!response.success) {
        // console.info('Content script: error from background:', response.error);
        showErrorInPopup(popup, response.error || "请求处理失败");
        return;
      }
      showContentPopup(response.data);
    }
  );
}

// Load marked.js from lib directory
function loadMarked() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("lib/marked.min.js");
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Setup streaming response handler
function setupStreamingResponse(popup, initialData) {
  let accumulatedContent = initialData.markdown || "";

  // Show initial content
  updateStreamingContent(popup, {
    word: initialData.word,
    markdown: accumulatedContent,
  });

  // Listen for streaming updates
  chrome.runtime.onMessage.addListener(function streamingListener(request) {
    // console.group('处理流式更新');
    // console.log('收到请求:', request);

    if (request.action === "streamUpdate" && request.data) {
      try {
        const chunk = request.data.chunk;
        // console.log('原始数据块:', chunk);
        if (!chunk) {
          // console.log('数据块为空，跳过处理');
          // console.groupEnd();
          return;
        }

        // 处理 SSE 格式的数据
        const lines = chunk.split("\n");
        // console.log('分割后的行数:', lines.length);
        // console.log('分割后的行:', lines);

        for (const line of lines) {
          // console.log('处理行:', line);
          if (line.startsWith("data: ")) {
            try {
              if (line.trim() === "data: [DONE]") {
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
                if (
                  delta.reasoning_content !== undefined &&
                  delta.reasoning_content !== null
                ) {
                  // console.log('发现思考过程:', delta.reasoning_content);
                  if (
                    !accumulatedContent.includes("<!-- reasoning-start -->")
                  ) {
                    accumulatedContent += "\n<!-- reasoning-start -->\n";
                  }
                  accumulatedContent += delta.reasoning_content;
                } else if (
                  delta.content !== undefined &&
                  delta.content !== null
                ) {
                  // console.log('发现回答内容:', delta.content);
                  if (
                    accumulatedContent.includes("<!-- reasoning-start -->") &&
                    !accumulatedContent.includes("<!-- reasoning-end -->")
                  ) {
                    accumulatedContent += "\n<!-- reasoning-end -->\n";
                  }
                  accumulatedContent += delta.content;
                }

                if (
                  (delta.reasoning_content !== undefined &&
                    delta.reasoning_content !== null) ||
                  (delta.content !== undefined && delta.content !== null)
                ) {
                  updateStreamingContent(popup, {
                    word: initialData.word,
                    markdown: accumulatedContent,
                  });
                } else {
                  // console.log('未找到有效的内容字段 delta:', delta);
                }
              }
            } catch (e) {
              console.error("解析数据块失败:", e);
              console.error("问题行:", line);
              console.error("完整错误:", e.stack);
              continue; // 继续处理下一行
            }
          }
          //  else {
          // console.log('行不是以data:开头，跳过:', line);
          // }
        }
      } catch (e) {
        console.error("处理流式数据失败:", e);
        showErrorInPopup(popup, "处理响应数据失败: " + e.message);
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
      popup = document.getElementById("context-dict-popup");
      if (!popup) return;
    }

    // Update word text if needed
    const wordText = popup.querySelector(".word-text");
    if (wordText && data.word) {
      wordText.textContent = data.word;
    }

    // Update markdown content
    const markdownContent = popup.querySelector(".markdown-content");
    if (!markdownContent) return;

    // Calculate dynamic height
    const contentHeight = markdownContent.scrollHeight;
    const windowHeight = window.innerHeight;
    const maxHeight = Math.min(windowHeight * 0.8, contentHeight + 100); // 100px padding
    popup.style.maxHeight = `${maxHeight}px`;

    // Store current scroll position and check if we're at the bottom
    const isAtBottom =
      markdownContent.scrollHeight - markdownContent.scrollTop <=
      markdownContent.clientHeight + 50;

    // Render markdown using marked.js
    const htmlContent = marked.parse(data.markdown);
    markdownContent.innerHTML = htmlContent;

    // Process reasoning section
    const reasoningStart = markdownContent.innerHTML.indexOf(
      "<!-- reasoning-start -->"
    );
    const reasoningEnd = markdownContent.innerHTML.indexOf(
      "<!-- reasoning-end -->"
    );

    if (reasoningStart !== -1) {
      // Extract reasoning content
      const beforeReasoning = markdownContent.innerHTML.substring(
        0,
        reasoningStart
      );
      let reasoningContent = markdownContent.innerHTML.substring(
        reasoningStart,
        reasoningEnd !== -1
          ? reasoningEnd + "<!-- reasoning-end -->".length
          : undefined
      );
      const afterReasoning =
        reasoningEnd !== -1
          ? markdownContent.innerHTML.substring(
              reasoningEnd + "<!-- reasoning-end -->".length
            )
          : "";

      // Replace HTML comments with div and add toggle button
      reasoningContent = reasoningContent
        .replace(
          "<!-- reasoning-start -->",
          '<div class="reasoning-section"><button class="toggle-reasoning" aria-label="切换思考过程显示"></button>'
        )
        .replace("<!-- reasoning-end -->", "</div>");

      // Update content
      markdownContent.innerHTML =
        beforeReasoning + reasoningContent + afterReasoning;

      // Add click handler to toggle reasoning section
      const reasoningSection =
        markdownContent.querySelector(".reasoning-section");
      const toggleButton = reasoningSection?.querySelector(".toggle-reasoning");

      if (toggleButton) {
        toggleButton.addEventListener("click", function (e) {
          e.stopPropagation(); // 阻止事件冒泡
          const section = this.closest(".reasoning-section");
          if (section) {
            section.classList.toggle("collapsed");
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
          behavior: "smooth",
          block: "end",
          inline: "nearest",
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
    const links = markdownContent.getElementsByTagName("a");
    for (let i = 0; i < links.length; i++) {
      links[i].target = "_blank";
      links[i].rel = "noopener noreferrer";
    }

    // Show content section if hidden
    popup.querySelector(".loading-section").style.display = "none";
    popup.querySelector(".content-section").style.display = "block";
  } catch (error) {
    console.error("Error updating streaming content:", error);
  }
}

// Show content popup
async function showContentPopup(data) {
  console.group("Content script: Content Data Validation");
  console.log("Received data:", data);

  // Validate data
  if (!data || typeof data !== "object" || !data.word || !data.markdown) {
    console.error("Content script: invalid data", {
      data: data,
      type: typeof data,
      isArray: Array.isArray(data),
      hasWord: data?.word,
      hasMarkdown: data?.markdown,
    });
    console.groupEnd();
    const popup = document.getElementById("context-dict-popup");
    if (popup) {
      showErrorInPopup(popup, "接收到无效数据");
    }
    return;
  }

  try {
    // Get popup element
    const popup = document.getElementById("context-dict-popup");
    if (!popup) {
      throw new Error("Popup element not found");
    }

    // Update word text
    const wordText = popup.querySelector(".word-text");
    if (wordText) {
      wordText.textContent = data.word;
    }

    // Update markdown content
    const markdownContent = popup.querySelector(".markdown-content");
    if (!markdownContent) {
      throw new Error("找不到内容容器");
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
      const links = markdownContent.getElementsByTagName("a");
      for (let i = 0; i < links.length; i++) {
        links[i].target = "_blank";
        links[i].rel = "noopener noreferrer";
      }
    } catch (error) {
      console.error("Error rendering markdown:", error);
      throw new Error("渲染内容失败");
    }

    // Hide loading and show content
    popup.querySelector(".loading-section").style.display = "none";
    popup.querySelector(".content-section").style.display = "block";

    // Add click event listeners
    setupPopupEventListeners(popup);

    // 添加滚动事件监听
    window._popupScrollHandler = () => {
      if (popup && popup.style.display !== "none") {
        requestAnimationFrame(() => updatePopupPosition(popup));
      }
    };

    // 添加滚动和调整大小的事件监听器
    window.addEventListener("scroll", window._popupScrollHandler, {
      passive: true,
    });
    window.addEventListener("resize", window._popupScrollHandler, {
      passive: true,
    });

    console.log("Content updated successfully");
    console.groupEnd();
  } catch (error) {
    console.error("Content script: error updating popup content", error);
    const popup = document.getElementById("context-dict-popup");
    if (popup) {
      showErrorInPopup(popup, error.message || "更新内容时出错");
    }
    console.groupEnd();
  }
}

// 存储最后一次选择的位置
let lastSelectionRect = null;

// Position popup relative to selection
function positionPopup(popup) {
  if (!popup) return;

  // 设置弹窗宽度为视口宽度的90%，最大不超过1000px
  const viewportWidth = window.innerWidth;
  const popupWidth = Math.min(1000, viewportWidth * 0.9);
  popup.style.width = `${popupWidth}px`;
  popup.style.maxWidth = "none";

  // 设置弹窗高度为视口高度的70%，最大不超过600px
  const viewportHeight = window.innerHeight;
  const popupHeight = Math.min(600, viewportHeight * 0.7);
  popup.style.maxHeight = `${popupHeight}px`;

  // 使用固定位置居中显示
  popup.style.position = "fixed";
  popup.style.left = "50%";
  popup.style.top = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.zIndex = "999999";
}

// 更新弹窗位置
function updatePopupPosition(popup) {
  if (!popup) return;

  // 确保弹窗始终居中
  popup.style.position = "fixed";
  popup.style.left = "50%";
  popup.style.top = "50%";
  popup.style.transform = "translate(-50%, -50%)";

  // 设置合适的滚动行为
  const contentHeight = popup.scrollHeight;
  const viewportHeight = window.innerHeight;
  const maxHeight = Math.min(600, viewportHeight * 0.7);

  if (contentHeight > maxHeight) {
    popup.style.overflowY = "auto";
    popup.style.paddingRight = "12px";
  } else {
    popup.style.overflowY = "visible";
    popup.style.paddingRight = "20px";
  }
}

// Setup popup event listeners
function setupPopupEventListeners(popup) {
  // Add click event listener to close button
  popup.querySelector(".close-btn").addEventListener("click", () => {
    popup.classList.remove("show");
  });

  // Add click event listener to close popup when clicking outside
  document.addEventListener("click", function closePopup(e) {
    if (!popup.contains(e.target)) {
      popup.classList.remove("show");
      document.removeEventListener("click", closePopup);
    }
  });
}

// Hide popup
function hidePopup() {
  const popup = document.getElementById("context-dict-popup");
  if (popup) {
    // 移除滚动事件监听器
    if (window._popupScrollHandler) {
      window.removeEventListener("scroll", window._popupScrollHandler);
      window.removeEventListener("resize", window._popupScrollHandler);
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

    popup.classList.remove("show");
    // Reset popup state
    setTimeout(() => {
      if (!popup.classList.contains("show")) {
        popup.querySelector(".loading-section").style.display = "none";
        popup.querySelector(".content-section").style.display = "none";
        const spinner = popup.querySelector(".loading-spinner");
        if (spinner) {
          spinner.style.display = "block";
        }
        const loadingText = popup.querySelector(".loading-text");
        if (loadingText) {
          loadingText.textContent = "正在查询中...";
          loadingText.style.color = "";
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
  if (!selection.rangeCount) return "";

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const paragraph =
    container.nodeType === Node.TEXT_NODE ? container.parentNode : container;

  return paragraph.textContent.trim();
}

// Mock API response data
function getMockData(word, context) {
  return {
    word,
    contextMeaning: `在当前上下文中，"${word}"的含义是：一个特定的术语或概念，它在文本"${context.substring(
      0,
      100
    )}..."中被讨论。`,
    examples: [
      "这是一个使用该词的示例句子。",
      "另一个展示如何正确使用它的例子。",
      "在不同上下文中的第三个例子。",
    ],
    resources: [
      {
        title: "词典定义",
        url: `https://www.zdic.net/hans/${word}`,
        icon: "menu_book",
      },
      {
        title: "使用示例",
        url: `https://www.linguee.com/chinese-english/search?source=auto&query=${word}`,
        icon: "format_quote",
      },
      {
        title: "相关词汇",
        url: `https://www.thesaurus.com/browse/${word}`,
        icon: "account_tree",
      },
    ],
  };
}

// Show loading state
function showLoading() {
  const popup = document.getElementById("context-dict-popup");
  if (!popup) return;

  popup.querySelector(".content-section").style.display = "none";
  popup.querySelector(".loading-section").style.display = "block";
}

// Show error in popup
function showErrorInPopup(popup, message) {
  if (!popup || !popup.classList.contains("show")) return;

  const loadingSection = popup.querySelector(".loading-section");
  const spinner = loadingSection.querySelector(".loading-spinner");
  const loadingText = loadingSection.querySelector(".loading-text");

  // Hide spinner and show error message
  if (spinner) {
    spinner.style.display = "none";
  }
  if (loadingText) {
    loadingText.textContent = message;
    loadingText.style.color = "#ff4444";
  }

  // Hide popup after delay
  setTimeout(() => {
    if (popup && popup.classList.contains("show")) {
      hidePopup();
    }
  }, 2000);
}

// Initialize extension
async function initializeExtension() {
  console.log("Initializing extension...");

  // Preload marked.js
  try {
    await loadMarked();
    console.log("marked.js preloaded successfully");
  } catch (error) {
    console.error("Failed to preload marked.js:", error);
  }

  // Add styles
  const styles = document.createElement("style");
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
  const link = document.createElement("link");
  link.href = "https://fonts.googleapis.com/icon?family=Material+Icons";
  link.rel = "stylesheet";
  document.head.appendChild(link);

  console.log("Extension initialized");
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (!request || !request.action) return;

  try {
    switch (request.action) {
      case "showExplanation":
        if (request.data && request.data.selectedText) {
          showLoadingPopup(request.data.selectedText);
        }
        break;
      case "showContent":
        if (request.data) {
          showContentPopup(request.data);
        }
        break;
      case "showError":
        if (request.error) {
          showErrorInPopup(
            document.getElementById("context-dict-popup"),
            request.error
          );
        }
        break;
      default:
        // console.info('Content script: unknown action received', request.action);
        break;
    }
  } catch (error) {
    console.info("Content script: error handling message", error);
    const popup = document.getElementById("context-dict-popup");
    if (popup) {
      showErrorInPopup(popup, "处理消息时出错");
    }
  }
});

// Hide popup when clicking outside
document.addEventListener("mousedown", function (e) {
  const popup = document.getElementById("context-dict-popup");
  if (popup && !popup.contains(e.target)) {
    chrome.runtime.sendMessage({
      action: "cancelRequest",
      requestId: window.currentRequestId,
    });
    hidePopup();
  }
});

// Initialize extension when DOM is ready
document.addEventListener("DOMContentLoaded", initializeExtension);

// 替换原有的response.json()处理
async function handleResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 处理完整的事件
    while (buffer.includes("\n")) {
      const lineEnd = buffer.indexOf("\n");
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);

      if (line.startsWith("data: ")) {
        try {
          const jsonData = JSON.parse(line.slice(6));
          // 在这里处理每个数据块
          appendToPopup(jsonData.content);
        } catch (e) {
          showErrorInPopup("数据解析错误: " + e.message);
        }
      }
    }
  }
}

function appendToPopup(content) {
  const popup = document.getElementById("context-dict-popup");
  if (!popup) return;

  const markdownContent = popup.querySelector(".markdown-content");
  if (!markdownContent) return;

  markdownContent.innerHTML += content;
}

// Global function to display contexts
function displayContexts() {
  const suggestionsList = document.querySelector("#context-dict-suggestions");
  if (!suggestionsList) return;

  suggestionsList.innerHTML = "";
  availableContexts.forEach((context) => {
    const li = document.createElement("li");
    li.className = "suggestion-item context-item";
    const isSelected = selectedContexts.some((sc) => sc.id === context.id);
    if (isSelected) {
      li.classList.add("selected");
    }
    if (context.disabled) {
      li.classList.add("disabled");
      li.title = context.tooltip || "此选项不可用";
    }
    li.dataset.contextId = context.id;
    li.innerHTML = `
            <span class="material-icons suggestion-icon">${context.icon}</span>
            <span class="suggestion-text">${context.name}</span>
            ${
              isSelected
                ? '<span class="material-icons suggestion-selected-indicator">check</span>'
                : ""
            }
        `;
    li.addEventListener("click", () => {
      if (!context.disabled) {
        toggleContextSelection(context);
      }
    });
    suggestionsList.appendChild(li);
  });
  suggestionsList.style.display = "block";
}

let searchPopup = null;
let isContextSelectionMode = true; // Track if we are selecting context or searching
let selectedContexts = []; // Store selected context objects

// Define available contexts
const availableContexts = [
  { id: "currentPage", name: "当前网页", icon: "description" },
  { id: "history", name: "浏览记录", icon: "history", disabled: true, tooltip: "功能暂未开放" },
  { id: "bookmarks", name: "书签", icon: "bookmark_border", disabled: true, tooltip: "功能暂未开放" },
];

// Function to create the search popup
class SearchPopupManager {
  constructor() {
    this.popup = null;
    this.searchInput = null;
    this.suggestionsList = null;
    this.tagsContainer = null;
    this.selectedSuggestionIndex = -1; // Added for keyboard navigation
    // selectedContexts and isContextSelectionMode are managed globally
  }

  createSearchPopup() {
    if (this.popup) {
      return {
        element: this.popup,
        performSearch: this.performSearch.bind(this),
        toggleContextSelection: this.toggleContextSelection.bind(this),
      };
    }

    if (!document.querySelector('link[href*="material-icons"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/icon?family=Material+Icons";
      document.head.appendChild(link);
    }

    // Inject CSS for selected suggestion item
    const styleId = 'context-dict-selected-suggestion-style';
    if (!document.getElementById(styleId)) {
        const styleElement = document.createElement('style');
        styleElement.id = styleId;
        styleElement.textContent = `
            #context-dict-suggestions .suggestion-item.selected-suggestion {
                background-color: #e0e0e0; /* Light grey background for selected item */
            }
        `;
        document.head.appendChild(styleElement);
    }

    this.popup = document.createElement("div");
    this.popup.id = "context-dict-search-popup";
    this.popup.innerHTML = `
            <div class="search-input-container">
                <div class="search-input-wrapper">
                    <span class="material-icons search-icon">search</span>
                    <div class="context-tags-container"></div>
                    <input type="text" id="context-dict-search-input" placeholder="选择上下文后按 Tab 输入搜索内容...">
                </div>
            </div>
            <ul id="context-dict-suggestions"></ul>
        `;
    document.body.appendChild(this.popup);

    this.searchInput = this.popup.querySelector("#context-dict-search-input");
    this.suggestionsList = this.popup.querySelector("#context-dict-suggestions");
    this.tagsContainer = this.popup.querySelector(".context-tags-container");
    this.isFillingFromSuggestion = false; // Initialize the flag

    this.setupEventListeners();

    return {
      element: this.popup,
      performSearch: this.performSearch.bind(this),
      toggleContextSelection: this.toggleContextSelection.bind(this),
    };
  }

  displaySuggestions(suggestions) {
    console.log('[displaySuggestions] Called with suggestions:', suggestions);
    if (!this.suggestionsList || !this.searchInput) {
        console.log('[displaySuggestions] suggestionsList or searchInput missing, returning.');
        return;
    }
    this.suggestionsList.innerHTML = "";
    this.selectedSuggestionIndex = -1; // Reset selected index

    if (!suggestions || suggestions.length === 0) {
        this.suggestionsList.style.display = "none";
        console.log('[displaySuggestions] No suggestions, hiding list.');
        return;
    }

    suggestions.forEach((item, index) => { // Added index parameter
        if (item && typeof item.title === 'string' && typeof item.icon === 'string') {
            const li = document.createElement("li");
            li.className = "suggestion-item";
            li.dataset.index = index; // Add data-index for identification
            li.innerHTML = `
                <span class="material-icons suggestion-icon">${item.icon}</span>
                <span class="suggestion-text">${item.title}</span>
            `;
            li.addEventListener("click", () => {
                this.searchInput.value = item.title;
                this.searchInput.focus();
                this.suggestionsList.style.display = "none";
                this.selectedSuggestionIndex = -1; // Reset on click
                // Future: if (item.url && (item.type === 'bookmark' || item.type === 'history')) { chrome.tabs.create({ url: item.url }); }
            });
            this.suggestionsList.appendChild(li);
        } else {
            console.warn('[displaySuggestions] Skipping invalid item:', item);
        }
    });
    this.suggestionsList.style.display = "block";
    this.highlightSuggestion(this.selectedSuggestionIndex); // Initial highlight (none)
    console.log(`[displaySuggestions] Setting display to: block`);
  }

  highlightSuggestion(index) {
    if (!this.suggestionsList) return;
    const items = this.suggestionsList.querySelectorAll('.suggestion-item');
    items.forEach((item, idx) => {
        if (idx === index) {
            item.classList.add('selected-suggestion');
            // Scroll into view if needed
            item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else {
            item.classList.remove('selected-suggestion');
        }
    });
  }
  
  async fetchAllSuggestionsAndUpdateDisplay(query = '') {
    if (isContextSelectionMode) { // Global variable
        if (this.suggestionsList) this.suggestionsList.style.display = 'none';
        return;
    }

    const lowerCaseQuery = query.toLowerCase();
    let allSuggestions = [];

    try {
        const results = await Promise.allSettled([
            new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getCopiedTexts' }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error fetching copied texts:", chrome.runtime.lastError.message);
                        resolve([]); return;
                    }
                    if (response && response.success && Array.isArray(response.data)) {
                        resolve(response.data.map(text => ({ title: String(text), type: 'copied', icon: 'content_paste' })));
                    } else {
                        resolve([]);
                    }
                });
            }),
            new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getBookmarks', query: query }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error fetching bookmarks:", chrome.runtime.lastError.message);
                        resolve([]); return;
                    }
                    if (response && response.success && Array.isArray(response.data)) {
                        resolve(response.data.map(bm => ({ title: String(bm.title || bm.url), url: bm.url, type: 'bookmark', icon: 'bookmark' })));
                    } else {
                        resolve([]);
                    }
                });
            }),
            new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getHistory', query: query }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error fetching history:", chrome.runtime.lastError.message);
                        resolve([]); return;
                    }
                    if (response && response.success && Array.isArray(response.data)) {
                        resolve(response.data.map(h => ({ title: String(h.title || h.url), url: h.url, type: 'history', icon: 'history' })));
                    } else {
                        resolve([]);
                    }
                });
            })
        ]);

        results.forEach(result => {
            if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                allSuggestions.push(...result.value);
            } else if (result.status === 'rejected') {
                console.error("A suggestion promise was rejected:", result.reason);
            }
        });
        
        let filteredSuggestions = allSuggestions;
        if (query.trim() !== '') { 
            filteredSuggestions = allSuggestions.filter(item =>
                item.title && item.title.toLowerCase().includes(lowerCaseQuery)
            );
        } 
        
        const uniqueSuggestions = [];
        const seenTitles = new Set();
        for (const item of filteredSuggestions) {
            if (item.title && !seenTitles.has(item.title)) { 
                uniqueSuggestions.push(item);
                seenTitles.add(item.title);
            }
        }
        this.displaySuggestions(uniqueSuggestions.slice(0, 15));
    } catch (error) {
        console.error("Error in fetchAllSuggestionsAndUpdateDisplay:", error);
        this.displaySuggestions([]);
    }
  }

  updateContextTags() {
    if (!this.tagsContainer || !this.searchInput) return;
    this.tagsContainer.innerHTML = "";
    selectedContexts.forEach((context) => { // Global variable
      const tag = document.createElement("div");
      tag.className = "context-tag";
      tag.innerHTML = `
              <span class="material-icons">${context.icon}</span>
              ${context.name}
              <button class="remove-tag-btn" data-context-id="${context.id}" title="移除">&times;</button>
          `;
      tag.querySelector(".remove-tag-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleContextSelection(context);
      });
      this.tagsContainer.appendChild(tag);
    });
    if (selectedContexts.length > 0) { // Global variable
      this.searchInput.placeholder = isContextSelectionMode // Global variable
        ? "按 Tab 输入搜索内容..."
        : "输入搜索内容...";
    } else {
      this.searchInput.placeholder = isContextSelectionMode // Global variable
        ? "选择上下文后按 Tab 输入搜索内容..."
        : "输入搜索内容...";
    }
  }

  toggleContextSelection(context) {
    if (!this.searchInput) return;
    if (context.disabled) {
      return;
    }
    const index = selectedContexts.findIndex((sc) => sc.id === context.id); // Global variable
    if (index > -1) {
      selectedContexts.splice(index, 1); // Global variable
    } else {
      selectedContexts.push(context); // Global variable
    }
    this.updateContextTags();
    displayContexts(); // Global function
    this.searchInput.focus();
  }

  switchToSearchMode() {
    if (!this.suggestionsList || !this.searchInput) return;
    isContextSelectionMode = false; // Global variable
    this.searchInput.placeholder =
      selectedContexts.length > 0 ? "输入搜索内容..." : "输入搜索内容..."; // Global variable
    this.searchInput.focus();
    this.fetchAllSuggestionsAndUpdateDisplay(this.searchInput.value);
  }

  performSearch(term) {
    if (!term) return;
    console.log(
      "Performing search for:",
      term,
      "with contexts:",
      selectedContexts.map((c) => c.name) // Global variable
    );
    chrome.storage.sync.get(['apiKey', 'apiEndpoint'], (settings) => {
      if (!settings.apiKey || !settings.apiEndpoint) {
        console.error("API Key or Endpoint not set.");
        showLoadingPopup(term, "search"); // Global function
        const mainPopup = document.getElementById("context-dict-popup");
        if (mainPopup) {
            showErrorInPopup(mainPopup, "错误：请先在扩展设置中配置 API Key 和 Endpoint"); // Global function
        }
        hideSearchPopup(); // Global function
      } else {
        showLoadingPopup(term, "search"); // Global function
        hideSearchPopup(); // Global function
      }
    });
  }

  setupEventListeners() {
    if (!this.searchInput || !this.suggestionsList) return;

    this.searchInput.addEventListener("input", (e) => {
      if (this.isFillingFromSuggestion) {
        this.isFillingFromSuggestion = false; // Reset flag after it's been checked
        return; // Skip processing for this specific input event
      }
      const query = e.target.value;

      if (query === '') {
        if (!isContextSelectionMode) { // Global variable
          console.log('[Input Event] Input cleared. Switching back to context selection mode.');
          isContextSelectionMode = true; // Global variable
          displayContexts(); // Global function, to show context items as suggestions
          this.updateContextTags();
        } 
        // When input is cleared, hide specific copied text suggestions or show contexts
        // If in context mode, displayContexts() handles it.
        // If it was search mode and cleared, it switches to context mode.
        // To show all copied texts when input is empty in search mode (before switching):
        // else { this.fetchAndDisplayCopiedTextSuggestions(); }
        return;
      }

      if (isContextSelectionMode) { // Global variable
        // If user starts typing while in context selection mode, switch to search mode
        console.log(`[Input Event] Typing in context mode. Query: '${query}'. Switching...`);
        this.switchToSearchMode(); 
        // The character will be in the input, and switchToSearchMode will call fetchAndDisplayCopiedTextSuggestions
        // which will then use the current input value (the typed character).
        return; 
      }
      
      // In search mode, fetch and display suggestions based on input
      this.fetchAllSuggestionsAndUpdateDisplay(query);
    });

    this.searchInput.addEventListener("focus", () => {
        if (this.popup.style.display === 'none') return; // Don't do anything if popup is hidden

        if (!isContextSelectionMode) { // Global variable
            this.fetchAllSuggestionsAndUpdateDisplay(this.searchInput.value);
        } else {
            displayContexts(); // Global function, show context items when focusing in context mode
        }
    });

    this.searchInput.addEventListener("keydown", (e) => {
      if (isContextSelectionMode && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { // Global variable
        console.log(`[Keydown] Printable key '${e.key}' pressed in context mode. Switching...`);
        this.switchToSearchMode();
        return; 
      }

      if (e.key === "Escape") {
        hideSearchPopup(); // Global function
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (isContextSelectionMode) { // Global variable
          console.log('[Tab Keydown] Context mode. Switching to search mode...');
          this.switchToSearchMode();
        } else {
          console.log('[Tab Keydown] Search mode. Refreshing suggestions...');
          // If suggestions are visible and there's a selected one, Tab could also select it.
          // For now, it just refreshes.
          this.fetchAllSuggestionsAndUpdateDisplay(this.searchInput.value);
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (this.suggestionsList.style.display === 'block') {
            e.preventDefault();
            const items = this.suggestionsList.querySelectorAll('.suggestion-item');
            if (items.length > 0) {
                if (e.key === 'ArrowDown') {
                    this.selectedSuggestionIndex = (this.selectedSuggestionIndex + 1) % items.length;
                } else { // ArrowUp
                    this.selectedSuggestionIndex = (this.selectedSuggestionIndex - 1 + items.length) % items.length;
                }
                this.highlightSuggestion(this.selectedSuggestionIndex);
            }
        }
      } else if (e.key === 'Enter') {
        if (!isContextSelectionMode) { // Global variable
            e.preventDefault(); // Prevent default action for Enter early

            const currentSuggestionIndex = this.selectedSuggestionIndex;
            const suggestionsVisible = this.suggestionsList.style.display === 'block';
            const items = this.suggestionsList.querySelectorAll('.suggestion-item');

            if (currentSuggestionIndex > -1 && currentSuggestionIndex < items.length && suggestionsVisible) {
                const selectedItem = items[currentSuggestionIndex];
                const selectedText = selectedItem.querySelector('.suggestion-text').textContent;

                this.isFillingFromSuggestion = true; // Set flag before changing value
                this.searchInput.value = selectedText;
                // The input event handler will now check and reset this.isFillingFromSuggestion
                this.suggestionsList.style.display = 'none';
                this.selectedSuggestionIndex = -1; // Reset selected index
                this.searchInput.focus(); // Ensure input remains focused
                // No search is performed when a suggestion is selected by Enter.
                return; // Crucial: Prevent fall-through to search logic.
            } else {
                // No suggestion selected or suggestions not visible, perform search from input
                const searchTerm = this.searchInput.value.trim();
                if (searchTerm) {
                    this.performSearch(searchTerm);
                }
            }
        }
      }
    });
  }
}

// Singleton instance
const searchPopupManager = new SearchPopupManager();

// Function to show the search popup
function showSearchPopup(rect, hasSelection) {
  console.log('[showSearchPopup] Called with rect:', rect, 'hasSelection:', hasSelection);
  const { element: searchPopup, performSearch, toggleContextSelection } = searchPopupManager.createSearchPopup();
  const searchInput = searchPopup.querySelector('#context-dict-search-input');

  // 重置状态
  isContextSelectionMode = true;
  selectedContexts = [];
  searchPopupManager.updateContextTags();
  searchInput.value = '';

  // 显示弹窗
  searchPopup.style.display = 'block';
  searchPopup.classList.add('show');

  // 自动聚焦输入框 (使用 setTimeout 确保弹窗可见)
  setTimeout(() => {
    if (searchInput) {
      searchInput.focus();
      console.log('[showSearchPopup] Input focused via setTimeout.');
    } else {
      console.error('[showSearchPopup] Search input not found for focusing in setTimeout.');
    }
  }, 50); // 50ms 延迟确保渲染完成

  // 显示上下文选项
  displayContexts();

  // 添加点击外部关闭的监听器
  document.addEventListener('click', handleClickOutsideSearchPopup, true);
}

// Function to hide the search popup
function hideSearchPopup() {
  if (searchPopupManager.popup) {
    searchPopupManager.popup.classList.remove('show'); // Use class to hide
    // Remove direct style manipulation to rely on CSS transitions
    // searchPopupManager.suggestionsList.innerHTML = "";
    // searchPopupManager.suggestionsList.style.display = "none";
    // searchPopupManager.searchInput.value = "";
    // searchPopupManager.tagsContainer.innerHTML = "";
    // Reset selected contexts when popup is fully hidden (optional, might need transitionend event)
    // selectedContexts = [];

    // Consider resetting input/suggestions after transition ends if needed
    searchPopupManager.popup.addEventListener('transitionend', function handleTransitionEnd() {
        if (!searchPopupManager.popup.classList.contains('show')) {
            // Clear content only after fade out is complete
            searchPopupManager.suggestionsList.innerHTML = "";
            searchPopupManager.searchInput.value = "";
            searchPopupManager.tagsContainer.innerHTML = "";
            selectedContexts = []; // Reset selected contexts
        }
        // Remove the listener to avoid multiple executions
        searchPopupManager.popup.removeEventListener('transitionend', handleTransitionEnd);
    });

  }
  document.removeEventListener("click", handleClickOutsideSearchPopup, true);
}

// Handle clicks outside the search popup
function handleClickOutsideSearchPopup(event) {
  if (
    searchPopupManager.popup &&
    !searchPopupManager.popup.contains(event.target)
  ) {
    hideSearchPopup();
  }
}

// Mock data for search suggestions (replace with actual API call)
const mockSuggestions = [
  { title: "Document A", type: "work", url: "/docs/a" },
  { title: "Meeting Notes", type: "work", url: "/notes/meeting" },
  { title: "John Doe", type: "contact", url: "/contacts/john" },
  { title: "GitHub Repo", type: "projectX", url: "https://github.com/user/repo" },
];
window.mockSuggestions = mockSuggestions; // Make available globally if needed by class

// State variables for search popup
// Function to display context options
function displayContexts() {
  if (!searchPopupManager.suggestionsList) return;

  searchPopupManager.suggestionsList.innerHTML = "";
  availableContexts.forEach((context) => {
    const li = document.createElement("li");
    // Use consistent class names with suggestion items for easier styling
    li.className = "suggestion-item context-item"; 
    const isSelected = selectedContexts.some((sc) => sc.id === context.id);
    if (isSelected) {
      li.classList.add("selected");
    }

    if (context.disabled) {
      li.classList.add("disabled");
      li.title = context.tooltip || "此选项当前不可用"; // Add a tooltip for disabled items
    }

    // li.innerHTML = `
    //         <span class="material-icons suggestion-icon">${context.icon}</span>
    //         <span class="suggestion-text">${context.name}</span>
    //         ${isSelected ? '<span class="material-icons suggestion-selected-indicator">check</span>' : ''}
    //     `;
    li.innerHTML = `
            <span class="material-icons suggestion-icon">${context.icon}</span>
            <span class="suggestion-text">${context.name}</span>
        `;
    li.addEventListener("click", () => {
      // Only allow toggling if the context is not disabled
      if (!context.disabled) {
        searchPopupManager.toggleContextSelection(context); // Use the instance method
      }
    });
    searchPopupManager.suggestionsList.appendChild(li);
  });
  searchPopupManager.suggestionsList.style.display = "block";
}

// Listen for messages from the background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleSearchPopup") {
    console.log("[Content] Received toggleSearchPopup message");
    const selection = window.getSelection();
    let rect;
    let hasSelection = false;
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      // Use selection bounds if text is selected
      const range = selection.getRangeAt(0);
      rect = range.getBoundingClientRect();
      hasSelection = true;
    } else {
      // Default position (center of the viewport) if no text is selected
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      // Define a default size or calculate based on expected popup size
      const defaultWidth = 300; // Example width
      const defaultHeight = 200; // Example height
      rect = {
        top: viewportHeight / 2 - defaultHeight / 2,
        left: viewportWidth / 2 - defaultWidth / 2,
        width: defaultWidth,
        height: defaultHeight,
        bottom: viewportHeight / 2 + defaultHeight / 2,
        right: viewportWidth / 2 + defaultWidth / 2,
        x: viewportWidth / 2 - defaultWidth / 2,
        y: viewportHeight / 2 - defaultHeight / 2
      };
      hasSelection = false;
    }
    showSearchPopup(rect, hasSelection); // Show the popup with the determined position and selection status
    // Indicate that the response will be sent asynchronously (or keep the port open)
    return true; 
  }
  // Return true for other potential async messages if needed, or false/undefined otherwise
  // For now, only handling toggleSearchPopup explicitly
  return false; // Explicitly return false if no async operation for other message types
});

// ... existing code ...
