'use strict';

// 用时间戳后6位作为后缀，保证唯一且不超过用户名 20 字符限制
const TS = String(Date.now()).slice(-6);

module.exports = {
    // 测试用户（每次运行使用时间戳后缀，避免与真实数据冲突）
    testUser: {
        username: `tu_${TS}`,       // max 9 chars
        password: 'Test12345',
        nickname: '测试用户',
    },

    testUser2: {
        username: `tu2_${TS}`,      // max 10 chars
        password: 'Test12345',
        role: 'user',
    },

    // 测试指数（不会出现在真实关注列表中的代码）
    testIndex: {
        code: '999999',
        name: '测试指数',
        market: 'SH',
        secid: '1.999999',
        category: 'test',
    },

    // 测试股票
    testStock: {
        code: '999998',
        name: '测试股票',
        market: 'SH',
        secid: '1.999998',
        sector: '测试行业',
    },

    // 测试 ETF
    testEtf: {
        code: '999997',
        name: '测试ETF',
        market: 'SH',
        secid: '1.999997',
        category: 'test',
    },

    // 测试基金
    testFund: {
        code: '999996',
        name: '测试基金',
        shortName: '测试',
        type: 'index',
        category: 'test',
    },

    // 测试 DCA 策略
    testDcaPlan: {
        indexCode: 'TEST999',
        indexName: '测试定投指数',
        monthlyAmount: 1000,
        levels: [
            { label: '低温', tempRange: '0-30', investPct: 100, investAmt: 1000, reserveAmt: 0, color: '#48bb78' },
        ],
    },

    // 测试加仓基准
    testBenchmark: {
        indexCode: 'TEST998',
        indexName: '测试加仓基准',
        baseValue: 4000,
        levels: [
            { pct: -10, ratio: 1.5 },
            { pct: -20, ratio: 2.0 },
        ],
    },
};
