import http from 'k6/http';
import { check, group } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const searchLatency = new Trend('search_latency');
const failedRequests = new Counter('failed_requests');

export const options = {
  // شبیه‌سازی حمله‌مانند و ترافیک بسیار شدید
  stages: [
    { duration: '10s', target: 50 },   // ورود سریع ۲۰۰ کاربر
    { duration: '20s', target: 200 },   // جهش به ۸۰۰ کاربر
    { duration: '30s', target: 500 },  // اوج فشار با ۱۵۰۰ کاربر همزمان بدون مکث
    { duration: '10s', target: 0 },     // فرود
  ],

  // حد آستانه سخت‌گیرانه برای ثبت شکست در CI
  thresholds: {
    http_req_failed: ['rate<0.01'],        // اگر حتی ۱٪ خطا داد رد شود
    http_req_duration: ['p(95)<300'],      // اگر پاسخ‌ها بالای ۳۰۰ms رفت یعنی سیستم قفل کرده
  },
};

const BASE_URL = 'http://localhost:8080';

export default function () {
  group('Heavy Database Queries', function () {
    // ۱. درخواست سنگین: جستجوی صاحبان حیوانات با رشته خالی (دریافت کل لیست از DB)
    const res1 = http.get(`${BASE_URL}/owners?lastName=`);
    searchLatency.add(res1.timings.duration);

    const check1 = check(res1, {
      'Owners search status 200': (r) => r.status === 200,
    });
    if (!check1) failedRequests.add(1);

    // ۲. فراخوانی صفحه لیست کامل دامپزشکان
    const res2 = http.get(`${BASE_URL}/vets.html`);
    const check2 = check(res2, {
      'Vets page status 200': (r) => r.status === 200,
    });
    if (!check2) failedRequests.add(1);
  });

  // هیچ sleepای وجود ندارد تا سرور حتی ۱ میلی‌ثانیه تنفس نکند!
}

// --- گزارش‌گیری و محاسبه میزان خرابی / پیشنهاد منابع ---
export function handleSummary(data) {
  const p95Latency = data.metrics.http_req_duration.values['p(95)'];
  const maxVUs = data.metrics.vus_max.values.max;
  const failureRate = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate * 100 : 0;
  const reqPerSec = data.metrics.http_reqs.values.rate;
  const targetLatency = 300; // حد استاندارد (۳۰۰ میلی‌ثانیه)

  let resourceAnalysis = '';
  
  if (p95Latency > targetLatency || failureRate > 1) {
    const latencyRatio = (p95Latency / targetLatency).toFixed(2);
    const suggestedReplicas = Math.ceil(latencyRatio);

    resourceAnalysis = `
================================================================================
🚨 SYSTEM CRASHED / BOTTLENECK REACHED (سیستم زیر بار قفل شد)
================================================================================
- Max Concurrent Users (VU) : ${maxVUs}
- Total Requests / Sec (RPS): ${reqPerSec.toFixed(2)} req/s
- Actual p(95) Latency      : ${p95Latency.toFixed(2)} ms (Standard: <= ${targetLatency} ms)
- Failure / Error Rate      : ${failureRate.toFixed(2)} %

🔍 RESOURCE REQUIREMENT ANALYSIS / تحلیل منابع مورد نیاز:
- برنامه تحت فشار ${maxVUs} کاربر همزمان دچار کندی شد شد و زمان پاسخ‌دهی ${latencyRatio} برابر افت کرد.
- پیشنهاد برای بازگشت به حالت استاندارد:
  1. افزایش CPU/RAM: منابع سخت‌افزاری کانتینر فعلی را حداقل ${latencyRatio} برابر افزایش دهید.
  2. توسعه افقی (Kubernetes/Scaling): برنامه باید روی حداقل ${suggestedReplicas} نمونه (Replica) توزیع شود.
  3. دیتابیس: اتصال‌های دیتابیس (Connection Pool) را افزایش داده و کش (Redis) اضافه کنید.
================================================================================
`;
  } else {
    resourceAnalysis = `
================================================================================
✅ SYSTEM SURVIVED / سیستم فشار ۱۵۰۰ کاربر را تحمل کرد!
================================================================================
- p(95) Latency: ${p95Latency.toFixed(2)} ms
================================================================================
`;
  }

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }) + '\n' + resourceAnalysis,
  };
}

function textSummary(data, options) {
  return require('k6/vendor/text-summary').textSummary(data, options);
}