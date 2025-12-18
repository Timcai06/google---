// 当前页面状态
let currentPage = 'home';
let currentFilter = 'all';

// 页面切换
function showPage(pageName) {
  const homePage = document.getElementById('homePage');
  const wordListPage = document.getElementById('wordListPage');
  
  if (pageName === 'home') {
    homePage.classList.add('active');
    wordListPage.classList.remove('active');
    currentPage = 'home';
    loadHomePage();
  } else {
    homePage.classList.remove('active');
    wordListPage.classList.add('active');
    currentPage = 'wordList';
    currentFilter = pageName;
    loadWordListPage(pageName);
  }
}

// 加载首页
async function loadHomePage() {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  const wordArray = Object.values(words);
  
  // 统计各类型数量
  const counts = {
    word: 0,
    phrase: 0,
    sentence: 0,
    starred: 0
  };
  
  wordArray.forEach(item => {
    const type = item.type || 'word';
    if (type === 'word') counts.word++;
    else if (type === 'phrase') counts.phrase++;
    else if (type === 'sentence') counts.sentence++;
    
    if (item.starred) counts.starred++;
  });
  
  // 更新统计
  document.getElementById('totalWords').textContent = wordArray.length;
  document.getElementById('wordCount').textContent = counts.word;
  document.getElementById('phraseCount').textContent = counts.phrase;
  document.getElementById('sentenceCount').textContent = counts.sentence;
  document.getElementById('starredCount').textContent = counts.starred;
}

// 加载单词列表页面
async function loadWordListPage(filter) {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  
  // 设置页面标题
  const titles = {
    word: '单词',
    phrase: '词组',
    sentence: '句子',
    starred: '星标单词'
  };
  
  document.getElementById('pageTitle').textContent = titles[filter] || '翻译记录';
  
  const searchTerm = document.getElementById('searchInput').value;
  const sortBy = document.getElementById('sortSelect').value;
  displayWords(words, searchTerm, sortBy, filter);
  updatePageStats(words, filter);
}

// 更新页面统计
function updatePageStats(words, filter) {
  const wordArray = Object.values(words);
  let count = 0;
  
  if (filter === 'starred') {
    count = wordArray.filter(item => item.starred).length;
  } else {
    count = wordArray.filter(item => {
      const type = item.type || 'word';
      return type === filter;
    }).length;
  }
  
  document.getElementById('pageStats').textContent = count;
}

// 显示单词列表
function displayWords(words, searchTerm = '', sortBy = 'count', typeFilter = 'all') {
  const wordList = document.getElementById('wordList');
  
  // 转换为数组并过滤
  let wordArray = Object.values(words);
  
  // 类型过滤
  if (typeFilter === 'starred') {
    wordArray = wordArray.filter(item => item.starred);
  } else if (typeFilter !== 'all') {
    wordArray = wordArray.filter(item => {
      const itemType = item.type || 'word';
      return itemType === typeFilter;
    });
  }
  
  // 搜索过滤
  if (searchTerm) {
    const searchLower = searchTerm.toLowerCase();
    wordArray = wordArray.filter(item => 
      item.word.toLowerCase().includes(searchLower) ||
      item.translation.toLowerCase().includes(searchLower)
    );
  }
  
  // 排序函数
  const sortFunction = (a, b) => {
    switch (sortBy) {
      case 'count':
        return b.count - a.count;
      case 'lastUsed':
        return new Date(b.lastUsed) - new Date(a.lastUsed);
      case 'word':
        return a.word.localeCompare(b.word);
      default:
        return 0;
    }
  };
  
  // 排序
  wordArray.sort(sortFunction);
  
  // 清空列表
  wordList.innerHTML = '';
  
  if (wordArray.length === 0) {
    wordList.innerHTML = '<div class="empty-state">暂无翻译记录</div>';
    return;
  }
  
  // 创建单词项
  wordArray.forEach((item, itemIndex) => {
    const wordItem = document.createElement('div');
    wordItem.className = 'word-item';
    
    // 如果是最后一个，添加特殊类
    if (itemIndex === wordArray.length - 1) {
      wordItem.classList.add('last-item');
    }
    
    const firstUsed = new Date(item.firstUsed).toLocaleString('zh-CN');
    const lastUsed = new Date(item.lastUsed).toLocaleString('zh-CN');
    
    // 获取类型标签
    const itemType = item.type || 'word';
    const typeLabel = itemType === 'word' ? '单词' : itemType === 'phrase' ? '词组' : '句子';
    const typeClass = itemType === 'word' ? 'type-word' : itemType === 'phrase' ? 'type-phrase' : 'type-sentence';
    
    // 星标状态
    const isStarred = item.starred || false;
    const starClass = isStarred ? 'starred' : '';
    
    wordItem.innerHTML = `
      <div class="word-header">
        <div class="word-title-row">
          <button class="star-btn ${starClass}" data-word="${escapeHtml(item.word)}">
            <span class="star-icon">⭐</span>
          </button>
          <span class="word-text">${escapeHtml(item.word)}</span>
          <span class="word-type ${typeClass}">${typeLabel}</span>
        </div>
        <span class="word-count">使用 ${item.count} 次</span>
      </div>
      <div class="translation-text">${escapeHtml(item.translation)}</div>
      <div class="word-meta">
        <span>首次: ${firstUsed}</span>
        <span>最近: ${lastUsed}</span>
        <button class="delete-btn" data-word="${escapeHtml(item.word)}">删除</button>
      </div>
    `;
    
    // 星标按钮事件
    const starBtn = wordItem.querySelector('.star-btn');
    starBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleStar(item.word);
      loadWordListPage(currentFilter);
      if (currentPage === 'home') {
        loadHomePage();
      }
    });
    
    // 删除按钮事件
    const deleteBtn = wordItem.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`确定要删除单词 "${item.word}" 吗？`)) {
        await deleteWord(item.word);
        loadWordListPage(currentFilter);
        if (currentPage === 'home') {
          loadHomePage();
        }
      }
    });
    
    wordList.appendChild(wordItem);
  });
}

// 切换星标
async function toggleStar(word) {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  const wordLower = word.toLowerCase();
  
  if (words[wordLower]) {
    words[wordLower].starred = !words[wordLower].starred;
    await chrome.storage.local.set({ translatedWords: words });
  }
}

// 删除单词
async function deleteWord(word) {
  const result = await chrome.storage.local.get(['translatedWords']);
  const words = result.translatedWords || {};
  delete words[word.toLowerCase()];
  await chrome.storage.local.set({ translatedWords: words });
}

// 清空所有记录
async function clearAllWords() {
  if (confirm('确定要清空所有翻译记录吗？此操作不可恢复！')) {
    await chrome.storage.local.set({ translatedWords: {} });
    if (currentPage === 'home') {
      loadHomePage();
    } else {
      loadWordListPage(currentFilter);
    }
  }
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 事件监听
// 首页卡片点击
document.querySelectorAll('.home-card').forEach(card => {
  card.addEventListener('click', () => {
    const page = card.dataset.page;
    showPage(page);
  });
});

// 返回按钮
document.getElementById('backBtn').addEventListener('click', () => {
  showPage('home');
});

// 搜索输入
document.getElementById('searchInput').addEventListener('input', (e) => {
  const searchTerm = e.target.value;
  const sortBy = document.getElementById('sortSelect').value;
  chrome.storage.local.get(['translatedWords'], (result) => {
    displayWords(result.translatedWords || {}, searchTerm, sortBy, currentFilter);
  });
});

// 排序选择
document.getElementById('sortSelect').addEventListener('change', (e) => {
  const sortBy = e.target.value;
  const searchTerm = document.getElementById('searchInput').value;
  chrome.storage.local.get(['translatedWords'], (result) => {
    displayWords(result.translatedWords || {}, searchTerm, sortBy, currentFilter);
  });
});

// 清空按钮
document.getElementById('clearAllBtn').addEventListener('click', clearAllWords);

// 页面加载时显示首页
loadHomePage();

// 监听存储变化，实时更新
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.translatedWords) {
    if (currentPage === 'home') {
      loadHomePage();
    } else {
      loadWordListPage(currentFilter);
    }
  }
});

