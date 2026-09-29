const api = require('../../utils/api');
const fmt = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    updateTime: '',
    mkt: null,
    list: [],
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(true);
  },

  async load(silent) {
    if (!silent) this.setData({ loading: true });
    this.setData({ error: '' });
    try {
      const d = await api.getIndices();
      const th = d.thermometer || {};
      const mkt = {
        temperature: th.marketTemperature === undefined ? null : th.marketTemperature,
        status: th.marketStatus || '',
        trend: th.marketTrend || '',
        updateTime: th.updateTime || '',
      };

      const list = (d.indices || []).map((it) => {
        const eva = fmt.evaInfo(it.evaType);
        const pePct = it.pePercentile === null || it.pePercentile === undefined ? null : Number(it.pePercentile);
        return {
          code: it.code,
          name: it.name,
          icon: it.icon,
          iconBg: it.iconBg,
          iconColor: it.iconColor || '#fff',
          sparkData: it.sparkData || [],
          _priceText: fmt.num(it.price),
          _chgText: fmt.signed(it.change),
          _amtText: fmt.signed(it.changeAmt, 2, ''),
          _chgColor: fmt.changeColor(it.change),
          _pe: fmt.num(it.pe),
          _pb: fmt.num(it.pb),
          _roe: it.roe === null || it.roe === undefined ? '--' : fmt.num(it.roe) + '%',
          _div: it.dividend === null || it.dividend === undefined ? '--' : fmt.num(it.dividend) + '%',
          _pePct: pePct === null ? '--' : pePct.toFixed(1) + '%',
          _pePctW: pePct === null ? 0 : Math.max(0, Math.min(100, pePct)),
          _evaText: eva.text,
          _evaCls: eva.cls,
          _tempText: fmt.tempText(it.temperature),
          _tempLabel: (it.temperatureStatus && it.temperatureStatus.label) || '',
          _tempColor: fmt.tempColor(it.temperature),
          _sparkColor: fmt.trendColor(it.sparkData),
        };
      });

      this.setData({
        mkt,
        list,
        updateTime: fmt.shortTime(d.updateTime),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
    wx.stopPullDownRefresh();
  },

  onTapCard(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    wx.navigateTo({ url: `/pages/thermometer/index?code=${encodeURIComponent(code)}` });
  },
});
