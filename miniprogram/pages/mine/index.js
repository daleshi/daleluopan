const api = require('../../utils/api');

Page({
  data: {
    user: null,
    hasToken: false,
    checking: false,
    baseUrl: api.BASE,
  },

  onShow() {
    const t = api.getToken();
    this.setData({ hasToken: !!t });
    if (t) this.checkMe();
    else this.setData({ user: null });
  },

  async checkMe() {
    this.setData({ checking: true });
    try {
      const me = await api.getMe();
      if (me) this.setData({ user: me, hasToken: true });
      else this.setData({ user: null, hasToken: false });
    } catch (e) {
      this.setData({ user: null, hasToken: false });
    }
    this.setData({ checking: false });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/index' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      success: async (res) => {
        if (!res.confirm) return;
        await api.logout();
        this.setData({ user: null, hasToken: false });
        wx.showToast({ title: '已退出', icon: 'none' });
      },
    });
  },

  onCopyUrl() {
    wx.setClipboardData({ data: api.BASE });
  },
});
