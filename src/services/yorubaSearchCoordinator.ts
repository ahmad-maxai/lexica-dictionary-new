import { StandardSearchResponse } from '../types/dictionary';
import {
  YORUBA_PACK_MANIFEST,
  isYorubaSqliteIntegrationEnabled,
} from '../config/yorubaDictionaryConfig';
import { dictionaryDb } from './dictionaryDatabase';
import { type StandardSearchOptions } from './standardDictionarySearch';
import { yorubaPackService } from './yorubaPackService';
import { yorubaSqliteRepo, type YorubaSearchOptions } from './yorubaSqliteRepository';

export async function searchYorubaStandardUnified(
  query: string,
  options: StandardSearchOptions & YorubaSearchOptions = {}
): Promise<StandardSearchResponse> {
  if (!isYorubaSqliteIntegrationEnabled()) {
    const legacy = dictionaryDb.searchStandard(query, 'yo', options);
    return {
      ...legacy,
      totalCount: legacy.results.length,
      hasMore: false,
      offset: 0,
      limit: legacy.results.length,
      engineSource: 'starter-corpus',
    };
  }

  // Ensure Android pack status is loaded before checking active pack
  if (yorubaPackService.isNativeAndroid()) {
    await yorubaPackService.ensureStatusLoaded();
  }

  // Use native Android SQLite pack (or injected test SQLite executor) when active
  if (yorubaSqliteRepo.isPackActive()) {
    return yorubaSqliteRepo.searchStandard(query, {
      strictDiacritics: options.strictDiacritics,
      partOfSpeech: options.partOfSpeech,
      letter: options.letter,
      limit: options.limit,
      offset: options.offset,
    });
  }

  // On Android native without installed pack, NEVER fall back to starter 70-entry corpus
  if (yorubaPackService.isNativeAndroid()) {
    const compressedKb = (YORUBA_PACK_MANIFEST.compressedSizeBytes / 1024).toFixed(0);
    const extractedKb = (YORUBA_PACK_MANIFEST.uncompressedSizeBytes / 1024).toFixed(0);
    return {
      status: 'language_not_installed',
      language: 'yo',
      query: (query || '').trim(),
      results: [],
      totalCount: 0,
      hasMore: false,
      offset: 0,
      limit: options.limit || 20,
      engineSource: 'sqlite-yo',
      message: `Yoruba offline SQLite dictionary is not installed (${compressedKb} KB download · ${extractedKb} KB offline · ${YORUBA_PACK_MANIFEST.acceptedEntries.toLocaleString()} entries). Install it from Language Library.`,
    };
  }

  // Development web preview fallback (outside Android native runtime)
  const previewRes = dictionaryDb.searchStandard(query, 'yo', options);
  return {
    ...previewRes,
    totalCount: previewRes.results.length,
    hasMore: false,
    offset: 0,
    limit: previewRes.results.length,
    engineSource: 'web-preview-fallback',
  };
}
