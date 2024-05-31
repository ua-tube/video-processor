import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { VideoProcessPayload } from './types';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CancelProcessVideoDto } from './dto';
import { ackMessage } from '../common/utils';

@Controller('processor')
export class ProcessorController {
  constructor(
    @InjectQueue('processor')
    private readonly processorQueue: Queue,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @EventPattern('process_video')
  async handleVideoProcess(
    @Payload() payload: VideoProcessPayload,
    @Ctx() context: RmqContext,
  ) {
    await this.processorQueue.add('process-video', payload);
    ackMessage(context);
  }

  @EventPattern('process_video_cancel')
  async handleCancelVideoProcess(
    @Payload() payload: CancelProcessVideoDto,
    @Ctx() context: RmqContext,
  ) {
    this.eventEmitter.emit('cancel-process', payload);
    ackMessage(context);
  }
}
