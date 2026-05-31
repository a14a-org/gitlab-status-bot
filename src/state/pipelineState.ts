import { Firestore } from '@google-cloud/firestore';

const COLLECTION = 'pipeline-states';

// Lazily initialize the Firestore client so importing this module does not
// require Google credentials (e.g. during local integration tests). The client
// is only constructed on first real use, preserving production behavior.
let _db: Firestore | undefined;
const db = (): Firestore => {
    if (!_db) {
        _db = new Firestore();
    }
    return _db;
};

// Hermetic in-memory backend used when PIPELINE_STATE_BACKEND=memory, so that
// integration tests can exercise the webhook handlers without a live Firestore.
const useMemory = (): boolean => process.env.PIPELINE_STATE_BACKEND === 'memory';
const memoryStore = new Map<string, FirestorePipelineMessage>();

export interface PipelineMessage {
    ts: string;
    channel: string;
    expandedStages: Set<string>;
    lastPipelineData: any;
}

// Internal interface for Firestore storage (Sets don't serialize well)
interface FirestorePipelineMessage {
    ts: string;
    channel: string;
    expandedStages: string[];
    lastPipelineData: any;
}

export const getPipelineState = async (pipelineId: number): Promise<PipelineMessage | undefined> => {
    try {
        if (useMemory()) {
            const stored = memoryStore.get(pipelineId.toString());
            if (!stored) {
                return undefined;
            }
            return { ...stored, expandedStages: new Set(stored.expandedStages) };
        }

        const doc = await db().collection(COLLECTION).doc(pipelineId.toString()).get();
        
        if (!doc.exists) {
            return undefined;
        }
        
        const data = doc.data() as FirestorePipelineMessage;
        return {
            ...data,
            expandedStages: new Set(data.expandedStages), // Convert array back to Set
        };
    } catch (error) {
        console.error('Error getting pipeline state from Firestore:', error);
        return undefined;
    }
};

export const setPipelineState = async (pipelineId: number, message: PipelineMessage): Promise<void> => {
    try {
        const firestoreData: FirestorePipelineMessage = {
            ...message,
            expandedStages: Array.from(message.expandedStages), // Convert Set to array for storage
        };
        
        if (useMemory()) {
            memoryStore.set(pipelineId.toString(), firestoreData);
            return;
        }

        await db().collection(COLLECTION).doc(pipelineId.toString()).set(firestoreData);
    } catch (error) {
        console.error('Error setting pipeline state in Firestore:', error);
        throw error; // Re-throw to handle in calling code
    }
};

export const deletePipelineState = async (pipelineId: number): Promise<void> => {
    try {
        if (useMemory()) {
            memoryStore.delete(pipelineId.toString());
            return;
        }

        await db().collection(COLLECTION).doc(pipelineId.toString()).delete();
    } catch (error) {
        console.error('Error deleting pipeline state from Firestore:', error);
        throw error;
    }
};

// Optional: Cleanup old pipeline states (can be called periodically)
export const cleanupOldStates = async (olderThanDays: number = 7): Promise<void> => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        
        // Note: This is a simple cleanup. In production, you might want to add
        // a timestamp field to documents for more efficient querying
        const snapshot = await db().collection(COLLECTION).get();
        const batch = db().batch();
        
        snapshot.docs.forEach(doc => {
            // Simple cleanup based on document creation time
            // You could enhance this with a proper timestamp field
            if (doc.createTime && doc.createTime.toDate() < cutoffDate) {
                batch.delete(doc.ref);
            }
        });
        
        await batch.commit();
        console.log(`Cleaned up old pipeline states older than ${olderThanDays} days`);
    } catch (error) {
        console.error('Error cleaning up old pipeline states:', error);
    }
};
