import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { finished } from 'stream';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import { VideoProcessPayload } from './types';
import { GeneratorConfiguration, VideoProcessingSteps } from './config';
import { PrismaService } from '../prisma';
import { VideoProcessingStep } from '@prisma/client';
import FormData from 'form-data';
import { randomUUID } from 'node:crypto';
import { SERVICE_UPLOADED_VIDEO } from './constants';

const streamFinished = promisify(finished);

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async videoProcess(payload: VideoProcessPayload) {
    const { filePath, outputFolderPath } = await this.downloadVideo(
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

    await this.processVideo(payload, filePath, outputFolderPath, videoStream);
  }

  private async downloadVideo(videoUrl: string) {
    const split = videoUrl.split('/').at(-1).split('.');
    const outputFolderPath = join(process.cwd(), '.tmp', split[0]);
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

    return { filePath, outputFolderPath };
  }

  private async uploadVideo(videoPath: string, groupId: string) {
    const formData = new FormData();

    const stream = createReadStream(videoPath);
    formData.append('file', stream);

    const videoId = randomUUID();
    const { data } = await axios.post(
      this.configService.get<string>('STORAGE_BASE_URL') +
        '/api/v1/storage/videos/internal',
      formData,
      {
        headers: {
          token: this.configService.get<string>('STORAGE_SERVICE_TOKEN'),
          'file-id': videoId,
          'group-id': groupId,
          category: SERVICE_UPLOADED_VIDEO,
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

      for (const s of processingSteps) {
        try {
          const outputFilePath = join(outputFolderPath, `${s.label}.mp4`);
          await new Promise((resolve, reject) => {
            ffmpeg()
              .input(filePath)
              .inputOption(this.buildInputOption())
              .outputOption(
                this.buildOutputOption(s.width, s.height, s.bitrate),
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
                await this.uploadVideo(outputFilePath, s.videoId);
                this.logger.log(`Video ${s.label} uploaded to storage.`);
                resolve(true);
              })
              .run();
          });
        } catch (e) {
          this.logger.error(e);
          reject(e);
        }
      }

      await this.removeTempFile(filePath);
      resolve(true);
    });
  }

  private buildInputOption() {
    const args: string[] = [];

    if (this.configService.get<boolean>('HWACCEL_ENABLED')) {
      args.push(
        `-hwaccel ${GeneratorConfiguration.hardwareAcceleration.hardwareAccelerator}`,
      );
      args.push(`-hwaccel_device ${GeneratorConfiguration.device}`);
      args.push(`-c:v ${GeneratorConfiguration.hardwareAcceleration.decoder}`);
    } else {
      args.push('-c:v h264');
    }

    return args;
  }

  private buildOutputOption(width: number, height: number, bitrate: number) {
    const args: string[] = [];

    args.push(`-s ${width}x${height}`);
    args.push(`-b:v ${bitrate}k`);
    args.push('-c:a aac');
    args.push(
      `-c:v ${
        this.configService.get<boolean>('HWACCEL_ENABLED')
          ? GeneratorConfiguration.hardwareAcceleration.encoder
          : 'h264'
      }`,
    );

    return args;
  }

  private async removeTempFile(filePath: string) {
    await rm(filePath, { force: true });
  }
}
