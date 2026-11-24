import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { uploadReceiptImage, deleteReceiptImages } from '../lib/storage/supabase-storage';

async function testStorageRollback() {
  console.log('--- STARTING STORAGE ROLLBACK & CLEANUP TEST ---');

  // Create a 1x1 dummy transparent PNG base64
  const dummyBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const testFileName = `test-rollback-${Date.now()}.png`;

  console.log('1. Uploading test receipt image...');
  const uploadResult = await uploadReceiptImage(dummyBase64, testFileName);
  assert.ok(uploadResult.storageKey, 'Storage key must be returned');
  console.log(`✓ Upload successful. Storage Key: ${uploadResult.storageKey}, Source: ${uploadResult.source}`);

  // If local fallback, verify file physically exists on disk
  if (uploadResult.storageKey.startsWith('local:')) {
    const localRel = uploadResult.storageKey.replace(/^local:/, '');
    const localPath = path.join(process.cwd(), 'storage', localRel);
    assert.strictEqual(fs.existsSync(localPath), true, 'File must exist on disk before rollback');
    console.log(`✓ Physical file confirmed on disk at: ${localPath}`);
  }

  // 2. Simulate failure rollback: call deleteReceiptImages
  console.log('2. Triggering atomic storage rollback cleanup...');
  const cleanupRes = await deleteReceiptImages([uploadResult.storageKey]);
  assert.strictEqual(cleanupRes.errors.length, 0, `Cleanup errors should be 0: ${cleanupRes.errors.join(', ')}`);
  assert.strictEqual(cleanupRes.deleted.length, 1, 'Exactly 1 file should be deleted');
  console.log(`✓ Cleanup report: deleted = [${cleanupRes.deleted.join(', ')}]`);

  // Verify file is physically gone
  if (uploadResult.storageKey.startsWith('local:')) {
    const localRel = uploadResult.storageKey.replace(/^local:/, '');
    const localPath = path.join(process.cwd(), 'storage', localRel);
    assert.strictEqual(fs.existsSync(localPath), false, 'File must NOT exist on disk after rollback');
    console.log('✓ Verified: File was physically deleted from disk. No orphaned storage files remain.');
  }

  console.log('--- STORAGE ROLLBACK TEST PASSED SUCCESSFULLY! ---');
}

testStorageRollback().catch((err) => {
  console.error('Storage rollback test failed:', err);
  process.exit(1);
});
