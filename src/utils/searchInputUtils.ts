/**
 * Pure cursor-aware search input editing utilities.
 * Designed to preserve Unicode diacritics (e.g. Yoruba `ẹ̀kọ́`, Fulfulde `ɓ/ɗ/ƴ/ŋ`)
 * and support reliable Android WebView typing, pasting, cursor insertion, and deletion.
 */

export interface CursorEditResult {
  nextValue: string;
  nextCursor: number;
}

/**
 * Sanitizes pasted single-line search text without stripping diacritics,
 * tone marks, hooked consonants, or non-Latin scripts.
 */
export function sanitizeSearchPaste(text: string): string {
  return (text || '').replace(/[\r\n]+/g, ' ');
}

/**
 * Inserts text at the active cursor/selection range and returns the next value and caret offset.
 */
export function insertTextAtCursor(
  currentValue: string,
  insertion: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): CursorEditResult {
  const len = currentValue.length;
  const start =
    typeof selectionStart === 'number' && selectionStart >= 0
      ? Math.min(selectionStart, len)
      : len;
  const end =
    typeof selectionEnd === 'number' && selectionEnd >= start
      ? Math.min(selectionEnd, len)
      : start;

  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const nextValue = `${before}${insertion}${after}`;
  const nextCursor = start + insertion.length;
  return { nextValue, nextCursor };
}

/**
 * Deletes the selected range, or one logical character (code point) before the cursor.
 */
export function deleteBeforeCursor(
  currentValue: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): CursorEditResult {
  const len = currentValue.length;
  const start =
    typeof selectionStart === 'number' && selectionStart >= 0
      ? Math.min(selectionStart, len)
      : len;
  const end =
    typeof selectionEnd === 'number' && selectionEnd >= start
      ? Math.min(selectionEnd, len)
      : start;

  if (end > start) {
    return {
      nextValue: currentValue.slice(0, start) + currentValue.slice(end),
      nextCursor: start,
    };
  }

  if (start <= 0) {
    return { nextValue: currentValue, nextCursor: 0 };
  }

  // Delete one full Unicode code point (handles surrogate pairs like Adlam/emoji)
  const before = currentValue.slice(0, start);
  const codePoints = Array.from(before);
  codePoints.pop();
  const nextBefore = codePoints.join('');
  return {
    nextValue: nextBefore + currentValue.slice(start),
    nextCursor: nextBefore.length,
  };
}

/**
 * Replaces the active selection (or inserts at cursor) with pasted text.
 */
export function applyPasteAtCursor(
  currentValue: string,
  pastedText: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): CursorEditResult {
  return insertTextAtCursor(
    currentValue,
    sanitizeSearchPaste(pastedText),
    selectionStart,
    selectionEnd
  );
}
