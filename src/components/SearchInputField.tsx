import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { sanitizeSearchPaste } from '../utils/searchInputUtils';

export interface SearchInputFieldProps {
  value: string;
  onValueChange: (nextValue: string) => void;
  placeholder?: string;
  className?: string;
  direction?: 'ltr' | 'rtl';
  ariaLabel?: string;
  id?: string;
}

/**
 * Mobile/Android-hardened search input field.
 *
 * Addresses Android Chromium WebView / Capacitor IME bugs:
 * 1. Keeps `dir` stable instead of flipping on empty-vs-non-empty transitions.
 * 2. Reconciles native `input` and `paste` DOM mutations on microtask + rAF so
 *    clipboard pastes and IME multi-char commits always trigger React search updates.
 * 3. Preserves Unicode combining marks (`ẹ̀kọ́`) and hooked letters (`ɓ`, `ɗ`, `ƴ`, `ŋ`)
 *    without blocking or stripping during IME composition.
 */
export const SearchInputField = forwardRef<HTMLInputElement, SearchInputFieldProps>(
  (
    {
      value,
      onValueChange,
      placeholder,
      className = '',
      direction = 'ltr',
      ariaLabel,
      id,
    },
    forwardedRef
  ) => {
    const innerRef = useRef<HTMLInputElement>(null);
    const latestValueRef = useRef(value);
    const isComposingRef = useRef(false);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
      latestValueRef.current = value;
    }, [value]);

    useEffect(() => {
      return () => {
        if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafIdRef.current);
        }
      };
    }, []);

    useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement, []);

    const reconcileFromDom = (sanitizeLinebreaks = false) => {
      const el = innerRef.current;
      if (!el) return;
      const domVal = sanitizeLinebreaks ? sanitizeSearchPaste(el.value) : el.value;
      if (domVal !== latestValueRef.current) {
        latestValueRef.current = domVal;
        onValueChange(domVal);
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      latestValueRef.current = next;
      onValueChange(next);
    };

    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      const next = e.currentTarget.value;
      if (next !== latestValueRef.current) {
        latestValueRef.current = next;
        onValueChange(next);
      }
    };

    const handlePaste = () => {
      // Do not preventDefault: let Android WebView perform native clipboard paste,
      // then reconcile DOM -> React state immediately on microtask and next frame.
      queueMicrotask(() => reconcileFromDom(true));
      if (typeof requestAnimationFrame === 'function') {
        if (rafIdRef.current !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafIdRef.current);
        }
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          reconcileFromDom(true);
        });
      }
    };

    const handleCompositionStart = () => {
      isComposingRef.current = true;
    };

    const handleCompositionUpdate = (e: React.CompositionEvent<HTMLInputElement>) => {
      const next = e.currentTarget.value;
      if (next !== latestValueRef.current) {
        latestValueRef.current = next;
        onValueChange(next);
      }
    };

    const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = false;
      const next = e.currentTarget.value;
      if (next !== latestValueRef.current) {
        latestValueRef.current = next;
        onValueChange(next);
      }
    };

    return (
      <input
        ref={innerRef}
        id={id}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label={ariaLabel || placeholder || 'Search dictionary'}
        value={value}
        onChange={handleChange}
        onInput={handleInput}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionUpdate={handleCompositionUpdate}
        onCompositionEnd={handleCompositionEnd}
        placeholder={placeholder}
        className={className}
        dir={direction}
      />
    );
  }
);

SearchInputField.displayName = 'SearchInputField';
