/**
 * 单词翻译助手 - 后台服务工作进程
 *
 * 主要功能：
 * 1. 调用第三方翻译/词典API（网易有道开放平台）
 * 2. 处理扩展安装事件
 * 3. 与内容脚本(content script)进行消息通信
 * 4. 管理翻译请求和响应
 */

// 监听扩展安装事件 - 当用户首次安装或更新扩展时触发
chrome.runtime.onInstalled.addListener(() => {
  console.log('单词翻译助手已安装');
});

// =========================
// 网易有道翻译/词典 API 集成模块
// =========================

// TODO: 将下面两个占位字符串替换为你在有道开放平台申请的 appKey 和 appSecret
// 有道翻译API的应用密钥 - 用于身份验证
const YOUDAO_APP_KEY = '73a29bc0304b261d';
// 有道翻译API的应用密钥 - 用于生成签名
const YOUDAO_APP_SECRET = 'cek7XucQ5ggaDqXDCMYEVXs0FiZTHueX';

/**
 * 生成有道API签名所需的截断函数
 * 根据有道官方文档算法，对查询文本进行长度处理
 *
 * @param {string} q - 要翻译的文本
 * @returns {string} 处理后的文本
 */
function truncate(q) {
  const len = q.length;
  if (len <= 20) return q;
  return q.substring(0, 10) + len + q.substring(len - 10, len);
}

/**
 * 计算SHA-256哈希值并返回十六进制字符串
 * 用于有道API的v3签名算法
 *
 * @param {string} message - 要哈希的消息
 * @returns {Promise<string>} SHA-256哈希值的十六进制表示
 */
async function sha256Hex(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 调用网易有道开放平台进行文本翻译
 * 支持自动语言检测和中英文互译
 *
 * @param {string} text - 要翻译的文本内容
 * @returns {Promise<Object>} 翻译结果对象，包含译文、词典信息等
 * @throws {Error} 当API配置错误或翻译失败时抛出异常
 */
async function translateWithYoudao(text) {
  // 检查API密钥是否正确配置
  if (!YOUDAO_APP_KEY || !YOUDAO_APP_SECRET || YOUDAO_APP_KEY === 'Y73a29bc0304b261d') {
    throw new Error('Youdao appKey/appSecret 未配置');
  }

  // API请求基础配置
  const url = 'https://openapi.youdao.com/api';
  const q = text;                    // 查询文本
  const from = 'auto';               // 源语言自动检测
  const to = 'zh-CHS';               // 目标语言：简体中文
  const salt = Date.now().toString(); // 随机盐值，防止重放攻击
  const curtime = Math.floor(Date.now() / 1000).toString(); // 当前时间戳

  // 生成API签名字符串
  const signStr = YOUDAO_APP_KEY + truncate(q) + salt + curtime + YOUDAO_APP_SECRET;
  const sign = await sha256Hex(signStr); // 计算SHA-256签名

  // 构建请求参数
  const params = new URLSearchParams({
    q,                    // 查询文本
    from,                 // 源语言
    to,                   // 目标语言
    appKey: YOUDAO_APP_KEY, // 应用密钥
    salt,                 // 盐值
    sign,                 // 签名
    signType: 'v3',       // 签名类型
    curtime               // 时间戳
  });

  // 发送HTTP POST请求到有道API
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  // 解析JSON响应
  const data = await resp.json();

  // 检查API响应是否成功
  if (data.errorCode !== '0') {
    console.error('Youdao API error:', data);
    throw new Error('Youdao error: ' + data.errorCode);
  }

  // 提取翻译结果
  const translation = Array.isArray(data.translation) ? data.translation[0] : ''; // 主译文
  const basic = data.basic || null; // 词典信息（单词音标、词性等）

  // 返回结构化的翻译结果
  return {
    translation,    // 翻译文本
    basic,         // 词典详细信息
    raw: data      // 原始API响应数据
  };
}

/**
 * 消息监听器 - 处理来自内容脚本的翻译请求
 * 使用Chrome扩展消息传递API进行跨脚本通信
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 检查消息类型是否为翻译请求
  if (msg && msg.type === 'YOUDAO_TRANSLATE' && msg.text) {
    // 异步调用翻译函数
    translateWithYoudao(msg.text)
      .then(result => {
        // 翻译成功，返回结果
        sendResponse({ ok: true, result });
      })
      .catch(err => {
        // 翻译失败，记录错误并返回错误信息
        console.error('Youdao translate failed:', err);
        sendResponse({ ok: false, error: err.message });
      });
    // 返回true表示将异步发送响应
    return true;
  }
});


