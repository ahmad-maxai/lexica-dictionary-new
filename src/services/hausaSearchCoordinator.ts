import { StandardSearchResponse } from '../types/dictionary';
import {
  HAUSA_PACK_MANIFEST,
  isHausaSqliteIntegrationEnabled,
} from '../config/hausaDictionaryConfig';
import { dictionaryDb } from './dictionaryDatabase';
import { type StandardSearchOptions } from './standardDictionarySearch';
import { hausaPackService } from './hausaPackService';
import { hausaSqliteRepo, type HausaSearchOptions } from './hausaSqliteRepository';

export async function searchHausaStandardUnified(
  query: string,
  options: StandardSearchOptions & HausaSearchOptions = {}
): Promise<StandardSearchResponse> {
  if (!isHausaSqliteIntegrationEnabled()) {
    const legacy = dictionaryDb.searchStandard(query, 'ha', options);
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
  if (hausaPackService.isNativeAndroid()) {
    await hausaPackService.ensureStatusLoaded();
  }

  // Use native Android SQLite pack (or injected test SQLite executor) when active
  if (hausaSqliteRepo.isPackActive()) {
    return hausaSqliteRepo.searchStandard(query, {
      partOfSpeech: options.partOfSpeech,
      letter: options.letter,
      limit: options.limit,
      offset: options.offset,
    });
  }

  // On Android native without installed pack, return explicit not-installed state
  if (hausaPackService.isNativeAndroid()) {
    const compressedKb = (HAUSA_PACK_MANIFEST.compressedSizeBytes / 1024).toFixed(0);
    const extractedKb = (HAUSA_PACK_MANIFEST.uncompressedSizeBytes / 1024).toFixed(0);
    return {
      status: 'language_not_installed',
      language: 'ha',
      query: (query || '').trim(),
      results: [],
      totalCount: 0,
      hasMore: false,
      offset: 0,
      limit: options.limit || 20,
      engineSource: 'sqlite-ha',
      message: `Hausa offline SQLite dictionary is not installed (${compressedKb} KB download · ${extractedKb} KB offline · ${HAUSA_PACK_MANIFEST.acceptedEntries.toLocaleString()} entries). Install it from Language Library.`,
    };
  }

  // Development web preview fallback (outside Android native runtime)
  const previewRes = dictionaryDb.searchStandard(query, 'ha', options);
  return {
    ...previewRes,
    totalCount: previewRes.results.length,
    hasMore: false,
    offset: 0,
    limit: previewRes.results.length,
    engineSource: 'web-preview-fallback',
  };
}
