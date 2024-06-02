import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { PlaylistProcessingStep, VideoProcessPayload } from '../types';
import { PrismaService } from '../../prisma';
import { VideoProcessingStatus, VideoProcessingStep } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SERVICE_UPLOADED_THUMBNAIL, VIDEO_MANAGER_SVC } from '../constants';
import { ClientRMQ } from '@nestjs/microservices';
import {
  AddPreviewEvent,
  AddProcessedVideoEvent,
  AddThumbnailEvent,
} from '../events';
import { lastValueFrom } from 'rxjs';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { removeTempFileOrFolder } from '../utils';
import { FfmpegService } from './ffmpeg.service';
import { HlsService } from './hls.service';
import { NetworkService } from './network.service';
import { FfprobeFormat, FfprobeStream } from 'fluent-ffmpeg';
import { PREVIEW_CONFIG, RESOLUTIONS } from '../config';

@Injectable()
export class ProcessorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIDEO_MANAGER_SVC)
    private readonly videoManagerClient: ClientRMQ,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    @Inject(FfmpegService)
    private readonly ffmpegService: FfmpegService,
    @Inject(HlsService)
    private readonly hlsService: HlsService,
    @Inject(NetworkService)
    private readonly networkService: NetworkService,
  ) {}

  onApplicationBootstrap(): void {
    this.videoManagerClient
      .connect()
      .then(() =>
        this.logger.log(`${VIDEO_MANAGER_SVC} connection established`),
      )
      .catch(() => this.logger.error(`${VIDEO_MANAGER_SVC} connection failed`));
  }

  async start(payload: VideoProcessPayload) {
    const videoProcessingStatus = await this.cacheManager.get(
      `v-${payload.videoId}-status`,
    );

    if (videoProcessingStatus && videoProcessingStatus === 'canceled') {
      this.logger.warn(`Video (${payload.videoId}) process was canceled`);
      return;
    }

    const { filePath, outputFolderPath, folderId } =
      await this.networkService.downloadVideo(payload.videoUrl);

    const videoMetadata = await this.ffmpegService.probe(filePath);
    const videoStream = videoMetadata.streams.find(
      (x) => x.codec_type === 'video',
    );
    const format = videoMetadata.format;
    const isHaveAudioTrack = videoMetadata.streams.some(
      (x) => x.codec_type === 'audio',
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

    try {
      await Promise.all([
        this.updateVideoStatus(payload.videoId, 'ProcessingThumbnails'),
        this.processPreview(payload, filePath, folderId, videoStream, format),
        this.processThumbnail(payload, filePath, folderId, videoStream),
      ]);

      await Promise.all([
        this.updateVideoStatus(payload.videoId, 'ProcessingVideos'),
        this.processVideo(
          payload,
          filePath,
          outputFolderPath,
          videoStream,
          isHaveAudioTrack,
        ),
      ]);

      this.logger.log(
        `Emit video_process_finished for videoId (${payload.videoId})`,
      );
      this.videoManagerClient.emit('video_process_finished', {
        videoId: payload.videoId,
      });
      await removeTempFileOrFolder(outputFolderPath);
    } catch (e) {
      this.logger.error(e);
      await lastValueFrom(
        this.videoManagerClient.send('set_processing_status', {
          videoId: payload.videoId,
          status: 'VideoProcessingFailed',
        }),
      );
    }
  }

  private async processVideo(
    payload: VideoProcessPayload,
    filePath: string,
    outputFolderPath: string,
    videoStream: FfprobeStream,
    isHaveAudioTrack: boolean,
  ) {
    return new Promise(async (resolve, reject) => {
      const steps = RESOLUTIONS.filter((x) => x.height <= videoStream.height);

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
      const playlistProcessingSteps: PlaylistProcessingStep[] = [];

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
            const cmd = this.ffmpegService.ffmpeg(filePath);
            cmd
              .inputOption(this.ffmpegService.buildInputOption())
              .outputOption(
                this.ffmpegService.buildTranscodeOutputOption(
                  s.width,
                  s.height,
                  s.bitrate,
                  isHaveAudioTrack,
                ),
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

                const hlsFolder = join(outputFolderPath, s.label);
                await mkdir(hlsFolder, { recursive: true });
                this.ffmpegService
                  .ffmpeg(outputFilePath)
                  .inputOption(this.ffmpegService.buildInputOption())
                  .outputOptions(
                    this.ffmpegService.buildHlsOutputOptions(
                      hlsFolder,
                      s.label,
                    ),
                  )
                  .output(join(hlsFolder, `${s.label}.m3u8`))
                  .on('end', async () => {
                    this.logger.log(`HLS for ${s.label} generated`);

                    const hlsId = await this.networkService.uploadHls(
                      hlsFolder,
                      s.videoId,
                    );

                    this.logger.log(`HLS ${s.label} uploaded to storage.`);
                    this.logger.log(
                      `Emit add_processed_video for video (${s.videoId})`,
                    );

                    const { streams, format } =
                      await this.ffmpegService.probe(outputFilePath);

                    const lengthSeconds =
                      s.label === '144p'
                        ? Math.floor(
                            Number(
                              format?.duration ||
                                streams?.[0]?.duration ||
                                streams?.[1]?.duration,
                            ) || 0,
                          )
                        : null;

                    this.videoManagerClient.emit(
                      'add_processed_video',
                      new AddProcessedVideoEvent(
                        s.videoId,
                        s.label,
                        lengthSeconds,
                      ),
                    );

                    playlistProcessingSteps.push({
                      ...s,
                      hlsId,
                    });

                    const masterFilePath = await this.hlsService.writePlaylist(
                      outputFolderPath,
                      playlistProcessingSteps,
                    );
                    await this.networkService.uploadHlsMaster(
                      masterFilePath,
                      payload.videoId,
                    );

                    resolve(true);
                  })
                  .run();
              })
              .run();

            this.ffmpegService.setCommand(`v-${s.videoId}-${s.label}`, cmd);
          });
        } catch (e) {
          this.logger.error(e);
          reject(e);
        } finally {
          this.ffmpegService.deleteCommand(`v-${s.videoId}-${s.label}`);
        }
      }

      resolve(true);
    });
  }

  private async processPreview(
    payload: VideoProcessPayload,
    filePath: string,
    folderId: string,
    videoStream: FfprobeStream,
    format: FfprobeFormat,
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
          PREVIEW_CONFIG.previewThumbnailHeight,
        );
        let width = Math.ceil(
          height * (videoStream.width / videoStream.height),
        );
        width = Math.ceil((width / 2.0) * 2.0);

        let startPositionSeconds =
          format.duration * PREVIEW_CONFIG.previewThumbnailStartPosition;
        const lengthSeconds = Math.min(
          +videoStream.duration,
          PREVIEW_CONFIG.previewThumbnailLengthSeconds,
        );
        if (
          +videoStream.duration - startPositionSeconds <
          PREVIEW_CONFIG.previewThumbnailLengthSeconds
        ) {
          startPositionSeconds = 0.0;
        }

        await new Promise((resolve, reject) => {
          const cmd = this.ffmpegService.ffmpeg(filePath);
          cmd
            .inputOption(this.ffmpegService.buildInputOption())
            .outputOption(
              this.ffmpegService.buildPreviewOutputOption(
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
              const { id, url } = await this.networkService.uploadImage(
                outputThumbnailPath,
                payload.videoId,
                SERVICE_UPLOADED_THUMBNAIL,
              );
              this.logger.log(
                `Video preview to video (${payload.videoId}) uploaded to storage.`,
              );
              this.logger.log(`Emit add_preview to video (${payload.videoId})`);
              this.videoManagerClient.emit(
                'add_preview',
                new AddPreviewEvent(id, url, payload.videoId),
              );
              resolve(true);
            })
            .run();

          this.ffmpegService.setCommand(`v-${payload.videoId}-preview`, cmd);
        });
        resolve(true);
      } catch (e) {
        this.logger.error(e);
        this.videoManagerClient.emit('preview_generate_failed', payload);
        reject(e);
      } finally {
        this.ffmpegService.deleteCommand(`v-${payload.videoId}-preview`);
      }
    });
  }

  private async processThumbnail(
    payload: VideoProcessPayload,
    filePath: string,
    folderId: string,
    videoStream: FfprobeStream,
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
          const cmd = this.ffmpegService.ffmpeg(filePath);
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
                const filePath = join(outputFilePath, `tn_${i}.png`);
                const { id, url } = await this.networkService.uploadImage(
                  filePath,
                  payload.videoId,
                  SERVICE_UPLOADED_THUMBNAIL,
                );
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

          this.ffmpegService.setCommand(`v-${payload.videoId}-thumbnails`, cmd);
        });
      } catch (e) {
        this.logger.error(e);
        this.videoManagerClient.emit('thumbnails_generate_failed', payload);
        reject(e);
      } finally {
        this.ffmpegService.deleteCommand(`v-${payload.videoId}-thumbnails`);
      }
      resolve(true);
    });
  }

  private async updateVideoStatus(
    videoId: string,
    status: VideoProcessingStatus,
  ) {
    await this.prisma.video.update({
      where: { id: videoId },
      data: {
        status,
        processedAt: status === 'Processed' ? new Date() : undefined,
      },
    });
  }
}
