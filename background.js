// Background service worker
// 负责调用第三方翻译 / 词典接口，并与 content script 通信

// 监听扩展安装
chrome.runtime.onInstalled.addListener(() => {
  console.log('单词翻译助手已安装');
});

// =========================
// 网易有道翻译/词典 API 集成
// =========================

// TODO: 将下面两个占位字符串替换为你在有道开放平台申请的 appKey 和 appSecret
const YOUDAO_APP_KEY = '73a29bc0304b261d';
const YOUDAO_APP_SECRET = 'cek7XucQ5ggaDqXDCMYEVXs0FiZTHueX';

// 生成有道签名所需的 truncate 函数（官方文档算法）
function truncate(q) {
  const len = q.length;
  if (len <= 20) return q;
  return q.substring(0, 10) + len + q.substring(len - 10, len);
}

// 计算 SHA-256 并返回 16 进制字符串（signType=v3）
async function sha256Hex(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 调用有道开放平台进行翻译
async function translateWithYoudao(text) {
  if (!YOUDAO_APP_KEY || !YOUDAO_APP_SECRET || YOUDAO_APP_KEY === 'Y73a29bc0304b261d') {
    throw new Error('Youdao appKey/appSecret 未配置');
  }

  const url = 'https://openapi.youdao.com/api';
  const q = text;
  const from = 'auto';
  const to = 'zh-CHS';
  const salt = Date.now().toString();
  const curtime = Math.floor(Date.now() / 1000).toString();

  const signStr = YOUDAO_APP_KEY + truncate(q) + salt + curtime + YOUDAO_APP_SECRET;
  const sign = await sha256Hex(signStr);

  const params = new URLSearchParams({
    q,
    from,
    to,
    appKey: YOUDAO_APP_KEY,
    salt,
    sign,
    signType: 'v3',
    curtime
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await resp.json();

  if (data.errorCode !== '0') {
    console.error('Youdao API error:', data);
    throw new Error('Youdao error: ' + data.errorCode);
  }

  // 主译文
  const translation = Array.isArray(data.translation) ? data.translation[0] : '';

  // 词典信息（如果是单词/短语，会包含）
  const basic = data.basic || null;

  return {
    translation,
    basic,
    raw: data
  };
}

// 接收 content script 的翻译请求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'YOUDAO_TRANSLATE' && msg.text) {
    translateWithYoudao(msg.text)
      .then(result => {
        sendResponse({ ok: true, result });
      })
      .catch(err => {
        console.error('Youdao translate failed:', err);
        sendResponse({ ok: false, error: err.message });
      });
    // 表示异步响应
    return true;
  }
});


