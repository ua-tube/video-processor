import { Injectable, Logger } from '@nestjs/common';
import {
  OnQueueActive,
  OnQueueCompleted,
  OnQueueFailed,
  Process,
  Processor as BullProcessor,
} from '@nestjs/bull';
import { Job } from 'bull';
import { VIDEO_PROCESSOR_CONFIG } from './config';
import { ProcessorService } from './services';
import { VideoProcessPayload } from './types';

@Injectable()
@BullProcessor({ name: 'processor' })
export class Processor {
  private readonly logger = new Logger(Processor.name);

  constructor(private readonly processorService: ProcessorService) {}

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`Job: (${job.name}), id: (${job.id}) started`);
  }

  @OnQueueFailed()
  async onFailed(job: Job) {
    this.logger.error(`Job: (${job.name}), id: (${job.id}) failed`);
    if (job.attemptsMade < VIDEO_PROCESSOR_CONFIG.maxRetryCount) {
      await new Promise((resolve) =>
        setTimeout(resolve, VIDEO_PROCESSOR_CONFIG.retryDelayMs),
      );
      this.logger.log(
        `Job: (${job.name}), id: (${job.id}) attempt #${job.attemptsMade + 1} started`,
      );
      return job.retry();
    }

    this.logger.log(
      `Job: (${job.name}), id: (${job.id}) stopped because of attempts max count limit`,
    );
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.log(`Job: (${job.name}), id: (${job.id}) completed`);
  }

  @Process({ name: 'process-video', concurrency: 3 })
  async processVideo(job: Job<VideoProcessPayload>) {
    await this.processorService.start(job.data);
  }
}
