import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const petListLatency = new Trend('pet_list_latency');
const failedRequests = new Counter('failed_requests');

export const options = {
  // فشار سنگین و ناگهانی برای رسیدن به نقطه شکست (Breakdown Point)
  stages: [
    { duration: '10s', target: 50 },   // شروع سریع با ۵۰ کاربر
    { duration: '20s', target: 200 },  // افزایش به ۲۰۰ کاربر
    { duration: '20s', target: 500 },  // اوج فشار با ۵۰۰ کاربر همزمان
    { duration: '10s', target: 0 },    // کاهش بار
  ],

  thresholds: {
    http_req_failed: ['rate<0.05'],       // خطا زیر ۵٪
    http_req_duration: ['p(95)<1000'],    // حد مطلوب زیر ۱۰۰۰ میلی‌ثانیه
  },
};

const BASE_URL = 'http://localhost:8080';

export default function () {
  group('PetClinic Heavy Load Scenario', function () {
    const res = http.get(`${BASE_URL}/vets.html`);
    petListLatency.add(res.timings.duration);

    const success = check(res, {
      'Status is 200': (r) => r.status === 200,
    });
    if (!success) failedRequests.add(1);
  });

  // کاهش زمان sleep برای اعمال فشار کشنده‌تر به سرور
  sleep(0.2);
}

// --- بخش تحلیل هوشمند و گزارش تخمین منابع ---
export function handleSummary(data) {
  const p95Latency = data.metrics.http_req_duration.values['p(95)'];
  const avgLatency = data.metrics.http_req_duration.values.avg;
  const targetLatency = 500; // حد استاندارد و مطلوب (۵۰۰ میلی‌ثانیه)
  const maxVUs = data.metrics.vus_max.values.max;
  const failureRate = data.metrics.http_req_failed ? data.metrics.http_req_failed.values.rate * 100 : 0;

  let resourceAnalysis = '';
  
  if (p95Latency > targetLatency || failureRate > 2) {
    // محاسبه نسبت کندی بر اساس حد مطلوب
    const latencyRatio = (p95Latency / targetLatency).toFixed(2);
    // تخمین افزایش کلاستر/منابع (CPU/Replicas)
    const suggestedReplicas = Math.ceil(latencyRatio);

    resourceAnalysis = `
================================================================================
⚠️ SYSTEM PERFORMANCE BOTTLENECK DETECTED / تحلیل فشار روی سیستم
================================================================================
- Max Concurrent Users (VU): ${maxVUs}
- Actual p(95) Latency     : ${p95Latency.toFixed(2)} ms (Desired: <= ${targetLatency} ms)
- Failure / Error Rate     : ${failureRate.toFixed(2)} %

🔍 RESOURCE RECOMMENDATION / پیشنهاد منابع:
- سیستم شما در بار ${maxVUs} کاربر همزمان دچار کندی شده است (میزان کندی: ${latencyRatio} برابر حد مجاز).
- برای اینکه زمان پاسخ‌دهی به حالت نرمال (زیر ${targetLatency}ms) برگردد، پیشنهادات زیر توصیه می‌شود:
  1. افزایش منابع (Scale Up): حداقل CPU و RAM سرور/کانتینر را ${latencyRatio} برابر کنید.
  2. توسعه افقی (Scale Out / K8s): تعداد نمونه‌های (Replicas) برنامه را به حداقل ${suggestedReplicas} Pod افزایش دهید.
================================================================================
`;
  } else {
    resourceAnalysis = `
================================================================================
✅ SYSTEM HEALTHY / وضعیت سیستم عالی است
================================================================================
- سیستم تا ${maxVUs} کاربر همزمان را بدون نیاز به منبع اضافی با موفقیت پاسخ داد.
- p(95) Latency: ${p95Latency.toFixed(2)} ms
================================================================================
`;
  }

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }) + '\n' + resourceAnalysis,
  };
}

// تابع کمکی برای چاپ ساختار استاندارد k6 کنار گزارش جدید
function textSummary(data, options) {
  return require('k6/vendor/text-summary').textSummary(data, options);
}