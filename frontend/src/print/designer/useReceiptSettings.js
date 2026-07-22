// useReceiptSettings.js
//
// Hooks that wire the pure logic in receiptResolution.js to real data sources:
//   - per-terminal override  -> platformStore (device-local, same store file as
//                               template assignments — no new mechanism)
//   - tenant-wide flag        -> backend GET /settings/receipts
//   - assigned template       -> useAssignedTemplate('salesReceipt')
//
// Phase 2 only: these are NOT wired into any UI, Workstation, or SaleDetail yet.

import { useState, useEffect, useCallback } from 'react';
import { getStore } from '../../lib/platformStore';
import { settingsApi } from '../../services/api';
import { useAssignedTemplate } from './useAssignedTemplate';
import {
  RECEIPT_OVERRIDE_STATES,
  DEFAULT_RECEIPT_OVERRIDE,
  resolveShouldPrintReceipt,
  resolveShouldAutoPrint,
  resolveReceiptTemplate,
} from './receiptResolution';

// Same store file as templateLibrary / templateAssignments, keyed per tenant —
// a sibling entry, not a second storage mechanism.
const STORE_FILE = 'print-settings.json';
const OVERRIDE_KEY_PREFIX = 'receiptPrintingOverride';
const AUTO_PRINT_OVERRIDE_KEY_PREFIX = 'receiptAutoPrintOverride';

/** Per-terminal (device-local) receipt-printing override: inherit|force-on|force-off. */
export function useReceiptPrintingOverride(tenantId) {
  const storageKey = `${OVERRIDE_KEY_PREFIX}:${tenantId}`;
  const [override, setOverrideState] = useState(DEFAULT_RECEIPT_OVERRIDE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore(STORE_FILE);
      const saved = await store.get(storageKey);
      if (!cancelled) {
        setOverrideState(RECEIPT_OVERRIDE_STATES.includes(saved) ? saved : DEFAULT_RECEIPT_OVERRIDE);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  const setOverride = useCallback((value) => {
    const next = RECEIPT_OVERRIDE_STATES.includes(value) ? value : DEFAULT_RECEIPT_OVERRIDE;
    setOverrideState(next);
    (async () => {
      const store = await getStore(STORE_FILE);
      await store.set(storageKey, next);
      await store.save();
    })();
  }, [storageKey]);

  return { override, loaded, setOverride };
}

/** Tenant-wide receipts_enabled from the backend. Fails safe to enabled. */
export function useTenantReceiptsEnabled(tenantId) {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await settingsApi.receipts.get();
        if (!cancelled) { setEnabled(!!res.receipts_enabled); setLoaded(true); }
      } catch {
        if (!cancelled) { setEnabled(true); setLoaded(true); } // fail-safe: default enabled
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  return { enabled, loaded };
}

/**
 * Combined resolution: per-terminal override first, else the tenant-wide flag.
 * Governs default checkout printing only (NOT the SaleDetail reprint action).
 */
export function useShouldPrintReceipt(tenantId) {
  const { override, loaded: ovLoaded } = useReceiptPrintingOverride(tenantId);
  const { enabled, loaded: enLoaded } = useTenantReceiptsEnabled(tenantId);
  return {
    shouldPrint: resolveShouldPrintReceipt(override, enabled),
    loaded: ovLoaded && enLoaded,
  };
}

/** Per-terminal (device-local) auto-print override: inherit|force-on|force-off.
 *  Mirrors useReceiptPrintingOverride exactly, on the auto-print axis. */
export function useReceiptAutoPrintOverride(tenantId) {
  const storageKey = `${AUTO_PRINT_OVERRIDE_KEY_PREFIX}:${tenantId}`;
  const [override, setOverrideState] = useState(DEFAULT_RECEIPT_OVERRIDE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore(STORE_FILE);
      const saved = await store.get(storageKey);
      if (!cancelled) {
        setOverrideState(RECEIPT_OVERRIDE_STATES.includes(saved) ? saved : DEFAULT_RECEIPT_OVERRIDE);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  const setOverride = useCallback((value) => {
    const next = RECEIPT_OVERRIDE_STATES.includes(value) ? value : DEFAULT_RECEIPT_OVERRIDE;
    setOverrideState(next);
    (async () => {
      const store = await getStore(STORE_FILE);
      await store.set(storageKey, next);
      await store.save();
    })();
  }, [storageKey]);

  return { override, loaded, setOverride };
}

/** Tenant-wide receipts_auto_print from the backend. Fails safe to OFF. */
export function useTenantReceiptsAutoPrint(tenantId) {
  const [autoPrint, setAutoPrint] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await settingsApi.receiptsAutoPrint.get();
        if (!cancelled) { setAutoPrint(!!res.receipts_auto_print); setLoaded(true); }
      } catch {
        if (!cancelled) { setAutoPrint(false); setLoaded(true); } // fail-safe: no auto-print
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  return { autoPrint, loaded };
}

/**
 * Combined auto-print resolution: per-terminal override first, else tenant flag.
 * Only meaningful when printing is available (useShouldPrintReceipt) — the caller
 * combines both via decideReceiptAction.
 */
export function useShouldAutoPrintReceipt(tenantId) {
  const { override, loaded: ovLoaded } = useReceiptAutoPrintOverride(tenantId);
  const { autoPrint, loaded: apLoaded } = useTenantReceiptsAutoPrint(tenantId);
  return {
    shouldAutoPrint: resolveShouldAutoPrint(override, autoPrint),
    loaded: ovLoaded && apLoaded,
  };
}

/**
 * The template to print: the one assigned to 'salesReceipt', or the built-in
 * default if none is assigned / not found on this device.
 */
export function useResolvedReceiptTemplate(tenantId) {
  const { template, loaded } = useAssignedTemplate(tenantId, 'salesReceipt');
  return {
    template: loaded ? resolveReceiptTemplate(template) : null,
    loaded,
    isBuiltinDefault: loaded && !template,
  };
}
