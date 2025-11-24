export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    if (url.pathname === '/price') {
      const price = await getReliableTetherPriceToman();
      
      return new Response(
        JSON.stringify({
          tether_price_toman: price.final_price,
          source: price.source,
          fallback_used: price.fallback_count,
          updated_at: new Date().toLocaleString('fa-IR'),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    return new Response('Not Found', { status: 404 });
  },
};

// تابع اصلی: تا جایی که بتونه قیمت می‌گیره!
async function getReliableTetherPriceToman() {
  const strategies = [
    fetchFromArzDigital,
    fetchFromNobitex,
    fetchFromWallex,
    fetchFromTGJU,
    fetchFromCoingeckoAndFreeDollar,
  ];

  let lastError;
  let fallbackCount = 0;

  for (const strategy of strategies) {
    try {
      const price = await strategy();
      if (price && price > 50000 && price < 2000000) { // محدوده منطقی قیمت تتر به تومان
        return {
          final_price: Math.round(price),
          source: strategy.name.replace('fetchFrom', ''),
          fallback_count: fallbackCount,
        };
      }
    } catch (err) {
      lastError = err;
      fallbackCount++;
      console.error(`Fallback ${fallbackCount}: ${strategy.name} failed`, err);
    }
  }

  // اگر همه شکست خوردن، آخرین امید: مقدار پیش‌فرض منطقی
  return {
    final_price: 625000,
    source: 'پیش‌فرض (همه APIها قطع)',
    fallback_count: fallbackCount,
  };
}

// 1. ارزدیجیتال
async function fetchFromArzDigital() {
  const res = await fetch('https://api.arzdigital.com/market/ticker/USDT/');
  const data = await res.json();
  return data.price; // مستقیم قیمت به تومان
}

// 2. نوبیتکس
async function fetchFromNobitex() {
  const res = await fetch('https://api.nobitex.ir/v2/orderbook/USDTIRT');
  const data = await res.json();
  const bestSell = parseFloat(data.sell[0]?.price || 0); // بهترین قیمت فروش
  return bestSell > 0 ? bestSell : null;
}

// 3. والکس
async function fetchFromWallex() {
  const res = await fetch('https://api.wallex.ir/v1/currencies/stats');
  const data = await res.json();
  const usdt = data.result.find(c => c.key === 'USDT_IRT');
  return usdt ? parseFloat(usdt.price) : null;
}

// 4. سایت اتحادیه طلا و ارز (tgju.org)
async function fetchFromTGJU() {
  const res = await fetch('https://www.tgju.org/profile/price_dollar_rl', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const text = await res.text();
  const match = text.match(/"price":(\d+)/);
  if (match) {
    const dollarPrice = parseInt(match[1]);
    return Math.round(dollarPrice * 1.0005); // تتر ≈ دلار + کمی پرمیوم
  }
  return null;
}

// 5. کوین‌گکو + نرخ دلار آزاد از منبع ایرانی
async function fetchFromCoingeckoAndFreeDollar() {
  const [usdtRes, dollarRes] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd'),
    fetch('https://api.tgju.org/v1/market/indicator/summary')
  ]);

  const usdtData = await usdtRes.json();
  const dollarText = await dollarRes.text();

  const usdtUsd = usdtData?.tether?.usd || 1;

  // استخراج دلار آزاد از tgju
  const dollarMatch = dollarText.match(/"price_dollar_rl":\{"price":(\d+)/);
  const dollarIrr = dollarMatch ? parseInt(dollarMatch[1]) : 620000;

  return Math.round((dollarIrr / 10) * usdtUsd); // تبدیل ریال به تومان
}

// HTML صفحه (همون قبلی، فقط کمی بهبود)
const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>قیمت تتر به تومان - ضدقطعی</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;background:linear-gradient(135deg,#0f0c29,#30304b);color:#e2e8f0;text-align:center;padding:50px;margin:0;}
  .box{background:rgba(255,255,255,0.05);border-radius:16px;padding:30px;max-width:500px;margin:20px auto;box-shadow:0 10px 30px rgba(0,0,0,0.5);}
  .price{font-size:4.5rem;font-weight:bold;color:#22c55e;margin:20px 0;}
  .source{color:#94a3b8;font-size:1rem;margin:15px 0;}
  .fallback{color:#f59e0b;font-size:0.9rem;}
  button{padding:12px 30px;background:#3b82f6;color:white;border:none;border-radius:50px;font-size:1.1rem;cursor:pointer;margin-top:20px;}
  button:hover{background:#2563eb;}
</style>
</head>
<body>
<div class="box">
  <h1>قیمت لحظه‌ای تتر (USDT)</h1>
  <div id="price" class="price">در حال بارگذاری...</div>
  <div id="source" class="source"></div>
  <div id="fallback" class="fallback"></div>
  <p>آخرین بروزرسانی: <span id="time">-</span></p>
  <button onclick="updateNow()">بروزرسانی دستی</button>
</div>

<script>
async function updateNow() {
  document.getElementById('price').textContent = 'در حال دریافت...';
  try {
    const res = await fetch('/price?t=' + Date.now());
    const data = await res.json();
    const p = data.tether_price_toman;
    document.getElementById('price').innerHTML = p.toLocaleString('fa-IR') + ' <small style="font-size:2rem">تومان</small>';
    document.getElementById('source').textContent = 'منبع: ' + data.source;
    document.getElementById('fallback').textContent = data.fallback_used > 0 ? 'از منبع جایگزین استفاده شد (' + data.fallback_used + ')' : 'منبع اصلی فعال است';
    document.getElementById('time').textContent = new Date().toLocaleString('fa-IR');
  } catch(e) {
    document.getElementById('price').textContent = 'خطا در اتصال';
  }
}
updateNow();
setInterval(updateNow, 12000); // هر ۱۲ ثانیه
</script>
</body></html>`;