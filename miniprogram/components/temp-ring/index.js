Component({
  properties: {
    value: { type: Number, value: 0 },
    label: { type: String, value: '' },
    status: { type: String, value: '' },
  },

  observers: {
    'value, label, status': function () {
      wx.nextTick(() => this.draw());
    },
  },

  lifetimes: {
    attached() {
      wx.nextTick(() => this.draw());
    },
  },

  methods: {
    colorOf(v) {
      if (v < 30) return '#2f9e5e';
      if (v < 50) return '#d2601a';
      return '#b3352c';
    },

    draw() {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('.ring-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          try {
            if (!res || !res[0] || !res[0].node) return;
            const canvas = res[0].node;
            const ctx = canvas.getContext('2d');
            const dpr = wx.getSystemInfoSync().pixelRatio || 2;
            const w = res[0].width;
            const h = res[0].height;
            if (!w || !h) return;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, w, h);

            const v = Math.max(0, Math.min(100, Number(this.data.value) || 0));
            const cx = w / 2;
            const cy = h / 2;
            const r = Math.min(w, h) / 2 - 10;
            const start = -Math.PI / 2;
            const end = start + (v / 100) * Math.PI * 2;

            ctx.lineWidth = 10;
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = '#eeeae3';
            ctx.stroke();

            if (v > 0) {
              ctx.beginPath();
              ctx.arc(cx, cy, r, start, end);
              ctx.strokeStyle = this.colorOf(v);
              ctx.stroke();
            }

            ctx.fillStyle = this.colorOf(v);
            ctx.font = `500 ${Math.round(r * 0.62)}px -apple-system, "PingFang SC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(Math.round(v)), cx, cy - r * 0.06);

            ctx.fillStyle = '#78809a';
            ctx.font = `400 ${Math.round(r * 0.22)}px -apple-system, "PingFang SC", sans-serif`;
            ctx.fillText('°C', cx, cy + r * 0.42);
          } catch (e) {
            console.warn('[temp-ring] 绘制失败', e);
          }
        });
    },
  },
});
