// 翻译API配置 - 使用免费的翻译服务
const TRANSLATE_API = 'https://api.mymemory.translated.net/get';
// 音标API配置 - 使用免费的字典服务
const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

// 存储选中的文本
let selectedText = '';
let selectedRange = null;
let translationPopup = null;
let clickTooltip = null;

// 缓存
const translationCache = new Map();
const phoneticCache = new Map();

// 防抖定时器
let highlightDebounceTimer = null;
let selectionDebounceTimer = null;

// 初始化：加载已翻译的单词并高亮显示
async function initHighlighting() {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  
  // 高亮显示已翻译的单词
  highlightTranslatedWords(words);
}

// 高亮显示已翻译的单词（只高亮单词和词组）
function highlightTranslatedWords(words) {
  const body = document.body;
  if (!body) return;
  
  // 移除之前的高亮
  const existingHighlights = document.querySelectorAll('.translated-word-highlight');
  existingHighlights.forEach(el => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });
  
  // 只处理单词和词组类型
  const wordKeys = Object.keys(words).filter(word => {
    const wordData = words[word];
    return wordData.type === 'word' || wordData.type === 'phrase';
  });
  
  // 为每个已翻译的单词创建高亮
  wordKeys.forEach(word => {
    const wordLower = word.toLowerCase();
    const wordData = words[word];
    const posClass = getPartOfSpeechClass(wordData.partOfSpeech || '');
    const regex = new RegExp(`\\b${escapeRegExp(wordLower)}\\b`, 'gi');
    
    walkTextNodes(body, (node) => {
      // 跳过已经高亮的节点或其父节点
      if (node.parentElement && node.parentElement.classList.contains('translated-word-highlight')) {
        return;
      }
      
      // 跳过高亮元素内的文本节点
      let parent = node.parentElement;
      while (parent && parent !== body) {
        if (parent.classList && parent.classList.contains('translated-word-highlight')) {
          return;
        }
        parent = parent.parentElement;
      }
      
      if (node.nodeType === Node.TEXT_NODE && node.textContent.match(regex)) {
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        const text = node.textContent;
        
        while ((match = regex.exec(text)) !== null) {
          // 添加匹配前的文本
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
          }
          
          // 创建高亮元素
          const highlight = document.createElement('span');
          highlight.className = `translated-word-highlight ${posClass}`;
          highlight.textContent = match[0];
          highlight.dataset.word = wordLower;
          highlight.dataset.translation = words[word].translation;
          highlight.dataset.count = words[word].count;
          if (wordData.partOfSpeech) {
            highlight.dataset.partOfSpeech = wordData.partOfSpeech;
          }
          
          // 添加点击事件
          highlight.addEventListener('click', handleHighlightClick);
          
          fragment.appendChild(highlight);
          
          lastIndex = regex.lastIndex;
        }
        
        // 添加剩余的文本
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
        
        node.parentNode.replaceChild(fragment, node);
      }
    });
  });
}

// 转义正则表达式特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 判断是否为单词或词组（只包含字母、空格、连字符、撇号）
function isWordOrPhrase(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  
  // 只包含字母、空格、连字符、撇号的文本被认为是单词或词组
  // 且不能是纯空格
  const wordPattern = /^[a-zA-Z\s\-']+$/;
  return wordPattern.test(trimmed) && trimmed.replace(/\s/g, '').length > 0;
}

// 遍历文本节点
function walkTextNodes(node, callback) {
  if (node.nodeType === Node.TEXT_NODE) {
    callback(node);
  } else {
    const children = Array.from(node.childNodes);
    children.forEach(child => walkTextNodes(child, callback));
  }
}

// 翻译文本（带缓存，优先使用有道，失败时回退到 MyMemory）
async function translateText(text) {
  const cacheKey = text.toLowerCase().trim();
  
  // 检查缓存
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }
  
  // 1. 优先尝试使用 background.js 中的有道翻译
  try {
    const youdaoResp = await chrome.runtime.sendMessage({
      type: 'YOUDAO_TRANSLATE',
      text
    });
    
    if (youdaoResp && youdaoResp.ok && youdaoResp.result && youdaoResp.result.translation) {
      const translation = youdaoResp.result.translation;
      // 缓存结果
      translationCache.set(cacheKey, translation);
      return translation;
    }
  } catch (err) {
    console.error('Youdao 翻译失败，将回退到 MyMemory:', err);
  }
  
  // 2. 回退到 MyMemory（原有逻辑）
  try {
    const response = await fetch(`${TRANSLATE_API}?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
    const data = await response.json();
    
    let translation = '翻译失败';
    if (data.responseData && data.responseData.translatedText) {
      translation = data.responseData.translatedText;
    }
    
    // 缓存结果
    translationCache.set(cacheKey, translation);
    return translation;
  } catch (error) {
    console.error('MyMemory 翻译错误:', error);
    return '翻译失败';
  }
}

// 获取单词音标和词性（带缓存）
async function getPhoneticAndPartOfSpeech(word) {
  const cacheKey = word.toLowerCase().trim();
  
  // 检查缓存
  if (phoneticCache.has(cacheKey)) {
    return phoneticCache.get(cacheKey);
  }
  
  try {
    const response = await fetch(`${DICTIONARY_API}${encodeURIComponent(word)}`);
    const data = await response.json();
    
    let result = { phonetic: null, partOfSpeech: null };
    
    if (Array.isArray(data) && data.length > 0) {
      const entry = data[0];
      
      // 获取音标
      result.phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text;
      
      // 获取词性（通常在第一 meanings 的第一个 definition 中）
      if (entry.meanings && entry.meanings.length > 0) {
        result.partOfSpeech = entry.meanings[0].partOfSpeech || null;
      }
    }
    
    // 缓存结果（包括null）
    phoneticCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('获取音标和词性错误:', error);
    const result = { phonetic: null, partOfSpeech: null };
    phoneticCache.set(cacheKey, result);
    return result;
  }
}

// 获取单词音标（兼容旧代码）
async function getPhonetic(word) {
  const result = await getPhoneticAndPartOfSpeech(word);
  return result.phonetic;
}

// 处理高亮单词点击
async function handleHighlightClick(e) {
  e.stopPropagation(); // 阻止事件冒泡
  e.preventDefault(); // 阻止默认行为
  
  const highlight = e.target;
  const word = highlight.dataset.word;
  const translation = highlight.dataset.translation;
  
  // 增加翻译次数
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  const wordLower = word.toLowerCase();
  
  if (words[wordLower]) {
    // 增加计数
    words[wordLower].count += 1;
    words[wordLower].lastUsed = new Date().toISOString();
    await chrome.storage.local.set({ translatedWords: words });
    
    // 获取更新后的计数
    const updatedCount = words[wordLower].count;
    
    // 优先从存储中获取词性，如果没有则从API获取
    let partOfSpeech = words[wordLower].partOfSpeech || highlight.dataset.partOfSpeech;
    
    // 获取音标和词性（如果还没有缓存）
    let phonetic = highlight.dataset.phonetic;
    
    if (!phonetic || (!partOfSpeech && !highlight.dataset.partOfSpeech)) {
      const phoneticData = await getPhoneticAndPartOfSpeech(word);
      if (phoneticData.phonetic) {
        phonetic = phoneticData.phonetic;
        highlight.dataset.phonetic = phonetic;
      }
      if (phoneticData.partOfSpeech) {
        partOfSpeech = phoneticData.partOfSpeech;
        highlight.dataset.partOfSpeech = partOfSpeech;
        // 更新存储中的词性
        words[wordLower].partOfSpeech = partOfSpeech;
        await chrome.storage.local.set({ translatedWords: words });
      }
    }
    
    // 如果存储中有词性但dataset中没有，更新dataset
    if (words[wordLower].partOfSpeech && !highlight.dataset.partOfSpeech) {
      partOfSpeech = words[wordLower].partOfSpeech;
      highlight.dataset.partOfSpeech = partOfSpeech;
    }
    
    // 先显示提示框（使用当前元素位置，避免重新高亮后位置变化）
    showClickTooltip(highlight, word, translation, updatedCount, phonetic, partOfSpeech);
    
    // 然后重新高亮显示以更新所有高亮元素的计数和dataset
    // 使用延迟确保提示框已经显示
    setTimeout(() => {
      highlightTranslatedWords(words);
    }, 100);
  }
}

// 显示点击提示框
function showClickTooltip(element, word, translation, count, phonetic, partOfSpeech) {
  // 移除旧的提示
  if (clickTooltip) {
    clickTooltip.remove();
  }
  
  // 根据词性获取背景颜色类
  const posClass = getPartOfSpeechClass(partOfSpeech);
  
  // 创建新提示
  clickTooltip = document.createElement('div');
  clickTooltip.className = `click-tooltip ${posClass}`;
  
  let phoneticHtml = '';
  if (phonetic) {
    phoneticHtml = `<div class="tooltip-phonetic">${phonetic}</div>`;
  }
  
  let partOfSpeechHtml = '';
  if (partOfSpeech) {
    const posLabel = getPartOfSpeechLabel(partOfSpeech);
    partOfSpeechHtml = `<div class="tooltip-part-of-speech">${posLabel}</div>`;
  }
  
  clickTooltip.innerHTML = `
    <div class="tooltip-header">
      <span class="tooltip-word">${word}</span>
      <button class="tooltip-close">×</button>
    </div>
    ${phoneticHtml}
    ${partOfSpeechHtml}
    <div class="tooltip-translation">${translation}</div>
    <div class="tooltip-count">已翻译 ${count} 次</div>
    <div class="tooltip-actions">
      <button class="tooltip-remove-btn">取消高亮</button>
    </div>
  `;
  
  document.body.appendChild(clickTooltip);
  
  // 定位提示框
  const rect = element.getBoundingClientRect();
  const tooltipRect = clickTooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  let top = rect.bottom + 10;
  
  // 确保提示框不超出视口
  if (left < 10) {
    left = 10;
  } else if (left + tooltipRect.width > viewportWidth - 10) {
    left = viewportWidth - tooltipRect.width - 10;
  }
  
  if (top + tooltipRect.height > viewportHeight - 10) {
    top = rect.top - tooltipRect.height - 10;
  }
  
  clickTooltip.style.left = `${left}px`;
  clickTooltip.style.top = `${top}px`;
  
  // 关闭按钮事件
  const closeBtn = clickTooltip.querySelector('.tooltip-close');
  closeBtn.addEventListener('click', () => {
    clickTooltip.remove();
    clickTooltip = null;
  });
  
  // 取消高亮按钮事件
  const removeBtn = clickTooltip.querySelector('.tooltip-remove-btn');
  removeBtn.addEventListener('click', async () => {
    await removeWordHighlight(word);
    if (clickTooltip) {
      clickTooltip.remove();
      clickTooltip = null;
    }
  });
  
  // 点击外部关闭
  setTimeout(() => {
    const closeOnClickOutside = (e) => {
      if (!clickTooltip.contains(e.target) && !element.contains(e.target)) {
        clickTooltip.remove();
        clickTooltip = null;
        document.removeEventListener('click', closeOnClickOutside);
      }
    };
    document.addEventListener('click', closeOnClickOutside);
  }, 100);
}

// 删除单词高亮
async function removeWordHighlight(word) {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  
  const wordLower = word.toLowerCase();
  if (words[wordLower]) {
    delete words[wordLower];
    await chrome.storage.local.set({ translatedWords: words });
    
    // 重新高亮显示（会移除该单词的高亮）
    highlightTranslatedWords(words);
  }
}

// 保存翻译记录
async function saveTranslation(word, translation, partOfSpeech = null) {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  
  const wordLower = word.toLowerCase().trim();
  const isWordPhrase = isWordOrPhrase(word);
  const type = isWordPhrase ? (word.trim().split(/\s+/).length === 1 ? 'word' : 'phrase') : 'sentence';
  
  if (words[wordLower]) {
    words[wordLower].count += 1;
    words[wordLower].lastUsed = new Date().toISOString();
    // 如果之前没有词性，现在有了，则更新
    if (partOfSpeech && !words[wordLower].partOfSpeech) {
      words[wordLower].partOfSpeech = partOfSpeech;
    }
  } else {
    words[wordLower] = {
      word: wordLower,
      translation: translation,
      count: 1,
      type: type,
      partOfSpeech: partOfSpeech,
      firstUsed: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };
  }
  
  await chrome.storage.local.set({ translatedWords: words });
  
  // 只对单词和词组进行高亮
  if (isWordPhrase) {
    highlightTranslatedWords(words);
  }
}

// 获取词性标签（中文）
function getPartOfSpeechLabel(partOfSpeech) {
  const labels = {
    'noun': '名词',
    'verb': '动词',
    'adjective': '形容词',
    'adverb': '副词',
    'pronoun': '代词',
    'preposition': '介词',
    'conjunction': '连词',
    'interjection': '感叹词',
    'determiner': '限定词',
    'article': '冠词',
    'numeral': '数词',
    'auxiliary': '助动词',
    'modal': '情态动词'
  };
  return labels[partOfSpeech.toLowerCase()] || partOfSpeech;
}

// 根据词性获取CSS类名
function getPartOfSpeechClass(partOfSpeech) {
  if (!partOfSpeech) return 'pos-default';
  
  const pos = partOfSpeech.toLowerCase();
  const classMap = {
    'noun': 'pos-noun',
    'verb': 'pos-verb',
    'adjective': 'pos-adjective',
    'adverb': 'pos-adverb',
    'pronoun': 'pos-pronoun',
    'preposition': 'pos-preposition',
    'conjunction': 'pos-conjunction',
    'interjection': 'pos-interjection',
    'determiner': 'pos-determiner',
    'article': 'pos-article',
    'numeral': 'pos-numeral',
    'auxiliary': 'pos-auxiliary',
    'modal': 'pos-modal'
  };
  
  return classMap[pos] || 'pos-default';
}

// 显示翻译弹窗（使用与点击高亮单词相同的样式）
async function showTranslationPopup(text, translation, x, y, count = 1) {
  // 移除旧的弹窗和提示框
  if (translationPopup) {
    translationPopup.remove();
    translationPopup = null;
  }
  if (clickTooltip) {
    clickTooltip.remove();
    clickTooltip = null;
  }
  
  const isWordPhrase = isWordOrPhrase(text);
  const wordLower = text.toLowerCase().trim();
  
  // 获取音标和词性（如果还没有缓存）
  let phonetic = null;
  let partOfSpeech = null;
  if (isWordPhrase) {
    const phoneticData = await getPhoneticAndPartOfSpeech(wordLower);
    phonetic = phoneticData.phonetic;
    partOfSpeech = phoneticData.partOfSpeech;
  }
  
  // 创建一个虚拟元素用于定位（模拟高亮元素的位置）
  const virtualElement = {
    getBoundingClientRect: () => ({
      left: x,
      top: y,
      right: x + 100,
      bottom: y + 20,
      width: 100,
      height: 20
    })
  };
  
  // 根据词性获取背景颜色类
  const posClass = getPartOfSpeechClass(partOfSpeech);
  
  // 使用与点击高亮单词相同的提示框样式
  clickTooltip = document.createElement('div');
  clickTooltip.className = `click-tooltip ${posClass}`;
  
  let phoneticHtml = '';
  if (phonetic) {
    phoneticHtml = `<div class="tooltip-phonetic">${phonetic}</div>`;
  }
  
  let partOfSpeechHtml = '';
  if (partOfSpeech) {
    const posLabel = getPartOfSpeechLabel(partOfSpeech);
    partOfSpeechHtml = `<div class="tooltip-part-of-speech">${posLabel}</div>`;
  }
  
  // 只有单词和词组才显示"取消高亮"按钮
  let removeBtnHtml = '';
  if (isWordPhrase) {
    removeBtnHtml = `
      <div class="tooltip-actions">
        <button class="tooltip-remove-btn">取消高亮</button>
      </div>
    `;
  }
  
  clickTooltip.innerHTML = `
    <div class="tooltip-header">
      <span class="tooltip-word">${text}</span>
      <button class="tooltip-close">×</button>
    </div>
    ${phoneticHtml}
    ${partOfSpeechHtml}
    <div class="tooltip-translation">${translation}</div>
    <div class="tooltip-count">已翻译 ${count} 次</div>
    ${removeBtnHtml}
  `;
  
  document.body.appendChild(clickTooltip);
  
  // 定位提示框
  const rect = virtualElement.getBoundingClientRect();
  const tooltipRect = clickTooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  let top = rect.bottom + 10;
  
  // 确保提示框不超出视口
  if (left < 10) {
    left = 10;
  } else if (left + tooltipRect.width > viewportWidth - 10) {
    left = viewportWidth - tooltipRect.width - 10;
  }
  
  if (top + tooltipRect.height > viewportHeight - 10) {
    top = rect.top - tooltipRect.height - 10;
  }
  
  clickTooltip.style.left = `${left}px`;
  clickTooltip.style.top = `${top}px`;
  
  // 关闭按钮事件
  const closeBtn = clickTooltip.querySelector('.tooltip-close');
  closeBtn.addEventListener('click', () => {
    clickTooltip.remove();
    clickTooltip = null;
  });
  
  // 取消高亮按钮事件（只有单词和词组才有）
  if (isWordPhrase) {
    const removeBtn = clickTooltip.querySelector('.tooltip-remove-btn');
    removeBtn.addEventListener('click', async () => {
      await removeWordHighlight(wordLower);
      if (clickTooltip) {
        clickTooltip.remove();
        clickTooltip = null;
      }
    });
  }
  
  // 点击外部关闭
  setTimeout(() => {
    const closeOnClickOutside = (e) => {
      if (!clickTooltip.contains(e.target)) {
        clickTooltip.remove();
        clickTooltip = null;
        document.removeEventListener('click', closeOnClickOutside);
      }
    };
    document.addEventListener('click', closeOnClickOutside);
  }, 100);
  
  // 为了兼容性，也设置 translationPopup 引用
  translationPopup = clickTooltip;
}

// 获取纯文本内容（排除高亮元素，正确处理跨节点选择）
function getPlainTextFromSelection(selection) {
  const range = selection.getRangeAt(0);
  
  // 使用 cloneContents 克隆选择内容
  const clonedRange = range.cloneContents();
  const div = document.createElement('div');
  div.appendChild(clonedRange);
  
  // 移除所有高亮元素的标签，但保留文本内容
  const highlights = div.querySelectorAll('.translated-word-highlight');
  highlights.forEach(highlight => {
    const textNode = document.createTextNode(highlight.textContent);
    if (highlight.parentNode) {
      highlight.parentNode.replaceChild(textNode, highlight);
    }
  });
  
  // 获取纯文本（会自动合并相邻的文本节点）
  const text = div.textContent || div.innerText || '';
  return text.trim();
}

// 处理文本选择（保存选择，等待回车键）
function handleTextSelection() {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  if (text && text.length > 0 && text.length < 100) {
    // 检查选择是否完全在高亮元素内（点击高亮单词的情况）
    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    // 检查起始和结束节点是否在高亮元素内
    let isInHighlight = false;
    
    // 检查起始节点
    let node = startContainer.nodeType === Node.TEXT_NODE ? startContainer.parentElement : startContainer;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('translated-word-highlight')) {
        isInHighlight = true;
        break;
      }
      node = node.parentElement;
    }
    
    // 如果不在高亮元素内，检查结束节点
    if (!isInHighlight) {
      node = endContainer.nodeType === Node.TEXT_NODE ? endContainer.parentElement : endContainer;
      while (node && node !== document.body) {
        if (node.classList && node.classList.contains('translated-word-highlight')) {
          isInHighlight = true;
          break;
        }
        node = node.parentElement;
      }
    }
    
    // 如果完全在高亮元素内，不处理（这是点击高亮单词的情况）
    if (isInHighlight && range.startContainer === range.endContainer) {
      return;
    }
    
    // 保存选择和文本
    selectedRange = range.cloneRange();
    selectedText = getPlainTextFromSelection(selection).trim();
    
    // 不自动翻译，等待用户按回车键
    // 可以在这里显示一个提示，告诉用户按回车键翻译
  }
}

// 执行翻译（按回车键后调用）
async function executeTranslation() {
  if (!selectedText || !selectedRange) {
    return;
  }
  
  const text = selectedText;
  const range = selectedRange;
  
  // 获取选择的位置
  const rect = range.getBoundingClientRect();
  
  // 翻译文本
  const translation = await translateText(text);
  
  // 检查是否已存在记录
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  const wordLower = text.toLowerCase().trim();
  const existingWord = words[wordLower];
  const count = existingWord ? existingWord.count + 1 : 1;
  
  // 获取词性信息（如果是单词或词组）
  let partOfSpeech = null;
  const isWordPhrase = isWordOrPhrase(text);
  if (isWordPhrase) {
    const phoneticData = await getPhoneticAndPartOfSpeech(wordLower);
    partOfSpeech = phoneticData.partOfSpeech;
  }
  
  // 保存翻译记录（包含词性）
  await saveTranslation(text, translation, partOfSpeech);
  
  // 显示翻译弹窗（包含音标、词性和次数）
  await showTranslationPopup(text, translation, rect.left, rect.bottom, count);
  
  // 清除选择
  const selection = window.getSelection();
  selection.removeAllRanges();
  
  // 清除保存的选择
  selectedText = '';
  selectedRange = null;
}

// 监听鼠标抬起事件（完成选择）
document.addEventListener('mouseup', async (e) => {
  // 清除之前的定时器
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer);
  }
  
  // 防抖处理
  selectionDebounceTimer = setTimeout(() => {
    const selection = window.getSelection();
    if (selection.toString().trim().length > 0) {
      handleTextSelection();
    }
  }, 150);
});

// 监听键盘事件（回车键触发翻译）
document.addEventListener('keydown', async (e) => {
  // 检查是否按下了回车键
  if (e.key === 'Enter' && selectedText && selectedRange) {
    // 检查是否有输入框或文本区域处于焦点状态
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );
    
    // 如果输入框没有焦点，才执行翻译
    if (!isInputFocused) {
      e.preventDefault();
      await executeTranslation();
    }
  }
  
  // ESC键清除选择
  if (e.key === 'Escape' && selectedText) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selectedText = '';
    selectedRange = null;
  }
});

// 页面加载完成后初始化高亮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHighlighting);
} else {
  initHighlighting();
}

// 监听DOM变化（当前版本关闭自动重新高亮以提升性能并避免影响选区）
// 如需对高度动态的页面启用自动高亮，可以将 childList / subtree 设置为 true 并在回调中调用 initHighlighting。
const observer = new MutationObserver(() => {
  // 保留空回调，占位，不在 DOM 变化时自动重新高亮
});

observer.observe(document.body, {
  childList: false,
  subtree: false
});

