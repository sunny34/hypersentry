import axios from 'axios';

async function testApi() {
    const symbol = '';
    const endTime = Date.now();
    const startTime = endTime - 24 * 60 * 60 * 1000;

    console.log('Testing candleSnapshot...');
    try {
        const res = await axios.post('https://api.hyperliquid.xyz/info', {
            type: 'candleSnapshot',
            req: {
                coin: symbol,
                interval: '15m',
                startTime: startTime,
                endTime: endTime,
            },
        });
        console.log('Status:', res.status);
        console.log('Data length:', res.data.length);
    } catch (e) {
        const err = e;
        console.error('Error:', err.response ? err.response.status : err.message);
        console.error('Data:', err.response ? err.response.data : '');
    }
}

testApi();
