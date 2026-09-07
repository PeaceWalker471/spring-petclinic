import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// تعاریف متریک‌های اختصاصی برای تحلیل دقیق‌تر
const petListLatency = new Trend('pet_list_latency');
const ownerSearchLatency = new Trend('owner_search_latency');
const failedRequests = new Counter('failed_requests');

export const options = {
  // تعریف مراحل فشار بر برنامه (تست شیب‌دار / Ramp-up)
  stages: [
    { duration: '10s', target: 5 },   // ورود تدریجی ۵ کاربر همزمان
    { duration: '20s', target: 20 },  // افزایش بار به ۲۰ کاربر همزمان (فشار متوسط)
    { duration: '10s', target: 50 },  // فشار سنگین (۵۰ کاربر همزمان برای سنجش مرز مقاومت)
    { duration: '10s', target: 0 },   // خروج تدریجی کاربران
  ],

  // تعاریف حد آستانه (Thresholds) - اگر این شرایط رعایت نشود Build رد می‌شود
  thresholds: {
    http_req_failed: ['rate<0.02'],        // نرخ خطا باید زیر ۲ درصد باشد
    http_req_duration: ['p(95)<800'],     // ۹۵٪ درخواست‌ها باید زیر ۸۰۰ میلی‌ثانیه پاسخ داده شوند
    'pet_list_latency': ['p(95)<400'],    // لیست دامپزشکان باید سریع‌تر از ۴۰۰ms باشد
  },
};

const BASE_URL = 'http://localhost:8080';

export default function () {
  // سناریوی ۱: بازدید از صفحه اصلی
  group('1. Home Page', function () {
    const res = http.get(`${BASE_URL}/`);
    const success = check(res, {
      'Home status is 200': (r) => r.status === 200,
    });
    if (!success) failedRequests.add(1);
  });

  sleep(1);

  // سناریوی ۲: مشاهده لیست دامپزشکان (Vets)
  group('2. Vets List', function () {
    const res = http.get(`${BASE_URL}/vets.html`);
    petListLatency.add(res.timings.duration); // ثبت زمان اختصاصی این API
    
    const success = check(res, {
      'Vets page loaded': (r) => r.status === 200,
      'Vets page has content': (r) => r.body.includes('Veterinarians'),
    });
    if (!success) failedRequests.add(1);
  });

  sleep(1);

  // سناریوی ۳: جستجوی صاحب حیوان (Find Owners)
  group('3. Find Owners Page', function () {
    const res = http.get(`${BASE_URL}/owners/find`);
    ownerSearchLatency.add(res.timings.duration);

    const success = check(res, {
      'Find owners loaded': (r) => r.status === 200,
    });
    if (!success) failedRequests.add(1);
  });

  sleep(1);
}