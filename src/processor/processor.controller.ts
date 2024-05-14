import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { VideoProcessPayload } from './types';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Controller()
export class ProcessorController {
  constructor(
    @InjectQueue('processor')
    private readonly processorQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @EventPattern('process_video')
  async handleVideoProcess(@Payload() payload: VideoProcessPayload) {
    await this.processorQueue.add('process-video', payload);
  }

  @EventPattern('cancel_video_process')
  async handleCancelVideoProcess(
    @Payload() payload: Pick<VideoProcessPayload, 'videoId'>,
  ) {
    this.eventEmitter.emit('cancel-process', payload);
  }
}
