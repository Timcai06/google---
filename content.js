/**
 * 单词翻译助手 - 内容脚本
 *
 * 主要功能：
 * 1. 在网页中注入翻译功能和UI组件
 * 2. 处理文本选择和翻译请求
 * 3. 高亮显示已翻译的单词
 * 4. 管理翻译缓存和用户交互
 * 5. 与后台服务进程通信获取翻译结果
 */

// ====================  
// 配置常量定义  
// ====================  

// 允许运行插件的域名列表
const ALLOWED_DOMAINS = [
  'wikipedia.org',
  'zhihu.com',
  'blog.csdn.net',
  'medium.com',
  'dev.to',
  'stackoverflow.com',
  'github.io',
  'gitbook.io',
  'notion.site'
];

// 翻译API配置 - 使用免费的翻译服务作为备用方案
const TRANSLATE_API = 'https://api.mymemory.translated.net/get';
// 音标API配置 - 使用免费的字典服务获取单词音标和词性
const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

// ====================  
// 全局变量定义  
// ====================

// 存储用户选中的文本内容
let selectedText = '';
// 存储用户选中的文本范围对象，用于后续操作
let selectedRange = null;
// 翻译弹出窗口DOM元素
let translationPopup = null;
// 点击提示工具条DOM元素
let clickTooltip = null;

// ====================
// 缓存系统
// ====================

// 翻译结果缓存 - 避免重复翻译相同文本
const translationCache = new Map();
// 音标信息缓存 - 避免重复查询单词音标
const phoneticCache = new Map();

// ====================
// 防抖定时器
// ====================

// 高亮显示的防抖定时器 - 防止频繁触发高亮更新
let highlightDebounceTimer = null;
// 文本选择的防抖定时器 - 防止频繁触发翻译请求
let selectionDebounceTimer = null;

/**
 * 检查当前域名是否允许运行插件
 * @returns {boolean} 是否允许运行插件
 */
function isDomainAllowed() {
  const hostname = window.location.hostname;
  // 检查当前域名是否在允许列表中
  return ALLOWED_DOMAINS.some(domain => hostname.endsWith(domain));
}

/**
 * 初始化高亮功能
 * 页面加载时自动加载已翻译的单词并进行高亮显示
 */
async function initHighlighting() {
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    console.log('单词翻译助手: 当前域名不允许运行插件');
    return;
  }
  
  // 从Chrome本地存储中获取已翻译的单词数据和用户设置
  const result = await chrome.storage.local.get(['translatedWords', 'userSettings']);
  const words = result.translatedWords || {};
  const settings = result.userSettings || {};

  // 应用自定义颜色设置
  applyCustomColors(settings);

  // 对已翻译的单词进行高亮显示
  highlightTranslatedWords(words);
}

/**
 * 高亮显示已翻译的单词
 * 只对单词和词组类型进行高亮，句子类型不进行高亮
 *
 * @param {Object} words - 已翻译的单词对象，键为单词，值为翻译数据
 */
function highlightTranslatedWords(words) {
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    return;
  }
  
  const body = document.body;
  if (!body) return;

  // 移除之前的所有高亮元素，防止重复高亮
  const existingHighlights = document.querySelectorAll('.translated-word-highlight');
  existingHighlights.forEach(el => {
    const parent = el.parentNode;
    // 将高亮元素替换为纯文本节点
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize(); // 合并相邻的文本节点
  });

  // 只处理单词和词组类型的翻译记录
  let wordKeys = Object.keys(words).filter(word => {
    const wordData = words[word];
    return wordData.type === 'word' || wordData.type === 'phrase';
  });

  // 限制高亮的单词数量，避免过多DOM操作
  const MAX_HIGHLIGHTS = 50; // 每个页面最多高亮50个单词
  wordKeys = wordKeys.slice(0, MAX_HIGHLIGHTS);

  // 为每个已翻译的单词创建高亮显示
  wordKeys.forEach(word => {
    const wordLower = word.toLowerCase();
    const wordData = words[word];
    // 为词组使用特殊的词性样式类
    const posClass = wordData.type === 'phrase' ? 'pos-phrase' : getPartOfSpeechClass(wordData.partOfSpeech || '');
    // 创建区分大小写的正则表达式，用于精确匹配单词边界
    const regex = new RegExp(`\\b${escapeRegExp(wordLower)}\\b`, 'gi');

    // 获取主要内容区域，避免在整个页面进行遍历
    const contentAreas = [
      document.querySelector('main'),
      document.querySelector('article'),
      document.querySelector('.article-content'),
      document.querySelector('.post-content'),
      document.querySelector('.content'),
      document.querySelector('.entry-content'),
      document.querySelector('#content'),
      document.body // 作为最后的备选
    ].filter(Boolean);

    // 只在主要内容区域进行遍历
    contentAreas.forEach(contentArea => {
      // 遍历页面中的所有文本节点
      walkTextNodes(contentArea, (node) => {
        // 跳过已经高亮的节点或其父节点，避免重复处理
        if (node.parentElement && node.parentElement.classList.contains('translated-word-highlight')) {
          return;
        }

        // 跳过高亮元素内部的文本节点
        let parent = node.parentElement;
        while (parent && parent !== contentArea) {
          if (parent.classList && parent.classList.contains('translated-word-highlight')) {
            return;
          }
          parent = parent.parentElement;
        }

        // 跳过脚本、样式、iframe等非文本内容
        if (node.parentElement && ['SCRIPT', 'STYLE', 'IFRAME', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO'].includes(node.parentElement.tagName)) {
          return;
        }

        // 处理文本节点中的单词匹配
        if (node.nodeType === Node.TEXT_NODE && node.textContent.match(regex)) {
          const fragment = document.createDocumentFragment();
          let lastIndex = 0;
          let match;
          const text = node.textContent;

          // 循环处理所有匹配的单词
          while ((match = regex.exec(text)) !== null) {
            // 添加匹配前的文本
            if (match.index > lastIndex) {
              fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            // 创建高亮显示的span元素
            const highlight = document.createElement('span');
            highlight.className = `translated-word-highlight ${posClass}`;
            highlight.textContent = match[0];
            // 存储单词相关数据作为元素属性
            highlight.dataset.word = wordLower;
            highlight.dataset.translation = words[word].translation;
            highlight.dataset.count = words[word].count;
            if (wordData.partOfSpeech) {
              highlight.dataset.partOfSpeech = wordData.partOfSpeech;
            }

            // 移除旧的事件监听器，改为使用事件委托
          // highlight.addEventListener('click', handleHighlightClick);

            fragment.appendChild(highlight);

            lastIndex = regex.lastIndex;
          }

          // 添加剩余的文本内容
          if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
          }

          // 用处理后的片段替换原始文本节点
          node.parentNode.replaceChild(fragment, node);
        }
      });
    });
  });
}

/**
 * 转义正则表达式特殊字符
 * 防止用户输入的文本影响正则表达式的正常工作
 *
 * @param {string} string - 需要转义的字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断文本是否为单词或词组
 * 只包含字母、空格、连字符、撇号的文本被认为是单词或词组
 *
 * @param {string} text - 要判断的文本
 * @returns {boolean} 是否为单词或词组
 */
function isWordOrPhrase(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // 只包含字母、空格、连字符、撇号的文本被认为是单词或词组
  // 且不能是纯空格
  const wordPattern = /^[a-zA-Z\s\-']+$/;
  return wordPattern.test(trimmed) && trimmed.replace(/\s/g, '').length > 0;
}

/**
 * 递归遍历DOM树中的所有文本节点
 * 对每个文本节点执行回调函数
 *
 * @param {Node} node - 要遍历的DOM节点
 * @param {Function} callback - 对每个文本节点执行的回调函数
 */
function walkTextNodes(node, callback) {
  if (node.nodeType === Node.TEXT_NODE) {
    // 如果是文本节点，直接执行回调
    callback(node);
  } else {
    // 如果是元素节点，递归遍历其子节点
    const children = Array.from(node.childNodes);
    children.forEach(child => walkTextNodes(child, callback));
  }
}

/**
 * 翻译文本内容
 * 带缓存功能，优先使用有道翻译，失败时回退到MyMemory翻译服务
 *
 * @param {string} text - 要翻译的文本
 * @returns {Promise<Object>} 翻译结果对象
 */
async function translateText(text) {
  const cacheKey = text.toLowerCase().trim();

  // 检查翻译缓存
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // 1. 优先尝试使用background.js中的有道翻译服务
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

/**
 * 获取单词的音标和词性信息
 * 使用Dictionary API获取单词的发音和词性分类
 *
 * @param {string} word - 要查询的单词
 * @returns {Promise<Object>} 包含音标和词性的对象
 */
async function getPhoneticAndPartOfSpeech(word) {
  const cacheKey = word.toLowerCase().trim();

  // 检查音标缓存，避免重复API调用
  if (phoneticCache.has(cacheKey)) {
    return phoneticCache.get(cacheKey);
  }

  try {
    // 调用Dictionary API获取单词详细信息
    const response = await fetch(`${DICTIONARY_API}${encodeURIComponent(word)}`);
    const data = await response.json();

    let result = { phonetic: null, partOfSpeech: null };

    if (Array.isArray(data) && data.length > 0) {
      const entry = data[0];

      // 提取音标信息（优先使用phonetic字段，否则从phonetics数组中查找）
      result.phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text;

      // 提取词性信息（从第一个释义中获取）
      if (entry.meanings && entry.meanings.length > 0) {
        result.partOfSpeech = entry.meanings[0].partOfSpeech || null;
      }
    }

    // 缓存结果（包括null值）
    phoneticCache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error('获取音标和词性错误:', error);
    const result = { phonetic: null, partOfSpeech: null };
    phoneticCache.set(cacheKey, result);
    return result;
  }
}

/**
 * 获取单词音标（兼容旧代码的接口）
 * 为了保持向后兼容性，提供单独的音标获取函数
 *
 * @param {string} word - 要查询的单词
 * @returns {Promise<string|null>} 单词的音标字符串或null
 */
async function getPhonetic(word) {
  const result = await getPhoneticAndPartOfSpeech(word);
  return result.phonetic;
}

/**
 * 处理高亮单词的点击事件
 * 显示单词的详细信息工具提示，包括翻译、音标、词性等
 *
 * @param {Event} e - 点击事件对象
 */
async function handleHighlightClick(e) {
  e.stopPropagation(); // 阻止事件冒泡，避免触发其他点击事件
  e.preventDefault(); // 阻止默认行为

  const highlight = e.target;
  const word = highlight.dataset.word;
  const translation = highlight.dataset.translation;

  // 更新单词的使用统计信息
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  const wordLower = word.toLowerCase();

  if (words[wordLower]) {
    // 增加单词的使用计数
    words[wordLower].count += 1;
    words[wordLower].lastUsed = new Date().toISOString();
    await chrome.storage.local.set({ translatedWords: words });

    // 获取更新后的使用次数
    const updatedCount = words[wordLower].count;

    // 获取词性信息（优先从存储中获取）
    let partOfSpeech = words[wordLower].partOfSpeech || highlight.dataset.partOfSpeech;

    // 获取音标信息（如果还没有缓存）
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
        // 更新存储中的词性信息
        words[wordLower].partOfSpeech = partOfSpeech;
        await chrome.storage.local.set({ translatedWords: words });
      }
    }

    // 如果存储中有词性但元素属性中没有，同步更新元素属性
    if (words[wordLower].partOfSpeech && !highlight.dataset.partOfSpeech) {
      partOfSpeech = words[wordLower].partOfSpeech;
      highlight.dataset.partOfSpeech = partOfSpeech;
    }
    
    // 先显示提示框（使用当前元素位置，避免重新高亮后位置变化）
    showClickTooltip(highlight, word, translation, updatedCount, phonetic, partOfSpeech, words[wordLower].type);
    
    // 然后重新高亮显示以更新所有高亮元素的计数和dataset
    // 使用延迟确保提示框已经显示
    setTimeout(() => {
      highlightTranslatedWords(words);
    }, 100);
  }
}

// 显示点击提示框
function showClickTooltip(element, word, translation, count, phonetic, partOfSpeech, wordType = 'word') {
  // 移除旧的提示
  if (clickTooltip) {
    clickTooltip.remove();
  }
  
  // 根据词性获取背景颜色类
  // 词组使用特殊的词性类
  const posClass = wordType === 'phrase' ? 'pos-phrase' : getPartOfSpeechClass(partOfSpeech);
  
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
  // 词组使用特殊的词性类
  const type = isWordPhrase ? (text.trim().split(/\s+/).length === 1 ? 'word' : 'phrase') : 'sentence';
  const posClass = type === 'phrase' ? 'pos-phrase' : getPartOfSpeechClass(partOfSpeech);
  
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
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    return;
  }
  
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
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    return;
  }
  
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
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    return;
  }
  
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
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    return;
  }
  
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

/**
 * 应用自定义颜色设置
 * 根据用户设置动态生成和应用CSS样式
 * @param {Object} settings - 用户设置对象
 */
function applyCustomColors(settings) {
  // 移除现有的自定义样式
  const existingStyle = document.getElementById('custom-highlight-colors');
  if (existingStyle) {
    existingStyle.remove();
  }

  // 如果用户选择了自定义主题，应用自定义颜色
  if (settings.highlightTheme === 'custom' && settings.customColors) {
    const style = document.createElement('style');
    style.id = 'custom-highlight-colors';
    
    let cssContent = '';
    
    // 为每个词性生成自定义颜色
    Object.entries(settings.customColors).forEach(([pos, color]) => {
      const className = pos === 'default' ? '' : `.pos-${pos}`;
      cssContent += `
        .translated-word-highlight${className} {
          background: ${color} !important;
          background: linear-gradient(135deg, ${color} 0%, ${adjustBrightness(color, -20)} 100%) !important;
        }
        .translated-word-highlight${className}:hover {
          background: linear-gradient(135deg, ${adjustBrightness(color, 10)} 0%, ${color} 100%) !important;
          filter: brightness(1.1) !important;
        }
        .click-tooltip${className} {
          background: linear-gradient(135deg, ${color} 0%, ${adjustBrightness(color, -20)} 100%) !important;
        }
      `;
    });
    
    style.textContent = cssContent;
    document.head.appendChild(style);
  }
}

/**
 * 调整颜色亮度
 * @param {string} color - 颜色值（支持hex、rgb、颜色名称）
 * @param {number} percent - 亮度调整百分比（正值变亮，负值变暗）
 * @returns {string} 调整后的颜色
 */
function adjustBrightness(color, percent) {
  // 简化的亮度调整函数
  const rgb = colorToRgb(color);
  if (!rgb) return color;
  
  const factor = 1 + percent / 100;
  const r = Math.min(255, Math.max(0, Math.round(rgb.r * factor)));
  const g = Math.min(255, Math.max(0, Math.round(rgb.g * factor)));
  const b = Math.min(255, Math.max(0, Math.round(rgb.b * factor)));
  
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * 颜色转换为RGB对象
 * @param {string} color - 颜色字符串
 * @returns {Object|null} RGB对象或null
 */
function colorToRgb(color) {
  // 处理十六进制颜色
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }
  
  // 处理rgb颜色
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3])
    };
  }
  
  return null;
}

// 监听设置变化，实时更新颜色
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.userSettings) {
    // 重新应用颜色设置
    applyCustomColors(changes.userSettings.newValue || {});
    // 重新高亮显示以应用新颜色
    chrome.storage.local.get(['translatedWords']).then(result => {
      const words = result.translatedWords || {};
      highlightTranslatedWords(words);
    });
  }
});

// 使用事件委托处理所有高亮元素的点击事件
document.addEventListener('click', async (e) => {
  // 检查当前域名是否允许运行插件
  if (!isDomainAllowed()) {
    return;
  }
  
  // 检查点击的是否是高亮元素
  const highlight = e.target.closest('.translated-word-highlight');
  if (highlight) {
    await handleHighlightClick(e);
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
