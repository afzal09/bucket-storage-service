import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ObjectEvent {
  type: 'ObjectCreated' | 'ObjectRemoved';
  bucketName: string;
  key: string;
  versionId: string;
  size?: number;
}

/**
 * Thin wrapper over EventEmitter2 — an in-process pub/sub used in place of
 * the BullMQ+Redis queue the HLD originally sketched for notifications.
 * ObjectsService depends on this interface, not on EventEmitter2 directly,
 * so swapping in a real queue later (for cross-process delivery, retries
 * that survive a restart, etc.) only means changing this one class.
 */
@Injectable()
export class EventPublisherService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async publish(event: ObjectEvent): Promise<void> {
    this.eventEmitter.emit(event.type, event);
  }
}
