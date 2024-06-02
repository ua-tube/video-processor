import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CancelProcessVideoDto } from '../../dto';
import { FfmpegService } from '../../services';
import { PrismaService } from '../../../prisma';
import { removeTempFileOrFolder } from '../../utils';
import { join } from 'node:path';

@Injectable()
export class ProcessorEventListener {
  constructor(
    private readonly ffmpegService: FfmpegService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('cancel-process', { async: true, promisify: true })
  async handleStopProcessor(payload: CancelProcessVideoDto) {
    const commands = [...this.ffmpegService.runnningCommands].filter((x) =>
      x[0].startsWith(`v-${payload.videoId}`),
    );

    commands.forEach(([key, command]) => {
      command.kill('SIGKILL');
      this.ffmpegService.deleteCommand(key);
    });

    await Promise.all([
      this.prisma.video.delete({ where: { id: payload.videoId } }),
      removeTempFileOrFolder(
        join(process.cwd(), 'processor_output', payload.videoId),
      ),
    ]);
  }
}
