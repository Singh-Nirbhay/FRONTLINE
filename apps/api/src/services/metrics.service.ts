export interface IMetricsRegistry {
  incrementCounter(name: string, labels: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
}

export class DevelopmentMetricsRegistry implements IMetricsRegistry {
  private counters: Record<string, { count: number; labels: Record<string, string> }[]> = {};
  private histograms: Record<string, { value: number; labels?: Record<string, string> }[]> = {};

  incrementCounter(name: string, labels: Record<string, string>): void {
    if (!this.counters[name]) {
      this.counters[name] = [];
    }
    
    // Find matching label set
    const match = this.counters[name].find(entry => 
      Object.keys(labels).every(key => entry.labels[key] === labels[key])
    );

    if (match) {
      match.count++;
    } else {
      this.counters[name].push({ count: 1, labels });
    }

    console.log(`[Metrics] Counter [${name}] incremented. Labels:`, labels);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.histograms[name]) {
      this.histograms[name] = [];
    }

    this.histograms[name].push({ value, labels });
    console.log(`[Metrics] Histogram [${name}] recorded value: ${value}. Labels:`, labels);
  }

  // Helper methods for testing / checking internal state
  getCounterValue(name: string, labels: Record<string, string>): number {
    const list = this.counters[name] || [];
    const match = list.find(entry => 
      Object.keys(labels).every(key => entry.labels[key] === labels[key])
    );
    return match ? match.count : 0;
  }

  getHistogramValues(name: string): number[] {
    const list = this.histograms[name] || [];
    return list.map(entry => entry.value);
  }

  clear(): void {
    this.counters = {};
    this.histograms = {};
  }
}

// Export metrics singleton
export const metricsRegistry = new DevelopmentMetricsRegistry();
export default metricsRegistry;
