import { getPerformance, Performance, trace } from "firebase/performance";
import { FirebaseApp } from "firebase/app";

/**
 * FIREBASE PERFORMANCE MONITORING — WEB
 * 
 * Official Firebase Performance Monitoring for web.
 * Automatically measures:
 * - Page load time
 * - Network requests (XHR/Fetch)
 * - Custom traces for critical operations
 * 
 * This module:
 * - Initializes Firebase Performance Monitoring
 * - Provides utilities to measure custom operations
 * - Tracks business-critical operations
 * 
 * NOTE: Automatic metrics (page load, network) are enabled by default.
 * Custom traces should be sparse and targeted at critical paths only.
 */

let performance: Performance | null = null;
let isInitialized = false;

/**
 * Initialize Firebase Performance Monitoring
 */
export function initializeFirebasePerformance(app: FirebaseApp): void {
  if (isInitialized) return;

  try {
    performance = getPerformance(app);
    isInitialized = true;
    
    // Enable automatic metrics collection
    if (performance) {
      console.log("[FirebasePerformance] Initialized successfully");
      console.log("[FirebasePerformance] Automatic metrics enabled:");
      console.log("  - Page load time");
      console.log("  - Network requests (XHR/Fetch)");
      console.log("  - First Contentful Paint (FCP)");
      console.log("  - Largest Contentful Paint (LCP)");
    }
  } catch (error) {
    console.error("[FirebasePerformance] Failed to initialize:", error);
  }
}

/**
 * Measure a custom operation with automatic start/stop
 * Usage: const unsubscribe = measureOperation("payment_link_generation", async () => { ... })
 */
export async function measureOperation<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!isInitialized || !performance) {
    // If performance is not initialized, just run the operation
    return operation();
  }

  const customTrace = trace(performance, operationName);
  
  try {
    customTrace.start();
    console.log(`[FirebasePerformance] Trace started: ${operationName}`);
    
    const result = await operation();
    
    customTrace.stop();
    console.log(`[FirebasePerformance] Trace completed: ${operationName}`);
    
    return result;
  } catch (error) {
    customTrace.stop();
    console.error(`[FirebasePerformance] Trace failed: ${operationName}`, error);
    throw error;
  }
}

/**
 * Measure a synchronous operation
 */
export function measureSyncOperation<T>(
  operationName: string,
  operation: () => T
): T {
  if (!isInitialized || !performance) {
    return operation();
  }

  const customTrace = trace(performance, operationName);
  
  try {
    customTrace.start();
    const result = operation();
    customTrace.stop();
    return result;
  } catch (error) {
    customTrace.stop();
    throw error;
  }
}

/**
 * Manually create and manage a trace
 * Usage:
 * const t = createTrace("operation_name");
 * t.start();
 * // ... do work
 * t.stop();
 */
export function createTrace(operationName: string) {
  if (!isInitialized || !performance) {
    return {
      start: () => console.warn("[FirebasePerformance] Not initialized"),
      stop: () => {},
      setAttribute: () => {},
      incrementMetric: () => {},
    };
  }

  const customTrace = trace(performance, operationName);

  return {
    start: () => {
      customTrace.start();
      console.log(`[FirebasePerformance] Manual trace started: ${operationName}`);
    },
    stop: () => {
      customTrace.stop();
      console.log(`[FirebasePerformance] Manual trace stopped: ${operationName}`);
    },
    setAttribute: (name: string, value: string) => {
      try {
        customTrace.setAttribute(name, value);
      } catch (err) {
        console.error("[FirebasePerformance] Failed to set attribute:", err);
      }
    },
    incrementMetric: (name: string, value: number = 1) => {
      try {
        customTrace.incrementMetric(name, value);
      } catch (err) {
        console.error("[FirebasePerformance] Failed to increment metric:", err);
      }
    },
  };
}

/**
 * Utility function to measure simple async operations with error handling
 */
export async function withPerformanceTrace<T>(
  operationName: string,
  operation: () => Promise<T>,
  errorHandler?: (error: any) => void
): Promise<T> {
  try {
    return await measureOperation(operationName, operation);
  } catch (error) {
    if (errorHandler) {
      errorHandler(error);
    }
    throw error;
  }
}
