const api = require('../../utils/api');
const fmt = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    temperature: 0,
    status: '',
    trend: '',
    updateTime: '',
    bands: [],
    notes: [],
    list: [],
    detail: null,
  },

  onLoad(options) {
    this.code = options && options.code ? decodeURIComponent(options.code) : '';
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

      const list = (th.allIndices || [])
        .slice()
        .sort((a, b) => (a.temperature || 0) - (b.temperature || 0))
        .map((it) => ({
          name: it.name,
          code: it.code,
          temperature: it.temperature,
          tempText: fmt.tempText(it.temperature),
          tempColor: fmt.tempColor(it.temperature),
          tempW: Math.max(0, Math.min(100, Number(it.temperature) || 0)),
          internalYield: it.internalYield === null || it.internalYield === undefined ? '--' : fmt.num(it.internalYield) + '%',
          dividendYield: it.dividendYield === null || it.dividendYield === undefined ? '--' : fmt.num(it.dividendYield) + '%',
        }));

      this.setData({
        temperature: th.marketTemperature === undefined ? 0 : th.marketTemperature,
        status: th.marketStatus || '',
        trend: th.marketTrend || '',
        updateTime: th.updateTime || '',
        bands: th.bands || [],
        notes: th.notes || [],
        list,
        loading: false,
      });

      if (this.code) this.loadDetail(this.code);
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败' });
    }
    wx.stopPullDownRefresh();
  },

  async loadDetail(code) {
    try {
      const d = await api.getThermometerDetail(code);
      if (!d || d.supported === false) {
        this.setData({ detail: { unsupported: true, name: code, message: (d && d.message) || '暂无温度数据' } });
        return;
      }
      this.setData({
        detail: {
          unsupported: false,
          name: d.name || code,
          code: d.code || code,
          temperature: d.temperature,
          tempColor: fmt.tempColor(d.temperature),
          internalYield: d.internalYield === null || d.internalYield === undefined ? '--' : fmt.num(d.internalYield) + '%',
          dividendYield: d.dividendYield === null || d.dividendYield === undefined ? '--' : fmt.num(d.dividendYield) + '%',
          tags: d.tags || [],
          description: d.description || '',
          industries: (d.industries || []).slice(0, 5),
          riskNote: d.riskNote || '',
        },
      });
    } catch (e) {
      this.setData({ detail: { unsupported: true, name: code, message: (e && e.message) || '详情获取失败' } });
    }
  },
});
