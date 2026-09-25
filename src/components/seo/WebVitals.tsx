'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { track } from '@/lib/analytics';

type Metric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

// A stable module-level callback: a new function each render would re-report every metric.
function report(metric: Metric) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[web-vitals] ${metric.name}`, Math.round(metric.value * 1000) / 1000, metric.rating);
    return;
  }
  track('web_vital', {
    name: metric.name,
    // CLS is unitless and small; x1000 keeps three decimals as an integer like the ms metrics.
    value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
    rating: metric.rating,
    navigation: metric.navigationType,
  });
}

export function WebVitals() {
  useReportWebVitals(report);
  return null;
}
