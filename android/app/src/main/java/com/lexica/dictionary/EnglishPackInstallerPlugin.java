package com.lexica.dictionary;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Debug;
import android.os.StatFs;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import java.util.zip.Deflater;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.json.JSONObject;

@CapacitorPlugin(name = "EnglishPackInstaller")
public class EnglishPackInstallerPlugin extends Plugin {

    private static final String PACKS_SUBDIR = "lexica_packs";
    private static final String ACTIVE_DB_NAME = "lexica_englishSQLite.db";
    private static final String TMP_DB_NAME = "lexica_englishSQLite.db.tmp";
    private static final String BACKUP_DB_NAME = "lexica_englishSQLite.db.bak";
    private static final String PART_GZ_NAME = "lexica_english.db.gz.part";
    private static final String META_FILE_NAME = "lexica_english.db.gz.meta.json";
    private static final String EXTENDED_DB_NAME = "lexica_english_extended.db";

    private static final String BACKUP_ENTRY_MANIFEST = "manifest.json";
    private static final String BACKUP_ENTRY_STATE = "bundled_state.json";
    private static final String BACKUP_ENTRY_ENGLISH_DB = "packs/lexica_englishSQLite.db";
    private static final String BACKUP_FORMAT = "lexica-offline-backup";
    private static final int BACKUP_FORMAT_VERSION = 1;
    private static final int MAX_JSON_ENTRY_BYTES = 8 * 1024 * 1024;

    private static final long STORAGE_SAFETY_MARGIN_BYTES = 20L * 1024L * 1024L;
    private static final int IO_BUFFER_SIZE = 32768;
    private static final int MAX_REDIRECTS = 8;
    private static final Pattern SHA256_HEX_PATTERN = Pattern.compile("^[0-9a-fA-F]{64}$");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean installInProgress = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);
    private final AtomicBoolean backupInProgress = new AtomicBoolean(false);

    private volatile String pendingExportStateJson = "";
    private volatile boolean pendingExportIncludeEnglish = true;
    private volatile boolean pendingImportReplaceExisting = false;

    private File getPacksDir() {
        File dir = new File(getContext().getNoBackupFilesDir(), PACKS_SUBDIR);
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private long getAvailableStorageBytes(File dir) {
        StatFs stat = new StatFs(dir.getAbsolutePath());
        return stat.getAvailableBytes();
    }

    private boolean isHausa(PluginCall call) {
        if (call == null) return false;
        String lang = call.getString("lang", "");
        String packId = call.getString("packId", "");
        return "ha".equalsIgnoreCase(lang) || (packId != null && packId.startsWith("ha-"));
    }

    private boolean isExtendedLayer(PluginCall call) {
        if (call == null) return false;
        String layer = call.getString("packLayer", "core");
        return "extended".equalsIgnoreCase(layer);
    }

    private String getPackDisplayLabel(PluginCall call) {
        return isHausa(call) ? "Hausa" : "English";
    }

    private File getActiveDb(File dir, PluginCall call) {
        return new File(dir, isHausa(call) ? "lexica_hausaSQLite.db" : ACTIVE_DB_NAME);
    }

    private File getTargetDb(File dir, PluginCall call) {
        if (isExtendedLayer(call)) {
            return getExtendedDb(dir, call);
        }
        return getActiveDb(dir, call);
    }

    private File getTmpDb(File dir, PluginCall call) {
        if (isExtendedLayer(call)) {
            return new File(dir, isHausa(call) ? "lexica_hausa_extended.db.tmp" : "lexica_english_extended.db.tmp");
        }
        return new File(dir, isHausa(call) ? "lexica_hausaSQLite.db.tmp" : TMP_DB_NAME);
    }

    private File getBakDb(File dir, PluginCall call) {
        if (isExtendedLayer(call)) {
            return new File(dir, isHausa(call) ? "lexica_hausa_extended.db.bak" : "lexica_english_extended.db.bak");
        }
        return new File(dir, isHausa(call) ? "lexica_hausaSQLite.db.bak" : BACKUP_DB_NAME);
    }

    private File getPartGz(File dir, PluginCall call) {
        if (isExtendedLayer(call)) {
            return new File(dir, isHausa(call) ? "lexica_hausa_extended.db.gz.part" : "lexica_english_extended.db.gz.part");
        }
        return new File(dir, isHausa(call) ? "lexica_hausa.db.gz.part" : PART_GZ_NAME);
    }

    private File getMetaFile(File dir, PluginCall call) {
        if (isExtendedLayer(call)) {
            return new File(dir, isHausa(call) ? "lexica_hausa_extended.db.gz.meta.json" : "lexica_english_extended.db.gz.meta.json");
        }
        return new File(dir, isHausa(call) ? "lexica_hausa.db.gz.meta.json" : META_FILE_NAME);
    }

    private File getExtendedDb(File dir, PluginCall call) {
        return new File(dir, isHausa(call) ? "lexica_hausa_extended.db" : EXTENDED_DB_NAME);
    }

    @PluginMethod
    public void getPackStatus(PluginCall call) {
        executor.execute(() -> {
            try {
                File dir = getPacksDir();
                File activeDb = getActiveDb(dir, call);
                File partGz = getPartGz(dir, call);
                long availableBytes = getAvailableStorageBytes(dir);

                JSObject res = new JSObject();
                res.put("dbPath", activeDb.getAbsolutePath());
                res.put("availableBytes", availableBytes);
                res.put("partialBytes", partGz.exists() ? partGz.length() : 0L);
                res.put("inProgress", installInProgress.get());

                if (activeDb.exists() && activeDb.length() > 0) {
                    res.put("installed", true);
                    res.put("dbSizeBytes", activeDb.length());
                    try {
                        JSObject meta = readDbSummary(activeDb);
                        populateLayerSummary(res, meta, dir);
                    } catch (Exception dbErr) {
                        res.put("installed", false);
                        res.put("error", dbErr.getMessage());
                    }
                } else {
                    res.put("installed", false);
                    res.put("dbSizeBytes", 0L);
                    res.put("extendedInstalled", false);
                    res.put("extendedDbPath", "");
                    res.put("extendedDbSizeBytes", 0L);
                }

                call.resolve(res);
            } catch (Exception e) {
                call.reject("PACK_STATUS_ERROR: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void installPack(PluginCall call) {
        String downloadUrl = headerOrEmpty(call.getString("url", ""));
        String compressedSha256 = headerOrEmpty(call.getString("compressedSha256", ""));
        String uncompressedSha256 = headerOrEmpty(call.getString("uncompressedSha256", ""));
        String expectedPackVersion = headerOrEmpty(call.getString("packVersion", ""));
        boolean forceReinstall = Boolean.TRUE.equals(call.getBoolean("forceReinstall", false));
        // Note: Capacitor PluginCall.getLong() returns defaultValue when org.json parses <=2GB integers as Integer.
        long compressedSizeBytes = extractPositiveLong(call, "compressedSizeBytes");
        long uncompressedSizeBytes = extractPositiveLong(call, "uncompressedSizeBytes");

        List<String> invalidFields = new ArrayList<>();
        if (downloadUrl.isEmpty() || !downloadUrl.toLowerCase(Locale.US).startsWith("https://")) {
            invalidFields.add("url");
        }
        if (!SHA256_HEX_PATTERN.matcher(compressedSha256).matches()) {
            invalidFields.add("compressedSha256");
        }
        if (!SHA256_HEX_PATTERN.matcher(uncompressedSha256).matches()) {
            invalidFields.add("uncompressedSha256");
        }
        if (compressedSizeBytes <= 0L) {
            invalidFields.add("compressedSizeBytes");
        }
        if (uncompressedSizeBytes <= 0L) {
            invalidFields.add("uncompressedSizeBytes");
        }
        if (!invalidFields.isEmpty()) {
            call.reject(
                "INVALID_MANIFEST: Invalid or missing pack manifest field(s): " + String.join(", ", invalidFields) + ".",
                "INVALID_MANIFEST"
            );
            return;
        }

        if (backupInProgress.get()) {
            call.reject("BACKUP_IN_PROGRESS: Wait for the active backup/restore operation to finish.", "BACKUP_IN_PROGRESS");
            return;
        }

        if (!installInProgress.compareAndSet(false, true)) {
            call.reject("INSTALL_IN_PROGRESS: Another English pack installation is already running.", "INSTALL_IN_PROGRESS");
            return;
        }
        cancelRequested.set(false);

        executor.execute(() -> {
            File dir = getPacksDir();
            boolean extendedLayer = isExtendedLayer(call);
            String label = getPackDisplayLabel(call);
            File coreDb = getActiveDb(dir, call);
            File targetDb = getTargetDb(dir, call);
            File tmpDb = getTmpDb(dir, call);
            File bakDb = getBakDb(dir, call);
            File partGz = getPartGz(dir, call);
            File metaFile = getMetaFile(dir, call);

            try {
                // Step 0: Duplicate-version download guard — reuse verified local DB without network I/O
                if (!forceReinstall
                        && targetDb.exists()
                        && targetDb.length() == uncompressedSizeBytes
                        && !expectedPackVersion.isEmpty()) {
                    try {
                        JSObject existingSummary = extendedLayer
                            ? validateExtendedDatabase(targetDb)
                            : validateStagingDatabase(targetDb);
                        String installedVersion = existingSummary.optString("pack_version", "");
                        boolean hasContent = extendedLayer
                            ? existingSummary.optInt("total_senses", 0) > 0 || existingSummary.optInt("schema_version", 0) >= 3
                            : existingSummary.optInt("accepted_entries", 0) > 0;
                        if (expectedPackVersion.equals(installedVersion) && hasContent) {
                            JSObject result = new JSObject();
                            JSObject coreSummary = extendedLayer && coreDb.exists()
                                ? readDbSummary(coreDb)
                                : existingSummary;
                            result.put("installed", coreDb.exists() && coreDb.length() > 0);
                            result.put("alreadyInstalled", true);
                            result.put("dbPath", coreDb.getAbsolutePath());
                            result.put("dbSizeBytes", coreDb.exists() ? coreDb.length() : 0L);
                            populateLayerSummary(result, coreSummary, dir);
                            call.resolve(result);
                            return;
                        }
                    } catch (Exception ignored) {
                        // Existing DB failed verification or differed; proceed cleanly to staged upgrade/reinstall.
                    }
                }

                // Step 1: Check available storage before starting/resuming
                long existingPartBytes = partGz.exists() ? partGz.length() : 0L;
                long remainingDownload = Math.max(0L, compressedSizeBytes - existingPartBytes);
                long requiredBytes = remainingDownload + uncompressedSizeBytes + STORAGE_SAFETY_MARGIN_BYTES;
                long availableBytes = getAvailableStorageBytes(dir);

                if (availableBytes < requiredBytes) {
                    JSObject errData = new JSObject();
                    errData.put("availableBytes", availableBytes);
                    errData.put("requiredBytes", requiredBytes);
                    call.reject(
                        String.format(
                            Locale.US,
                            "Insufficient storage space. Available: %.1f MB, Required: %.1f MB.",
                            availableBytes / (1024.0 * 1024.0),
                            requiredBytes / (1024.0 * 1024.0)
                        ),
                        "INSUFFICIENT_STORAGE",
                        errData
                    );
                    return;
                }

                // Step 2: Resumable streaming download with HTTP Range + ETag validation
                emitProgress("downloading", existingPartBytes, compressedSizeBytes, "Preparing download...");
                downloadWithResume(downloadUrl, compressedSizeBytes, partGz, metaFile);

                if (cancelRequested.get()) {
                    call.reject("Download paused. Partial file kept for safe resume.", "DOWNLOAD_CANCELLED");
                    return;
                }

                // Step 3: Verify compressed archive SHA-256
                emitProgress("verifying_archive", compressedSizeBytes, compressedSizeBytes, "Verifying compressed archive checksum...");
                String actualCompressedSha = computeFileSha256(partGz);
                if (!actualCompressedSha.equalsIgnoreCase(compressedSha256)) {
                    deleteIfExists(partGz);
                    deleteIfExists(metaFile);
                    call.reject(
                        "Downloaded archive SHA-256 verification failed. Expected " + compressedSha256 + " but got " + actualCompressedSha,
                        "CHECKSUM_MISMATCH_COMPRESSED"
                    );
                    return;
                }

                // Step 4: Native streaming gunzip directly to staging file + compute uncompressed SHA-256
                deleteIfExists(tmpDb);
                emitProgress("extracting", 0L, uncompressedSizeBytes, "Extracting SQLite dictionary...");
                String actualUncompressedSha;
                try {
                    actualUncompressedSha = extractGzipAndHash(partGz, tmpDb, uncompressedSizeBytes);
                } catch (Exception extractErr) {
                    deleteIfExists(tmpDb);
                    deleteIfExists(partGz);
                    deleteIfExists(metaFile);
                    throw extractErr;
                }

                // Step 5: Verify uncompressed SQLite SHA-256
                emitProgress("verifying_database", uncompressedSizeBytes, uncompressedSizeBytes, "Verifying database SHA-256 checksum...");
                if (!actualUncompressedSha.equalsIgnoreCase(uncompressedSha256)) {
                    deleteIfExists(tmpDb);
                    deleteIfExists(partGz);
                    deleteIfExists(metaFile);
                    call.reject(
                        "Extracted SQLite database SHA-256 verification failed.",
                        "CHECKSUM_MISMATCH_UNCOMPRESSED"
                    );
                    return;
                }

                // Step 6: Run SQLite integrity & schema validation on staging DB before activation
                emitProgress("verifying_integrity", uncompressedSizeBytes, uncompressedSizeBytes, "Running SQLite integrity checks...");
                JSObject dbSummary;
                try {
                    dbSummary = extendedLayer ? validateExtendedDatabase(tmpDb) : validateStagingDatabase(tmpDb);
                } catch (Exception integrityErr) {
                    deleteIfExists(tmpDb);
                    deleteIfExists(partGz);
                    deleteIfExists(metaFile);
                    throw integrityErr;
                }

                // Step 7: Atomic swap preserving active DB until tmpDb replaces it cleanly
                emitProgress(
                    "activating",
                    uncompressedSizeBytes,
                    uncompressedSizeBytes,
                    "Activating offline " + label + (extendedLayer ? " Extended" : "") + " dictionary..."
                );
                atomicReplaceDatabase(tmpDb, targetDb, bakDb);

                // Clean up temporary/compressed staging files after confirmed activation
                deleteIfExists(partGz);
                deleteIfExists(metaFile);

                JSObject result = new JSObject();
                JSObject coreSummary = extendedLayer && coreDb.exists() ? readDbSummary(coreDb) : dbSummary;
                result.put("installed", coreDb.exists() && coreDb.length() > 0);
                result.put("alreadyInstalled", false);
                result.put("dbPath", coreDb.getAbsolutePath());
                result.put("dbSizeBytes", coreDb.exists() ? coreDb.length() : 0L);
                populateLayerSummary(result, coreSummary, dir);
                call.resolve(result);
            } catch (CancelledException ce) {
                call.reject("Download paused. Partial file kept for safe resume.", "DOWNLOAD_CANCELLED");
            } catch (Exception e) {
                deleteIfExists(tmpDb);
                call.reject("PACK_INSTALL_FAILED: " + e.getMessage(), "PACK_INSTALL_FAILED", e);
            } finally {
                installInProgress.set(false);
            }
        });
    }

    @PluginMethod
    public void cancelInstall(PluginCall call) {
        cancelRequested.set(true);
        JSObject res = new JSObject();
        res.put("cancelled", true);
        call.resolve(res);
    }

    @PluginMethod
    public void removePack(PluginCall call) {
        if (installInProgress.get() || backupInProgress.get()) {
            call.reject("Cannot remove pack while installation or backup is active.", "INSTALL_IN_PROGRESS");
            return;
        }
        executor.execute(() -> {
            try {
                File dir = getPacksDir();
                if (isExtendedLayer(call)) {
                    deleteIfExists(getExtendedDb(dir, call));
                    deleteIfExists(getTmpDb(dir, call));
                    deleteIfExists(getBakDb(dir, call));
                    deleteIfExists(getPartGz(dir, call));
                    deleteIfExists(getMetaFile(dir, call));
                } else {
                    deleteIfExists(getActiveDb(dir, call));
                    deleteIfExists(getTmpDb(dir, call));
                    deleteIfExists(getBakDb(dir, call));
                    deleteIfExists(getPartGz(dir, call));
                    deleteIfExists(getMetaFile(dir, call));
                    deleteIfExists(getExtendedDb(dir, call));
                }
                JSObject res = new JSObject();
                res.put("removed", true);
                res.put("availableBytes", getAvailableStorageBytes(dir));
                call.resolve(res);
            } catch (Exception e) {
                call.reject("PACK_REMOVE_FAILED: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void verifyInstalledPack(PluginCall call) {
        executor.execute(() -> {
            try {
                File dir = getPacksDir();
                boolean extendedLayer = isExtendedLayer(call);
                File coreDb = getActiveDb(dir, call);
                File targetDb = getTargetDb(dir, call);
                if (!targetDb.exists()) {
                    call.reject("Dictionary pack database is not installed.", "NOT_INSTALLED");
                    return;
                }
                JSObject targetSummary = extendedLayer
                    ? validateExtendedDatabase(targetDb)
                    : validateStagingDatabase(targetDb);
                JSObject coreSummary = extendedLayer && coreDb.exists()
                    ? readDbSummary(coreDb)
                    : targetSummary;
                JSObject summary = new JSObject();
                summary.put("installed", coreDb.exists() && coreDb.length() > 0);
                summary.put("dbPath", coreDb.getAbsolutePath());
                summary.put("dbSizeBytes", coreDb.exists() ? coreDb.length() : 0L);
                populateLayerSummary(summary, coreSummary, dir);
                call.resolve(summary);
            } catch (Exception e) {
                call.reject("INTEGRITY_CHECK_FAILED: " + e.getMessage(), "SQLITE_INTEGRITY_FAILED", e);
            }
        });
    }

    @PluginMethod
    public void getMemoryMetrics(PluginCall call) {
        try {
            Runtime rt = Runtime.getRuntime();
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
            if (am != null) {
                am.getMemoryInfo(memInfo);
            }
            JSObject res = new JSObject();
            res.put("javaHeapUsedBytes", rt.totalMemory() - rt.freeMemory());
            res.put("javaHeapMaxBytes", rt.maxMemory());
            res.put("nativeHeapAllocatedBytes", Debug.getNativeHeapAllocatedSize());
            res.put("systemAvailMemBytes", memInfo.availMem);
            res.put("systemTotalMemBytes", memInfo.totalMem);
            res.put("lowMemory", memInfo.lowMemory);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("MEMORY_METRICS_ERROR: " + e.getMessage(), e);
        }
    }

    /**
     * Phase 5: User-controlled offline backup export using Android Storage Access Framework (ACTION_CREATE_DOCUMENT).
     * Creates a single compressed .lexicabackup ZIP containing bundled_state.json, optional packs/lexica_englishSQLite.db,
     * and manifest.json with exact byte counts and SHA-256 checksums.
     */
    @PluginMethod
    public void exportBackup(PluginCall call) {
        String bundledStateJson = call.getString("bundledStateJson", "");
        if (bundledStateJson == null || bundledStateJson.trim().isEmpty()) {
            call.reject("BACKUP_INVALID_PAYLOAD: Missing bundled dictionary state payload.", "BACKUP_INVALID_PAYLOAD");
            return;
        }
        boolean includeEnglishPack = Boolean.TRUE.equals(call.getBoolean("includeEnglishPack", true));
        String suggestedFileName = headerOrEmpty(call.getString("suggestedFileName", ""));
        if (suggestedFileName.isEmpty()) {
            SimpleDateFormat fmt = new SimpleDateFormat("yyyyMMdd", Locale.US);
            fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
            suggestedFileName = "lexica-backup-" + fmt.format(new Date()) + ".lexicabackup";
        }

        if (installInProgress.get()) {
            call.reject("INSTALL_IN_PROGRESS: Wait for the English pack download to finish before exporting.", "INSTALL_IN_PROGRESS");
            return;
        }
        if (!backupInProgress.compareAndSet(false, true)) {
            call.reject("BACKUP_IN_PROGRESS: Another backup operation is already in progress.", "BACKUP_IN_PROGRESS");
            return;
        }

        pendingExportStateJson = bundledStateJson;
        pendingExportIncludeEnglish = includeEnglishPack;

        try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/zip");
            intent.putExtra(Intent.EXTRA_TITLE, suggestedFileName);
            startActivityForResult(call, intent, "handleExportBackupResult");
        } catch (Exception e) {
            backupInProgress.set(false);
            call.reject("BACKUP_PICKER_FAILED: " + e.getMessage(), "BACKUP_PICKER_FAILED", e);
        }
    }

    @ActivityCallback
    private void handleExportBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            backupInProgress.set(false);
            return;
        }
        if (result == null
                || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            backupInProgress.set(false);
            call.reject("Backup export cancelled.", "BACKUP_CANCELLED");
            return;
        }

        final Uri targetUri = result.getData().getData();
        final String stateJson = pendingExportStateJson;
        final boolean includeEnglishRequested = pendingExportIncludeEnglish;

        executor.execute(() -> {
            try {
                File dir = getPacksDir();
                File activeDb = new File(dir, ACTIVE_DB_NAME);
                boolean includeEnglish = includeEnglishRequested && activeDb.exists() && activeDb.length() > 0;

                JSObject dbSummary = null;
                long dbTotalBytes = 0L;
                if (includeEnglish) {
                    emitProgress("exporting_backup", 0L, activeDb.length(), "Verifying installed SQLite pack before export...");
                    dbSummary = validateStagingDatabase(activeDb);
                    dbTotalBytes = activeDb.length();
                }

                byte[] stateBytes = stateJson.getBytes(StandardCharsets.UTF_8);
                String stateSha256 = computeBytesSha256(stateBytes);

                long progressTotal = Math.max(1L, dbTotalBytes + stateBytes.length);
                emitProgress("exporting_backup", 0L, progressTotal, "Writing offline backup archive...");

                String dbSha256 = "";
                try (OutputStream rawOut = openDocumentOutputStream(targetUri);
                     ZipOutputStream zos = new ZipOutputStream(rawOut)) {
                    zos.setLevel(Deflater.BEST_SPEED);

                    // 1. Write bundled_state.json
                    ZipEntry stateEntry = new ZipEntry(BACKUP_ENTRY_STATE);
                    zos.putNextEntry(stateEntry);
                    zos.write(stateBytes);
                    zos.closeEntry();

                    // 2. Stream active English SQLite DB once while hashing on-the-fly
                    if (includeEnglish) {
                        ZipEntry dbEntry = new ZipEntry(BACKUP_ENTRY_ENGLISH_DB);
                        zos.putNextEntry(dbEntry);

                        MessageDigest digest = MessageDigest.getInstance("SHA-256");
                        byte[] buf = new byte[IO_BUFFER_SIZE];
                        long written = 0L;
                        long lastEmitMs = 0L;

                        try (InputStream in = new BufferedInputStream(new FileInputStream(activeDb), IO_BUFFER_SIZE)) {
                            int n;
                            while ((n = in.read(buf)) != -1) {
                                digest.update(buf, 0, n);
                                zos.write(buf, 0, n);
                                written += n;
                                long now = System.currentTimeMillis();
                                if (now - lastEmitMs >= 200 || written >= dbTotalBytes) {
                                    lastEmitMs = now;
                                    emitProgress("exporting_backup", written, progressTotal, "Archiving offline English dictionary...");
                                }
                            }
                        }
                        zos.closeEntry();
                        dbSha256 = toHex(digest.digest());
                    }

                    // 3. Write manifest.json with verified SHA-256 checksums & exact byte sizes
                    JSONObject manifest = new JSONObject();
                    manifest.put("format", BACKUP_FORMAT);
                    manifest.put("formatVersion", BACKUP_FORMAT_VERSION);
                    SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                    isoFmt.setTimeZone(TimeZone.getTimeZone("UTC"));
                    manifest.put("createdAtIso", isoFmt.format(new Date()));
                    manifest.put("includesEnglishSqlite", includeEnglish);
                    manifest.put("bundledStateBytes", stateBytes.length);
                    manifest.put("bundledStateSha256", stateSha256);

                    if (includeEnglish && dbSummary != null) {
                        JSONObject enObj = new JSONObject();
                        enObj.put("packId", "en-wiktionary-sqlite");
                        enObj.put("packLayer", dbSummary.optString("pack_layer", "full"));
                        enObj.put("datasetVersion", dbSummary.optString("pack_version", ""));
                        enObj.put("schemaVersion", dbSummary.optInt("schema_version", 1));
                        enObj.put("acceptedEntries", dbSummary.optInt("accepted_entries", 0));
                        enObj.put("distinctHeadwords", dbSummary.optInt("distinct_headwords", 0));
                        enObj.put("totalSenses", dbSummary.optInt("total_senses", 0));
                        enObj.put("corePrimarySenses", dbSummary.optInt("core_primary_senses", dbSummary.optInt("accepted_entries", 0)));
                        enObj.put("totalWordForms", dbSummary.optInt("total_word_forms", 0));
                        enObj.put("dbBytes", dbTotalBytes);
                        enObj.put("dbSha256", dbSha256);
                        manifest.put("englishPack", enObj);
                    }

                    ZipEntry manifestEntry = new ZipEntry(BACKUP_ENTRY_MANIFEST);
                    zos.putNextEntry(manifestEntry);
                    zos.write(manifest.toString(2).getBytes(StandardCharsets.UTF_8));
                    zos.closeEntry();
                    zos.finish();
                }

                emitProgress("exporting_backup", progressTotal, progressTotal, "Offline backup exported.");

                JSObject res = new JSObject();
                res.put("exported", true);
                res.put("includesEnglishSqlite", includeEnglish);
                res.put("englishDbBytes", dbTotalBytes);
                res.put("englishDbSha256", dbSha256);
                res.put("bundledStateSha256", stateSha256);
                res.put("uri", targetUri.toString());
                call.resolve(res);
            } catch (Exception e) {
                call.reject("BACKUP_EXPORT_FAILED: " + e.getMessage(), "BACKUP_EXPORT_FAILED", e);
            } finally {
                pendingExportStateJson = "";
                backupInProgress.set(false);
            }
        });
    }

    /**
     * Phase 5: User-controlled offline restore via Android Storage Access Framework (ACTION_OPEN_DOCUMENT).
     * Reads .lexicabackup ZIP strictly offline via ContentResolver, verifies manifest + SHA-256 + SQLite PRAGMA quick_check,
     * prevents duplicate overwrites unless replaceExisting=true, and swaps atomically without corrupting active DB on failure.
     */
    @PluginMethod
    public void importBackup(PluginCall call) {
        boolean replaceExisting = Boolean.TRUE.equals(call.getBoolean("replaceExisting", false));

        if (installInProgress.get()) {
            call.reject("INSTALL_IN_PROGRESS: Wait for the English pack download to finish before restoring.", "INSTALL_IN_PROGRESS");
            return;
        }
        if (!backupInProgress.compareAndSet(false, true)) {
            call.reject("BACKUP_IN_PROGRESS: Another backup operation is already in progress.", "BACKUP_IN_PROGRESS");
            return;
        }

        pendingImportReplaceExisting = replaceExisting;

        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(
                Intent.EXTRA_MIME_TYPES,
                new String[] { "application/zip", "application/x-zip-compressed", "application/octet-stream", "*/*" }
            );
            startActivityForResult(call, intent, "handleImportBackupResult");
        } catch (Exception e) {
            backupInProgress.set(false);
            call.reject("BACKUP_PICKER_FAILED: " + e.getMessage(), "BACKUP_PICKER_FAILED", e);
        }
    }

    @ActivityCallback
    private void handleImportBackupResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            backupInProgress.set(false);
            return;
        }
        if (result == null
                || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            backupInProgress.set(false);
            call.reject("Backup restore cancelled.", "BACKUP_CANCELLED");
            return;
        }

        final Uri sourceUri = result.getData().getData();
        final boolean replaceExisting = pendingImportReplaceExisting;

        executor.execute(() -> {
            File dir = getPacksDir();
            File activeDb = new File(dir, ACTIVE_DB_NAME);
            File bakDb = new File(dir, BACKUP_DB_NAME);
            File stagingDb = new File(dir, "lexica_englishSQLite.backup.tmp.db");

            try {
                deleteIfExists(stagingDb);
                emitProgress("reading_backup", 0L, 100L, "Reading offline backup archive...");

                String manifestStr = null;
                byte[] bundledStateBytes = null;
                boolean extractedDb = false;
                String extractedDbSha256 = "";
                long extractedDbBytes = 0L;

                try (InputStream rawIn = getContext().getContentResolver().openInputStream(sourceUri)) {
                    if (rawIn == null) {
                        throw new IOException("Unable to open selected backup document.");
                    }
                    try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(rawIn, IO_BUFFER_SIZE))) {
                        ZipEntry entry;
                        while ((entry = zis.getNextEntry()) != null) {
                            String entryName = entry.getName();
                            if (entry.isDirectory()) {
                                zis.closeEntry();
                                continue;
                            }
                            if (entryName.contains("..")) {
                                throw new IOException("Unsafe path in backup archive: " + entryName);
                            }

                            if (BACKUP_ENTRY_MANIFEST.equals(entryName)) {
                                byte[] bytes = readSmallZipEntry(zis, MAX_JSON_ENTRY_BYTES);
                                manifestStr = new String(bytes, StandardCharsets.UTF_8);
                            } else if (BACKUP_ENTRY_STATE.equals(entryName)) {
                                bundledStateBytes = readSmallZipEntry(zis, MAX_JSON_ENTRY_BYTES);
                            } else if (BACKUP_ENTRY_ENGLISH_DB.equals(entryName)) {
                                long avail = getAvailableStorageBytes(dir);
                                long expectedEntrySize = entry.getSize();
                                if (expectedEntrySize > 0 && avail < expectedEntrySize + STORAGE_SAFETY_MARGIN_BYTES) {
                                    throw new IOException("Insufficient storage space to restore English SQLite pack.");
                                }
                                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                                byte[] buf = new byte[IO_BUFFER_SIZE];
                                long written = 0L;
                                long lastEmitMs = 0L;
                                long progressDenominator = expectedEntrySize > 0 ? expectedEntrySize : 115_000_000L;

                                try (FileOutputStream fos = new FileOutputStream(stagingDb, false)) {
                                    int n;
                                    while ((n = zis.read(buf)) != -1) {
                                        digest.update(buf, 0, n);
                                        fos.write(buf, 0, n);
                                        written += n;
                                        long now = System.currentTimeMillis();
                                        if (now - lastEmitMs >= 200) {
                                            lastEmitMs = now;
                                            emitProgress(
                                                "reading_backup",
                                                Math.min(written, progressDenominator),
                                                progressDenominator,
                                                "Extracting backup SQLite dictionary..."
                                            );
                                        }
                                    }
                                    fos.getFD().sync();
                                }
                                extractedDb = true;
                                extractedDbBytes = written;
                                extractedDbSha256 = toHex(digest.digest());
                            }
                            zis.closeEntry();
                        }
                    }
                }

                if (manifestStr == null || bundledStateBytes == null) {
                    call.reject(
                        "BACKUP_CORRUPTED: Archive is missing manifest.json or bundled_state.json.",
                        "BACKUP_CORRUPTED"
                    );
                    return;
                }

                emitProgress("verifying_backup", 50L, 100L, "Verifying backup checksums and structure...");
                JSONObject manifest = new JSONObject(manifestStr);
                if (!BACKUP_FORMAT.equals(manifest.optString("format", ""))
                        || manifest.optInt("formatVersion", 0) != BACKUP_FORMAT_VERSION) {
                    call.reject("BACKUP_CORRUPTED: Unsupported or invalid Lexica backup format.", "BACKUP_CORRUPTED");
                    return;
                }

                String expectedStateSha = headerOrEmpty(manifest.optString("bundledStateSha256", ""));
                long expectedStateBytes = manifest.optLong("bundledStateBytes", -1L);
                String actualStateSha = computeBytesSha256(bundledStateBytes);
                if (!SHA256_HEX_PATTERN.matcher(expectedStateSha).matches()
                        || expectedStateBytes != bundledStateBytes.length
                        || !expectedStateSha.equalsIgnoreCase(actualStateSha)) {
                    call.reject("BACKUP_CORRUPTED: Bundled language state checksum verification failed.", "BACKUP_CORRUPTED");
                    return;
                }

                String bundledStateJson = new String(bundledStateBytes, StandardCharsets.UTF_8);
                // Validate bundledStateJson is parseable JSON object
                new JSONObject(bundledStateJson);

                boolean includesEnglishSqlite = manifest.optBoolean("includesEnglishSqlite", false);
                JSObject restoredDbSummary = null;

                if (includesEnglishSqlite) {
                    JSONObject enObj = manifest.optJSONObject("englishPack");
                    if (!extractedDb || !stagingDb.exists() || enObj == null) {
                        call.reject(
                            "BACKUP_CORRUPTED: Backup manifest declares English SQLite pack, but archive database is missing.",
                            "BACKUP_CORRUPTED"
                        );
                        return;
                    }
                    long expectedDbBytes = enObj.optLong("dbBytes", -1L);
                    String expectedDbSha = headerOrEmpty(enObj.optString("dbSha256", ""));
                    if (!SHA256_HEX_PATTERN.matcher(expectedDbSha).matches()
                            || expectedDbBytes != extractedDbBytes
                            || !expectedDbSha.equalsIgnoreCase(extractedDbSha256)) {
                        call.reject(
                            "BACKUP_CORRUPTED: English SQLite backup SHA-256 verification failed. Existing dictionary was left untouched.",
                            "BACKUP_CORRUPTED"
                        );
                        return;
                    }

                    // Validate SQLite integrity before touching active DB
                    try {
                        restoredDbSummary = validateStagingDatabase(stagingDb);
                    } catch (Exception integrityErr) {
                        call.reject(
                            "BACKUP_CORRUPTED: Restored SQLite failed PRAGMA quick_check (" + integrityErr.getMessage() + ").",
                            "BACKUP_CORRUPTED"
                        );
                        return;
                    }

                    // Duplicate / overwrite safeguard
                    if (activeDb.exists() && activeDb.length() > 0 && !replaceExisting) {
                        String existingSha = "";
                        try {
                            existingSha = computeFileSha256(activeDb);
                        } catch (Exception ignored) {
                        }
                        if (!existingSha.isEmpty() && existingSha.equalsIgnoreCase(extractedDbSha256)) {
                            call.reject(
                                "BACKUP_DUPLICATE_PACK: The selected backup matches the already installed English dictionary pack.",
                                "BACKUP_DUPLICATE_PACK"
                            );
                            return;
                        }
                        call.reject(
                            "BACKUP_CONFLICT_EXISTS: An offline English dictionary is already installed. Confirm Replace Existing to overwrite it.",
                            "BACKUP_CONFLICT_EXISTS"
                        );
                        return;
                    }

                    emitProgress("restoring_backup", 90L, 100L, "Activating restored English SQLite dictionary...");
                    atomicReplaceDatabase(stagingDb, activeDb, bakDb);
                }

                emitProgress("restoring_backup", 100L, 100L, "Backup restored offline.");

                JSObject res = new JSObject();
                res.put("restored", true);
                res.put("includesEnglishSqlite", includesEnglishSqlite);
                res.put("bundledStateJson", bundledStateJson);
                res.put("uri", sourceUri.toString());
                if (includesEnglishSqlite && restoredDbSummary != null) {
                    res.put("dbPath", activeDb.getAbsolutePath());
                    res.put("dbSizeBytes", activeDb.length());
                    populateLayerSummary(res, restoredDbSummary, dir);
                }
                call.resolve(res);
            } catch (Exception e) {
                call.reject("BACKUP_IMPORT_FAILED: " + e.getMessage(), "BACKUP_IMPORT_FAILED", e);
            } finally {
                deleteIfExists(stagingDb);
                backupInProgress.set(false);
            }
        });
    }

    private OutputStream openDocumentOutputStream(Uri uri) throws IOException {
        try {
            OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt");
            if (out != null) return out;
        } catch (IllegalArgumentException ignored) {
            // Some OEM document providers accept only default write mode
        }
        OutputStream fallback = getContext().getContentResolver().openOutputStream(uri);
        if (fallback == null) {
            throw new IOException("Unable to open target document for writing.");
        }
        return fallback;
    }

    private byte[] readSmallZipEntry(ZipInputStream zis, int maxBytes) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = zis.read(buf)) != -1) {
            total += n;
            if (total > maxBytes) {
                throw new IOException("Backup metadata entry exceeded safety size limit.");
            }
            baos.write(buf, 0, n);
        }
        return baos.toByteArray();
    }

    private void atomicReplaceDatabase(File stagingDb, File activeDb, File bakDb) throws IOException {
        boolean hadExisting = activeDb.exists();
        deleteIfExists(bakDb);
        if (hadExisting && !activeDb.renameTo(bakDb)) {
            deleteIfExists(stagingDb);
            throw new IOException("Failed to stage existing database backup before replacement.");
        }
        if (!stagingDb.renameTo(activeDb)) {
            if (hadExisting && bakDb.exists()) {
                //noinspection ResultOfMethodCallIgnored
                bakDb.renameTo(activeDb);
            }
            deleteIfExists(stagingDb);
            throw new IOException("Failed to activate verified English SQLite database.");
        }
        deleteIfExists(bakDb);
    }

    private void deleteIfExists(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private void emitProgress(String stage, long processedBytes, long totalBytes, String message) {
        JSObject data = new JSObject();
        data.put("stage", stage);
        data.put("processedBytes", processedBytes);
        data.put("totalBytes", totalBytes);
        int percent = totalBytes > 0 ? (int) Math.min(100L, (processedBytes * 100L) / totalBytes) : 0;
        data.put("percent", percent);
        data.put("message", message);
        notifyListeners("packInstallProgress", data);
    }

    private void downloadWithResume(String initialUrl, long expectedTotalBytes, File partFile, File metaFile)
            throws Exception {
        long existingLen = partFile.exists() ? partFile.length() : 0L;
        if (existingLen == expectedTotalBytes) {
            return;
        }
        if (existingLen > expectedTotalBytes) {
            deleteIfExists(partFile);
            deleteIfExists(metaFile);
            existingLen = 0L;
        }

        String savedEtag = "";
        boolean canResume = false;
        if (existingLen > 0 && metaFile.exists()) {
            try {
                String metaText = readTextFile(metaFile);
                JSONObject meta = new JSONObject(metaText);
                String metaUrl = meta.optString("url", "");
                savedEtag = meta.optString("etag", "");
                if (initialUrl.equals(metaUrl) && !savedEtag.isEmpty()) {
                    canResume = true;
                }
            } catch (Exception ignored) {
                canResume = false;
            }
        }

        if (!canResume && existingLen > 0) {
            deleteIfExists(partFile);
            deleteIfExists(metaFile);
            existingLen = 0L;
        }

        HttpURLConnection conn = openConnectionWithRedirects(initialUrl, existingLen);
        try {
            int status = conn.getResponseCode();
            String respEtag = headerOrEmpty(conn.getHeaderField("ETag"));
            String contentRange = headerOrEmpty(conn.getHeaderField("Content-Range"));

            boolean appendMode = false;
            long bytesAlready = 0L;

            if (existingLen > 0 && status == HttpURLConnection.HTTP_PARTIAL) {
                boolean rangeValid = contentRange.toLowerCase(Locale.US).startsWith("bytes " + existingLen + "-");
                boolean etagMatches = savedEtag.isEmpty() || respEtag.isEmpty() || savedEtag.equals(respEtag);
                if (rangeValid && etagMatches) {
                    appendMode = true;
                    bytesAlready = existingLen;
                } else {
                    conn.disconnect();
                    deleteIfExists(partFile);
                    deleteIfExists(metaFile);
                    conn = openConnectionWithRedirects(initialUrl, 0L);
                    status = conn.getResponseCode();
                    respEtag = headerOrEmpty(conn.getHeaderField("ETag"));
                }
            } else if (existingLen > 0 && status == 416) {
                conn.disconnect();
                deleteIfExists(partFile);
                deleteIfExists(metaFile);
                conn = openConnectionWithRedirects(initialUrl, 0L);
                status = conn.getResponseCode();
                respEtag = headerOrEmpty(conn.getHeaderField("ETag"));
            } else if (existingLen > 0 && status == HttpURLConnection.HTTP_OK) {
                deleteIfExists(partFile);
                deleteIfExists(metaFile);
                appendMode = false;
                bytesAlready = 0L;
            }

            if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
                throw new IOException("HTTP download failed with status code " + status);
            }

            JSONObject meta = new JSONObject();
            meta.put("url", initialUrl);
            meta.put("etag", respEtag.isEmpty() ? savedEtag : respEtag);
            meta.put("totalBytes", expectedTotalBytes);
            writeTextFile(metaFile, meta.toString());

            long downloaded = bytesAlready;
            long lastEmitMs = 0L;
            byte[] buffer = new byte[IO_BUFFER_SIZE];

            try (InputStream in = new BufferedInputStream(conn.getInputStream(), IO_BUFFER_SIZE);
                 FileOutputStream out = new FileOutputStream(partFile, appendMode)) {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelRequested.get()) {
                        out.flush();
                        throw new CancelledException();
                    }
                    out.write(buffer, 0, read);
                    downloaded += read;

                    long now = System.currentTimeMillis();
                    if (now - lastEmitMs >= 200 || downloaded >= expectedTotalBytes) {
                        lastEmitMs = now;
                        emitProgress("downloading", downloaded, expectedTotalBytes, "Downloading English dictionary pack...");
                    }
                }
                out.getFD().sync();
            }
            long actualPartLen = partFile.exists() ? partFile.length() : 0L;
            if (actualPartLen < expectedTotalBytes) {
                throw new IOException(
                    "Download interrupted at " + actualPartLen + " of " + expectedTotalBytes + " bytes. Tap Retry to resume."
                );
            }
            if (actualPartLen > expectedTotalBytes) {
                deleteIfExists(partFile);
                deleteIfExists(metaFile);
                throw new IOException("Downloaded archive exceeded expected size; cleared partial file for clean retry.");
            }
        } finally {
            conn.disconnect();
        }
    }

    private long extractPositiveLong(PluginCall call, String key) {
        Object raw = call.getData().opt(key);
        if (raw == null || raw == JSONObject.NULL) {
            return 0L;
        }
        if (raw instanceof Number) {
            long val = ((Number) raw).longValue();
            return val > 0L ? val : 0L;
        }
        if (raw instanceof String) {
            try {
                long val = Long.parseLong(((String) raw).trim());
                return val > 0L ? val : 0L;
            } catch (NumberFormatException ignored) {
                return 0L;
            }
        }
        return 0L;
    }

    private HttpURLConnection openConnectionWithRedirects(String urlStr, long rangeStart) throws IOException {
        String currentUrl = urlStr;
        for (int hop = 0; hop < MAX_REDIRECTS; hop++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(currentUrl).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "Lexica-Android/1.1.0");
            conn.setRequestProperty("Accept-Encoding", "identity");
            if (rangeStart > 0) {
                conn.setRequestProperty("Range", "bytes=" + rangeStart + "-");
            }
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                    || code == HttpURLConnection.HTTP_MOVED_TEMP
                    || code == HttpURLConnection.HTTP_SEE_OTHER
                    || code == 307
                    || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new IOException("Redirect without Location header");
                }
                currentUrl = new URL(new URL(currentUrl), location).toString();
                continue;
            }
            return conn;
        }
        throw new IOException("Too many redirects while downloading English pack");
    }

    private String headerOrEmpty(String val) {
        return val == null ? "" : val.trim();
    }

    private String computeBytesSha256(byte[] data) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(data);
        return toHex(digest.digest());
    }

    private String computeFileSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[IO_BUFFER_SIZE];
        try (InputStream in = new BufferedInputStream(new FileInputStream(file), IO_BUFFER_SIZE)) {
            int n;
            while ((n = in.read(buf)) != -1) {
                digest.update(buf, 0, n);
            }
        }
        return toHex(digest.digest());
    }

    private String extractGzipAndHash(File gzFile, File outFile, long expectedBytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[IO_BUFFER_SIZE];
        long written = 0L;
        long lastEmitMs = 0L;

        try (GZIPInputStream gzipIn = new GZIPInputStream(new BufferedInputStream(new FileInputStream(gzFile), IO_BUFFER_SIZE), IO_BUFFER_SIZE);
             FileOutputStream out = new FileOutputStream(outFile, false)) {
            int n;
            while ((n = gzipIn.read(buf)) != -1) {
                digest.update(buf, 0, n);
                out.write(buf, 0, n);
                written += n;
                long now = System.currentTimeMillis();
                if (now - lastEmitMs >= 250 || written >= expectedBytes) {
                    lastEmitMs = now;
                    emitProgress("extracting", written, expectedBytes, "Extracting SQLite database...");
                }
            }
            out.getFD().sync();
        }
        return toHex(digest.digest());
    }

    private void populateLayerSummary(JSObject target, JSObject metaSummary, File packsDir) {
        target.put("datasetVersion", metaSummary.optString("pack_version", ""));
        int schemaVer = metaSummary.optInt("schema_version", 1);
        target.put("schemaVersion", schemaVer);
        String packLayer = metaSummary.optString("pack_layer", schemaVer >= 3 ? "core" : "full");
        target.put("packLayer", packLayer);
        int acceptedEntries = metaSummary.optInt("accepted_entries", 0);
        target.put("acceptedEntries", acceptedEntries);
        target.put("distinctHeadwords", metaSummary.optInt("distinct_headwords", 0));
        target.put("totalSenses", metaSummary.optInt("total_senses", 0));
        target.put("corePrimarySenses", metaSummary.optInt("core_primary_senses", acceptedEntries));
        target.put("totalWordForms", metaSummary.optInt("total_word_forms", 0));

        boolean isHa = target.optString("dbPath", "").contains("hausa");
        File extDb = new File(packsDir, isHa ? "lexica_hausa_extended.db" : EXTENDED_DB_NAME);
        boolean extInstalled = extDb.exists() && extDb.length() > 0L;
        target.put("extendedInstalled", extInstalled);
        target.put("extendedDbPath", extInstalled ? extDb.getAbsolutePath() : "");
        target.put("extendedDbSizeBytes", extInstalled ? extDb.length() : 0L);
    }

    private JSObject validateStagingDatabase(File dbFile) throws Exception {
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            try (Cursor qc = db.rawQuery("PRAGMA quick_check;", null)) {
                if (!qc.moveToFirst() || !"ok".equalsIgnoreCase(qc.getString(0))) {
                    throw new IOException("PRAGMA quick_check failed");
                }
            }
            try (Cursor tables = db.rawQuery(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('entries','word_forms','entries_fts','metadata','sources');",
                null
            )) {
                if (!tables.moveToFirst() || tables.getInt(0) < 5) {
                    throw new IOException("Missing required English dictionary base tables");
                }
            }
            boolean hasSensesTable = false;
            try (Cursor sensesCur = db.rawQuery(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='senses';",
                null
            )) {
                hasSensesTable = sensesCur.moveToFirst() && sensesCur.getInt(0) > 0;
            }
            boolean hasPosTable = false;
            try (Cursor posCur = db.rawQuery(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='parts_of_speech';",
                null
            )) {
                hasPosTable = posCur.moveToFirst() && posCur.getInt(0) > 0;
            }
            if (!hasSensesTable && !hasPosTable) {
                throw new IOException("Missing senses or Core parts_of_speech schema table");
            }
            try (Cursor countCur = db.rawQuery("SELECT COUNT(*) FROM entries;", null)) {
                if (!countCur.moveToFirst() || countCur.getInt(0) <= 0) {
                    throw new IOException("English dictionary entries table is empty");
                }
            }
            if (!hasSensesTable && hasPosTable) {
                try (Cursor defCur = db.rawQuery(
                    "SELECT COUNT(*) FROM entries WHERE primary_definition IS NOT NULL AND length(primary_definition) > 0;",
                    null
                )) {
                    if (!defCur.moveToFirst() || defCur.getInt(0) <= 0) {
                        throw new IOException("Core English dictionary entries lack primary definitions");
                    }
                }
            }
            return readDbSummaryFromOpenDb(db);
        } finally {
            if (db != null) {
                db.close();
            }
        }
    }

    private JSObject validateExtendedDatabase(File dbFile) throws Exception {
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            try (Cursor qc = db.rawQuery("PRAGMA quick_check;", null)) {
                if (!qc.moveToFirst() || !"ok".equalsIgnoreCase(qc.getString(0))) {
                    throw new IOException("Extended DB PRAGMA quick_check failed");
                }
            }
            try (Cursor tables = db.rawQuery(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('metadata','senses_ext','entry_extensions');",
                null
            )) {
                if (!tables.moveToFirst() || tables.getInt(0) < 3) {
                    throw new IOException("Missing required Extended dictionary schema tables");
                }
            }
            try (Cursor countCur = db.rawQuery("SELECT COUNT(*) FROM senses_ext;", null)) {
                if (!countCur.moveToFirst() || countCur.getInt(0) <= 0) {
                    throw new IOException("Extended dictionary senses_ext table is empty");
                }
            }
            return readDbSummaryFromOpenDb(db);
        } finally {
            if (db != null) {
                db.close();
            }
        }
    }

    private JSObject readDbSummary(File dbFile) throws Exception {
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(dbFile.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            return readDbSummaryFromOpenDb(db);
        } finally {
            if (db != null) {
                db.close();
            }
        }
    }

    private JSObject readDbSummaryFromOpenDb(SQLiteDatabase db) {
        JSObject obj = new JSObject();
        try (Cursor c = db.rawQuery("SELECT key, value FROM metadata;", null)) {
            while (c.moveToNext()) {
                String k = c.getString(0);
                String v = c.getString(1);
                if ("accepted_entries".equals(k)
                        || "distinct_headwords".equals(k)
                        || "total_senses".equals(k)
                        || "schema_version".equals(k)
                        || "core_primary_senses".equals(k)
                        || "total_word_forms".equals(k)) {
                    try {
                        obj.put(k, Integer.parseInt(v));
                    } catch (NumberFormatException ignored) {
                        obj.put(k, "schema_version".equals(k) ? 1 : 0);
                    }
                } else {
                    obj.put(k, v);
                }
            }
        }
        return obj;
    }

    private String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private String readTextFile(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            int total = 0;
            while (total < data.length) {
                int r = fis.read(data, total, data.length - total);
                if (r < 0) break;
                total += r;
            }
            return new String(data, 0, total, StandardCharsets.UTF_8);
        }
    }

    private void writeTextFile(File file, String content) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(file, false)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.getFD().sync();
        }
    }

    private static class CancelledException extends Exception {}
}
