import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { VideoProcessPayload } from './types';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CancelProcessVideoDto } from './dto';
import { CancelProcessAuthGuard } from '../common/guards';

@Controller('processor')
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

  @UseGuards(CancelProcessAuthGuard)
  @Post('internal/cancel')
  async handleCancelVideoProcess(@Body() dto: CancelProcessVideoDto) {
    this.eventEmitter.emit('cancel-process', dto);
  }
}
