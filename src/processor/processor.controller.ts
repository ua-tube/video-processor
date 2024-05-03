import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { VideoProcessPayload } from './types';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Controller()
export class ProcessorController {
  constructor(
    @InjectQueue('processor')
    private readonly processorQueue: Queue,
  ) {}

  @EventPattern('process_video')
  async handleVideoProcess(@Payload() payload: VideoProcessPayload) {
    await this.processorQueue.add('process-video', payload);
  }
}
