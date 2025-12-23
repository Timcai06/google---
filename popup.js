/**
 * 单词翻译助手 - 弹出页面脚本
 *
 * 主要功能：
 * 1. 管理扩展的弹出页面UI和导航
 * 2. 处理单词列表的显示、分页和搜索
 * 3. 管理用户数据和过滤器
 * 4. 提供单词管理功能（删除、收藏等）
 * 5. 实现高效的搜索和虚拟滚动
 */

// ====================
// 全局状态管理
// ====================

// 当前显示的页面状态
let currentPage = 'home';
// 当前激活的过滤器类型
let currentFilter = 'all';

// ====================
// 数据存储和索引
// ====================

// 原始单词数据存储
let wordsData = {};
// 单词索引 - 按类型分类存储单词键
let wordsIndex = {
  all: [],      // 所有单词
  word: [],     // 单词类型
  phrase: [],   // 词组类型
  sentence: [], // 句子类型
  starred: []   // 收藏的单词
};
// 搜索倒排索引 - 用于快速搜索
let searchIndex = {};
// 搜索结果缓存 - 避免重复搜索计算
let searchCache = new Map();
// 数据加载状态标志
let isDataLoaded = false;
// 当前页面的数据
let currentPageData = [];
// 当前页码索引
let currentPageIndex = 0;
// 每页显示的项目数量
const PAGE_SIZE = 50; // 每页显示50个项目（恢复到原来的大小以减少翻页）

/**
 * 显示指定的页面
 * 处理页面切换逻辑和相应的数据加载
 *
 * @param {string} pageName - 要显示的页面名称 ('home' 或具体的过滤器类型)
 */
function showPage(pageName) {
  const homePage = document.getElementById('homePage');
  const wordListPage = document.getElementById('wordListPage');

  if (pageName === 'home') {
    // 显示首页
    homePage.classList.add('active');
    wordListPage.classList.remove('active');
    currentPage = 'home';
    loadHomePage();
  } else {
    // 显示单词列表页面
    homePage.classList.remove('active');
    wordListPage.classList.add('active');
    currentPage = 'wordList';
    currentFilter = pageName;
    loadWordListPage(pageName);
  }
}

/**
 * 加载数据并构建搜索索引
 * 从Chrome存储中获取单词数据并建立各种索引以提高查询性能
 */
async function loadDataAndBuildIndex() {
  if (isDataLoaded) return; // 防止重复加载

  // 从Chrome本地存储获取翻译单词数据
  const result = await chrome.storage.local.get(['translatedWords']);
  wordsData = result.translatedWords || {};

  // 重建所有索引（分类索引和搜索索引）
  buildIndex();

  // 标记数据已加载
  isDataLoaded = true;
}

// 构建高效的索引结构
function buildIndex() {
  // 清空现有索引
  wordsIndex = {
    all: [],
    word: [],
    phrase: [],
    sentence: [],
    starred: []
  };
  searchIndex = {}; // 清空搜索索引

  // 将对象转换为数组并分类
  const wordArray = Object.keys(wordsData).map(key => ({
    key: key,
    ...wordsData[key]
  }));

  // 构建各类型索引
  wordArray.forEach((item, index) => {
    const type = item.type || 'word';

    // 所有项目索引
    wordsIndex.all.push(item);

    // 类型索引
    if (wordsIndex[type]) {
      wordsIndex[type].push(item);
    }

    // 星标索引
    if (item.starred) {
      wordsIndex.starred.push(item);
    }

    // 构建搜索倒排索引
    buildSearchIndex(item, index);
  });

  // 对所有索引进行排序（按使用次数降序）
  Object.keys(wordsIndex).forEach(key => {
    wordsIndex[key].sort((a, b) => b.count - a.count);
  });
}

// 构建搜索倒排索引
function buildSearchIndex(item, index) {
  const text = `${item.key} ${item.translation}`.toLowerCase();
  const words = text.split(/\s+/);

  // 为每个单词建立倒排索引
  words.forEach(word => {
    if (!searchIndex[word]) {
      searchIndex[word] = new Set();
    }
    searchIndex[word].add(index);
  });
}

// 获取过滤后的数据
function getFilteredData(typeFilter = 'all', searchTerm = '') {
  // 生成缓存键
  const cacheKey = `${typeFilter}:${searchTerm}`;

  // 检查缓存
  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey);
  }

  let data = [];

  // 根据类型过滤
  if (typeFilter === 'starred') {
    data = [...wordsIndex.starred];
  } else if (wordsIndex[typeFilter]) {
    data = [...wordsIndex[typeFilter]];
  } else {
    data = [...wordsIndex.all];
  }

  // 搜索过滤
  if (searchTerm) {
    data = performSearch(data, searchTerm);
  }

  // 缓存结果（限制缓存大小）
  if (searchCache.size > 100) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  searchCache.set(cacheKey, data);

  return data;
}

// 使用倒排索引进行高效搜索
function performSearch(data, searchTerm) {
  if (!searchTerm.trim()) return data;

  const searchWords = searchTerm.toLowerCase().split(/\s+/);
  const wordArray = Object.keys(wordsData).map(key => ({
    key: key,
    ...wordsData[key]
  }));

  // 使用倒排索引进行搜索
  let resultIndices = new Set();

  searchWords.forEach(searchWord => {
    if (searchIndex[searchWord]) {
      if (resultIndices.size === 0) {
        // 第一个搜索词
        resultIndices = new Set(searchIndex[searchWord]);
      } else {
        // 交集操作
        const currentIndices = searchIndex[searchWord];
        resultIndices = new Set([...resultIndices].filter(x => currentIndices.has(x)));
      }
    } else {
      // 如果搜索词不在索引中，清空结果
      resultIndices.clear();
    }
  });

  // 获取匹配的项目
  const matchedItems = [...resultIndices].map(index => wordArray[index]);

  // 按相关性排序（匹配的搜索词越多越相关）
  matchedItems.sort((a, b) => {
    const aScore = calculateRelevanceScore(a, searchWords);
    const bScore = calculateRelevanceScore(b, searchWords);
    return bScore - aScore;
  });

  return matchedItems;
}

// 计算相关性分数
function calculateRelevanceScore(item, searchWords) {
  const text = `${item.key} ${item.translation}`.toLowerCase();
  let score = 0;

  searchWords.forEach(word => {
    // 精确匹配获得更高分数
    if (item.key.toLowerCase().includes(word)) {
      score += 10;
    }
    if (item.translation.toLowerCase().includes(word)) {
      score += 5;
    }
    // 部分匹配获得较低分数
    if (text.includes(word)) {
      score += 1;
    }
  });

  return score;
}

// 加载首页
async function loadHomePage() {
  await loadDataAndBuildIndex();

  // 使用索引快速统计
  const counts = {
    word: wordsIndex.word.length,
    phrase: wordsIndex.phrase.length,
    sentence: wordsIndex.sentence.length,
    starred: wordsIndex.starred.length
  };

  // 更新统计面板
  document.getElementById('totalWords').textContent = wordsIndex.all.length;
  document.getElementById('wordCount').textContent = counts.word;
  document.getElementById('phraseCount').textContent = counts.phrase;
  document.getElementById('sentenceCount').textContent = counts.sentence;
  document.getElementById('starredCount').textContent = counts.starred;

  // 初始化学习面板
  updateLearningPanel();
}

/**
 * 更新学习面板内容
 * 根据当前数据状态显示学习建议或最近学习的单词
 */
function updateLearningPanel() {
  const learningContent = document.getElementById('learningContent');

  // 如果没有单词数据，显示占位符
  if (wordsIndex.all.length === 0) {
    learningContent.innerHTML = `
      <div class="learning-placeholder">
        <div class="placeholder-icon">🎯</div>
        <div class="placeholder-text">开始翻译一些单词来开始学习吧！</div>
      </div>
    `;
    return;
  }

  // 显示学习建议或最近学习的单词
  const recentWords = getRecentWords(5); // 获取最近5个单词

  if (recentWords.length > 0) {
    learningContent.innerHTML = `
      <div class="recent-learning">
        <h4>最近学习</h4>
        <div class="recent-words">
          ${recentWords.map(word => `
            <div class="recent-word-item" data-word="${word.key}">
              <span class="recent-word-text">${word.key}</span>
              <span class="recent-word-count">${word.count}次</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // 为最近学习的单词添加点击事件
    document.querySelectorAll('.recent-word-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const wordKey = e.currentTarget.dataset.word;
        showWordDetail(wordKey);
      });
    });
  } else {
    learningContent.innerHTML = `
      <div class="learning-placeholder">
        <div class="placeholder-icon">📚</div>
        <div class="placeholder-text">选择左侧类别开始学习</div>
      </div>
    `;
  }
}

/**
 * 获取最近学习的单词
 * @param {number} limit - 返回的单词数量限制
 * @returns {Array} 最近学习的单词数组
 */
function getRecentWords(limit) {
  // 从所有单词中按最后使用时间排序，取最新的limit个
  const allWords = Object.values(wordsData);
  return allWords
    .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
    .slice(0, limit)
    .map(word => ({
      key: word.key,
      count: word.count,
      lastUsed: word.lastUsed
    }));
}

/**
 * 显示单词详情
 * @param {string} wordKey - 单词键
 */
function showWordDetail(wordKey) {
  // 这里可以实现显示单词详情的逻辑
  // 暂时跳转到对应的单词列表页面
  const wordData = wordsData[wordKey];
  if (wordData) {
    // 根据单词类型跳转到对应页面
    let filterType = 'word'; // 默认单词
    if (wordData.key.includes(' ')) {
      if (wordData.key.split(' ').length > 3) {
        filterType = 'sentence';
      } else {
        filterType = 'phrase';
      }
    }
    showPage(filterType);
  }
}

// 加载单词列表页面
async function loadWordListPage(filter) {
  await loadDataAndBuildIndex();

  // 设置页面标题和相关信息
  const pageInfo = getPageInfo(filter);
  document.getElementById('pageTitle').textContent = pageInfo.title;

  // 更新搜索框placeholder
  document.getElementById('searchInput').placeholder = pageInfo.searchPlaceholder;

  const searchTerm = document.getElementById('searchInput').value;
  const sortBy = document.getElementById('sortSelect').value;

  // 重置分页
  currentPageIndex = 0;
  currentPageData = getFilteredData(filter, searchTerm);

  // 应用排序
  sortData(currentPageData, sortBy);

  displayWords(currentPageData, 0, PAGE_SIZE);
  updatePageStats(currentPageData.length, pageInfo.unit);
}

// 获取页面信息
function getPageInfo(filter) {
  const pageInfos = {
    word: {
      title: '单词',
      searchPlaceholder: '搜索单词...',
      unit: '个单词'
    },
    phrase: {
      title: '词组',
      searchPlaceholder: '搜索词组...',
      unit: '个词组'
    },
    sentence: {
      title: '句子',
      searchPlaceholder: '搜索句子...',
      unit: '个句子'
    },
    starred: {
      title: '星标单词',
      searchPlaceholder: '搜索星标单词...',
      unit: '个星标单词'
    }
  };

  return pageInfos[filter] || {
    title: '翻译记录',
    searchPlaceholder: '搜索...',
  };
}

// 排序数据
function sortData(data, sortBy) {
  const sortFunction = (a, b) => {
    switch (sortBy) {
      case 'count':
        return b.count - a.count;
      case 'lastUsed':
        return new Date(b.lastUsed) - new Date(a.lastUsed);
      case 'word':
        return a.key.localeCompare(b.key);
      default:
        return 0;
    }
  };

  data.sort(sortFunction);
}

// 更新页面统计
function updatePageStats(totalCount, unit = '个') {
  document.getElementById('pageStats').textContent = `${totalCount} ${unit}`;
}

// 显示单词列表（分页显示）
// 显示单词列表（分页显示 + 虚拟滚动）
function displayWords(data, startIndex = 0, pageSize = PAGE_SIZE) {
  const wordList = document.getElementById('wordList');
  const endIndex = Math.min(startIndex + pageSize, data.length);

  // 清空列表，但保留分页控件
  const existingPagination = wordList.querySelector('.pagination-controls');
  wordList.innerHTML = '';

  if (data.length === 0) {
    wordList.innerHTML = '<div class="empty-state">暂无翻译记录</div>';
    return;
  }

  // 创建虚拟滚动容器
  const virtualContainer = document.createElement('div');
  virtualContainer.className = 'virtual-scroll-container';
  virtualContainer.style.height = `${Math.min(data.length, pageSize) * 60}px`; // 估算高度

  // 只显示当前页的数据（虚拟滚动）
  for (let i = startIndex; i < endIndex; i++) {
    const item = data[i];
    const wordItem = createWordItem(item, i === endIndex - 1);
    virtualContainer.appendChild(wordItem);
  }

  wordList.appendChild(virtualContainer);

  // 重新添加分页控件（如果需要）
  if (data.length > pageSize) {
    addPaginationControls(data.length, pageSize);
  }
}

// 创建单词项（优化版本）
function createWordItem(item, isLast = false) {
  const wordItem = document.createElement('div');
  wordItem.className = 'word-item';

  if (isLast) {
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
        <button class="star-btn ${starClass}" data-word="${escapeHtml(item.key)}">
          <span class="star-icon">⭐</span>
        </button>
        <span class="word-text">${escapeHtml(item.key)}</span>
        <span class="word-type ${typeClass}">${typeLabel}</span>
      </div>
      <span class="word-count">使用 ${item.count} 次</span>
    </div>
    <div class="translation-text">${escapeHtml(item.translation)}</div>
    <div class="word-meta">
      <span>首次: ${firstUsed}</span>
      <span>最近: ${lastUsed}</span>
      <button class="delete-btn" data-word="${escapeHtml(item.key)}">删除</button>
    </div>
  `;

  // 事件监听器
  const starBtn = wordItem.querySelector('.star-btn');
  starBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await toggleStar(item.key);
    // 重新加载当前页面数据
    await loadDataAndBuildIndex();
    if (currentPage === 'home') {
      loadHomePage();
    } else {
      loadWordListPage(currentFilter);
    }
  });

  const deleteBtn = wordItem.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`确定要删除 "${item.key}" 吗？`)) {
      await deleteWord(item.key);
      // 重新加载当前页面数据
      await loadDataAndBuildIndex();
      if (currentPage === 'home') {
        loadHomePage();
      } else {
        loadWordListPage(currentFilter);
      }
    }
  });

  return wordItem;
}

// 添加分页控件
function addPaginationControls(totalCount, pageSize) {
  const wordList = document.getElementById('wordList');

  // 移除现有的分页控件
  const existingPagination = wordList.querySelector('.pagination-controls');
  if (existingPagination) {
    existingPagination.remove();
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const currentPageNum = Math.floor(currentPageIndex / pageSize) + 1;

  const paginationDiv = document.createElement('div');
  paginationDiv.className = 'pagination-controls';
  paginationDiv.innerHTML = `
    <button class="page-btn" id="prevPage" ${currentPageNum === 1 ? 'disabled' : ''}>上一页</button>
    <span class="page-info">第 ${currentPageNum} 页 / 共 ${totalPages} 页</span>
    <button class="page-btn" id="nextPage" ${currentPageNum === totalPages ? 'disabled' : ''}>下一页</button>
  `;

  wordList.appendChild(paginationDiv);

  // 使用一次性事件监听器
  const prevBtn = paginationDiv.querySelector('#prevPage');
  const nextBtn = paginationDiv.querySelector('#nextPage');

  prevBtn.addEventListener('click', function handlePrev() {
    if (currentPageIndex >= pageSize) {
      currentPageIndex -= pageSize;
      displayWords(currentPageData, currentPageIndex, pageSize);
      // 更新统计信息，使用正确的单位
      const pageInfo = getPageInfo(currentFilter);
      updatePageStats(currentPageData.length, pageInfo.unit);
    }
  });

  nextBtn.addEventListener('click', function handleNext() {
    if (currentPageIndex + pageSize < totalCount) {
      currentPageIndex += pageSize;
      displayWords(currentPageData, currentPageIndex, pageSize);
      // 更新统计信息，使用正确的单位
      const pageInfo = getPageInfo(currentFilter);
      updatePageStats(currentPageData.length, pageInfo.unit);
    }
  });
}

// 切换星标
async function toggleStar(word) {
  const wordLower = word.toLowerCase();

  if (wordsData[wordLower]) {
    wordsData[wordLower].starred = !wordsData[wordLower].starred;
    await chrome.storage.local.set({ translatedWords: wordsData });

    // 重新构建索引并清空搜索缓存
    buildIndex();
    searchCache.clear();
  }
}

// 删除单词
async function deleteWord(word) {
  const wordLower = word.toLowerCase();

  if (wordsData[wordLower]) {
    delete wordsData[wordLower];
    await chrome.storage.local.set({ translatedWords: wordsData });

    // 重新构建索引并清空搜索缓存
    buildIndex();
    searchCache.clear();
  }
}

// 清空所有记录
async function clearAllWords() {
  if (confirm('确定要清空所有翻译记录吗？此操作不可恢复！')) {
    wordsData = {};
    wordsIndex = {
      all: [],
      word: [],
      phrase: [],
      sentence: [],
      starred: []
    };
    searchIndex = {};
    searchCache.clear();
    isDataLoaded = false;

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

// 搜索输入（防抖处理）
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const searchTerm = e.target.value;
    const sortBy = document.getElementById('sortSelect').value;

    // 重新获取过滤数据
    currentPageData = getFilteredData(currentFilter, searchTerm);
    sortData(currentPageData, sortBy);

    // 重置分页
    currentPageIndex = 0;
    displayWords(currentPageData, 0, PAGE_SIZE);

    // 更新统计信息，使用正确的单位
    const pageInfo = getPageInfo(currentFilter);
    updatePageStats(currentPageData.length, pageInfo.unit);
  }, 150); // 减少防抖时间到150ms以提高响应性
});

// 排序选择
document.getElementById('sortSelect').addEventListener('change', (e) => {
  const sortBy = e.target.value;
  const searchTerm = document.getElementById('searchInput').value;

  // 对当前数据重新排序
  sortData(currentPageData, sortBy);

  // 重置分页并重新显示
  currentPageIndex = 0;
  displayWords(currentPageData, 0, PAGE_SIZE);

  // 更新统计信息，使用正确的单位
  const pageInfo = getPageInfo(currentFilter);
  updatePageStats(currentPageData.length, pageInfo.unit);
});

// 清空按钮
document.getElementById('clearAllBtn').addEventListener('click', clearAllWords);

// 页面加载时显示首页
loadHomePage();

// 初始化事件监听器
function initializeEventListeners() {
  // 统计卡片点击事件
  document.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const pageType = e.currentTarget.dataset.page;
      if (pageType) {
        showPage(pageType);
      }
    });
  });

  // 其他现有的事件监听器...
}

// 调用初始化函数
initializeEventListeners();

// 监听存储变化，实时更新
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.translatedWords) {
    // 标记数据需要重新加载
    isDataLoaded = false;

    if (currentPage === 'home') {
      loadHomePage();
    } else {
      loadWordListPage(currentFilter);
    }
  }
});

