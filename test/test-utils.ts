import { FirestoreOrmRepository } from "../index";

/**
 * Common timeout for longer running tests
 */
export const EXTENDED_TIMEOUT = 10000;

/**
 * Initializes Firebase and ORM for testing
 * @returns Object containing the initialized firebase app, connection and storage
 */
export const usingEmulator = (): boolean => {
  return !!process.env.FIRESTORE_EMULATOR_HOST;
};

export const initializeTestEnvironment = () => {
  // Prefer Firebase Emulator if available
  if (usingEmulator()) {
    try {
      // Lazy require to avoid hard dependency when not needed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const admin = require('firebase-admin');
      if (admin.apps && admin.apps.length === 0) {
        admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-test' });
      }
      const firestore = admin.firestore();
      const storage = admin.storage && admin.storage();
      FirestoreOrmRepository.initGlobalConnection(firestore);
      if (storage) FirestoreOrmRepository.initGlobalStorage(storage);
      return { firebaseApp: admin.app(), connection: firestore, storage };
    } catch (e) {
      // Fallback to in-memory mocks below
    }
  }

  // Create a minimal Admin-like Firestore mock for tests
  const mockQuerySnapshot = {
    docs: [],
    size: 0,
    empty: true
  } as any;

  const collectionImpl = (name: string) => {
    const store: Array<{ id: string; data: any; path: string }> = [];
    const state: any = { filters: [] as Array<(rec: { id: string; data: any }) => boolean>, limit: undefined as number | undefined };

    const api: any = {
      _name: name,
      where: jest.fn((field: string, op: string, value: any) => {
        state.filters.push((rec: { id: string; data: any }) => {
          const v = field === '__name__' ? rec.id : rec.data[field];
          switch (op) {
            case '==': return v === value;
            case '>=': return v >= value;
            case '<=': return v <= value;
            case '>': return v > value;
            case '<': return v < value;
            case 'array-contains': return Array.isArray(v) && v.includes(value);
            default: return true;
          }
        });
        return api;
      }),
      orderBy: jest.fn(() => api),
      limit: jest.fn((n: number) => { state.limit = n; return api; }),
      startAt: jest.fn(() => api),
      onSnapshot: jest.fn((cb: any) => {
        cb({ docChanges: () => [] });
        return () => {};
      }),
      add: jest.fn(async (data: any) => {
        const id = Math.random().toString(36).slice(2);
        store.push({ id, data, path: `${name}/${id}` });
        return { id };
      }),
      doc: jest.fn((id?: string) => {
        const docId = id || Math.random().toString(36).slice(2);
        const path = `${name}/${docId}`;
        const ensure = () => {
          let found = store.find(d => d.id === docId);
          if (!found) {
            found = { id: docId, data: {}, path };
            store.push(found);
          }
          return found;
        };
        return {
          id: docId,
          path,
          set: jest.fn(async (data: any) => { const f = ensure(); f.data = { ...data }; }),
          update: jest.fn(async (data: any) => { const f = ensure(); f.data = { ...f.data, ...data }; }),
          get: jest.fn(async () => {
            const f = store.find(d => d.id === docId);
            return { exists: !!f, id: docId, data: () => (f ? f.data : undefined), ref: { path } };
          }),
          delete: jest.fn(async () => {
            const idx = store.findIndex(d => d.id === docId);
            if (idx >= 0) store.splice(idx, 1);
          }),
          onSnapshot: jest.fn((cb: any) => { cb({ data: () => (store.find(d => d.id === docId)?.data || {}) }); return () => {}; })
        };
      }),
      get: jest.fn(async () => {
        let results = store.slice();
        for (const filter of state.filters) {
          results = results.filter(rec => filter(rec));
        }
        if (typeof state.limit === 'number') {
          results = results.slice(0, state.limit);
        }
        return {
          docs: results.map((d: any) => ({ id: d.id, data: () => d.data, ref: { path: d.path } })),
          size: results.length,
          empty: results.length === 0
        };
      })
    };
    return api;
  };

  const collectionsMap: Record<string, any> = {};

  const mockFirestore: any = {
    _settings: {},
    collection: jest.fn((name: string) => {
      if (!collectionsMap[name]) {
        collectionsMap[name] = collectionImpl(name);
        collectionsMap[name].path = name;
      }
      return collectionsMap[name];
    }),
    doc: jest.fn((path: string) => ({
      path,
      set: jest.fn(async (data: any) => {}),
      update: jest.fn(async (data: any) => {}),
      get: jest.fn(async () => ({ exists: false, data: () => ({}) })),
      delete: jest.fn(async () => {})
    })),
    // naive collectionGroup: return a query over all collections with this name
    collectionGroup: jest.fn((name: string) => {
      // Merge all stores with prefix name; here we just return a fresh collection with empty store
      return collectionImpl(name);
    })
  };

  // Admin-like query helpers expected by repository/query
  mockFirestore.where = (field: string, op: string, value: any) => ({ type: 'where', apply: (ref: any) => ref.where(field, op, value) });
  mockFirestore.orderBy = (field: string, dir?: 'asc'|'desc') => ({ type: 'orderBy', apply: (ref: any) => ref.orderBy(field, dir) });
  mockFirestore.limit = (n: number) => ({ type: 'limit', apply: (ref: any) => ref.limit(n) });

  // Minimal storage mock
  const mockStorage: any = {
    ref: jest.fn(() => ({
      put: jest.fn(() => ({ on: jest.fn((_, __, ___, done) => done && done()) })),
      putString: jest.fn(() => ({ on: jest.fn((_, __, ___, done) => done && done()) }))
    }))
  };

  FirestoreOrmRepository.initGlobalConnection(mockFirestore);
  FirestoreOrmRepository.initGlobalStorage(mockStorage);

  return { firebaseApp: null, connection: mockFirestore, storage: mockStorage };
};

/**
 * Deletes all documents from a collection
 * @param Model The model class to clean up
 */
export const cleanupCollection = async (Model: any) => {
  const items = await Model.getAll();
  const deletePromises = items.map(item => item.remove());
  await Promise.all(deletePromises);
};