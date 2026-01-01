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
let wordsData = {}

// ====================
// 学习模式功能
// ====================

/**
 * 学习模式管理器
 */
class LearningManager {
  constructor() {
    this.currentMode = 'flashcard';
    this.currentSession = null;
    this.wordsToLearn = [];
    this.currentIndex = 0;
    this.sessionStats = {
      total: 0,
      correct: 0,
      startTime: null,
      mistakes: []
    };
  }

  /**
   * 开始学习会话
   */
  async startLearningSession(mode = 'flashcard', wordFilter = 'all') {
    try {
      // 获取用户设置
      const result = await chrome.storage.local.get(['userSettings', 'translatedWords', 'learningProgress']);
      const settings = result.userSettings || {};
      const words = result.translatedWords || {};
      const progress = result.learningProgress || {};
      
      // 筛选要学习的单词
      this.wordsToLearn = this.filterWordsForLearning(words, wordFilter, progress, settings);
      
      if (this.wordsToLearn.length === 0) {
        alert('没有可学习的单词，请先添加一些翻译记录！');
        return false;
      }

      // 初始化会话
      this.currentMode = mode;
      this.currentIndex = 0;
      this.sessionStats = {
        total: this.wordsToLearn.length,
        correct: 0, 
        startTime: Date.now(),
        mistakes: []
      };

      // 显示学习页面
      showPage('learning');
      
      // 初始化对应的学习模式
      this.initializeLearningMode(mode);
      
      return true;
      
    } catch (error) {
      console.error('开始学习会话失败:', error);
      alert('开始学习失败，请重试');
      return false;
    }
  }

  /**
   * 筛选适合学习的单词
   */
  filterWordsForLearning(words, filter, progress, settings) {
    let filteredWords = Object.values(words);
    
    // 根据筛选条件过滤
    switch (filter) {
      case 'words':
        filteredWords = filteredWords.filter(w => w.type === 'word');
        break;
      case 'phrases':
        filteredWords = filteredWords.filter(w => w.type === 'phrase');
        break;
      case 'sentences':
        filteredWords = filteredWords.filter(w => w.type === 'sentence');
        break;
      case 'starred':
        filteredWords = filteredWords.filter(w => w.starred);
        break;
      case 'difficult':
        filteredWords = filteredWords.filter(w => {
          const wordProgress = progress[w.word || w.key];
          return !wordProgress || wordProgress.masteryLevel < 3;
        });
        break;
      default:
        // all - 使用所有单词
        break;
    }

    // 根据学习进度排序（优先学习掌握程度低的单词）
    filteredWords.sort((a, b) => {
      const progressA = progress[a.word || a.key] || { masteryLevel: 0, lastReviewed: 0 };
      const progressB = progress[b.word || b.key] || { masteryLevel: 0, lastReviewed: 0 };
      
      // 优先学习掌握程度低的单词
      if (progressA.masteryLevel !== progressB.masteryLevel) {
        return progressA.masteryLevel - progressB.masteryLevel;
      }
      
      // 然后优先学习最近没有复习的单词
      return progressA.lastReviewed - progressB.lastReviewed;
    });

    // 限制学习数量（根据用户设置）
    const dailyGoal = settings.dailyGoal || 20;
    return filteredWords.slice(0, dailyGoal);
  }

  /**
   * 初始化学习模式
   */
  initializeLearningMode(mode) {
    // 隐藏所有模式
    document.querySelectorAll('.flashcard-mode, .quiz-mode, .spelling-mode').forEach(el => {
      el.classList.remove('active');
    });
    
    // 激活对应模式
    document.getElementById(`${mode}Mode`).classList.add('active');
    
    // 更新模式按钮状态
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      }
    });

    // 根据模式初始化
    switch (mode) {
      case 'flashcard':
        this.initFlashcardMode();
        break;
      case 'quiz':
        this.initQuizMode();
        break;
      case 'spelling':
        this.initSpellingMode();
        break;
    }
  }

  /**
   * 初始化闪卡模式
   */
  initFlashcardMode() {
    this.showCurrentFlashcard();
  }

  /**
   * 显示当前闪卡
   */
  showCurrentFlashcard() {
    const currentWord = this.wordsToLearn[this.currentIndex];
    if (!currentWord) {
      this.finishLearningSession();
      return;
    }

    const wordDisplay = document.getElementById('currentWord');
    const phoneticDisplay = document.getElementById('currentPhonetic');
    const posDisplay = document.getElementById('currentPOS');
    const translationDisplay = document.getElementById('currentTranslation');

    wordDisplay.textContent = currentWord.word || currentWord.key;
    phoneticDisplay.textContent = currentWord.phonetic || '';
    posDisplay.textContent = currentWord.partOfSpeech ? `(${currentWord.partOfSpeech})` : '';
    translationDisplay.textContent = '点击翻转查看翻译';

    // 更新进度
    this.updateLearningProgress();
  }

  /**
   * 翻转闪卡
   */
  flipFlashcard() {
    const currentWord = this.wordsToLearn[this.currentIndex];
    const translationDisplay = document.getElementById('currentTranslation');
    
    if (translationDisplay.textContent === '点击翻转查看翻译') {
      translationDisplay.textContent = currentWord.translation;
    } else {
      translationDisplay.textContent = '点击翻转查看翻译';
    }
  }

  /**
   * 处理闪卡难度反馈
   */
  handleFlashcardDifficulty(difficulty) {
    const currentWord = this.wordsToLearn[this.currentIndex];
    const wordKey = currentWord.word || currentWord.key;
    
    // 记录学习结果
    this.recordLearningResult(wordKey, difficulty === 'easy');
    
    // 移动到下一个单词
    this.currentIndex++;
    if (this.currentIndex >= this.wordsToLearn.length) {
      this.finishLearningSession();
    } else {
      this.showCurrentFlashcard();
    }
  }

  /**
   * 初始化测验模式
   */
  initQuizMode() {
    this.showCurrentQuiz();
  }

  /**
   * 显示当前测验题
   */
  showCurrentQuiz() {
    const currentWord = this.wordsToLearn[this.currentIndex];
    if (!currentWord) {
      this.finishLearningSession();
      return;
    }

    const questionText = document.getElementById('quizQuestion');
    const optionsContainer = document.getElementById('quizOptions');
    const resultContainer = document.getElementById('quizResult');

    // 隐藏结果区域
    resultContainer.style.display = 'none';

    // 生成问题（显示翻译，让用户选择英文）
    questionText.textContent = `"${currentWord.translation}" 的英文是什么？`;

    // 生成选项
    const options = this.generateQuizOptions(currentWord);
    optionsContainer.innerHTML = '';
    
    options.forEach((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'quiz-option';
      optionElement.textContent = option.word;
      optionElement.dataset.word = option.word;
      optionElement.dataset.correct = option.isCorrect;
      
      optionElement.addEventListener('click', (e) => {
        this.handleQuizAnswer(e.target);
      });
      
      optionsContainer.appendChild(optionElement);
    });

    this.updateLearningProgress();
  }

  /**
   * 生成测验选项
   */
  generateQuizOptions(correctWord) {
    const options = [];
    const correctOption = {
      word: correctWord.word || correctWord.key,
      isCorrect: true
    };
    options.push(correctOption);

    // 添加干扰选项（从其他单词中选择）
    const otherWords = this.wordsToLearn.filter(w => 
      (w.word || w.key) !== (correctWord.word || correctWord.key)
    );
    
    const distractors = otherWords.slice(0, 3).map(word => ({
      word: word.word || word.key,
      isCorrect: false
    }));
    
    options.push(...distractors);
    
    // 打乱选项顺序
    return options.sort(() => Math.random() - 0.5);
  }

  /**
   * 处理测验答案
   */
  handleQuizAnswer(selectedOption) {
    const isCorrect = selectedOption.dataset.correct === 'true';
    const currentWord = this.wordsToLearn[this.currentIndex];
    const wordKey = currentWord.word || currentWord.key;
    
    // 记录学习结果
    this.recordLearningResult(wordKey, isCorrect);
    
    // 显示结果
    this.showQuizResult(isCorrect);
    
    // 禁用所有选项
    document.querySelectorAll('.quiz-option').forEach(option => {
      option.style.pointerEvents = 'none';
      if (option.dataset.correct === 'true') {
        option.classList.add('correct');
      } else if (option === selectedOption && !isCorrect) {
        option.classList.add('incorrect');
      }
    });
  }

  /**
   * 显示测验结果
   */
  showQuizResult(isCorrect) {
    const resultContainer = document.getElementById('quizResult');
    const resultIcon = document.getElementById('resultIcon');
    const resultText = document.getElementById('resultText');
    
    resultContainer.style.display = 'block';
    
    if (isCorrect) {
      resultIcon.textContent = '🎉';
      resultText.textContent = '回答正确！';
      resultText.style.color = '#27ae60';
    } else {
      resultIcon.textContent = '😅';
      resultText.textContent = '回答错误，继续加油！';
      resultText.style.color = '#e74c3c';
    }
  }

  /**
   * 处理下一题
   */
  handleNextQuiz() {
    this.currentIndex++;
    if (this.currentIndex >= this.wordsToLearn.length) {
      this.finishLearningSession();
    } else {
      this.showCurrentQuiz();
    }
  }

  /**
   * 初始化拼写模式
   */
  initSpellingMode() {
    this.showCurrentSpelling();
  }

  /**
   * 显示当前拼写题
   */
  showCurrentSpelling() {
    const currentWord = this.wordsToLearn[this.currentIndex];
    if (!currentWord) {
      this.finishLearningSession();
      return;
    }

    const promptElement = document.getElementById('spellingPrompt');
    const inputElement = document.getElementById('spellingInput');
    const resultContainer = document.getElementById('spellingResult');

    // 隐藏结果区域，清空输入
    resultContainer.style.display = 'none';
    inputElement.value = '';
    inputElement.disabled = false;

    // 显示提示（显示翻译，让用户拼写英文）
    promptElement.textContent = `请拼写："${currentWord.translation}"`;

    // 添加回车键监听
    inputElement.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleSpellingSubmit();
      }
    });

    this.updateLearningProgress();
  }

  /**
   * 处理拼写提交
   */
  handleSpellingSubmit() {
    const currentWord = this.wordsToLearn[this.currentIndex];
    const wordKey = currentWord.word || currentWord.key;
    const userInput = document.getElementById('spellingInput').value.trim().toLowerCase();
    const correctAnswer = wordKey.toLowerCase();
    
    const isCorrect = userInput === correctAnswer;
    
    // 记录学习结果
    this.recordLearningResult(wordKey, isCorrect);
    
    // 显示结果
    this.showSpellingResult(isCorrect, correctAnswer);
  }

  /**
   * 显示拼写结果
   */
  showSpellingResult(isCorrect, correctAnswer) {
    const resultContainer = document.getElementById('spellingResult');
    const feedbackElement = document.getElementById('spellingFeedback');
    const correctElement = document.getElementById('correctSpelling');
    const inputElement = document.getElementById('spellingInput');
    
    resultContainer.style.display = 'block';
    inputElement.disabled = true;
    
    if (isCorrect) {
      feedbackElement.textContent = '拼写正确！';
      feedbackElement.style.color = '#27ae60';
      correctElement.style.display = 'none';
    } else {
      feedbackElement.textContent = '拼写错误，正确答案是：';
      feedbackElement.style.color = '#e74c3c';
      correctElement.textContent = correctAnswer;
      correctElement.style.display = 'block';
    }
  }

  /**
   * 处理下一题拼写
   */
  handleNextSpelling() {
    this.currentIndex++;
    if (this.currentIndex >= this.wordsToLearn.length) {
      this.finishLearningSession();
    } else {
      this.showCurrentSpelling();
    }
  }

  /**
   * 更新学习进度显示
   */
  updateLearningProgress() {
    const progressElement = document.getElementById('learningProgress');
    const current = this.currentIndex + 1;
    const total = this.wordsToLearn.length;
    progressElement.textContent = `${current}/${total}`;
  }

  /**
   * 记录学习结果
   */
  async recordLearningResult(wordKey, isCorrect) {
    try {
      const result = await chrome.storage.local.get(['learningProgress']);
      const progress = result.learningProgress || {};
      
      if (!progress[wordKey]) {
        progress[wordKey] = {
          masteryLevel: 0,
          reviewCount: 0,
          correctCount: 0,
          lastReviewed: Date.now(),
          nextReview: Date.now()
        };
      }
      
      const wordProgress = progress[wordKey];
      wordProgress.reviewCount++;
      wordProgress.lastReviewed = Date.now();
      
      if (isCorrect) {
        wordProgress.correctCount++;
        wordProgress.masteryLevel = Math.min(wordProgress.masteryLevel + 1, 5);
      } else {
        wordProgress.masteryLevel = Math.max(wordProgress.masteryLevel - 1, 0);
        this.sessionStats.mistakes.push(wordKey);
      }
      
      // 计算下次复习时间（基于掌握程度）
      const intervals = [1, 2, 4, 7, 14, 30]; // 天数
      const interval = intervals[wordProgress.masteryLevel] || 30;
      wordProgress.nextReview = Date.now() + (interval * 24 * 60 * 60 * 1000);
      
      await chrome.storage.local.set({ learningProgress: progress });
      
      if (isCorrect) {
        this.sessionStats.correct++;
      }
      
    } catch (error) {
      console.error('记录学习结果失败:', error);
    }
  }

  /**
   * 完成学习会话
   */
  finishLearningSession() {
    const endTime = Date.now();
    const duration = Math.round((endTime - this.sessionStats.startTime) / 60000); // 分钟
    const accuracy = Math.round((this.sessionStats.correct / this.sessionStats.total) * 100);
    
    // 显示学习总结
    this.showLearningSummary(duration, accuracy);
  }

  /**
   * 显示学习总结
   */
  showLearningSummary(duration, accuracy) {
    // 隐藏学习区域
    document.getElementById('learningArea').style.display = 'none';
    
    // 显示总结区域
    const summaryElement = document.getElementById('learningSummary');
    summaryElement.style.display = 'block';
    
    // 填充统计数据
    document.getElementById('totalQuestions').textContent = this.sessionStats.total;
    document.getElementById('correctAnswers').textContent = this.sessionStats.correct;
    document.getElementById('accuracyRate').textContent = `${accuracy}%`;
    document.getElementById('learningTime').textContent = `${duration}分钟`;
  }

  /**
   * 复习错题
   */
  reviewMistakes() {
    if (this.sessionStats.mistakes.length === 0) {
      alert('没有错题需要复习！');
      return;
    }
    
    // 创建错题学习会话
    this.wordsToLearn = this.sessionStats.mistakes.map(wordKey => {
      return this.wordsToLearn.find(w => (w.word || w.key) === wordKey);
    }).filter(Boolean);
    
    this.currentIndex = 0;
    this.sessionStats.mistakes = [];
    
    // 重新开始学习
    document.getElementById('learningArea').style.display = 'block';
    document.getElementById('learningSummary').style.display = 'none';
    
    this.initializeLearningMode(this.currentMode);
  }

  /**
   * 开始新的学习会话
   */
  startNewSession() {
    // 返回首页
    showPage('home');
  }
}

// 创建学习管理器实例
const learningManager = new LearningManager();

// 原始单词数据存储
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
 * @param {string} pageName - 要显示的页面名称 ('home', 'settings', 'learning' 或具体的过滤器类型)
 */
function showPage(pageName) {
  // 获取所有页面元素
  const homePage = document.getElementById('homePage');
  const wordListPage = document.getElementById('wordListPage');
  const settingsPage = document.getElementById('settingsPage');
  const learningPage = document.getElementById('learningPage');

  // 移除所有页面的 active 类
  homePage.classList.remove('active');
  wordListPage.classList.remove('active');
  settingsPage.classList.remove('active');
  learningPage.classList.remove('active');

  // 根据 pageName 显示对应的页面
  switch (pageName) {
    case 'home':
      // 显示首页
      homePage.classList.add('active');
      currentPage = 'home';
      loadHomePage();
      break;
    case 'settings':
      // 显示设置页面
      settingsPage.classList.add('active');
      currentPage = 'settings';
      loadSettings();
      break;
    case 'learning':
      // 显示学习页面
      learningPage.classList.add('active');
      currentPage = 'learning';
      // 学习页面由 learningManager 管理，不需要额外加载
      break;
    default:
      // 显示单词列表页面
      wordListPage.classList.add('active');
      currentPage = 'wordList';
      currentFilter = pageName;
      loadWordListPage(pageName);
      break;
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

// ====================
// 导入导出功能
// ====================

/**
 * 导出翻译数据
 * @param {string} contentType - 导出内容类型 (all, words, phrases, sentences, starred)
 * @param {string} format - 导出格式 (json, csv)
 */
async function exportData(contentType = 'all', format = 'json') {
  try {
    // 获取所有翻译数据
    const result = await chrome.storage.local.get(['translatedWords']);
    const allWords = result.translatedWords || {};
    
    let exportData = {};
    
    // 根据内容类型过滤数据
    switch (contentType) {
      case 'all':
        exportData = allWords;
        break;
      case 'words':
        exportData = Object.fromEntries(
          Object.entries(allWords).filter(([_, word]) => word.type === 'word')
        );
        break;
      case 'phrases':
        exportData = Object.fromEntries(
          Object.entries(allWords).filter(([_, word]) => word.type === 'phrase')
        );
        break;
      case 'sentences':
        exportData = Object.fromEntries(
          Object.entries(allWords).filter(([_, word]) => word.type === 'sentence')
        );
        break;
      case 'starred':
        exportData = Object.fromEntries(
          Object.entries(allWords).filter(([_, word]) => word.starred)
        );
        break;
      default:
        exportData = allWords;
    }
    
    // 准备导出数据
    const exportObject = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      contentType: contentType,
      wordCount: Object.keys(exportData).length,
      data: exportData
    };
    
    let content, filename, mimeType;
    
    if (format === 'csv') {
      // CSV格式导出
      content = convertToCSV(exportData);
      filename = `translation_data_${contentType}_${new Date().toISOString().split('T')[0]}.csv`;
      mimeType = 'text/csv';
    } else {
      // JSON格式导出（默认）
      content = JSON.stringify(exportObject, null, 2);
      filename = `translation_data_${contentType}_${new Date().toISOString().split('T')[0]}.json`;
      mimeType = 'application/json';
    }
    
    // 创建下载链接
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log(`成功导出 ${Object.keys(exportData).length} 条翻译记录`);
    
  } catch (error) {
    console.error('导出数据失败:', error);
    alert('导出数据失败，请重试');
  }
}

/**
 * 将数据转换为CSV格式
 * @param {Object} data - 翻译数据对象
 * @returns {string} CSV格式的字符串
 */
function convertToCSV(data) {
  const headers = ['单词', '翻译', '类型', '词性', '使用次数', '首次使用', '最近使用', '星标'];
  const rows = Object.values(data).map(word => [
    word.word || word.key,
    word.translation,
    word.type,
    word.partOfSpeech || '',
    word.count,
    word.firstUsed,
    word.lastUsed,
    word.starred ? '是' : '否'
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  // 添加BOM以支持中文
  return '\uFEFF' + csvContent;
}

/**
 * 导入翻译数据
 * @param {File} file - 导入的文件
 * @param {string} mode - 导入模式 (merge, replace)
 */
async function importData(file, mode = 'merge') {
  try {
    const content = await file.text();
    let importData;
    
    // 根据文件扩展名解析数据
    if (file.name.endsWith('.json')) {
      importData = JSON.parse(content);
      // 处理新版本数据结构
      if (importData.data) {
        importData = importData.data;
      }
    } else if (file.name.endsWith('.csv')) {
      importData = parseCSV(content);
    } else {
      throw new Error('不支持的文件格式');
    }
    
    // 验证数据格式
    if (!validateImportData(importData)) {
      throw new Error('数据格式不正确');
    }
    
    let result = await chrome.storage.local.get(['translatedWords']);
    let existingWords = result.translatedWords || {};
    
    if (mode === 'replace') {
      // 覆盖模式：清空现有数据
      existingWords = {};
    }
    
    // 合并数据（合并模式或覆盖模式后的空数据）
    let importedCount = 0;
    let updatedCount = 0;
    
    Object.entries(importData).forEach(([key, word]) => {
      if (mode === 'merge' && existingWords[key]) {
        // 合并模式：保留使用次数较多的记录
        if (word.count > existingWords[key].count) {
          existingWords[key] = { ...existingWords[key], ...word };
          updatedCount++;
        }
      } else {
        // 新记录或覆盖模式
        existingWords[key] = word;
        importedCount++;
      }
    });
    
    // 保存合并后的数据
    await chrome.storage.local.set({ translatedWords: existingWords });
    
    // 重新构建索引
    buildIndex();
    searchCache.clear();
    
    console.log(`导入完成：新增 ${importedCount} 条，更新 ${updatedCount} 条`);
    
    // 刷新当前页面
    if (currentPage === 'home') {
      loadHomePage();
    } else {
      loadWordListPage(currentFilter);
    }
    
    return { importedCount, updatedCount };
    
  } catch (error) {
    console.error('导入数据失败:', error);
    throw error;
  }
}

/**
 * 解析CSV格式的数据
 * @param {string} content - CSV内容
 * @returns {Object} 解析后的数据对象
 */
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const data = {};
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
    const word = {};
    
    headers.forEach((header, index) => {
      if (values[index]) {
        switch (header) {
          case '单词':
            word.word = values[index];
            break;
          case '翻译':
            word.translation = values[index];
            break;
          case '类型':
            word.type = values[index];
            break;
          case '词性':
            word.partOfSpeech = values[index];
            break;
          case '使用次数':
            word.count = parseInt(values[index]) || 1;
            break;
          case '首次使用':
            word.firstUsed = values[index];
            break;
          case '最近使用':
            word.lastUsed = values[index];
            break;
          case '星标':
            word.starred = values[index] === '是';
            break;
        }
      }
    });
    
    if (word.word && word.translation) {
      const key = word.word.toLowerCase();
      data[key] = word;
    }
  }
  
  return data;
}

/**
 * 验证导入数据的格式
 * @param {Object} data - 要验证的数据
 * @returns {boolean} 数据是否有效
 */
function validateImportData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  // 检查是否有有效的单词记录
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return false;
  }
  
  // 验证前几条记录的结构
  const sampleEntries = entries.slice(0, 5);
  return sampleEntries.every(([key, word]) => {
    return word && 
           typeof word === 'object' &&
           word.translation &&
           word.type &&
           typeof word.count === 'number';
  });
}

/**
 * 显示导入预览
 * @param {File} file - 导入的文件
 */
async function showImportPreview(file) {
  try {
    const content = await file.text();
    let previewData;
    
    if (file.name.endsWith('.json')) {
      const parsed = JSON.parse(content);
      previewData = parsed.data || parsed;
    } else if (file.name.endsWith('.csv')) {
      previewData = parseCSV(content);
    }
    
    const entries = Object.entries(previewData).slice(0, 5);
    const previewHtml = entries.map(([key, word]) => `
      <div class="preview-item">
        <strong>${escapeHtml(word.word || key)}</strong>: ${escapeHtml(word.translation)}
        <span class="preview-meta">(${word.type}, 使用${word.count}次)</span>
      </div>
    `).join('');
    
    document.getElementById('previewContent').innerHTML = previewHtml;
    document.getElementById('importPreview').style.display = 'block';
    document.getElementById('confirmImportBtn').disabled = false;
    
  } catch (error) {
    console.error('预览导入数据失败:', error);
    document.getElementById('previewContent').innerHTML = '<div style="color: red;">无法预览文件内容</div>';
    document.getElementById('importPreview').style.display = 'block';
    document.getElementById('confirmImportBtn').disabled = true;
  }
}

/**
 * 更新导出统计信息
 * @param {string} contentType - 导出内容类型
 */
async function updateExportStats(contentType) {
  const result = await chrome.storage.local.get(['translatedWords']);
  const allWords = result.translatedWords || {};
  
  let count = 0;
  switch (contentType) {
    case 'all':
      count = Object.keys(allWords).length;
      break;
    case 'words':
      count = Object.values(allWords).filter(w => w.type === 'word').length;
      break;
    case 'phrases':
      count = Object.values(allWords).filter(w => w.type === 'phrase').length;
      break;
    case 'sentences':
      count = Object.values(allWords).filter(w => w.type === 'sentence').length;
      break;
    case 'starred':
      count = Object.values(allWords).filter(w => w.starred).length;
      break;
  }
  
  document.getElementById('exportCount').textContent = count;
}

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

// 设置页面返回按钮
document.getElementById('backBtnFromSettings').addEventListener('click', () => {
  showPage('home');
});

// 导入导出按钮
document.getElementById('importBtn').addEventListener('click', () => {
  document.getElementById('importDialog').style.display = 'flex';
});

document.getElementById('exportBtn').addEventListener('click', () => {
  document.getElementById('exportDialog').style.display = 'flex';
  updateExportStats('all');
});

// 设置按钮
document.getElementById('settingsBtn').addEventListener('click', () => {
  showPage('settings');
  loadSettings();
});

// 导入对话框事件
document.getElementById('closeImportDialog').addEventListener('click', () => {
  document.getElementById('importDialog').style.display = 'none';
  document.getElementById('importFile').value = '';
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('confirmImportBtn').disabled = true;
});

document.getElementById('cancelImportBtn').addEventListener('click', () => {
  document.getElementById('importDialog').style.display = 'none';
  document.getElementById('importFile').value = '';
  document.getElementById('importPreview').style.display = 'none';
  document.getElementById('confirmImportBtn').disabled = true;
});

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    showImportPreview(file);
  }
});

document.getElementById('confirmImportBtn').addEventListener('click', async () => {
  const file = document.getElementById('importFile').files[0];
  const mode = document.getElementById('importMode').value;
  
  if (!file) {
    alert('请选择要导入的文件');
    return;
  }

  try {
    const result = await importData(file, mode);
    alert(`导入成功！新增 ${result.importedCount} 条，更新 ${result.updatedCount} 条`);
    document.getElementById('importDialog').style.display = 'none';
    document.getElementById('importFile').value = '';
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('confirmImportBtn').disabled = true;
  } catch (error) {
    alert('导入失败：' + error.message);
  }
});

// 导出对话框事件
document.getElementById('closeExportDialog').addEventListener('click', () => {
  document.getElementById('exportDialog').style.display = 'none';
});

document.getElementById('cancelExportBtn').addEventListener('click', () => {
  document.getElementById('exportDialog').style.display = 'none';
});

document.getElementById('exportContent').addEventListener('change', (e) => {
  updateExportStats(e.target.value);
});

document.getElementById('confirmExportBtn').addEventListener('click', () => {
  const contentType = document.getElementById('exportContent').value;
  const format = document.getElementById('exportFormat').value;
  exportData(contentType, format);
  document.getElementById('exportDialog').style.display = 'none';
});

// 设置页面事件
document.getElementById('highlightTheme').addEventListener('change', (e) => {
  const customColors = document.getElementById('customColors');
  if (e.target.value === 'custom') {
    customColors.style.display = 'block';
  } else {
    customColors.style.display = 'none';
  }
});

// 背景主题变化事件
document.getElementById('backgroundTheme').addEventListener('change', (e) => {
  const customBackgroundColor = document.getElementById('customBackgroundColor');
  if (e.target.value === 'custom') {
    customBackgroundColor.style.display = 'block';
  } else {
    customBackgroundColor.style.display = 'none';
  }
});

document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
  showPage('home');
});

document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
document.getElementById('importSettingsBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        await importSettings(file);
        alert('设置导入成功！');
      } catch (error) {
        alert('设置导入失败：' + error.message);
      }
    }
  };
  input.click();
});

document.getElementById('resetSettingsBtn').addEventListener('click', () => {
  if (confirm('确定要重置所有设置吗？此操作不可恢复！')) {
    resetSettings();
    alert('设置已重置为默认值');
  }
});

// 学习模式事件
// 学习模式切换
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const mode = e.target.dataset.mode;
    learningManager.initializeLearningMode(mode);
  });
});

// 闪卡模式事件
document.getElementById('flipCard').addEventListener('click', () => {
  learningManager.flipFlashcard();
});

document.querySelectorAll('.difficulty-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const difficulty = e.target.dataset.difficulty;
    learningManager.handleFlashcardDifficulty(difficulty);
  });
});

// 测验模式事件
document.getElementById('nextQuiz').addEventListener('click', () => {
  learningManager.handleNextQuiz();
});

// 拼写模式事件
document.getElementById('submitSpelling').addEventListener('click', () => {
  learningManager.handleSpellingSubmit();
});

document.getElementById('nextSpelling').addEventListener('click', () => {
  learningManager.handleNextSpelling();
});

// 学习总结事件
document.getElementById('reviewMistakes').addEventListener('click', () => {
  learningManager.reviewMistakes();
});

document.getElementById('startNewSession').addEventListener('click', () => {
  learningManager.startNewSession();
});

// 学习页面返回按钮
document.getElementById('backBtnFromLearning').addEventListener('click', () => {
  showPage('home');
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

  // 返回按钮
  document.getElementById('backBtn').addEventListener('click', () => {
    showPage('home');
  });

  // 设置页面返回按钮
  document.getElementById('backBtnFromSettings').addEventListener('click', () => {
    showPage('home');
  });

  // 导入导出按钮
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importDialog').style.display = 'flex';
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    document.getElementById('exportDialog').style.display = 'flex';
    updateExportStats('all');
  });

  // 设置按钮
  document.getElementById('settingsBtn').addEventListener('click', () => {
    showPage('settings');
    loadSettings();
  });

  // 导入对话框事件
  document.getElementById('closeImportDialog').addEventListener('click', () => {
    document.getElementById('importDialog').style.display = 'none';
    document.getElementById('importFile').value = '';
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('confirmImportBtn').disabled = true;
  });

  document.getElementById('cancelImportBtn').addEventListener('click', () => {
    document.getElementById('importDialog').style.display = 'none';
    document.getElementById('importFile').value = '';
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('confirmImportBtn').disabled = true;
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      showImportPreview(file);
    }
  });

  document.getElementById('confirmImportBtn').addEventListener('click', async () => {
    const file = document.getElementById('importFile').files[0];
    const mode = document.getElementById('importMode').value;
    
    if (!file) {
      alert('请选择要导入的文件');
      return;
    }

    try {
      const result = await importData(file, mode);
      alert(`导入成功！新增 ${result.importedCount} 条，更新 ${result.updatedCount} 条`);
      document.getElementById('importDialog').style.display = 'none';
      document.getElementById('importFile').value = '';
      document.getElementById('importPreview').style.display = 'none';
      document.getElementById('confirmImportBtn').disabled = true;
    } catch (error) {
      alert('导入失败：' + error.message);
    }
  });

  // 导出对话框事件
  document.getElementById('closeExportDialog').addEventListener('click', () => {
    document.getElementById('exportDialog').style.display = 'none';
  });

  document.getElementById('cancelExportBtn').addEventListener('click', () => {
    document.getElementById('exportDialog').style.display = 'none';
  });

  document.getElementById('exportContent').addEventListener('change', (e) => {
    updateExportStats(e.target.value);
  });

  document.getElementById('confirmExportBtn').addEventListener('click', () => {
    const contentType = document.getElementById('exportContent').value;
    const format = document.getElementById('exportFormat').value;
    exportData(contentType, format);
    document.getElementById('exportDialog').style.display = 'none';
  });

  // 设置页面事件
  document.getElementById('highlightTheme').addEventListener('change', (e) => {
    const customColors = document.getElementById('customColors');
    if (e.target.value === 'custom') {
      customColors.style.display = 'block';
    } else {
      customColors.style.display = 'none';
    }
  });
  
  // 背景主题变化事件
  document.getElementById('backgroundTheme').addEventListener('change', (e) => {
    const customBackgroundColor = document.getElementById('customBackgroundColor');
    if (e.target.value === 'custom') {
      customBackgroundColor.style.display = 'block';
    } else {
      customBackgroundColor.style.display = 'none';
    }
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('cancelSettingsBtn').addEventListener('click', () => {
    showPage('home');
  });

  document.getElementById('exportSettingsBtn').addEventListener('click', exportSettings);
  document.getElementById('importSettingsBtn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          await importSettings(file);
          alert('设置导入成功！');
        } catch (error) {
          alert('设置导入失败：' + error.message);
        }
      }
    };
    input.click();
  });

  document.getElementById('resetSettingsBtn').addEventListener('click', () => {
    if (confirm('确定要重置所有设置吗？此操作不可恢复！')) {
      resetSettings();
      alert('设置已重置为默认值');
    }
  });
}

// ====================
// 设置管理功能
// ====================

/**
 * 默认设置
 */
const DEFAULT_SETTINGS = {
  highlightTheme: 'default',
  backgroundTheme: 'default',
  backgroundColor: '#667eea',
  customColors: {
    noun: '#4CAF50',
    verb: '#2196F3',
    adjective: '#FF9800',
    adverb: '#9C27B0',
    pronoun: '#E91E63',
    preposition: '#795548',
    conjunction: '#607D8B',
    interjection: '#FF5722',
    default: '#9E9E9E'
  },
  translationAPI: 'youdao',
  apiKey: '',
  apiSecret: '',
  dailyGoal: 20,
  learningMode: 'normal',
  exportSettings: {
    defaultFormat: 'json',
    defaultContent: 'all'
  }
};

/**
 * 加载设置
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get(['userSettings']);
    const settings = result.userSettings || DEFAULT_SETTINGS;
    
    // 填充设置表单
    document.getElementById('backgroundTheme').value = settings.backgroundTheme || 'default';
    document.getElementById('highlightTheme').value = settings.highlightTheme || 'default';
    document.getElementById('translationAPI').value = settings.translationAPI || 'youdao';
    document.getElementById('apiKey').value = settings.apiKey || '';
    document.getElementById('apiSecret').value = settings.apiSecret || '';
    document.getElementById('dailyGoal').value = settings.dailyGoal || 20;
    document.getElementById('learningMode').value = settings.learningMode || 'normal';
    
    // 填充背景颜色
    document.getElementById('backgroundColor').value = settings.backgroundColor || '#667eea';
    
    // 填充自定义颜色
    if (settings.customColors) {
      Object.entries(settings.customColors).forEach(([type, color]) => {
        const colorInput = document.getElementById(`color${type.charAt(0).toUpperCase() + type.slice(1)}`);
        if (colorInput) {
          colorInput.value = color;
        }
      });
    }
    
    // 显示/隐藏自定义背景颜色选择器
    const customBackgroundColor = document.getElementById('customBackgroundColor');
    if (settings.backgroundTheme === 'custom') {
      customBackgroundColor.style.display = 'block';
    } else {
      customBackgroundColor.style.display = 'none';
    }
    
    // 显示/隐藏自定义颜色选择器
    const customColorsDiv = document.getElementById('customColors');
    if (settings.highlightTheme === 'custom') {
      customColorsDiv.style.display = 'block';
    } else {
      customColorsDiv.style.display = 'none';
    }
    
    // 应用背景颜色
    applyBackgroundColor(settings);
    
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

/**
 * 保存设置
 */
async function saveSettings() {
  try {
    const backgroundTheme = document.getElementById('backgroundTheme').value;
    const settings = {
      backgroundTheme: backgroundTheme,
      backgroundColor: backgroundTheme === 'custom' ? document.getElementById('backgroundColor').value : DEFAULT_SETTINGS.backgroundColor,
      highlightTheme: document.getElementById('highlightTheme').value,
      translationAPI: document.getElementById('translationAPI').value,
      apiKey: document.getElementById('apiKey').value,
      apiSecret: document.getElementById('apiSecret').value,
      dailyGoal: parseInt(document.getElementById('dailyGoal').value) || 20,
      learningMode: document.getElementById('learningMode').value,
      customColors: {}
    };
    
    // 收集自定义颜色
    if (settings.highlightTheme === 'custom') {
      const colorTypes = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'default'];
      colorTypes.forEach(type => {
        const colorInput = document.getElementById(`color${type.charAt(0).toUpperCase() + type.slice(1)}`);
        if (colorInput) {
          settings.customColors[type] = colorInput.value;
        }
      });
    }
    
    // 保存到存储
    await chrome.storage.local.set({ userSettings: settings });
    
    console.log('设置已保存');
    alert('设置已保存！');
    
    // 应用背景颜色
    applyBackgroundColor(settings);
    
    // 返回首页
    showPage('home');
    
  } catch (error) {
    console.error('保存设置失败:', error);
    alert('保存设置失败，请重试');
  }
}

/**
 * 导出设置
 */
async function exportSettings() {
  try {
    const result = await chrome.storage.local.get(['userSettings']);
    const settings = result.userSettings || DEFAULT_SETTINGS;
    
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      type: 'settings',
      data: settings
    };
    
    const content = JSON.stringify(exportData, null, 2);
    const filename = `word_translator_settings_${new Date().toISOString().split('T')[0]}.json`;
    
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('设置已导出');
    
  } catch (error) {
    console.error('导出设置失败:', error);
    alert('导出设置失败，请重试');
  }
}

/**
 * 导入设置
 * @param {File} file - 设置文件
 */
async function importSettings(file) {
  try {
    const content = await file.text();
    const importData = JSON.parse(content);
    
    if (importData.type !== 'settings') {
      throw new Error('不是有效的设置文件');
    }
    
    const settings = importData.data || importData;
    
    // 验证设置结构
    const requiredFields = ['highlightTheme', 'translationAPI', 'dailyGoal', 'learningMode'];
    const isValid = requiredFields.every(field => settings.hasOwnProperty(field));
    
    if (!isValid) {
      throw new Error('设置文件格式不正确');
    }
    
    // 保存设置
    await chrome.storage.local.set({ userSettings: settings });
    
    // 重新加载设置
    await loadSettings();
    
    console.log('设置已导入');
    
  } catch (error) {
    console.error('导入设置失败:', error);
    throw error;
  }
}

/**
 * 重置设置
 */
async function resetSettings() {
  try {
    await chrome.storage.local.set({ userSettings: DEFAULT_SETTINGS });
    await loadSettings();
    console.log('设置已重置为默认值');
  } catch (error) {
    console.error('重置设置失败:', error);
  }
}

/**
 * 解析渐变背景，获取主要颜色
 * @param {string} gradient - 渐变背景字符串
 * @returns {string} 主要颜色
 */
function getMainColorFromGradient(gradient) {
  // 简单解析渐变，获取第一个颜色
  const colorMatch = gradient.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,6}/);
  return colorMatch ? colorMatch[0] : '#667eea';
}

/**
 * 计算颜色亮度
 * @param {string} color - 颜色值
 * @returns {number} 亮度值（0-1）
 */
function getColorBrightness(color) {
  // 处理十六进制颜色
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.slice(0, 2), 16);
    const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.slice(2, 4), 16);
    const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  
  // 处理rgba颜色
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
  }
  
  return 0.5; // 默认亮度
}

/**
 * 从背景色衍生卡片颜色配置
 * @param {string} backgroundColor - 背景颜色
 * @returns {Object} 卡片颜色配置
 */
function deriveCardColors(backgroundColor) {
  const brightness = getColorBrightness(backgroundColor);
  const isDark = brightness < 0.5;
  
  // 根据背景亮度调整卡片透明度
  const cardOpacity = isDark ? 0.8 : 0.6;
  const cardHoverOpacity = isDark ? 0.9 : 0.75;
  const inputOpacity = isDark ? 0.8 : 0.6;
  const inputFocusOpacity = isDark ? 0.9 : 0.8;
  
  // 基于背景亮度确定文字颜色
  const textPrimary = isDark ? '#ffffff' : '#1a1a1a';
  const textSecondary = isDark ? '#cccccc' : '#555';
  const textTertiary = isDark ? '#999999' : '#888';
  
  // 确定卡片背景色
  const cardBg = isDark 
    ? `rgba(30, 30, 40, ${cardOpacity})`
    : `rgba(255, 255, 255, ${cardOpacity})`;
  
  const cardHover = isDark 
    ? `rgba(40, 40, 50, ${cardHoverOpacity})`
    : `rgba(255, 255, 255, ${cardHoverOpacity})`;
  
  const inputBg = isDark 
    ? `rgba(40, 40, 50, ${inputOpacity})`
    : `rgba(255, 255, 255, ${inputOpacity})`;
  
  const inputFocus = isDark 
    ? `rgba(50, 50, 60, ${inputFocusOpacity})`
    : `rgba(255, 255, 255, ${inputFocusOpacity})`;
  
  // 边框颜色
  const borderColor = isDark 
    ? 'rgba(255, 255, 255, 0.1)'
    : 'rgba(0, 0, 0, 0.08)';
  
  const borderHover = isDark 
    ? 'rgba(255, 255, 255, 0.2)'
    : 'rgba(0, 0, 0, 0.12)';
  
  return {
    cardBg,
    cardHover,
    inputBg,
    inputFocus,
    textPrimary,
    textSecondary,
    textTertiary,
    borderColor,
    borderHover
  };
}

/**
 * 应用背景颜色设置
 * @param {Object} settings - 用户设置对象
 */
function applyBackgroundColor(settings) {
  const root = document.documentElement;
  const body = document.body;
  
  // 定义增强的预设主题颜色 - 更复杂的渐变效果
  const themeColors = {
    default: {
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
      accent: '#667eea'
    },
    dark: {
      gradient: 'radial-gradient(circle at 10% 20%, rgb(32, 32, 32) 0%, rgb(18, 18, 18) 90%)',
      accent: '#667eea'
    },
    blue: {
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 30%, #667eea 70%, #764ba2 100%)',
      accent: '#4facfe'
    },
    purple: {
      gradient: 'linear-gradient(135deg, #88d3ce 0%, #6e45e2 30%, #ec87c0 70%, #a8edea 100%)',
      accent: '#6e45e2'
    },
    green: {
      gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 30%, #4facfe 70%, #00f2fe 100%)',
      accent: '#43e97b'
    }
  };
  
  // 获取当前主题配置
  const theme = themeColors[settings.backgroundTheme] || themeColors.default;
  
  // 应用背景颜色
  if (settings.backgroundTheme === 'custom') {
    // 使用自定义颜色
    const bgColor = settings.backgroundColor;
    const gradient = `linear-gradient(135deg, ${bgColor} 0%, ${adjustBrightness(bgColor, -20)} 50%, ${adjustBrightness(bgColor, -40)} 100%)`;
    body.style.background = gradient;
    
    // 从背景色衍生卡片颜色
    const cardColors = deriveCardColors(bgColor);
    
    // 设置自定义主题的CSS变量
    root.style.setProperty('--bg-primary', gradient);
    root.style.setProperty('--accent-primary', bgColor);
    root.style.setProperty('--text-primary', cardColors.textPrimary);
    root.style.setProperty('--text-secondary', cardColors.textSecondary);
    root.style.setProperty('--text-tertiary', cardColors.textTertiary);
    root.style.setProperty('--bg-card', cardColors.cardBg);
    root.style.setProperty('--bg-card-hover', cardColors.cardHover);
    root.style.setProperty('--bg-input', cardColors.inputBg);
    root.style.setProperty('--bg-input-focus', cardColors.inputFocus);
    root.style.setProperty('--border-color', cardColors.borderColor);
    root.style.setProperty('--border-hover', cardColors.borderHover);
  } else {
    // 使用预设主题
    body.style.background = theme.gradient;
    
    // 从渐变中获取主要颜色
    const mainColor = getMainColorFromGradient(theme.gradient);
    
    // 从背景色衍生卡片颜色
    const cardColors = deriveCardColors(mainColor);
    
    // 设置CSS变量，使UI元素与主题颜色呼应
    root.style.setProperty('--bg-primary', theme.gradient);
    root.style.setProperty('--accent-primary', theme.accent);
    root.style.setProperty('--text-primary', cardColors.textPrimary);
    root.style.setProperty('--text-secondary', cardColors.textSecondary);
    root.style.setProperty('--text-tertiary', cardColors.textTertiary);
    root.style.setProperty('--bg-card', cardColors.cardBg);
    root.style.setProperty('--bg-card-hover', cardColors.cardHover);
    root.style.setProperty('--bg-input', cardColors.inputBg);
    root.style.setProperty('--bg-input-focus', cardColors.inputFocus);
    root.style.setProperty('--border-color', cardColors.borderColor);
    root.style.setProperty('--border-hover', cardColors.borderHover);
  }
  
  // 添加动画类，实现动态效果
  body.classList.add('animated-bg');
  
  // 确保动画效果持续运行
  body.style.backgroundSize = '400% 400%';
  body.style.animation = 'gradientShift 15s ease infinite';
}

/**
 * 调整颜色亮度
 * @param {string} color - 颜色值（支持hex、rgb）
 * @param {number} percent - 亮度调整百分比（正值变亮，负值变暗）
 * @returns {string} 调整后的颜色
 */
function adjustBrightness(color, percent) {
  // 处理十六进制颜色
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    
    let r = (num >> 16) & 255;
    let g = (num >> 8) & 255;
    let b = num & 255;
    
    // 调整亮度
    const factor = 1 + percent / 100;
    r = Math.min(255, Math.max(0, Math.round(r * factor)));
    g = Math.min(255, Math.max(0, Math.round(g * factor)));
    b = Math.min(255, Math.max(0, Math.round(b * factor)));
    
    // 转换回十六进制
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
  
  return color;
}

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

/**
 * 初始化应用
 * 加载首页并应用背景颜色设置
 */
async function initializeApp() {
  // 加载设置并应用背景颜色
  const result = await chrome.storage.local.get(['userSettings']);
  const settings = result.userSettings || DEFAULT_SETTINGS;
  applyBackgroundColor(settings);
  
  // 加载首页
  loadHomePage();
  
  // 初始化事件监听器
  initializeEventListeners();
}

// 页面加载时初始化应用
initializeApp();

