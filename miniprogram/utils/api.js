const BASE = 'https://daleluopan.com';

let TOKEN = wx.getStorageSync('ic_token') || '';

function getToken() {
  return TOKEN;
}

function setToken(t) {
  TOKEN = t || '';
  if (TOKEN) wx.setStorageSync('ic_token', TOKEN);
  else wx.removeStorageSync('ic_token');
}

function request(path, method = 'GET', data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method,
      data,
      timeout: 20000,
      header: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      success: (res) => {
        if (res.statusCode === 401) {
          setToken('');
          const e = new Error('登录已失效');
          e.code = 401;
          return reject(e);
        }
        if (res.statusCode >= 500) {
          return reject(new Error(`服务异常 ${res.statusCode}`));
        }
        const body = res.data;
        if (body && body.success) return resolve(body.data);
        reject(new Error((body && body.error) || '请求失败'));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络异常')),
    });
  });
}

module.exports = {
  BASE,
  getToken,
  setToken,
  request,

  // 指数估值总览（免登录）
  getIndices: () => request('/api/indices'),
  // 每日估值全量表（免登录）
  getDailyEval: () => request('/api/daily-eval'),
  // 单指数温度详情（免登录）
  getThermometerDetail: (code) => request(`/api/thermometer/detail?code=${encodeURIComponent(code)}`),

  // 以下需登录
  login: async (username, password) => {
    const data = await request('/api/auth/login', 'POST', { username, password });
    if (data && data.token) setToken(data.token);
    return data;
  },
  getMe: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', 'POST').catch(() => {}).then(() => setToken('')),
};
