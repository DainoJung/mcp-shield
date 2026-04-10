/**
 * Lightweight metrics collector — no external dependencies.
 * Exposes Prometheus-compatible text format.
 */

export interface MetricLabels {
  server?: string;
  tool?: string;
  status?: string;
}

interface CounterEntry {
  value: number;
}

interface HistogramEntry {
  count: number;
  sum: number;
  buckets: Map<number, number>; // upper bound → count
}

const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];

function labelsToKey(labels: MetricLabels): string {
  return Object.entries(labels)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
}

export class MetricsCollector {
  private counters = new Map<string, Map<string, CounterEntry>>();
  private histograms = new Map<string, Map<string, HistogramEntry>>();
  private gauges = new Map<string, Map<string, number>>();
  private buckets: number[];

  constructor(buckets?: number[]) {
    this.buckets = buckets ?? DEFAULT_BUCKETS;
  }

  /** Increment a counter. */
  incCounter(name: string, labels: MetricLabels = {}, value = 1): void {
    const key = labelsToKey(labels);
    let metric = this.counters.get(name);
    if (!metric) {
      metric = new Map();
      this.counters.set(name, metric);
    }
    const entry = metric.get(key) ?? { value: 0 };
    entry.value += value;
    metric.set(key, entry);
  }

  /** Observe a value in a histogram. */
  observeHistogram(name: string, labels: MetricLabels, value: number): void {
    const key = labelsToKey(labels);
    let metric = this.histograms.get(name);
    if (!metric) {
      metric = new Map();
      this.histograms.set(name, metric);
    }

    let entry = metric.get(key);
    if (!entry) {
      entry = { count: 0, sum: 0, buckets: new Map() };
      for (const b of this.buckets) {
        entry.buckets.set(b, 0);
      }
      metric.set(key, entry);
    }

    entry.count++;
    entry.sum += value;
    for (const b of this.buckets) {
      if (value <= b) {
        entry.buckets.set(b, (entry.buckets.get(b) ?? 0) + 1);
      }
    }
  }

  /** Set a gauge value. */
  setGauge(name: string, labels: MetricLabels, value: number): void {
    const key = labelsToKey(labels);
    let metric = this.gauges.get(name);
    if (!metric) {
      metric = new Map();
      this.gauges.set(name, metric);
    }
    metric.set(key, value);
  }

  /** Export all metrics in Prometheus text format. */
  toPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const [name, entries] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [key, entry] of entries) {
        const labels = key ? `{${key}}` : "";
        lines.push(`${name}${labels} ${entry.value}`);
      }
    }

    // Histograms
    for (const [name, entries] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const [key, entry] of entries) {
        const baseLabels = key ? `,${key}` : "";
        for (const [bound, count] of entry.buckets) {
          lines.push(`${name}_bucket{le="${bound}"${baseLabels}} ${count}`);
        }
        lines.push(`${name}_bucket{le="+Inf"${baseLabels}} ${entry.count}`);
        lines.push(`${name}_sum{${key}} ${entry.sum}`);
        lines.push(`${name}_count{${key}} ${entry.count}`);
      }
    }

    // Gauges
    for (const [name, entries] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const [key, value] of entries) {
        const labels = key ? `{${key}}` : "";
        lines.push(`${name}${labels} ${value}`);
      }
    }

    return lines.join("\n") + "\n";
  }

  /** Reset all metrics (for testing). */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
