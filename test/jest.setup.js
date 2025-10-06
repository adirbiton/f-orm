// Automatically point Firebase SDKs to the local emulator if env vars are set
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-test';
// To enable, set these before running tests:
// FIRESTORE_EMULATOR_HOST=localhost:8080
// FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
