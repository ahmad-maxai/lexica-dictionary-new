import { StandardSearchResponse } from '../types/dictionary';
import {
  ENGLISH_PACK_MANIFEST,
  isEnglishSqliteIntegrationEnabled,
} from '../config/englishDictionaryConfig';
import { dictionaryDb } from './dictionaryDatabase';
import { type StandardSearchOptions } from './standardDictionarySearch';
import { englishPackService } from './englishPackService';
import { englishSqliteRepo, type EnglishSearchOptions } from './englishSqliteRepository';

export async function searchEnglishStandardUnified(
  query: string,
  options: StandardSearchOptions & EnglishSearchOptions = {}
): Promise<StandardSearchResponse> {
  if (!isEnglishSqliteIntegrationEnabled()) {
    const legacy = dictionaryDb.searchStandard(query, 'en', options);
    return {
      ...legacy,
      totalCount: legacy.results.length,
      hasMore: false,
      offset: 0,
      limit: legacy.results.length,
      engineSource: 'starter-corpus',
    };
  }

  // Use native Android SQLite pack (or injected test SQLite executor) when active
  if (englishSqliteRepo.isPackActive()) {
    return englishSqliteRepo.searchStandard(query, {
      partOfSpeech: options.partOfSpeech,
      letter: options.letter,
      limit: options.limit,
      offset: options.offset,
    });
  }

  // On Android native without installed pack, return explicit not-installed state
  if (englishPackService.isNativeAndroid()) {
    const compressedMb = (ENGLISH_PACK_MANIFEST.compressedSizeBytes / (1024 * 1024)).toFixed(2);
    const extractedMb = (ENGLISH_PACK_MANIFEST.uncompressedSizeBytes / (1024 * 1024)).toFixed(2);
    return {
      status: 'language_not_installed',
      language: 'en',
      query: (query || '').trim(),
      results: [],
      totalCount: 0,
      hasMore: false,
      offset: 0,
      limit: options.limit || 20,
      engineSource: 'sqlite-en',
      message: `English offline SQLite dictionary is not installed (${compressedMb} MB download · ${extractedMb} MB offline · ${ENGLISH_PACK_MANIFEST.acceptedEntries.toLocaleString()} entries). Install it from Language Library.`,
    };
  }

  // Development web preview fallback (only used outside Android native runtime)
  const previewRes = dictionaryDb.searchStandard(query, 'en', options);
  return {
    ...previewRes,
    totalCount: previewRes.results.length,
    hasMore: false,
    offset: 0,
    limit: previewRes.results.length,
    engineSource: 'web-preview-fallback',
  };
}
