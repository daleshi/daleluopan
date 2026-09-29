Component({
  properties: {
    data: { type: Array, value: [] },
    color: { type: String, value: '#e24b4a' },
  },

  observers: {
    'data, color': function () {
      // 等一帧，确保节点已布局
      wx.nextTick(() => this.draw());
    },
  },

  lifetimes: {
    attached() {
      wx.nextTick(() => this.draw());
    },
  },

  methods: {
    draw() {
      const query = wx.createSelectorQuery().in(this);
      query
        .select('.spark-canvas')
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

            const pts = (this.data.data || []).filter((v) => typeof v === 'number' && !Number.isNaN(v));
            if (pts.length < 2) return;

            const min = Math.min(...pts);
            const max = Math.max(...pts);
            const span = max - min || 1;
            const pad = 4;
            const coords = pts.map((v, i) => [
              (i / (pts.length - 1)) * (w - pad * 2) + pad,
              h - pad - ((v - min) / span) * (h - pad * 2),
            ]);

            ctx.beginPath();
            ctx.moveTo(coords[0][0], coords[0][1]);
            coords.forEach((p) => ctx.lineTo(p[0], p[1]));
            ctx.strokeStyle = this.data.color;
            ctx.lineWidth = 1.6;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            const grd = ctx.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, this.rgba(this.data.color, 0.22));
            grd.addColorStop(1, this.rgba(this.data.color, 0));
            ctx.lineTo(coords[coords.length - 1][0], h - pad);
            ctx.lineTo(coords[0][0], h - pad);
            ctx.closePath();
            ctx.fillStyle = grd;
            ctx.fill();
          } catch (e) {
            // 图表绘制失败不影响主流程
            console.warn('[sparkline] 绘制失败', e);
          }
        });
    },

    rgba(hex, alpha) {
      const h = String(hex || '').replace('#', '');
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      const n = parseInt(full || '000000', 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    },
  },
});
