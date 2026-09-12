import { FormResponse, FormSessionEvent } from '@activepieces/shared';
import { useCallback, useEffect, useRef } from 'react';

import { humanInputApi } from '../api/human-input-api';

const VISITOR_KEY_STORAGE = 'ap_form_visitor_key';
const SESSION_STORAGE_PREFIX = 'ap_form_session_';

function getOrCreateVisitorKey(): string {
  const existing = window.localStorage.getItem(VISITOR_KEY_STORAGE);
  if (existing) {
    return existing;
  }
  const generated = generateVisitorKey();
  window.localStorage.setItem(VISITOR_KEY_STORAGE, generated);
  return generated;
}

function generateVisitorKey(): string {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `vk_${random}`.slice(0, 64);
}

export function useFormTracking({
  form,
  useDraft,
}: {
  form: FormResponse;
  useDraft: boolean;
}) {
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const resolvedRunRef = useRef(false);
  const reachedFieldsRef = useRef<Set<string>>(new Set());
  const interactedFieldsRef = useRef<Set<string>>(new Set());
  const fieldNamesRef = useRef<string[]>(
    form.props.inputs.map((input) => input.displayName),
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const visitorKey = getOrCreateVisitorKey();
      const sessionStorageKey = `${SESSION_STORAGE_PREFIX}${form.id}_${useDraft ? 'draft' : 'live'}`;
      const cachedSessionId = window.sessionStorage.getItem(sessionStorageKey);

      const requestSession = async () => {
        const { sessionId } = await humanInputApi.startSession(
          { flowId: form.id, useDraft },
          visitorKey,
        );
        return sessionId;
      };

      let sessionId = cachedSessionId;
      if (!sessionId) {
        try {
          sessionId = await requestSession();
        } catch {
          return;
        }
        if (cancelled || !sessionId) {
          return;
        }
        window.sessionStorage.setItem(sessionStorageKey, sessionId);
      }
      sessionIdRef.current = sessionId;
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [form.id, useDraft]);

  const trackStart = useCallback(() => {
    if (startedRef.current || useDraft || !sessionIdRef.current) {
      return;
    }
    startedRef.current = true;
    void humanInputApi
      .trackEvent({
        flowId: form.id,
        sessionId: sessionIdRef.current,
        event: FormSessionEvent.START,
      })
      .catch(() => undefined);
  }, [form.id, useDraft]);

  const markReached = useCallback(
    (fieldName: string) => {
      const order = fieldNamesRef.current;
      const index = order.indexOf(fieldName);
      if (index === -1) {
        return;
      }
      for (let i = 0; i <= index; i += 1) {
        reachedFieldsRef.current.add(order[i]);
      }
    },
    [],
  );

  const trackFieldInteraction = useCallback(
    (fieldName: string) => {
      if (useDraft || !sessionIdRef.current) {
        return;
      }
      trackStart();
      markReached(fieldName);
      interactedFieldsRef.current.add(fieldName);
      const reachedFieldNames = fieldNamesRef.current.filter((name) =>
        reachedFieldsRef.current.has(name),
      );
      void humanInputApi
        .trackFieldInteraction({
          flowId: form.id,
          sessionId: sessionIdRef.current,
          fieldName,
          reachedFieldNames,
        })
        .catch(() => undefined);
    },
    [form.id, markReached, trackStart, useDraft],
  );

  const sendFieldSnapshot = useCallback(async (): Promise<void> => {
    if (useDraft || !sessionIdRef.current) {
      return;
    }
    const reachedFields = fieldNamesRef.current.filter((name) =>
      reachedFieldsRef.current.has(name),
    );
    try {
      await humanInputApi.trackEvent({
        flowId: form.id,
        sessionId: sessionIdRef.current,
        event: FormSessionEvent.START,
        reachedFields,
      });
    } catch {
      return;
    }
  }, [form.id, useDraft]);

  const trackSubmitOutcome = useCallback(
    async (outcome: 'success' | 'failure' | 'timeout'): Promise<void> => {
      if (useDraft || !sessionIdRef.current) {
        return;
      }
      await sendFieldSnapshot();
      const event =
        outcome === 'success'
          ? FormSessionEvent.SUBMIT
          : outcome === 'timeout'
            ? FormSessionEvent.TIMEOUT
            : FormSessionEvent.FAILURE;
      try {
        await humanInputApi.trackEvent({
          flowId: form.id,
          sessionId: sessionIdRef.current,
          event,
        });
      } catch {
        return;
      }
      if (!form.props.waitForResponse && !resolvedRunRef.current) {
        resolvedRunRef.current = true;
        await resolveAsyncRun(form.id, sessionIdRef.current);
      }
    },
    [form.id, form.props.waitForResponse, sendFieldSnapshot, useDraft],
  );

  const resolveRun = useCallback(async (): Promise<void> => {
    if (
      useDraft ||
      !sessionIdRef.current ||
      form.props.waitForResponse ||
      resolvedRunRef.current
    ) {
      return;
    }
    resolvedRunRef.current = true;
    await resolveAsyncRun(form.id, sessionIdRef.current);
  }, [form.id, form.props.waitForResponse, useDraft]);

  return {
    sessionIdRef,
    trackStart,
    trackFieldInteraction,
    trackSubmitOutcome,
    resolveRun,
  };
}

async function resolveAsyncRun(flowId: string, sessionId: string): Promise<void> {
  const submittedAt = new Date().toISOString();
  for (const attempt of [300, 1200, 3000]) {
    await delay(attempt);
    try {
      await humanInputApi.resolveRun({ flowId, sessionId, submittedAt });
    } catch {
      return;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
