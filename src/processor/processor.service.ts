import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { finished } from 'stream';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import { VideoProcessPayload } from './types';
import {
  GeneratorConfiguration,
  PreviewConfiguration,
  VideoProcessingSteps,
} from './config';
import { PrismaService } from '../prisma';
import { VideoProcessingStep } from '@prisma/client';
import FormData from 'form-data';
import { randomUUID } from 'node:crypto';
import {
  SERVICE_UPLOADED_THUMBNAIL,
  SERVICE_UPLOADED_VIDEO,
  VIDEO_MANAGER_SVC,
} from './constants';
import { ClientRMQ } from '@nestjs/microservices';
import {
  AddPreviewEvent,
  AddProcessedVideoEvent,
  AddThumbnailEvent,
} from './events';
import { lastValueFrom } from 'rxjs';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { OnEvent } from '@nestjs/event-emitter';

const streamFinished = promisify(finished);

@Injectable()
export class ProcessorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProcessorService.name);
  private runningCommands = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(VIDEO_MANAGER_SVC)
    private readonly videoManagerClient: ClientRMQ,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  onApplicationBootstrap(): void {
    this.videoManagerClient
      .connect()
      .then(() =>
        this.logger.log(`${VIDEO_MANAGER_SVC} connection established`),
      )
      .catch(() => this.logger.error(`${VIDEO_MANAGER_SVC} connection failed`));
  }

  async videoProcess(payload: VideoProcessPayload) {
    const videoProcessingStatus = await this.cacheManager.get(
      `v-${payload.videoId}-status`,
    );
    if (videoProcessingStatus && videoProcessingStatus === 'canceled') return;

    const { filePath, outputFolderPath, folderId } = await this.downloadVideo(
      payload.videoUrl,
    );
    const videoMetadata = await this.probeVideo(filePath);

    const videoStream = videoMetadata.streams.find(
      (x) => x.codec_type === 'video',
    );

    await this.prisma.video.create({
      data: {
        id: payload.videoId,
        creatorId: payload.creatorId,
        videoFileUrl: payload.videoUrl,
        originalFileName: payload.originalFileName,
        width: videoStream.width,
        height: videoStream.height,
        status: 'Pending',
        lockVersion: 0,
        retryCount: 0,
      },
    });

    this.logger.log(
      `Video processing (${payload.videoId}) is queued.
      Creator id: ${payload.creatorId}
      Original filename: ${payload.originalFileName}
      Video file url: ${payload.videoUrl}`,
    );

    await lastValueFrom(
      this.videoManagerClient.send('set_processing_status', {
        videoId: payload.videoId,
        status: 'VideoBeingProcessed',
      }),
    );
    this.logger.log(
      `Video (${payload.videoId}) processing status set to VideoBeingProcessed`,
    );

    await Promise.allSettled([
      this.processVideo(payload, filePath, outputFolderPath, videoStream),
      this.processPreview(payload, filePath, folderId, videoStream),
      this.processThumbnail(payload, filePath, folderId, videoStream),
    ])
      .then(() => {
        this.logger.log(`Emit publish_video for videoId (${payload.videoId})`);
        this.videoManagerClient.emit('publish_video', {
          videoId: payload.videoId,
        });
      })
      .catch(async (e) => {
        this.logger.error(e);
        await lastValueFrom(
          this.videoManagerClient.send('set_processing_status', {
            videoId: payload.videoId,
            status: 'VideoProcessingFailed',
          }),
        );
      })
      .finally(async () => await this.removeTempFileOrFolder(outputFolderPath));
  }

  private async downloadVideo(videoUrl: string) {
    const split = videoUrl.split('/').at(-1).split('.');
    const outputFolderPath = join(process.cwd(), 'processor_output', split[0]);
    const filePath = join(outputFolderPath, `video.${split[1]}`);

    await mkdir(outputFolderPath, { recursive: true });

    const writer = createWriteStream(filePath);

    const response = await axios.get(
      this.configService.get<string>('STORAGE_BASE_URL') + videoUrl,
      { responseType: 'stream' },
    );

    response.data.pipe(writer);
    await streamFinished(writer);

    this.logger.log(`Video to processing downloaded from URI ${videoUrl}`);

    return { filePath, outputFolderPath, folderId: split[0] };
  }

  private async uploadFile(
    filePath: string,
    type: 'videos' | 'images',
    groupId: string,
    category: string,
  ) {
    const formData = new FormData();

    const stream = createReadStream(filePath);
    formData.append('file', stream);

    const videoId = randomUUID();
    const { data } = await axios.post(
      this.configService.get<string>('STORAGE_BASE_URL') +
        `/api/v1/storage/${type}/internal`,
      formData,
      {
        headers: {
          token: this.configService.get<string>('STORAGE_SERVICE_TOKEN'),
          'file-id': videoId,
          'group-id': groupId,
          category,
          ...formData.getHeaders(),
        },
      },
    );
    return data;
  }

  private probeVideo(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  private async processVideo(
    payload: VideoProcessPayload,
    filePath: string,
    outputFolderPath: string,
    videoStream: ffmpeg.FfprobeStream,
  ) {
    return new Promise(async (resolve, reject) => {
      const steps = VideoProcessingSteps.filter(
        (x) => x.height <= videoStream.height,
      );

      const processingSteps: VideoProcessingStep[] = [];
      for (const s of steps) {
        let width = Math.ceil(
          s.height * (videoStream.width / videoStream.height),
        );
        width = Math.ceil(width / 2.0) * 2.0;

        processingSteps.push(
          await this.prisma.videoProcessingStep.create({
            data: {
              videoId: payload.videoId,
              width,
              height: s.height,
              label: s.label,
              bitrate: s.bitrate,
              complete: false,
            },
          }),
        );
      }

      await this.cacheManager.set(`v-${payload.videoId}-status`, 'work');

      for (const s of processingSteps) {
        const videoProcessorStatus = await this.cacheManager.get(
          `v-${payload.videoId}-status`,
        );
        if (videoProcessorStatus === 'canceled') {
          return;
        }

        try {
          const outputFilePath = join(outputFolderPath, `${s.label}.mp4`);
          await new Promise((resolve, reject) => {
            const cmd = ffmpeg(filePath);
            cmd
              .inputOption(this.buildInputOption())
              .outputOption(
                this.buildTranscodeOutputOption(s.width, s.height, s.bitrate),
              )
              .output(outputFilePath)
              .on('error', (err: any) => {
                reject(err);
              })
              .on('end', async () => {
                await this.prisma.videoProcessingStep.update({
                  where: { id: s.id },
                  data: { complete: true },
                });
                this.logger.log(
                  `Video ${s.label} processing finished, uploading to storage...`,
                );
                const { id, url } = await this.uploadFile(
                  outputFilePath,
                  'videos',
                  s.videoId,
                  SERVICE_UPLOADED_VIDEO,
                );
                this.logger.log(`Video ${s.label} uploaded to storage.`);
                await this.removeTempFileOrFolder(outputFilePath);
                this.logger.log(
                  `Emit add_processed_video for video (${s.videoId})`,
                );
                this.videoManagerClient.emit(
                  'add_processed_video',
                  new AddProcessedVideoEvent(id, s.videoId, url, s.label),
                );
                resolve(true);
              })
              .run();

            this.runningCommands.set(`v-${s.videoId}-${s.label}`, cmd);
          });
        } catch (e) {
          this.logger.error(e);
          reject(e);
        }
      }

      await this.removeTempFileOrFolder(filePath);
      resolve(true);
    });
  }

  private async processPreview(
    payload: VideoProcessPayload,
    filePath: string,
    folderId: string,
    videoStream: ffmpeg.FfprobeStream,
  ) {
    return new Promise(async (resolve, reject) => {
      try {
        const thumbnailId = randomUUID();
        const outputThumbnailPath = join(
          process.cwd(),
          'processor_output',
          folderId,
          thumbnailId + '.webp',
        );

        const height = Math.min(
          videoStream.height,
          PreviewConfiguration.previewThumbnailHeight,
        );
        let width = Math.ceil(
          height * (videoStream.width / videoStream.height),
        );
        width = Math.ceil((width / 2.0) * 2.0);

        let startPositionSeconds =
          +videoStream.duration *
          PreviewConfiguration.previewThumbnailStartPosition;
        const lengthSeconds = Math.min(
          +videoStream.duration,
          PreviewConfiguration.previewThumbnailLengthSeconds,
        );
        if (
          +videoStream.duration - startPositionSeconds <
          PreviewConfiguration.previewThumbnailLengthSeconds
        ) {
          startPositionSeconds = 0.0;
        }

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(filePath);
          cmd
            .inputOption(this.buildInputOption())
            .outputOption(
              this.buildPreviewOutputOption(
                width,
                height,
                startPositionSeconds,
                lengthSeconds,
              ),
            )
            .output(outputThumbnailPath)
            .on('error', (err: any) => {
              reject(err);
            })
            .on('end', async () => {
              this.logger.log(
                `Video preview (${thumbnailId}) processing finished, uploading to storage...`,
              );
              const { id, url } = await this.uploadFile(
                outputThumbnailPath,
                'images',
                payload.videoId,
                SERVICE_UPLOADED_THUMBNAIL,
              );
              this.logger.log(
                `Video preview to video (${payload.videoId}) uploaded to storage.`,
              );
              await this.removeTempFileOrFolder(outputThumbnailPath);
              this.logger.log(`Emit add_preview to video (${payload.videoId})`);
              this.videoManagerClient.emit(
                'add_preview',
                new AddPreviewEvent(id, url, payload.videoId),
              );
              resolve(true);
            })
            .run();

          this.runningCommands.set(`v-${payload.videoId}-preview`, cmd);
        });
        resolve(true);
      } catch (e) {
        this.logger.error(e);
        this.videoManagerClient.emit('preview_generate_failed', payload);
        reject(e);
      }
    });
  }

  private async processThumbnail(
    payload: VideoProcessPayload,
    filePath: string,
    folderId: string,
    videoStream: ffmpeg.FfprobeStream,
  ) {
    return new Promise(async (resolve, reject) => {
      try {
        const outputFilePath = join(
          process.cwd(),
          'processor_output',
          folderId,
        );
        const height = Math.min(videoStream.height, 360);
        let width = Math.ceil(
          height * (videoStream.width / videoStream.height),
        );
        width = Math.ceil((width / 2.0) * 2.0);

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(filePath);
          cmd
            .on('error', (err: any) => {
              reject(err);
            })
            .on('end', async () => {
              this.logger.log(
                `Thumbnails for video (${payload.videoId}) generated to folder (${folderId}), uploading to storage...`,
              );

              const thumbnails: any[] = [];
              for (let i = 1; i <= 3; i++) {
                const path = join(outputFilePath, `tn_${i}.png`);
                const { id, url } = await this.uploadFile(
                  path,
                  'images',
                  payload.videoId,
                  SERVICE_UPLOADED_THUMBNAIL,
                );
                await this.removeTempFileOrFolder(path);
                thumbnails.push({ imageFileId: id, url });
              }
              this.logger.log(`Thumbnails uploaded to storage.`);
              this.logger.log(
                `Emit add_thumbnails to video (${payload.videoId})`,
              );
              this.videoManagerClient.emit(
                'add_thumbnails',
                new AddThumbnailEvent(payload.videoId, thumbnails),
              );
              resolve(true);
            })
            .thumbnails({
              count: 3,
              folder: outputFilePath,
              filename: 'tn_%i.png',
              size: `${width}x${height}`,
              timemarks: ['10%', '25%', '50%'],
            });

          this.runningCommands.set(`v-${payload.videoId}-thumbnails`, cmd);
        });
      } catch (e) {
        this.logger.error(e);
        this.videoManagerClient.emit('thumbnails_generate_failed', payload);
        reject(e);
      }
      resolve(true);
    });
  }

  private buildInputOption() {
    const args: string[] = [];

    if (this.configService.get<boolean>('HWACCEL_ENABLED')) {
      args.push(`-hwaccel ${GeneratorConfiguration.hardwareAccelerator}`);
    }

    return args;
  }

  private buildTranscodeOutputOption(
    width: number,
    height: number,
    bitrate: number,
  ) {
    const args: string[] = [];

    args.push(`-s ${width}x${height}`);
    args.push(`-b:v ${bitrate}k`);
    args.push('-c:a aac');
    args.push(`-c:v ${this.getHwaccelEncoder()}`);

    return args;
  }

  private buildPreviewOutputOption(
    width: number,
    height: number,
    startPositionSeconds: number,
    lengthSeconds: number,
  ) {
    const args: string[] = [];

    args.push(`-s ${width}x${height}`);
    args.push('-r 12.000');
    args.push('-loop 0');
    args.push('-c:v webp');
    args.push(`-ss ${this.toFFmpegTime(startPositionSeconds)}`);
    args.push(`-t ${this.toFFmpegTime(lengthSeconds)}`);

    return args;
  }

  private toFFmpegTime(positionSeconds: number): string {
    const timespan = new Date(positionSeconds * 1000);
    const hours = timespan.getUTCHours();
    const minutes = timespan.getUTCMinutes();
    const seconds = timespan.getUTCSeconds();
    const milliseconds = timespan.getUTCMilliseconds();

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }

  private getHwaccelEncoder() {
    const hwaccelEnabled = this.configService.get<boolean>('HWACCEL_ENABLED');

    if (hwaccelEnabled) {
      const vendorName = this.configService.get('GPU_VENDOR');
      switch (vendorName) {
        case 'apple':
          return GeneratorConfiguration.hardwareAccelerationEncoder
            .appleSilicon;
        case 'nvidia':
          return GeneratorConfiguration.hardwareAccelerationEncoder.nvidia;
        case 'intel':
        case 'amd':
      }
    }

    return 'h264';
  }

  private async removeTempFileOrFolder(path: string) {
    await rm(path, { recursive: true, force: true });
  }

  @OnEvent('cancel-processor', { async: true, promisify: true })
  async handleStopProcessor(payload: { videoId: string }) {
    const commands = [...this.runningCommands].filter((x) =>
      x[0].startsWith(`v-${payload.videoId}`),
    );

    commands.forEach((cmd) => {
      cmd[1].kill('SIGKILL');
      this.runningCommands.delete(cmd[0]);
    });

    await Promise.all([
      this.prisma.video.delete({ where: { id: payload.videoId } }),
      this.removeTempFileOrFolder(
        join(process.cwd(), 'processor_output', payload.videoId),
      ),
    ]);
  }
}
