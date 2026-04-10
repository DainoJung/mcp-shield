import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "../../src/metrics/collector.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("counters", () => {
    it("increments counter", () => {
      collector.incCounter("requests_total", { server: "github" });
      collector.incCounter("requests_total", { server: "github" });
      const output = collector.toPrometheus();
      expect(output).toContain('requests_total{server="github"} 2');
    });

    it("tracks different label combinations separately", () => {
      collector.incCounter("requests_total", { status: "success" });
      collector.incCounter("requests_total", { status: "error" });
      collector.incCounter("requests_total", { status: "success" });
      const output = collector.toPrometheus();
      expect(output).toContain('requests_total{status="success"} 2');
      expect(output).toContain('requests_total{status="error"} 1');
    });

    it("supports custom increment value", () => {
      collector.incCounter("retries", {}, 5);
      const output = collector.toPrometheus();
      expect(output).toContain("retries 5");
    });
  });

  describe("histograms", () => {
    it("records observations with buckets", () => {
      collector.observeHistogram("duration_ms", { server: "test" }, 150);
      const output = collector.toPrometheus();
      expect(output).toContain("# TYPE duration_ms histogram");
      expect(output).toContain('duration_ms_bucket{le="100"');
      expect(output).toContain('duration_ms_bucket{le="250"');
      expect(output).toContain('duration_ms_bucket{le="+Inf"');
      expect(output).toContain("duration_ms_sum");
      expect(output).toContain("duration_ms_count");
    });

    it("accumulates multiple observations", () => {
      collector.observeHistogram("dur", {}, 10);
      collector.observeHistogram("dur", {}, 20);
      collector.observeHistogram("dur", {}, 30);
      const output = collector.toPrometheus();
      expect(output).toContain("dur_sum{} 60");
      expect(output).toContain("dur_count{} 3");
    });

    it("correctly assigns values to buckets", () => {
      // Value of 50 should be in le=50, le=100, etc. but NOT in le=25
      collector.observeHistogram("lat", {}, 50);
      const output = collector.toPrometheus();
      expect(output).toContain('lat_bucket{le="25"} 0');
      expect(output).toContain('lat_bucket{le="50"} 1');
      expect(output).toContain('lat_bucket{le="100"} 1');
    });
  });

  describe("gauges", () => {
    it("sets gauge value", () => {
      collector.setGauge("circuit_open", { server: "github" }, 1);
      const output = collector.toPrometheus();
      expect(output).toContain('circuit_open{server="github"} 1');
    });

    it("overwrites gauge value", () => {
      collector.setGauge("active", {}, 5);
      collector.setGauge("active", {}, 3);
      const output = collector.toPrometheus();
      expect(output).toContain("active 3");
      expect(output).not.toContain("active 5");
    });
  });

  describe("toPrometheus", () => {
    it("includes TYPE annotations", () => {
      collector.incCounter("c");
      collector.observeHistogram("h", {}, 1);
      collector.setGauge("g", {}, 1);
      const output = collector.toPrometheus();
      expect(output).toContain("# TYPE c counter");
      expect(output).toContain("# TYPE h histogram");
      expect(output).toContain("# TYPE g gauge");
    });

    it("returns empty-ish output when no metrics", () => {
      const output = collector.toPrometheus();
      expect(output.trim()).toBe("");
    });
  });

  describe("reset", () => {
    it("clears all metrics", () => {
      collector.incCounter("c");
      collector.observeHistogram("h", {}, 1);
      collector.setGauge("g", {}, 1);
      collector.reset();
      expect(collector.toPrometheus().trim()).toBe("");
    });
  });
});
