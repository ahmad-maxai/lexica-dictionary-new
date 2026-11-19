package com.lexica.dictionary;

import android.app.ActivityManager;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Debug;
import android.os.StatFs;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;
import org.json.JSONObject;

@CapacitorPlugin(name = "EnglishPackInstaller")
public class EnglishPackInstallerPlugin extends Plugin {

    private static final String PACKS_SUBDIR = "lexica_packs";
    private static final String ACTIVE_DB_NAME = "lexica_englishSQLite.db";
    private static final String TMP_DB_NAME = "lexica_englishSQLite.db.tmp";
    private static final String BACKUP_DB_NAME = "lexica_englishSQLite.db.bak";
    private static final String PART_GZ_NAME = "lexica_english.db.gz.part";
    private static final String META_FILE_NAME = "lexica_english.db.gz.meta.json";
    private static final long STORAGE_SAFETY_MARGIN_BYTES = 20L * 1024L * 1024L;
    private static final int IO_BUFFER_SIZE = 32768;
    private static final int MAX_REDIRECTS = 8;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean installInProgress = new AtomicBoolean(false);
    private final AtomicBoolean cancelRequested = new AtomicBoolean(false);

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

    @PluginMethod
    public void getPackStatus(PluginCall call) {
        executor.execute(() -> {
            try {
                File dir = getPacksDir();
                File activeDb = new File(dir, ACTIVE_DB_NAME);
                File partGz = new File(dir, PART_GZ_NAME);
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
                        res.put("datasetVersion", meta.optString("pack_version", ""));
                        res.put("acceptedEntries", meta.optInt("accepted_entries", 0));
                        res.put("distinctHeadwords", meta.optInt("distinct_headwords", 0));
                        res.put("totalSenses", meta.optInt("total_senses", 0));
                    } catch (Exception dbErr) {
                        res.put("installed", false);
                        res.put("error", dbErr.getMessage());
                    }
                } else {
                    res.put("installed", false);
                    res.put("dbSizeBytes", 0L);
                }

                call.resolve(res);
            } catch (Exception e) {
                call.reject("PACK_STATUS_ERROR: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void installPack(PluginCall call) {
        String downloadUrl = call.getString("url", "");
        String compressedSha256 = call.getString("compressedSha256", "");
        String uncompressedSha256 = call.getString("uncompressedSha256", "");
        long compressedSizeBytes = call.getLong("compressedSizeBytes", 0L);
        long uncompressedSizeBytes = call.getLong("uncompressedSizeBytes", 0L);

        if (downloadUrl.isEmpty() || compressedSha256.isEmpty() || uncompressedSha256.isEmpty()
                || compressedSizeBytes <= 0 || uncompressedSizeBytes <= 0) {
            call.reject("INVALID_MANIFEST: Missing pack URL, size, or SHA-256 checksums.", "INVALID_MANIFEST");
            return;
        }

        if (!installInProgress.compareAndSet(false, true)) {
            call.reject("INSTALL_IN_PROGRESS: Another English pack installation is already running.", "INSTALL_IN_PROGRESS");
            return;
        }
        cancelRequested.set(false);

        executor.execute(() -> {
            File dir = getPacksDir();
            File activeDb = new File(dir, ACTIVE_DB_NAME);
            File tmpDb = new File(dir, TMP_DB_NAME);
            File bakDb = new File(dir, BACKUP_DB_NAME);
            File partGz = new File(dir, PART_GZ_NAME);
            File metaFile = new File(dir, META_FILE_NAME);

            try {
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
                    // Corrupt download — clean partial files, keep any existing activeDb untouched
                    //noinspection ResultOfMethodCallIgnored
                    partGz.delete();
                    //noinspection ResultOfMethodCallIgnored
                    metaFile.delete();
                    call.reject(
                        "Downloaded archive SHA-256 verification failed. Expected " + compressedSha256 + " but got " + actualCompressedSha,
                        "CHECKSUM_MISMATCH_COMPRESSED"
                    );
                    return;
                }

                // Step 4: Native streaming gunzip directly to staging file + compute uncompressed SHA-256
                if (tmpDb.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpDb.delete();
                }
                emitProgress("extracting", 0L, uncompressedSizeBytes, "Extracting SQLite dictionary...");
                String actualUncompressedSha = extractGzipAndHash(partGz, tmpDb, uncompressedSizeBytes);

                // Step 5: Verify uncompressed SQLite SHA-256
                emitProgress("verifying_database", uncompressedSizeBytes, uncompressedSizeBytes, "Verifying database SHA-256 checksum...");
                if (!actualUncompressedSha.equalsIgnoreCase(uncompressedSha256)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpDb.delete();
                    call.reject(
                        "Extracted SQLite database SHA-256 verification failed.",
                        "CHECKSUM_MISMATCH_UNCOMPRESSED"
                    );
                    return;
                }

                // Step 6: Run SQLite integrity & schema validation on staging DB before activation
                emitProgress("verifying_integrity", uncompressedSizeBytes, uncompressedSizeBytes, "Running SQLite integrity checks...");
                JSObject dbSummary = validateStagingDatabase(tmpDb);

                // Step 7: Atomic swap preserving activeDb until tmpDb replaces it cleanly
                emitProgress("activating", uncompressedSizeBytes, uncompressedSizeBytes, "Activating offline English dictionary...");
                boolean hadExisting = activeDb.exists();
                if (bakDb.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    bakDb.delete();
                }
                if (hadExisting && !activeDb.renameTo(bakDb)) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpDb.delete();
                    call.reject("Failed to stage existing database backup before update.", "ACTIVATION_FAILED");
                    return;
                }
                if (!tmpDb.renameTo(activeDb)) {
                    if (hadExisting && bakDb.exists()) {
                        // Restore previous working DB immediately
                        //noinspection ResultOfMethodCallIgnored
                        bakDb.renameTo(activeDb);
                    }
                    //noinspection ResultOfMethodCallIgnored
                    tmpDb.delete();
                    call.reject("Failed to activate verified English SQLite database.", "ACTIVATION_FAILED");
                    return;
                }

                // Clean up temporary/compressed staging files after confirmed activation
                if (bakDb.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    bakDb.delete();
                }
                //noinspection ResultOfMethodCallIgnored
                partGz.delete();
                //noinspection ResultOfMethodCallIgnored
                metaFile.delete();

                JSObject result = new JSObject();
                result.put("installed", true);
                result.put("dbPath", activeDb.getAbsolutePath());
                result.put("dbSizeBytes", activeDb.length());
                result.put("datasetVersion", dbSummary.optString("pack_version", ""));
                result.put("acceptedEntries", dbSummary.optInt("accepted_entries", 0));
                result.put("distinctHeadwords", dbSummary.optInt("distinct_headwords", 0));
                result.put("totalSenses", dbSummary.optInt("total_senses", 0));
                call.resolve(result);
            } catch (CancelledException ce) {
                call.reject("Download paused. Partial file kept for safe resume.", "DOWNLOAD_CANCELLED");
            } catch (Exception e) {
                if (tmpDb.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tmpDb.delete();
                }
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
        if (installInProgress.get()) {
            call.reject("Cannot remove pack while installation is active.", "INSTALL_IN_PROGRESS");
            return;
        }
        executor.execute(() -> {
            try {
                File dir = getPacksDir();
                deleteIfExists(new File(dir, ACTIVE_DB_NAME));
                deleteIfExists(new File(dir, TMP_DB_NAME));
                deleteIfExists(new File(dir, BACKUP_DB_NAME));
                deleteIfExists(new File(dir, PART_GZ_NAME));
                deleteIfExists(new File(dir, META_FILE_NAME));
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
                File activeDb = new File(getPacksDir(), ACTIVE_DB_NAME);
                if (!activeDb.exists()) {
                    call.reject("English pack database is not installed.", "NOT_INSTALLED");
                    return;
                }
                JSObject summary = validateStagingDatabase(activeDb);
                summary.put("dbPath", activeDb.getAbsolutePath());
                summary.put("dbSizeBytes", activeDb.length());
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

    private void deleteIfExists(File file) {
        if (file.exists()) {
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
                // Server ignored Range and sent full body; restart cleanly from byte 0
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
        } finally {
            conn.disconnect();
        }
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
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('entries','senses','word_forms','entries_fts','metadata','sources');",
                null
            )) {
                if (!tables.moveToFirst() || tables.getInt(0) < 6) {
                    throw new IOException("Missing required English dictionary tables");
                }
            }
            try (Cursor countCur = db.rawQuery("SELECT COUNT(*) FROM entries;", null)) {
                if (!countCur.moveToFirst() || countCur.getInt(0) <= 0) {
                    throw new IOException("English dictionary entries table is empty");
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
                if ("accepted_entries".equals(k) || "distinct_headwords".equals(k) || "total_senses".equals(k)) {
                    try {
                        obj.put(k, Integer.parseInt(v));
                    } catch (NumberFormatException ignored) {
                        obj.put(k, 0);
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
