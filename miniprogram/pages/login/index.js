const api = require('../../utils/api');

Page({
  data: {
    username: '',
    password: '',
    loading: false,
  },

  onUser(e) {
    this.setData({ username: e.detail.value });
  },

  onPwd(e) {
    this.setData({ password: e.detail.value });
  },

  async onSubmit() {
    const { username, password } = this.data;
    if (!username.trim() || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const data = await api.login(username.trim(), password);
      if (!data || !data.token) {
        wx.showModal({
          title: '登录成功但无 token',
          content: '线上后端尚未部署「登录返回 token」改动，无法保持登录态。估值与温度功能无需登录，可正常使用。',
          showCancel: false,
        });
        return;
      }
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '登录失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },
});
