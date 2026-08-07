import { Queue } from 'bullmq';

// BullMQ keeps every completed and failed job forever unless told otherwise, and only one of the
// seven queues ever said otherwise. Nineteen repeating jobs firing every few minutes filled UAT's
// 400 MB Redis with 270k job records until `maxmemory` was hit; because the cluster runs
// volatile-lru and job keys carry no TTL, nothing could be evicted, so every worker died on
// "OOM command not allowed when used memory > 'maxmemory'" and ECS rolled the release back.
//
// Build every queue through here. A queue that constructs itself is a queue that can forget again,
// which is exactly how six of them did.
export const QUEUE_JOB_RETENTION = {
  removeOnComplete: { count: 48 },
  removeOnFail: { count: 100 },
};

export function createQueue(name: string, redisUrl: string): Queue {
  return new Queue(name, { connection: { url: redisUrl }, defaultJobOptions: QUEUE_JOB_RETENTION });
}
